import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { dataDirectory } from './dataDirectory.js'
import { setTimeout as delay } from 'node:timers/promises'
import express from 'express'
import { exportPdf } from './documentExports.js'
import { renderProposalDocument } from './proposalPdf.js'
import { productionStages, stageLabel, serviceDetails, readStageLayout, validStageLayout } from './serviceStages.js'
import { consumeOrderMaterials } from './orderMaterials.js'
import { workflowSnapshot, recordWorkflowNotifications } from './notificationEvents.js'
import { assignMaterialRequestCodes } from './materialRequestCodes.js'
import { adminIdentity } from './accounts.js'
import { recordOrderEvent } from './orderHistory.js'
import { cleanStageTimes, pieceTracking } from './pieces.js'
import { proposalMargins, PROPOSAL_MARGIN_GAP, declineReasons } from './proposalMath.js'
import { requireAdminOrOperator } from './access.js'
import { documentKind, isClientDocument } from './clientDocument.js'

const filesDirectory = path.join(dataDirectory, 'files')
const storePath = path.join(dataDirectory, 'offers.json')
const router = express.Router()
let pendingWrite = Promise.resolve()

export async function readStore() {
  try {
    return JSON.parse(await readFile(storePath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return { offers: [], orders: [], employees: [] }
    throw error
  }
}

async function writeStore(store) {
  const temporaryPath = `${storePath}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, JSON.stringify(store, null, 2), 'utf8')
  // Windows may temporarily lock the destination during reads or antivirus scans.
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporaryPath, storePath); break } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error
      await delay(20 * (attempt + 1))
    }
  }
}

export function mutateStore(change, { commit, rollback } = {}) {
  const operation = pendingWrite.catch(() => {}).then(async () => {
    await mkdir(dataDirectory, { recursive: true })
    const store = await readStore()
    const previous = commit ? structuredClone(store) : null
    const notificationsBefore = workflowSnapshot(store)
    try {
      const result = await change(store)
      recordWorkflowNotifications(notificationsBefore, store)
      assignMaterialRequestCodes(store)
      await writeStore(store)
      try { await commit?.() } catch (error) {
        // Keep the JSON metadata aligned if the SQL transaction cannot commit.
        await writeStore(previous)
        throw error
      }
      return result
    } catch (error) {
      await rollback?.()
      throw error
    }
  })
  pendingWrite = operation
  return operation
}

const handleError = (response, error) => {
  if (error.status) return response.status(error.status).json({ message: error.message })
  console.error('Falha ao salvar oferta:', error)
  response.status(500).json({ message: 'Não foi possível salvar os dados da oferta.' })
}

const clean = (value, limit = 500) => String(value ?? '').trim().slice(0, limit)
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const date = (value) => new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
const stageKeys = productionStages.map(([key]) => key)

function serviceSettings(offer) {
  return { stages: offer.resources?.stages ?? offer.proposal?.stages ?? [], kind: offer.resources?.kind ?? offer.proposal?.kind ?? 'service', strictProcess: serviceDetails(offer.resources).strictProcess }
}

function nextCode(prefix, rows) {
  const year = new Date().getFullYear()
  const start = `${prefix}-${year}-`
  const maximum = rows.reduce((max, row) => row.code?.startsWith(start) ? Math.max(max, Number(row.code.slice(start.length)) || 0) : max, 0)
  return `${start}${String(maximum + 1).padStart(4, '0')}`
}

// What the customer pays: the OS value when the proposal has one; older proposals kept the price in the service value.
// The service value of a proposal with an OS value is the internal cost and never goes to the customer.
const chargedValue = (proposal) => Number(proposal.osValue ?? proposal.serviceValue ?? 0)

// The proposal goes to the customer: internal cost and profit information never appears in it (margin, gross profit,
// material and labor costs, unit prices). Materials and labor are listed only by name and quantity.
export function proposalSections(offer, proposal, resources) {
  const facts = (name, entries) => ({ name, records: true, singleRecord: true, columns: entries.map(([label]) => label), rows: [entries.map(([, value]) => value)] })
  const sections = [
    facts('Dados da solicitação', [['Serviço', offer.service], ['Cliente', offer.company], [documentKind(offer.cnpj), offer.cnpj], ['Número da etiqueta', offer.labelNumber], ['Quantidade', offer.quantity], ['Prazo solicitado', date(offer.deadline)]]),
    facts('Descrição do serviço', [['Descrição', offer.description], ...(resources.serviceDescription ? [['Detalhes do serviço', resources.serviceDescription]] : [])]),
    { name: 'Materiais necessários', columns: ['Material', 'Especificação', 'Quantidade (kg)'], rows: (resources.materials || []).map((item) => [item.name, item.detail, Number(item.quantity)]) },
    { name: 'Mão de obra', columns: ['Recurso', 'Horas previstas'], rows: (resources.laborEntries || []).map((item) => [item.resource, Number(item.hours)]) },
    facts('Condições da proposta', [['Opção', `${proposal.key} · ${proposal.title || `Opção ${proposal.key}`}`], ['Prazo de entrega', proposal.deadline], ['Valor do serviço', chargedValue(proposal)], ['Desconto (%)', Number(proposal.discount || 0)], ['Tempo de máquina', proposal.machine], ['Tempo de serviço', proposal.serviceTime]]),
    facts('Processo de fabricação', [['Etapas', (proposal.stages || []).map(stageLabel).join(' > ') || 'A definir'], ['Processo', serviceDetails(resources).strictProcess ? 'Sequência obrigatória' : 'Etapas livres'], ['Tipo', proposal.kind === 'product' ? 'Produto' : 'Serviço'], ['Fabricado a partir de', resources.manufacturedFrom === 'sample' ? 'Amostra' : resources.manufacturedFrom === 'drawing' ? 'Desenho' : 'Não informado'], ['Têmpera', resources.tempering === true ? 'Sim' : resources.tempering === false ? 'Não' : 'Não informada'], ...(resources.stages?.includes('painting') ? [['Cor/Tipo', resources.paintColor || 'Não informado']] : [])]),
  ]
  if (offer.attachments?.length) sections.push({ name: 'Documentos vinculados', columns: ['Arquivo'], rows: offer.attachments.map((item) => [item.name]) })
  return sections
}

function createPdf(offer, proposal, resources, layout, generatedAt = new Date().toISOString()) {
  const sections = proposalSections(offer, proposal, resources)
  return exportPdf({ title: `Proposta ${offer.code}`, eyebrow: 'Proposta comercial', highlight: true, generatedAt, summary: [['Valor do serviço', money(chargedValue(proposal))], ['Prazo de entrega', proposal.deadline], ['Cliente', offer.company]], notes: [], sections }, { layout, orientation: 'portrait' })
}

router.get('/offers', async (_request, response) => {
  try { response.json({ items: (await readStore()).offers }) } catch (error) { handleError(response, error) }
})

router.get('/orders', async (_request, response) => {
  try { response.json({ items: (await readStore()).orders }) } catch (error) { handleError(response, error) }
})

router.post('/offers', async (request, response) => {
  const { cnpj, company, deadline, service, quantity, description, labelNumber } = request.body ?? {}
  if (!isClientDocument(cnpj) || !clean(company) || !/^\d{4}-\d{2}-\d{2}$/.test(String(deadline || '')) || !clean(service) || !Number.isInteger(Number(quantity)) || Number(quantity) < 1 || !clean(description)) {
    return response.status(400).json({ message: 'Preencha CNPJ (14 dígitos) ou CPF (11), empresa, prazo, peça/serviço, quantidade e descrição.' })
  }
  try {
    const offer = await mutateStore((store) => {
      const item = { id: randomUUID(), code: nextCode('OF', store.offers), cnpj: clean(cnpj, 18), company: clean(company, 160), deadline, service: clean(service, 160), quantity: Number(quantity), description: clean(description, 5000), labelNumber: clean(labelNumber, 80), requestedAt: new Date().toISOString(), origin: 'Inserida Manualmente', status: 'review', attachments: [], resources: { materials: [], laborEntries: [] }, proposal: null, orderCode: null }
      store.offers.unshift(item)
      return item
    })
    response.status(201).json({ item: offer })
  } catch (error) { handleError(response, error) }
})

router.put('/offers/:id/resources', async (request, response) => {
  const resources = request.body ?? {}
  if (!Array.isArray(resources.materials) || !Array.isArray(resources.laborEntries)) return response.status(400).json({ message: 'Recursos inválidos.' })
  if (resources.stages !== undefined && (!Array.isArray(resources.stages) || resources.stages.some((stage) => !stageKeys.includes(stage)))) return response.status(400).json({ message: 'Etapas inválidas.' })
  if (resources.stageLayout !== undefined && !validStageLayout(resources.stageLayout)) return response.status(400).json({ message: 'Ordem dos grupos ou subetapas inválida.' })
  if (resources.kind !== undefined && !['service', 'product'].includes(resources.kind)) return response.status(400).json({ message: 'Tipo inválido.' })
  if (resources.manufacturedFrom != null && !['sample', 'drawing'].includes(resources.manufacturedFrom)) return response.status(400).json({ message: 'Origem de fabricação inválida.' })
  if (resources.tempering != null && typeof resources.tempering !== 'boolean') return response.status(400).json({ message: 'Têmpera inválida.' })
  if (resources.urgency != null && !['normal', 'emergency'].includes(resources.urgency)) return response.status(400).json({ message: 'Tipo de proposta inválido.' })
  if (resources.strictProcess !== undefined && typeof resources.strictProcess !== 'boolean') return response.status(400).json({ message: 'Informe se o processo segue uma sequência obrigatória.' })
  if (['paintColor', 'serviceDescription'].some((field) => resources[field] != null && typeof resources[field] !== 'string')) return response.status(400).json({ message: 'Descrição inválida.' })
  try {
    const offer = await mutateStore((store) => {
      const item = store.offers.find((entry) => entry.id === request.params.id)
      if (!item || item.orderCode || item.status === 'rejected') return null
      const settings = serviceSettings(item)
      const materials = resources.materials.map((material) => {
        const previous = item.resources?.materials?.find((entry) => entry.id === material.id)
        const { requestedBy, requestedByName, requestedAt, requestedQuantity, requestRejection, requestReceipt, requestReceipts, ...fields } = material
        return { ...fields, requestedAt: previous?.requestedAt || (previous ? item.requestedAt : new Date().toISOString()), requestedBy: previous?.requestedBy ?? (previous ? null : request.adminId ?? null), requestedByName: previous?.requestedByName ?? (previous ? null : request.adminName || null), requestedQuantity: previous?.requestedQuantity ?? Number(material.purchaseQuantity ?? material.quantity), ...(previous?.requestRejection ? { requestRejection: previous.requestRejection } : {}), ...(previous?.requestReceipt ? { requestReceipt: previous.requestReceipt, requestReceipts: previous.requestReceipts } : {}) }
      })
      const nextResources = { materials, laborEntries: resources.laborEntries, stages: [...new Set(resources.stages ?? settings.stages)], stageLayout: readStageLayout({ stages: resources.stages ?? settings.stages, stageLayout: resources.stageLayout ?? item.resources?.stageLayout }), kind: resources.kind ?? settings.kind, ...serviceDetails({ ...item.resources, ...resources }), paintColor: clean(resources.paintColor ?? item.resources?.paintColor, 160), serviceDescription: clean(resources.serviceDescription ?? item.resources?.serviceDescription, 5000) }
      nextResources.stageTimes = cleanStageTimes(resources.stageTimes ?? item.resources?.stageTimes, nextResources.stages)
      // Normal/Emergencial only labels the offer inside the system; changing it keeps the proposal already made.
      // The planned stage times only measure the team; they do not change the price, so the proposal is kept too.
      const comparable = (value) => JSON.stringify({ ...value, urgency: undefined, stageTimes: undefined })
      if (comparable(item.resources) !== comparable(nextResources)) {
        item.proposal = null
        item.status = 'review'
      }
      item.resources = nextResources
      return item
    })
    if (!offer) return response.status(404).json({ message: 'Oferta não encontrada, já aceita ou recusada.' })
    response.json({ item: offer })
  } catch (error) { handleError(response, error) }
})

router.post('/offers/:id/attachments', express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (request, response) => {
  const filename = clean(request.query.name, 180)
  if (!filename || !Buffer.isBuffer(request.body) || !request.body.length) return response.status(400).json({ message: 'Selecione um arquivo válido.' })
  try {
    const existing = (await readStore()).offers.find((entry) => entry.id === request.params.id)
    if (!existing || existing.status === 'rejected') return response.status(404).json({ message: 'Oferta não encontrada ou recusada.' })
    await mkdir(filesDirectory, { recursive: true })
    const attachment = { id: randomUUID(), name: path.basename(filename), size: request.body.length, contentType: clean(request.query.type, 100) || 'application/octet-stream' }
    await writeFile(path.join(filesDirectory, attachment.id), request.body)
    // The file is written before the record; if the record is not saved, the file does not stay on the disk alone.
    const discard = () => rm(path.join(filesDirectory, attachment.id), { force: true }).catch(() => {})
    const offer = await mutateStore((store) => {
      const item = store.offers.find((entry) => entry.id === request.params.id)
      if (!item || item.status === 'rejected') return null
      item.attachments.push(attachment)
      if (!item.orderCode && item.proposal) {
        item.proposal = null
        item.status = 'review'
      }
      const order = store.orders.find((entry) => entry.offerId === item.id)
      if (order) {
        order.attachments = [...item.attachments]
        recordOrderEvent(order, 'attachment_added', request.adminName, `Anexo da OS incluído: ${attachment.name}`)
        order.updatedAt = new Date().toISOString()
        item.updatedAt = order.updatedAt
      }
      return item
    }).catch(async (error) => { await discard(); throw error })
    if (!offer) { await discard(); return response.status(404).json({ message: 'Oferta não encontrada.' }) }
    response.status(201).json({ item: offer })
  } catch (error) { handleError(response, error) }
})

router.get('/offers/:id/attachments/:attachmentId', async (request, response) => {
  try {
    const offer = (await readStore()).offers.find((item) => item.id === request.params.id)
    const attachment = offer?.attachments.find((item) => item.id === request.params.attachmentId)
    if (!attachment) return response.status(404).json({ message: 'Anexo não encontrado.' })
    response.download(path.join(filesDirectory, attachment.id), attachment.name)
  } catch (error) { handleError(response, error) }
})

router.post('/offers/:id/proposal', async (request, response) => {
  const proposal = request.body?.proposal
  const layout = request.body?.layout
  if (!proposal || !['classic', 'executive', 'compact'].includes(layout)) return response.status(400).json({ message: 'Selecione uma proposta e um modelo.' })
  try {
    const offer = (await readStore()).offers.find((item) => item.id === request.params.id)
    if (!offer || offer.orderCode || offer.status === 'rejected') return response.status(404).json({ message: 'Oferta não encontrada, já aceita ou recusada.' })
    const settings = serviceSettings(offer)
    if (!settings.stages.length) return response.status(400).json({ message: 'Defina as etapas nos detalhes da oferta antes de gerar a proposta.' })
    const selectedProposal = { ...proposal, ...settings }
    // The PDF is built on every download; generating it once here makes a problem with the data show up now.
    await createPdf(offer, selectedProposal, offer.resources, layout)
    const updated = await mutateStore((store) => {
      const item = store.offers.find((entry) => entry.id === request.params.id)
      if (!item || item.orderCode || item.status === 'rejected' || JSON.stringify(item.resources) !== JSON.stringify(offer.resources)) return null
      item.proposal = { ...selectedProposal, layout, generatedAt: new Date().toISOString() }
      item.status = 'proposed'
      return item
    })
    if (!updated) return response.status(404).json({ message: 'Oferta não encontrada ou já aceita.' })
    response.json({ item: updated })
  } catch (error) { handleError(response, error) }
})

router.get('/offers/:id/proposal.pdf', async (request, response) => {
  try {
    const offer = (await readStore()).offers.find((item) => item.id === request.params.id)
    if (!offer?.proposal) return response.status(404).json({ message: 'Proposta não encontrada.' })
    // Always built from the saved proposal: editing the resources discards the proposal, so it matches the current offer,
    // and files stored by earlier versions are never sent.
    // Proposals made with the commercial models (A, B, Nestlé, Etiqueta) keep their own document; older ones use the generic layout.
    const document = offer.proposal.document
    const pdf = document ? await renderProposalDocument(document) : await createPdf(offer, offer.proposal, offer.resources, offer.proposal.layout || 'classic', offer.proposal.generatedAt)
    const name = document ? ({ nestle: `FS-3055-${document.number}`, etiqueta: `Etiqueta-${document.labelNumber}` }[document.model] || `Proposta-${document.quoteNumber}`) : `Proposta-${offer.code}`
    response.type('pdf').attachment(`${name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`).send(pdf)
  } catch (error) { handleError(response, error) }
})

export default function createOffersRouter(pool, requireAdmin) {
  const configured = express.Router()
  configured.use((request, _response, next) => {
    const actor = adminIdentity(request)
    if (actor) { request.adminId = actor.id; request.adminName = actor.name }
    next()
  })
  // Offers are created and handled only in the administrative portal (there is no public entry of offers). The files of
  // an OS are also opened by the operator account; everything else, including the lists and the proposal PDF, needs an
  // administrator.
  configured.get(['/offers', '/orders', '/offers/:id/proposal.pdf'], requireAdmin)
  configured.post(['/offers', '/offers/:id/attachments', '/offers/:id/proposal'], requireAdmin)
  configured.put('/offers/:id/resources', requireAdmin)
  configured.get('/offers/:id/attachments/:attachmentId', requireAdminOrOperator)
  configured.use(router)
  // Purchase orders back the billing of a service. They belong to the OS only (not the offer) and never reach operators.
  configured.post('/orders/:code/purchase-orders', requireAdmin, express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (request, response) => {
    const filename = clean(request.query.name, 180)
    if (!filename || !Buffer.isBuffer(request.body) || !request.body.length) return response.status(400).json({ message: 'Selecione um arquivo válido, com até 20 MB.' })
    try {
      if (!(await readStore()).orders.some((entry) => entry.code === request.params.code)) return response.status(404).json({ message: 'OS não encontrada.' })
      const file = { id: randomUUID(), name: path.basename(filename), size: request.body.length, contentType: clean(request.query.type, 100) || 'application/octet-stream', uploadedAt: new Date().toISOString(), uploadedBy: request.adminName || 'Administrador' }
      await mkdir(filesDirectory, { recursive: true })
      await writeFile(path.join(filesDirectory, file.id), request.body)
      const discard = () => rm(path.join(filesDirectory, file.id), { force: true }).catch(() => {})
      const order = await mutateStore((store) => {
        const item = store.orders.find((entry) => entry.code === request.params.code)
        if (!item) return null
        item.purchaseOrders = [...(item.purchaseOrders || []), file]
        recordOrderEvent(item, 'purchase_order_added', request.adminName, `Pedido de compra anexado: ${file.name}`)
        return item
      }).catch(async (error) => { await discard(); throw error })
      if (!order) { await discard(); return response.status(404).json({ message: 'OS não encontrada.' }) }
      response.status(201).json({ item: file })
    } catch (error) { handleError(response, error) }
  })
  configured.get('/orders/:code/purchase-orders/:fileId', requireAdmin, async (request, response) => {
    try {
      const file = (await readStore()).orders.find((entry) => entry.code === request.params.code)?.purchaseOrders?.find((item) => item.id === request.params.fileId)
      if (!file) return response.status(404).json({ message: 'Anexo não encontrado.' })
      response.download(path.join(filesDirectory, file.id), file.name)
    } catch (error) { handleError(response, error) }
  })
  configured.delete('/orders/:code/purchase-orders/:fileId', requireAdmin, async (request, response) => {
    try {
      const removed = await mutateStore((store) => {
        const item = store.orders.find((entry) => entry.code === request.params.code)
        if (!item?.purchaseOrders?.some((file) => file.id === request.params.fileId)) return false
        const removed = item.purchaseOrders.find((file) => file.id === request.params.fileId)
        item.purchaseOrders = item.purchaseOrders.filter((file) => file.id !== request.params.fileId)
        recordOrderEvent(item, 'purchase_order_removed', request.adminName, `Pedido de compra removido: ${removed.name}`)
        return true
      })
      if (!removed) return response.status(404).json({ message: 'Anexo não encontrado.' })
      response.json({ ok: true })
    } catch (error) { handleError(response, error) }
  })
  // An atypical OS (redone piece, broken machine…) is left out of the averages of material and time of its piece.
  configured.put('/orders/:code/atypical', requireAdmin, async (request, response) => {
    if (typeof request.body?.atypical !== 'boolean') return response.status(400).json({ message: 'Informe se a OS é atípica.' })
    try {
      const order = await mutateStore((store) => {
        const item = store.orders.find((entry) => entry.code === request.params.code)
        if (!item) return null
        if (Boolean(item.atypical) !== request.body.atypical) {
          item.atypical = request.body.atypical
          recordOrderEvent(item, item.atypical ? 'marked_atypical' : 'unmarked_atypical', request.adminName, item.atypical ? 'OS marcada como atípica: fica fora das médias de material e tempo da peça.' : 'OS desmarcada como atípica: volta a entrar nas médias da peça.')
        }
        return item
      })
      if (!order) return response.status(404).json({ message: 'OS não encontrada.' })
      response.json({ item: { code: order.code, atypical: Boolean(order.atypical) } })
    } catch (error) { handleError(response, error) }
  })
  configured.get('/proposal-margins', requireAdmin, async (_request, response) => {
    try { const store = await readStore(); response.set('Cache-Control', 'no-store').json({ items: proposalMargins(store.orders || [], store.offers || []), gap: PROPOSAL_MARGIN_GAP }) } catch (error) { handleError(response, error) }
  })
  // The customer said no to the proposal sent: the offer is closed as declined and the option is counted in its acceptance rate.
  configured.post('/offers/:id/decline', requireAdmin, async (request, response) => {
    const reason = request.body?.reason == null || request.body.reason === '' ? null : String(request.body.reason)
    if (reason && !declineReasons.includes(reason)) return response.status(400).json({ message: 'Motivo da recusa inválido.' })
    try {
      const offer = await mutateStore((store) => {
        const item = store.offers.find((entry) => entry.id === request.params.id)
        if (!item) throw Object.assign(new Error('Oferta não encontrada.'), { status: 404 })
        if (item.orderCode || item.status === 'accepted') throw Object.assign(new Error('Esta oferta já gerou uma OS e não pode ser recusada.'), { status: 409 })
        if (item.status === 'rejected') return item
        if (!item.proposal?.key) throw Object.assign(new Error('Gere a proposta antes de registrar a recusa do cliente.'), { status: 409 })
        const at = new Date().toISOString()
        item.status = 'rejected'
        item.rejectedAt = at
        item.rejectedBy = request.adminId
        item.proposalDecline = { key: item.proposal.key, margin: Number(item.proposal.margin) || 0, reason, note: clean(request.body?.note, 1000), at, by: request.adminId, byName: request.adminName || 'Administrador' }
        return item
      })
      response.json({ item: offer })
    } catch (error) { handleError(response, error) }
  })
  // Undoes a decline registered by mistake: the offer goes back to "Proposta gerada" and leaves the acceptance rate.
  // The decline that was undone stays on the offer for consultation.
  configured.post('/offers/:id/undecline', requireAdmin, async (request, response) => {
    try {
      const offer = await mutateStore((store) => {
        const item = store.offers.find((entry) => entry.id === request.params.id)
        if (!item) throw Object.assign(new Error('Oferta não encontrada.'), { status: 404 })
        if (item.status !== 'rejected' || !item.proposalDecline) throw Object.assign(new Error('Esta oferta não tem uma recusa de proposta para desfazer.'), { status: 409 })
        item.declineHistory = [...(item.declineHistory || []), { ...item.proposalDecline, undoneAt: new Date().toISOString(), undoneBy: request.adminId, undoneByName: request.adminName || 'Administrador' }]
        delete item.proposalDecline
        item.status = 'proposed'
        item.rejectedAt = null
        item.rejectedBy = null
        return item
      })
      response.json({ item: offer })
    } catch (error) { handleError(response, error) }
  })
  configured.post('/offers/:id/reject', requireAdmin, async (request, response) => {
    try {
      const offer = await mutateStore((store) => {
        const item = store.offers.find((entry) => entry.id === request.params.id)
        if (!item) throw Object.assign(new Error('Oferta não encontrada.'), { status: 404 })
        if (item.origin !== 'Inserida Manualmente' || item.orderCode || !['review', 'rejected'].includes(item.status)) throw Object.assign(new Error('Somente ofertas manuais em análise podem ser recusadas.'), { status: 409 })
        if (item.status === 'rejected') return item
        item.status = 'rejected'
        item.rejectedAt = new Date().toISOString()
        item.rejectedBy = request.adminId
        return item
      })
      response.json({ item: offer })
    } catch (error) { handleError(response, error) }
  })
  configured.post('/offers/:id/accept', requireAdmin, async (request, response) => {
    let connection
    try {
      const order = await mutateStore(async (store) => {
        const item = store.offers.find((entry) => entry.id === request.params.id)
        if (item?.status === 'rejected') throw Object.assign(new Error('Esta oferta foi recusada e não pode gerar uma OS.'), { status: 409 })
        if (!item?.proposal) return null
        const existing = item.orderCode && store.orders.find((entry) => entry.offerId === item.id)
        if (existing?.inventoryConsumption) return existing
        if (item.orderCode && !existing) { const error = new Error('OS vinculada não encontrada.'); error.status = 409; throw error }
        const created = existing || { code: nextCode('OS', [...store.orders, ...(store.cancelledOrders || [])]), offerId: item.id, createdAt: new Date().toISOString(), status: 'Em andamento', company: item.company, cnpj: item.cnpj, service: item.service, description: item.description, labelNumber: item.labelNumber, quantity: item.quantity, deadline: item.deadline, requestedAt: item.requestedAt, attachments: [...item.attachments], resources: item.resources, proposal: item.proposal }
        const materials = created.resources?.materials || []
        let consumption = []
        if (materials.length && pool) {
          connection = await pool.getConnection()
          await connection.beginTransaction()
          const [previous] = await connection.execute("SELECT id FROM inventory_movements WHERE order_code = ? AND movement_type = 'exit' FOR UPDATE", [created.code])
          if (previous.length) { const error = new Error('Esta OS já possui saídas registradas no estoque. Confira o histórico antes de baixar novamente.'); error.status = 409; throw error }
          consumption = await consumeOrderMaterials(connection, created, { allowPartial: true })
        } else if (materials.some((material) => material.inventoryId != null || ['available', 'partial', 'missing'].includes(material.stockStatus))) {
          const error = new Error('O banco de estoque precisa estar disponível para baixar os materiais e gerar a OS.'); error.status = 503; throw error
        }
        created.inventoryConsumption = { processedAt: new Date().toISOString(), materials: consumption.map(({ materialIndexes, ...row }) => row) }
        if (!existing) { Object.assign(created, pieceTracking(store, created)); recordOrderEvent(created, 'order_created', request.adminName, `OS gerada a partir da proposta aceita (${item.code || item.id}).`); store.orders.unshift(created) }
        item.orderCode = created.code
        item.status = 'accepted'
        item.resources = created.resources
        return created
      }, { commit: () => connection?.commit(), rollback: () => connection?.rollback() })
      if (!order) return response.status(409).json({ message: 'Gere a proposta em PDF antes de aceitar a oferta.' })
      response.status(201).json({ item: order })
    } catch (error) { handleError(response, error) }
    finally { connection?.release() }
  })
  // An offer accepted by mistake: while nothing happened in the OS, the acceptance is undone. The material that left the
  // stock comes back (an entry "Estorno da OS"), the offer returns to "Proposta gerada" and the OS is not erased: it is kept
  // as cancelled, out of the lists, and its number is never reused.
  configured.post('/offers/:id/unaccept', requireAdmin, async (request, response) => {
    let connection
    try {
      const result = await mutateStore(async (store) => {
        const item = store.offers.find((entry) => entry.id === request.params.id)
        if (!item) throw Object.assign(new Error('Oferta não encontrada.'), { status: 404 })
        const order = item.orderCode && store.orders.find((entry) => entry.code === item.orderCode && entry.offerId === item.id)
        if (!order) throw Object.assign(new Error('Esta oferta não tem uma OS para desfazer.'), { status: 409 })
        let operation = order.operation || null
        if (pool) {
          connection = await pool.getConnection()
          await connection.beginTransaction()
          const [rows] = await connection.execute('SELECT data FROM order_operations WHERE order_code = ? FOR UPDATE', [order.code])
          operation = rows.length ? (typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data) : null
        }
        const blockers = []
        if (operation && (operation.startedAt || operation.activeSessions?.length || operation.activeSession || operation.status === 'completed' || Object.values(operation.stageCounts || {}).some((count) => Number(count) > 0))) blockers.push('o trabalho na OS já foi iniciado')
        if ((order.resources?.materials || []).some((material) => material.requestReceipt || material.requestReceipts?.length) || (store.materialRequestStatuses || []).some((status) => String(status.id).startsWith(`${item.id}-`) && ['received', 'partially-received'].includes(status.status))) blockers.push('já foi recebido material de compra para a OS')
        if ((store.payables || []).some((row) => row.orderCode === order.code && !row.inactive)) blockers.push('há contas a pagar ligadas à OS')
        if ((store.receivables || []).some((row) => row.orderCode === order.code && !row.inactive)) blockers.push('há contas a receber ligadas à OS')
        if (blockers.length) throw Object.assign(new Error(`Não é possível desfazer o aceite: ${blockers.join('; ')}. Confira a OS ${order.code}.`), { status: 409 })
        const returned = []
        if (connection) {
          const [moves] = await connection.execute("SELECT material_id AS materialId, movement_type AS type, SUM(quantity_kg) AS quantity FROM inventory_movements WHERE order_code = ? AND movement_type IN ('exit', 'entry') GROUP BY material_id, movement_type", [order.code])
          const net = new Map()
          for (const move of moves) net.set(move.materialId, (net.get(move.materialId) || 0) + (move.type === 'exit' ? 1 : -1) * Number(move.quantity))
          for (const [materialId, quantity] of net) {
            const amount = Number(quantity.toFixed(3))
            if (!(amount > 0)) continue
            const [[material]] = await connection.execute('SELECT id, name, quantity_kg, unit_price FROM inventory_materials WHERE id = ? FOR UPDATE', [materialId])
            if (!material) continue
            const balance = Number((Number(material.quantity_kg) + amount).toFixed(3))
            await connection.execute('UPDATE inventory_materials SET quantity_kg = ? WHERE id = ?', [balance, materialId])
            await connection.execute("INSERT INTO inventory_movements (material_id, movement_type, quantity_kg, unit_price_kg, balance_after_kg, destination, order_code, notes) VALUES (?, 'entry', ?, ?, ?, ?, ?, ?)", [materialId, amount, Number(material.unit_price), balance, 'Estorno de OS', order.code, `Estorno da ${order.code}: aceite da oferta ${item.code} desfeito.`])
            returned.push({ materialId, name: material.name, quantity: amount })
          }
        }
        const at = new Date().toISOString(), byName = request.adminName || 'Administrador'
        recordOrderEvent(order, 'order_cancelled', byName, `Aceite desfeito: OS cancelada${returned.length ? `; devolvido ao estoque: ${returned.map((row) => `${row.name} ${row.quantity.toLocaleString('pt-BR')} kg`).join(', ')}` : ''}.`)
        store.cancelledOrders ||= []
        store.cancelledOrders.push({ ...order, cancelledAt: at, cancelledBy: request.adminId, cancelledByName: byName, returnedMaterials: returned })
        store.orders = store.orders.filter((entry) => entry !== order)
        item.acceptHistory = [...(item.acceptHistory || []), { orderCode: order.code, acceptedAt: order.createdAt, undoneAt: at, undoneBy: request.adminId, undoneByName: byName }]
        item.orderCode = null
        item.status = 'proposed'
        // The offer goes back to before the acceptance: what the OS took from the stock is not on it anymore, and the
        // decisions taken on its material requests during the OS (purchase requested, refused) are cleared, so a new
        // acceptance starts from zero. The notices of the cancelled OS go away with it.
        item.resources = { ...item.resources, materials: (item.resources?.materials || []).map(({ inventoryConsumedQuantity, groupStockStatus, groupPurchaseQuantity, requestRejection, ...material }) => material) }
        const requestIds = (item.resources.materials || []).map((material) => `${item.id}-${material.id}`)
        store.materialRequestStatuses = (store.materialRequestStatuses || []).filter((status) => !requestIds.includes(status.id))
        store.silentMaterialRequestIds = requestIds
        store.operationalNotifications = (store.operationalNotifications || []).filter((notice) => notice.orderCode !== order.code)
        item.updatedAt = at
        return { item, orderCode: order.code, returned }
      }, { commit: () => connection?.commit(), rollback: () => connection?.rollback() })
      response.json(result)
    } catch (error) { handleError(response, error) }
    finally { connection?.release() }
  })
  return configured
}
