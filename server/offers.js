import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import express from 'express'
import { exportPdf } from './documentExports.js'
import { productionStages, stageLabel, serviceDetails, readStageLayout, validStageLayout } from './serviceStages.js'

const dataDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
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
    try {
      const result = await change(store)
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

function createPdf(offer, proposal, resources, layout) {
  const facts = (name, entries) => ({ name, records: true, singleRecord: true, columns: entries.map(([label]) => label), rows: [entries.map(([, value]) => value)] })
  const sections = [
    facts('Dados da solicitação', [['Serviço', offer.service], ['Cliente', offer.company], ['CNPJ', offer.cnpj], ['Número da etiqueta', offer.labelNumber], ['Quantidade', offer.quantity], ['Prazo solicitado', date(offer.deadline)]]),
    facts('Descrição do serviço', [['Descrição', offer.description], ...(resources.serviceDescription ? [['Detalhes do serviço', resources.serviceDescription]] : [])]),
    { name: 'Materiais necessários', columns: ['Material', 'Especificação', 'Quantidade (kg)', 'Valor/kg', 'Total (R$)'], rows: (resources.materials || []).map((item) => [item.name, item.detail, Number(item.quantity), Number(item.unitPrice), item.quantity * item.unitPrice]) },
    { name: 'Mão de obra', columns: ['Recurso', 'Horas previstas', 'Valor/hora', 'Total (R$)'], rows: (resources.laborEntries || []).map((item) => [item.resource, Number(item.hours), Number(item.hourlyRate), item.hours * item.hourlyRate]) },
    facts('Condições da proposta', [['Opção', `${proposal.key} · ${proposal.title || `Opção ${proposal.key}`}`], ['Prazo de entrega', proposal.deadline], ['Valor do serviço', Number(proposal.serviceValue || 0)], ['Materiais (R$)', Number(proposal.materials || 0)], ['Mão de obra (R$)', Number(proposal.labor || 0)], ['Margem de lucro bruto (%)', Number(proposal.margin || 0)], ['Desconto (%)', Number(proposal.discount || 0)], ['Lucro bruto esperado (R$)', Number(proposal.profit || 0)], ['Tempo de máquina', proposal.machine], ['Tempo de serviço', proposal.serviceTime]]),
    facts('Processo de fabricação', [['Etapas', (proposal.stages || []).map(stageLabel).join(' > ') || 'A definir'], ['Processo', serviceDetails(resources).strictProcess ? 'Sequência obrigatória' : 'Etapas livres'], ['Tipo', proposal.kind === 'product' ? 'Produto' : 'Serviço'], ['Fabricado a partir de', resources.manufacturedFrom === 'sample' ? 'Amostra' : resources.manufacturedFrom === 'drawing' ? 'Desenho' : 'Não informado'], ['Têmpera', resources.tempering === true ? 'Sim' : resources.tempering === false ? 'Não' : 'Não informada'], ...(resources.stages?.includes('painting') ? [['Cor/Tipo', resources.paintColor || 'Não informado']] : [])]),
  ]
  if (offer.attachments?.length) sections.push({ name: 'Documentos vinculados', columns: ['Arquivo'], rows: offer.attachments.map((item) => [item.name]) })
  return exportPdf({ title: `Proposta ${offer.code}`, generatedAt: new Date().toISOString(), summary: [['Valor do serviço', money(proposal.serviceValue)], ['Prazo de entrega', proposal.deadline]], notes: [`Modelo: ${{ classic: 'Clássico', executive: 'Executivo', compact: 'Compacto' }[layout]}`], sections }, { layout, orientation: 'portrait' })
}

router.get('/offers', async (_request, response) => {
  try { response.json({ items: (await readStore()).offers }) } catch (error) { handleError(response, error) }
})

router.get('/orders', async (_request, response) => {
  try { response.json({ items: (await readStore()).orders }) } catch (error) { handleError(response, error) }
})

router.post('/offers', async (request, response) => {
  const { cnpj, company, deadline, service, quantity, description, labelNumber } = request.body ?? {}
  if (!/^\d{14}$/.test(String(cnpj || '').replace(/\D/g, '')) || !clean(company) || !/^\d{4}-\d{2}-\d{2}$/.test(String(deadline || '')) || !clean(service) || !Number.isInteger(Number(quantity)) || Number(quantity) < 1 || !clean(description) || !clean(labelNumber)) {
    return response.status(400).json({ message: 'Preencha CNPJ, empresa, prazo, peça/serviço, quantidade, descrição e número da etiqueta.' })
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
  if (resources.strictProcess !== undefined && typeof resources.strictProcess !== 'boolean') return response.status(400).json({ message: 'Informe se o processo segue uma sequência obrigatória.' })
  if (['paintColor', 'serviceDescription'].some((field) => resources[field] != null && typeof resources[field] !== 'string')) return response.status(400).json({ message: 'Descrição inválida.' })
  try {
    const offer = await mutateStore((store) => {
      const item = store.offers.find((entry) => entry.id === request.params.id)
      if (!item || item.orderCode) return null
      const settings = serviceSettings(item)
      const nextResources = { materials: resources.materials, laborEntries: resources.laborEntries, stages: [...new Set(resources.stages ?? settings.stages)], stageLayout: readStageLayout({ stages: resources.stages ?? settings.stages, stageLayout: resources.stageLayout ?? item.resources?.stageLayout }), kind: resources.kind ?? settings.kind, ...serviceDetails({ ...item.resources, ...resources }), paintColor: clean(resources.paintColor ?? item.resources?.paintColor, 160), serviceDescription: clean(resources.serviceDescription ?? item.resources?.serviceDescription, 5000) }
      if (JSON.stringify(item.resources) !== JSON.stringify(nextResources)) {
        item.proposal = null
        item.status = 'review'
      }
      item.resources = nextResources
      return item
    })
    if (!offer) return response.status(404).json({ message: 'Oferta não encontrada ou já aceita.' })
    response.json({ item: offer })
  } catch (error) { handleError(response, error) }
})

router.post('/offers/:id/attachments', express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (request, response) => {
  const filename = clean(request.query.name, 180)
  if (!filename || !Buffer.isBuffer(request.body) || !request.body.length) return response.status(400).json({ message: 'Selecione um arquivo válido.' })
  try {
    await mkdir(filesDirectory, { recursive: true })
    const attachment = { id: randomUUID(), name: path.basename(filename), size: request.body.length, contentType: clean(request.query.type, 100) || 'application/octet-stream' }
    await writeFile(path.join(filesDirectory, attachment.id), request.body)
    const offer = await mutateStore((store) => {
      const item = store.offers.find((entry) => entry.id === request.params.id)
      if (!item) return null
      item.attachments.push(attachment)
      if (!item.orderCode && item.proposal) {
        item.proposal = null
        item.status = 'review'
      }
      const order = store.orders.find((entry) => entry.offerId === item.id)
      if (order) {
        order.attachments = [...item.attachments]
        order.updatedAt = new Date().toISOString()
        item.updatedAt = order.updatedAt
      }
      return item
    })
    if (!offer) return response.status(404).json({ message: 'Oferta não encontrada.' })
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
    if (!offer || offer.orderCode) return response.status(404).json({ message: 'Oferta não encontrada ou já aceita.' })
    const settings = serviceSettings(offer)
    if (!settings.stages.length) return response.status(400).json({ message: 'Defina as etapas nos detalhes da oferta antes de gerar a proposta.' })
    const selectedProposal = { ...proposal, ...settings }
    const pdf = await createPdf(offer, selectedProposal, offer.resources, layout)
    await mkdir(filesDirectory, { recursive: true })
    const pdfId = randomUUID()
    await writeFile(path.join(filesDirectory, pdfId), pdf)
    const updated = await mutateStore((store) => {
      const item = store.offers.find((entry) => entry.id === request.params.id)
      if (!item || item.orderCode || JSON.stringify(item.resources) !== JSON.stringify(offer.resources)) return null
      item.proposal = { ...selectedProposal, layout, pdfId, generatedAt: new Date().toISOString() }
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
    if (offer.orderCode) {
      const pdf = await createPdf(offer, offer.proposal, offer.resources, offer.proposal.layout || 'classic')
      return response.type('pdf').attachment(`Proposta-${offer.code}.pdf`).send(pdf)
    }
    if (!offer.proposal.pdfId) return response.status(404).json({ message: 'Proposta não encontrada.' })
    response.download(path.join(filesDirectory, offer.proposal.pdfId), `Proposta-${offer.code}.pdf`)
  } catch (error) { handleError(response, error) }
})

router.post('/offers/:id/accept', async (request, response) => {
  try {
    const order = await mutateStore((store) => {
      const item = store.offers.find((entry) => entry.id === request.params.id)
      if (!item?.proposal) return null
      if (item.orderCode) return store.orders.find((entry) => entry.offerId === item.id)
      const created = { code: nextCode('OS', store.orders), offerId: item.id, createdAt: new Date().toISOString(), status: 'Em andamento', company: item.company, cnpj: item.cnpj, service: item.service, description: item.description, labelNumber: item.labelNumber, quantity: item.quantity, deadline: item.deadline, requestedAt: item.requestedAt, attachments: [...item.attachments], resources: item.resources, proposal: item.proposal }
      store.orders.unshift(created)
      item.orderCode = created.code
      item.status = 'accepted'
      return created
    })
    if (!order) return response.status(409).json({ message: 'Gere a proposta em PDF antes de aceitar a oferta.' })
    response.status(201).json({ item: order })
  } catch (error) { handleError(response, error) }
})

export default router
