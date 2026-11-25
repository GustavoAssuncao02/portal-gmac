import { validEntryMode, withEntryMode } from './entryMode.js'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { dataDirectory } from './dataDirectory.js'
import { readStore, mutateStore as changeStore } from './store.js'
import { receiveFile } from './uploads.js'
import express from 'express'
import { exportPdf } from './documentExports.js'
import { renderProposalDocument } from './proposalPdf.js'
import { productionStages, stageLabel, stageActive, serviceDetails, serviceDescriptionText, readStageLayout, validStageLayout, stagePlanProblem, stagePlanPlace } from './serviceStages.js'
import { consumeOrderMaterials } from './orderMaterials.js'
import { addNotification, workflowSnapshot, recordWorkflowNotifications } from './notificationEvents.js'
import { assignMaterialRequestCodes } from './materialRequestCodes.js'
import { adminIdentity } from './accounts.js'
import { recordOrderEvent } from './orderHistory.js'
import { cleanStageResources, cleanStagePerPiece, cleanStageTimes, pieceTracking } from './pieces.js'
import { migrateStageLabor, stageLaborEntries } from './stageLabor.js'
import { proposalMargins, PROPOSAL_MARGIN_GAP, declineReasons } from './proposalMath.js'
import { requireAdminOrOperator } from './access.js'
import { documentDigits, documentKind, isClientDocument } from './clientDocument.js'
import { materialsStock } from './materialStock.js'
import { clientRequesters, offerRequesterInput, registerOfferContact, registerOfferRequesters } from './requesters.js'
import { actorOf, recordRegistryChange } from './registryHistory.js'
import { isPreRegisteredClient } from './sitePreRegistration.js'
import { currentServiceLocation, serviceLocationLabel, validServiceLocation } from './serviceLocation.js'
import { formatQuantity, materialUnit, validMaterialUnit, validQuantityFor } from './materialUnits.js'
import { labelEstimate, labelPlaceholderProposal } from './labelQuoteRules.js'
import { quantityLabel, quantityUnitMessage, quantityUnitOf, validQuantityUnit } from './quantityUnits.js'
import { todayBahia } from './payableRules.js'
import { retroactiveOrderDay } from './retroactiveEntry.js'

const filesDirectory = path.join(dataDirectory, 'files')
const router = express.Router()

export { readStore }

// Every change also records the workflow notifications it caused and numbers the new material requests.
export function mutateStore(change, options) {
  return changeStore(async (store) => {
    const notificationsBefore = workflowSnapshot(store)
    const result = await change(store)
    recordWorkflowNotifications(notificationsBefore, store)
    assignMaterialRequestCodes(store)
    return result
  }, options)
}

const handleError = (response, error) => {
  if (error.status) return response.status(error.status).json({ message: error.message })
  console.error('Falha ao salvar oferta:', error)
  response.status(500).json({ message: 'Não foi possível salvar os dados da oferta.' })
}

const clean = (value, limit = 500) => String(value ?? '').trim().slice(0, limit)
export const stillCreating = 'Esta oferta ainda está sendo criada: conclua os detalhes e clique em "Fazer proposta".'
// The requested deadline is optional while the offer is created and analysed, but the proposal PDF is only generated with
// it: the OS comes from the accepted proposal, so every OS has a deadline (services panel, tablet, planning, Editar OS).
export const deadlineRequired = 'Informe o prazo solicitado pelo cliente antes de gerar o PDF da proposta.'
// "Sem quantidade definida" (TCK-0005): the request arrives and someone goes to the client to count the pieces. The offer
// keeps quantity 1 only as a placeholder (quantityPending), the screens show "A definir", and the quantity is asked before
// the proposal options (PUT /offers/:id/quantity). Nothing that prints or opens an OS goes on without it.
export const quantityRequired = 'Informe a quantidade de peças da oferta antes de gerar a proposta.'
// A day that exists (2026-02-30 does not: Date would roll it into March).
export const isDay = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false
  const day = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value
}
// Retroactive entries (2026-11-25): a manual offer takes the day of the request and the acceptance the day of the OS, both
// typed (today by default) and never after today. Today keeps the real moment, as before; an earlier day is kept at noon
// (UTC) of that day, since the screens show these dates by their UTC day, and the real moment of the entry is kept apart.
export const dayMoment = (day, now = new Date()) => day === todayBahia(now) ? now.toISOString() : `${day}T12:00:00.000Z`
export const afterToday = (day, now = new Date()) => day > todayBahia(now)
const brDay = (day) => day.split('-').reverse().join('/')
export const requestedDayFuture = 'A data da solicitação não pode ser depois de hoje.'
export const deadlineBeforeRequest = 'O prazo solicitado não pode ser antes da data da solicitação.'
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const date = (value) => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'Não informado'

function serviceSettings(offer) {
  return { stages: offer.resources?.stages ?? offer.proposal?.stages ?? [], kind: offer.resources?.kind ?? offer.proposal?.kind ?? 'service', strictProcess: serviceDetails(offer.resources).strictProcess }
}

const proposalKeys = ['A', 'B', 'C', 'D']
const within = (value, min, max) => typeof value === 'number' && value >= min && value <= max

// Only what is chosen on the proposal screen is kept: the costs come from the offer and are worked out again on opening.
function proposalDraft(body) {
  const options = proposalKeys.map((key) => (Array.isArray(body?.options) ? body.options : []).find((option) => option?.key === key))
  if (!proposalKeys.includes(body?.selectedKey) || options.some((option) => !option || !within(option.margin, 0, 1000) || !within(option.discount, 0, 100) || typeof option.deadline !== 'string')) return null
  return { selectedKey: body.selectedKey, options: options.map(({ key, margin, discount, deadline }) => ({ key, margin, discount, deadline: clean(deadline, 40) })) }
}

export function nextCode(prefix, rows) {
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
    facts('Dados da solicitação', [['Serviço', offer.service], ['Cliente', offer.company], [documentKind(offer.cnpj), offer.cnpj], ['Número da etiqueta', offer.labelNumber], ['Quantidade', quantityUnitOf(offer.quantityUnit) === 'un' ? offer.quantity : quantityLabel(offer.quantity, offer.quantityUnit)], ['Prazo solicitado', date(offer.deadline)]]),
    facts('Descrição do serviço', [['Descrição', offer.description], ...(resources.serviceDescription ? [['Detalhes do serviço', resources.serviceDescription]] : [])]),
    { name: 'Materiais necessários', columns: ['Material', 'Especificação', 'Quantidade', 'Unidade'], rows: (resources.materials || []).map((item) => [item.name, item.detail, Number(item.quantity), materialUnit(item.unit)]) },
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
  const { cnpj, company, service, quantity, description, labelNumber, buyer } = request.body ?? {}
  // "Deixar oferta em aberto e notificar": someone registers it and the people in charge take it over later.
  const open = request.body?.open === true
  // The requested deadline may be left for later; it is asked when the proposal PDF is generated.
  const deadline = String(request.body?.deadline ?? '').trim()
  const quantityPending = request.body?.quantityPending === true
  if (!isClientDocument(cnpj) || !clean(company) || !clean(service) || (!quantityPending && (!Number.isInteger(Number(quantity)) || Number(quantity) < 1)) || !clean(description)) {
    return response.status(400).json({ message: 'Preencha CNPJ (14 dígitos) ou CPF (11), empresa, peça/serviço, quantidade e descrição.' })
  }
  if (deadline && !isDay(deadline)) return response.status(400).json({ message: 'Prazo solicitado inválido: escolha uma data ou deixe em branco.' })
  // "Data da solicitação": today by default, an earlier day for a retroactive entry. Not sent (older screen), it is now.
  const requestedDay = String(request.body?.requestedAt ?? '').trim()
  if (requestedDay && !isDay(requestedDay)) return response.status(400).json({ message: 'Data da solicitação inválida: escolha uma data.' })
  if (requestedDay && afterToday(requestedDay)) return response.status(400).json({ message: requestedDayFuture })
  if (requestedDay && deadline && deadline < requestedDay) return response.status(400).json({ message: deadlineBeforeRequest })
  // Unidades, pares ou conjuntos (TCK-0009); not sent, it is unidades.
  if (!validQuantityUnit(request.body?.quantityUnit)) return response.status(400).json({ message: quantityUnitMessage })
  try {
    // Up to 5 requesters; each new one is registered in the client like a single one was.
    const requesterNames = offerRequesterInput(request.body)
    let requestersCreated = 0, buyerCreated = false
    const offer = await mutateStore((store) => {
      const requesters = registerOfferRequesters(store, request.offerClient, requesterNames, actorOf(request))
      const buyerLink = registerOfferContact(store, 'buyers', request.offerClient, buyer, actorOf(request))
      requestersCreated = requesters.created
      buyerCreated = buyerLink.created
      // A manual offer starts as "Criando oferta": only "Fazer proposta" in its details (POST /offers/:id/finish) puts it
      // in analysis. The person who is creating it (editingBy) and since when are shown on the list.
      const at = new Date().toISOString(), author = { id: request.adminId ?? null, name: request.adminName || 'Administrador' }
      const item = { id: randomUUID(), code: nextCode('OF', [...store.offers, ...(store.discardedOffers || [])]), createdAt: at, createdBy: author.id, createdByName: author.name, ...(open ? { openForTeam: true } : { editingBy: { ...author, at } }), cnpj: clean(cnpj, 18), company: clean(company, 160), ...requesters.fields, buyer: buyerLink.name, buyerId: buyerLink.id, deadline, service: clean(service, 160), quantity: quantityPending ? 1 : Number(quantity), ...(quantityPending ? { quantityPending: true } : {}), quantityUnit: quantityUnitOf(request.body?.quantityUnit), description: clean(description, 5000), labelNumber: clean(labelNumber, 80), requestedAt: requestedDay ? dayMoment(requestedDay, new Date(at)) : at, origin: 'Inserida Manualmente', status: 'creating', attachments: [], resources: { materials: [], laborEntries: [] }, proposal: null, orderCode: null }
      store.offers.unshift(item)
      // An open offer has nobody creating it: it waits on the list, like the offers of the site, and the others are told.
      if (open) addNotification(store, { type: 'open-offer', offerId: item.id, authorId: author.id, title: 'Nova oferta em aberto', description: `${item.code} · ${item.company} · inserida por ${author.name}` })
      return item
    })
    response.status(201).json({ item: offer, requesterCreated: requestersCreated > 0, requestersCreated, buyerCreated })
  } catch (error) { handleError(response, error) }
})

router.put('/offers/:id/resources', async (request, response) => {
  const resources = request.body ?? {}
  if (!Array.isArray(resources.materials) || (resources.laborEntries !== undefined && !Array.isArray(resources.laborEntries))) return response.status(400).json({ message: 'Recursos inválidos.' })
  // Each material is counted in kilos or in units; units are whole numbers.
  if (resources.materials.some((material) => material?.unit != null && !validMaterialUnit(material.unit))) return response.status(400).json({ message: 'Escolha a unidade de cada material: quilo, metro, unidade ou conjunto.' })
  if (resources.entryMode !== undefined && !validEntryMode(resources.entryMode)) return response.status(400).json({ message: 'Forma de lançamento inválida.' })
  // Per piece, a unit can be a fraction (a bar that makes 4 pieces): the total is rounded up.
  if (resources.materials.some((material) => material?.quantityPerPiece != null ? !(Number(material.quantityPerPiece) > 0) : !validQuantityFor(material?.quantity, material?.unit))) return response.status(400).json({ message: 'Material contado por unidade aceita só quantidades inteiras.' })
  if (resources.stages !== undefined && (!Array.isArray(resources.stages) || resources.stages.some((stage) => !productionStages.some(([key]) => key === stage)))) return response.status(400).json({ message: 'Etapas inválidas.' })
  if (resources.stageLayout !== undefined && !validStageLayout(resources.stageLayout)) return response.status(400).json({ message: 'Ordem dos grupos ou subetapas inválida.' })
  if (resources.kind !== undefined && !['service', 'product'].includes(resources.kind)) return response.status(400).json({ message: 'Tipo inválido.' })
  if (resources.manufacturedFrom != null && !['sample', 'drawing'].includes(resources.manufacturedFrom)) return response.status(400).json({ message: 'Origem de fabricação inválida.' })
  if (resources.tempering != null && typeof resources.tempering !== 'boolean') return response.status(400).json({ message: 'Têmpera inválida.' })
  if (resources.urgency != null && !['normal', 'emergency'].includes(resources.urgency)) return response.status(400).json({ message: 'Tipo de proposta inválido.' })
  if (resources.serviceLocation != null && !validServiceLocation(resources.serviceLocation)) return response.status(400).json({ message: 'Tipo de serviço inválido: escolha interno ou externo.' })
  if (resources.strictProcess !== undefined && typeof resources.strictProcess !== 'boolean') return response.status(400).json({ message: 'Informe se o processo segue uma sequência obrigatória.' })
  if (['paintColor', 'serviceDescription'].some((field) => resources[field] != null && typeof resources[field] !== 'string')) return response.status(400).json({ message: 'Descrição inválida.' })
  if (resources.description !== undefined && typeof resources.description !== 'string') return response.status(400).json({ message: 'Descrição inválida.' })
  try {
    const offer = await mutateStore((store) => {
      const item = store.offers.find((entry) => entry.id === request.params.id)
      if (!item || item.orderCode || item.status === 'rejected') return null
      const settings = serviceSettings(item)
      // The details screen edits the same description typed when the offer was created. A separate text of an older offer
      // (or of a caller that still sends it) joins the end of the description.
      const currentDescription = serviceDescriptionText(item.description, item.resources?.serviceDescription)
      const description = clean(resources.description ?? serviceDescriptionText(item.description, resources.serviceDescription ?? item.resources?.serviceDescription), 5000)
      if (!description && currentDescription) throw Object.assign(new Error('Preencha a descrição do serviço.'), { status: 400 })
      const sized = withEntryMode({ ...resources, entryMode: resources.entryMode ?? item.resources?.entryMode, stageTimesPerPiece: resources.stageTimesPerPiece ?? item.resources?.stageTimesPerPiece, stageTimes: resources.stageTimes ?? item.resources?.stageTimes }, item.quantity)
      const materials = sized.materials.map((material) => {
        const previous = item.resources?.materials?.find((entry) => entry.id === material.id)
        const { requestedBy, requestedByName, requestedAt, requestedQuantity, requestRejection, requestReceipt, requestReceipts, ...fields } = material
        return { ...fields, requestedAt: previous?.requestedAt || (previous ? item.requestedAt : new Date().toISOString()), requestedBy: previous?.requestedBy ?? (previous ? null : request.adminId ?? null), requestedByName: previous?.requestedByName ?? (previous ? null : request.adminName || null), requestedQuantity: previous?.requestedQuantity ?? Number(material.purchaseQuantity ?? material.quantity), ...(previous?.requestRejection ? { requestRejection: previous.requestRejection } : {}), ...(previous?.requestReceipt ? { requestReceipt: previous.requestReceipt, requestReceipts: previous.requestReceipts } : {}) }
      })
      // A deactivated stage stays where it was checked, but cannot be checked again.
      const reactivated = (resources.stages || []).filter((code) => !settings.stages.includes(code) && !stageActive(code))
      if (reactivated.length) throw Object.assign(new Error(`A etapa ${reactivated.map(stageLabel).join(', ')} está desativada em Etapas: não pode ser marcada.`), { status: 400 })
      const nextResources = { materials, laborEntries: [], stages: [...new Set(resources.stages ?? settings.stages)], stageLayout: readStageLayout({ stages: resources.stages ?? settings.stages, stageLayout: resources.stageLayout ?? item.resources?.stageLayout }), kind: resources.kind ?? settings.kind, ...serviceDetails({ ...item.resources, ...resources }), paintColor: clean(resources.paintColor ?? item.resources?.paintColor, 160), serviceDescription: '' }
      nextResources.stageTimes = cleanStageTimes(sized.stageTimes, nextResources.stages)
      if (sized.entryMode) nextResources.entryMode = sized.entryMode
      if (sized.entryMode === 'piece') nextResources.stageTimesPerPiece = cleanStagePerPiece(sized.stageTimesPerPiece, nextResources.stages)
      nextResources.stageResources = cleanStageResources(resources.stageResources ?? item.resources?.stageResources, nextResources.stages, { machines: store.machines, laborServices: store.laborServices })
      // Labor is not typed: it comes from the time and the machine or service of each stage. An older hand-typed row stays
      // while the screen still sends it (it can only be removed).
      const sent = new Set((resources.laborEntries || []).map((entry) => entry?.id))
      nextResources.laborEntries = stageLaborEntries(nextResources, store, (item.resources?.laborEntries || []).filter((entry) => !entry.stageCode && sent.has(entry.id)))
      // Normal/Emergencial only labels the offer inside the system; changing it keeps the proposal already made.
      // The planned stage times and resources count through the labor they produce: changing them changes the labor and
      // so discards the proposal, like any other change of cost.
      // Interno/Externo is a label as well: it does not change the price.
      // The description goes in the proposal: only a different text discards it, not the older details joining it.
      // How it was typed (per piece or total) does not change the cost either: only the totals count.
      const comparable = (value) => JSON.stringify({ ...value, urgency: undefined, serviceLocation: undefined, stageTimes: undefined, stageResources: undefined, serviceDescription: undefined, entryMode: undefined, stageTimesPerPiece: undefined, materials: value?.materials?.map(({ quantityPerPiece, ...material }) => material) })
      // An offer still being created stays so: only "Fazer proposta" finishes it.
      if (item.status !== 'creating' && (description !== currentDescription || comparable(item.resources) !== comparable(nextResources))) {
        item.proposal = null
        item.status = 'review'
      }
      item.description = description
      item.resources = nextResources
      return item
    })
    if (!offer) return response.status(404).json({ message: 'Oferta não encontrada, já aceita ou recusada.' })
    response.json({ item: offer })
  } catch (error) { handleError(response, error) }
})

router.post('/offers/:id/attachments', async (request, response) => {
  const filename = clean(request.query.name, 180)
  if (!filename) return response.status(400).json({ message: 'Selecione um arquivo válido.' })
  try {
    const existing = (await readStore()).offers.find((entry) => entry.id === request.params.id)
    if (!existing || existing.status === 'rejected') return response.status(404).json({ message: 'Oferta não encontrada ou recusada.' })
    // The file is written before the record; if the record is not saved, the file does not stay on the disk alone.
    const id = randomUUID()
    const received = await receiveFile(request, filesDirectory, id)
    if (!received) return response.status(400).json({ message: 'Selecione um arquivo válido.' })
    const attachment = { id, name: path.basename(filename), size: received.size, contentType: clean(request.query.type, 100) || 'application/octet-stream' }
    const { discard } = received
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
    if (offer.status === 'creating') return response.status(409).json({ message: stillCreating })
    if (offer.quantityPending) return response.status(409).json({ message: quantityRequired })
    if (!isDay(offer.deadline)) return response.status(400).json({ message: deadlineRequired })
    const settings = serviceSettings(offer)
    if (!settings.stages.length) return response.status(400).json({ message: 'Defina as etapas nos detalhes da oferta antes de gerar a proposta.' })
    const problem = stagePlanProblem(settings.stages, offer.resources)
    if (problem) return response.status(400).json({ message: `${problem} ${stagePlanPlace}` })
    const selectedProposal = { ...proposal, ...settings }
    // The PDF is built on every download; generating it once here makes a problem with the data show up now.
    await createPdf(offer, selectedProposal, offer.resources, layout)
    const updated = await mutateStore((store) => {
      const item = store.offers.find((entry) => entry.id === request.params.id)
      if (!item || item.orderCode || ['rejected', 'creating'].includes(item.status) || item.description !== offer.description || JSON.stringify(item.resources) !== JSON.stringify(offer.resources)) return null
      item.proposal = { ...selectedProposal, layout, generatedAt: new Date().toISOString() }
      item.status = 'proposed'
      return item
    })
    if (!updated) return response.status(404).json({ message: 'Oferta não encontrada ou já aceita.' })
    response.json({ item: updated })
  } catch (error) { handleError(response, error) }
})

// The four options and the one chosen stay as they were left, so another person can finish the quote; every save notifies
// the other administrative accounts (the author already knows).
router.put('/offers/:id/proposal-draft', async (request, response) => {
  const draft = proposalDraft(request.body)
  if (!draft) return response.status(400).json({ message: 'Proposta inválida: confira a opção escolhida, o % de lucro bruto, o desconto e o prazo.' })
  try {
    const offer = await mutateStore((store) => {
      const item = store.offers.find((entry) => entry.id === request.params.id)
      if (!item || item.orderCode || item.status === 'rejected') return null
      if (item.status === 'creating') throw Object.assign(new Error(stillCreating), { status: 409 })
      item.proposalDraft ={ ...draft, savedAt: new Date().toISOString(), savedBy: request.adminId ?? null, savedByName: request.adminName || 'Administrador' }
      addNotification(store, { type: 'proposal-saved', at: item.proposalDraft.savedAt, authorId: item.proposalDraft.savedBy, offerId: item.id, title: 'Proposta salva', description: `${item.code} · ${item.service} · Proposta ${draft.selectedKey}`, employeeName: item.proposalDraft.savedByName })
      return item
    })
    if (!offer) return response.status(404).json({ message: 'Oferta não encontrada, já aceita ou recusada.' })
    response.json({ item: offer })
  } catch (error) { handleError(response, error) }
})

// Always built from the saved proposal: editing the resources discards the proposal, so it matches the current offer,
// and files stored by earlier versions are never sent. Also the attachment of the proposal e-mail (proposalEmails.js).
// Proposals made with the commercial models (A, B, Nestlé, Etiqueta) keep their own document; older ones use the generic layout.
export async function proposalPdfFile(offer) {
  const document = offer.proposal.document
  const content = document ? await renderProposalDocument(document) : await createPdf(offer, offer.proposal, offer.resources, offer.proposal.layout || 'classic', offer.proposal.generatedAt)
  const name = document ? ({ nestle: `FS-3055-${document.number}`, etiqueta: `Etiqueta-${document.labelNumber}` }[document.model] || `Proposta-${document.quoteNumber}`) : `Proposta-${offer.code}`
  return { name: `${name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`, content }
}

router.get('/offers/:id/proposal.pdf', async (request, response) => {
  try {
    const offer = (await readStore()).offers.find((item) => item.id === request.params.id)
    if (!offer?.proposal) return response.status(404).json({ message: 'Proposta não encontrada.' })
    const { name, content } = await proposalPdfFile(offer)
    response.type('pdf').attachment(name).send(content)
  } catch (error) { handleError(response, error) }
})

// "Deixar oferta em aberto e notificar" comes checked for the CPFs listed in OPEN_OFFER_DEFAULT_CPFS (comma separated).
export const openOfferDefault = (cpf, env = process.env) => {
  const own = documentDigits(cpf)
  return own.length === 11 && String(env.OPEN_OFFER_DEFAULT_CPFS || '').split(',').map((item) => documentDigits(item)).includes(own)
}

export default function createOffersRouter(pool, requireAdmin, accounts) {
  migrateStageLabor().catch((error) => console.error('Falha ao montar a mão de obra das etapas nas ofertas abertas:', error.message))
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
  // The registered client of a new offer (same CPF/CNPJ), whose requesters the offer's requester joins.
  configured.post('/offers', async (request, _response, next) => {
    try {
      const document = documentDigits(request.body?.cnpj)
      request.offerClient = accounts && document ? (await accounts.clients()).find((client) => documentDigits(client.document) === document) || null : null
      next()
    } catch (error) { next(error) }
  })
  // Whether "Deixar oferta em aberto e notificar" comes checked for this account: the CPFs are in OPEN_OFFER_DEFAULT_CPFS
  // (server environment, outside the public repository); the browser only gets the answer.
  configured.get('/offers/open-default', requireAdmin, async (request, response) => {
    try {
      const account = accounts && request.adminId != null ? await accounts.account(request.adminId) : null
      response.set('Cache-Control', 'no-store').json({ checked: openOfferDefault(account?.cpf) })
    } catch (error) { handleError(response, error) }
  })
  configured.put(['/offers/:id/resources', '/offers/:id/proposal-draft'], requireAdmin)
  // Per piece, the totals of the materials and the stage times follow the quantity (and so does what is left to buy).
  const resizePerPiece = (store, item, quantity, inventory) => {
    if (item.resources?.entryMode !== 'piece') return
    const sized = withEntryMode(item.resources, quantity)
    const stages = item.resources.stages || []
    const resources = { ...item.resources, materials: inventory ? materialsStock(sized.materials || [], inventory) : sized.materials || [], stageTimes: cleanStageTimes(sized.stageTimes, stages), stageTimesPerPiece: sized.stageTimesPerPiece }
    resources.laborEntries = stageLaborEntries(resources, store, (item.resources.laborEntries || []).filter((entry) => !entry.stageCode))
    item.resources = resources
  }
  const stockOf = async (offer) => (pool && offer?.resources?.entryMode === 'piece' && offer.resources.materials?.length ? (await pool.query('SELECT id, name, unit, quantity_kg AS quantity FROM inventory_materials'))[0] : null)
  // Informações do serviço of an offer not yet accepted: client (CPF/CNPJ and name), requester, buyer, piece, request date,
  // requested deadline, quantity and label. Everything but the request date goes printed on the proposal, so changing it
  // discards a generated proposal, as a change of resources does; the saved options (proposalDraft) stay and the proposal
  // is generated again with the right data. Launched per piece, materials and stage times follow the new quantity. An
  // accepted offer is corrected in its OS (Editar OS), which keeps the history of the order.
  configured.put('/offers/:id', requireAdmin, async (request, response) => {
    const body = request.body ?? {}
    const fields = { cnpj: clean(body.cnpj, 18), company: clean(body.company, 160), service: clean(body.service, 160), labelNumber: clean(body.labelNumber, 80), deadline: String(body.deadline ?? '').trim(), quantity: Number(body.quantity) }
    // "Sem quantidade definida" kept (or chosen now): the placeholder quantity stays as it is.
    const quantityPending = body.quantityPending === true
    const requestedDay = String(body.requestedAt || '')
    if (!isClientDocument(fields.cnpj) || !fields.company || !fields.service || !isDay(requestedDay) || (!quantityPending && (!Number.isInteger(fields.quantity) || fields.quantity < 1 || fields.quantity > 1000000000))) {
      return response.status(400).json({ message: 'Preencha CNPJ (14 dígitos) ou CPF (11), empresa, peça/serviço, data da solicitação e quantidade.' })
    }
    if (fields.deadline && !isDay(fields.deadline)) return response.status(400).json({ message: 'Prazo solicitado inválido: escolha uma data ou deixe em branco.' })
    if (!validQuantityUnit(body.quantityUnit)) return response.status(400).json({ message: quantityUnitMessage })
    try {
      const requesterNames = offerRequesterInput(body)
      const document = documentDigits(fields.cnpj)
      const client = accounts && document ? (await accounts.clients()).find((item) => documentDigits(item.document) === document) || null : null
      // Per piece, the totals of the materials change with the quantity and so does what is left to buy.
      const current = (await readStore()).offers.find((entry) => entry.id === request.params.id)
      if (quantityPending) fields.quantity = Number(current?.quantity) || 1
      const inventory = current && Number(current.quantity) !== fields.quantity ? await stockOf(current) : null
      let proposalDiscarded = false
      const offer = await mutateStore((store) => {
        const item = store.offers.find((entry) => entry.id === request.params.id)
        if (!item) throw Object.assign(new Error('Oferta não encontrada.'), { status: 404 })
        if (item.orderCode) throw Object.assign(new Error(`Esta oferta já virou a ${item.orderCode}: corrija os dados pela OS, em Editar OS.`), { status: 409 })
        if (item.status === 'rejected') throw Object.assign(new Error('Oferta recusada não pode ser editada: desfaça a recusa antes.'), { status: 409 })
        // Once the PDF exists the deadline can be changed (which discards it, as below) but not left empty.
        if (!fields.deadline && item.proposal) throw Object.assign(new Error('Com o PDF da proposta gerado, o prazo solicitado não pode ficar em branco: troque a data se precisar.'), { status: 400 })
        if (quantityPending && (item.proposal || item.proposalDraft)) throw Object.assign(new Error('Esta oferta já tem proposta: a quantidade não pode voltar para "a definir".'), { status: 400 })
        // The same rules as a new offer, only for a date that changes: an older offer with dates out of order still saves.
        const dayChanged = requestedDay !== String(item.requestedAt || '').slice(0, 10)
        if (dayChanged && afterToday(requestedDay)) throw Object.assign(new Error(requestedDayFuture), { status: 400 })
        if (fields.deadline && fields.deadline < requestedDay && (dayChanged || fields.deadline !== String(item.deadline || ''))) throw Object.assign(new Error(deadlineBeforeRequest), { status: 400 })
        // A screen of the previous version (a tab not reloaded yet) sends the names joined in one field: unchanged, the list
        // stays as it is instead of becoming one requester called "Ana, Bruno".
        const unchangedOldScreen = !Array.isArray(body.requesters) && item.requesters?.length > 1 && String(body.requester ?? '').trim() === item.requester
        const requesters = registerOfferRequesters(store, client, unchangedOldScreen ? item.requesters.map((entry) => entry.name) : requesterNames, actorOf(request))
        const buyer = registerOfferContact(store, 'buyers', client, body.buyer, actorOf(request))
        // The measure of the quantity goes printed too; a screen of the previous version does not send it and keeps it.
        const next = { ...fields, ...requesters.fields, buyer: buyer.name, buyerId: buyer.id, quantityUnit: quantityUnitOf(body.quantityUnit === undefined ? item.quantityUnit : body.quantityUnit) }
        // The same document typed with another mask keeps the one already saved.
        if (documentDigits(item.cnpj) === document) next.cnpj = item.cnpj
        const printed = ['cnpj', 'company', 'requester', 'buyer', 'service', 'labelNumber', 'deadline', 'quantity']
        const changed = printed.some((key) => String(item[key] ?? '') !== String(next[key] ?? '')) || quantityUnitOf(item.quantityUnit) !== next.quantityUnit
        const quantityChanged = Number(item.quantity) !== fields.quantity
        Object.assign(item, next)
        if (quantityPending) item.quantityPending = true
        else delete item.quantityPending
        // Observação (interna, das ofertas do site): não sai no PDF da proposta, então mudá-la não descarta a proposta.
        if (body.notes !== undefined) item.notes = clean(body.notes, 2000)
        // The list and the details show the day of the request (UTC): a new day keeps it at noon of that day.
        if (requestedDay !== String(item.requestedAt || '').slice(0, 10)) item.requestedAt = `${requestedDay}T12:00:00.000Z`
        if (quantityChanged) resizePerPiece(store, item, fields.quantity, inventory)
        if (changed && item.proposal) {
          item.proposal = null
          item.status = 'review'
          proposalDiscarded = true
        }
        item.updatedAt = new Date().toISOString()
        return item
      })
      response.json({ item: offer, proposalDiscarded })
    } catch (error) { handleError(response, error) }
  })
  // "Sem quantidade definida": the quantity counted at the client, asked before the proposal options (or the OS of an
  // etiqueta). Per piece, materials and stage times follow it. The offer leaves "A definir" for good.
  configured.put('/offers/:id/quantity', requireAdmin, async (request, response) => {
    const quantity = Number(request.body?.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000000) return response.status(400).json({ message: 'Informe a quantidade de peças (número inteiro, a partir de 1).' })
    try {
      const inventory = await stockOf((await readStore()).offers.find((entry) => entry.id === request.params.id))
      const offer = await mutateStore((store) => {
        const item = store.offers.find((entry) => entry.id === request.params.id)
        if (!item) throw Object.assign(new Error('Oferta não encontrada.'), { status: 404 })
        if (item.orderCode || item.status === 'rejected') throw Object.assign(new Error('Esta oferta já foi aceita ou recusada.'), { status: 409 })
        if (!item.quantityPending) throw Object.assign(new Error('A quantidade desta oferta já foi definida: corrija em Informações do serviço.'), { status: 409 })
        if (Number(item.quantity) !== quantity) resizePerPiece(store, item, quantity, inventory)
        item.quantity = quantity
        delete item.quantityPending
        item.quantityDefinedAt = new Date().toISOString()
        item.quantityDefinedByName = request.adminName || 'Administrador'
        item.updatedAt = item.quantityDefinedAt
        return item
      })
      response.json({ item: offer })
    } catch (error) { handleError(response, error) }
  })
  // Asked on the proposal screen when the PDF is generated for an offer created without the requested deadline. The
  // options with no delivery term take the same date: it becomes the "Prazo acordado" of the OS, which Editar OS needs.
  configured.put('/offers/:id/deadline', requireAdmin, async (request, response) => {
    const deadline = String(request.body?.deadline ?? '').trim()
    if (!isDay(deadline)) return response.status(400).json({ message: 'Escolha o prazo solicitado pelo cliente.' })
    try {
      const offer = await mutateStore((store) => {
        const item = store.offers.find((entry) => entry.id === request.params.id)
        if (!item) throw Object.assign(new Error('Oferta não encontrada.'), { status: 404 })
        if (item.orderCode || item.status === 'rejected') throw Object.assign(new Error('Esta oferta já foi aceita ou recusada.'), { status: 409 })
        if (item.proposal) throw Object.assign(new Error('Esta oferta já tem o PDF da proposta: troque o prazo em Informações do serviço.'), { status: 409 })
        item.deadline = deadline
        if (Array.isArray(item.proposalDraft?.options)) item.proposalDraft.options = item.proposalDraft.options.map((option) => String(option.deadline ?? '').trim() ? option : { ...option, deadline })
        item.updatedAt = new Date().toISOString()
        return item
      })
      response.json({ item: offer })
    } catch (error) { handleError(response, error) }
  })
  // "Criando oferta": another administrator who confirms "editar mesmo assim" becomes the one creating it (the list shows
  // their name); the time keeps counting from the creation.
  const creatingOffer = (store, id) => {
    const item = store.offers.find((entry) => entry.id === id)
    if (!item) throw Object.assign(new Error('Oferta não encontrada.'), { status: 404 })
    if (item.status !== 'creating') throw Object.assign(new Error('Esta oferta já foi concluída e está na lista de ofertas.'), { status: 409 })
    return item
  }
  configured.post('/offers/:id/take-over', requireAdmin, async (request, response) => {
    try {
      const offer = await mutateStore((store) => {
        const item = creatingOffer(store, request.params.id)
        if (String(item.editingBy?.id ?? '') !== String(request.adminId ?? '')) item.editingBy = { id: request.adminId ?? null, name: request.adminName || 'Administrador', at: new Date().toISOString() }
        return item
      })
      response.json({ item: offer })
    } catch (error) { handleError(response, error) }
  })
  // "Fazer proposta" of an offer being created: with the stages planned (the same rule of the proposal), it goes to analysis
  // and the actions of the list are open to everybody.
  configured.post('/offers/:id/finish', requireAdmin, async (request, response) => {
    try {
      const offer = await mutateStore((store) => {
        const item = store.offers.find((entry) => entry.id === request.params.id)
        if (!item) throw Object.assign(new Error('Oferta não encontrada.'), { status: 404 })
        if (item.status !== 'creating') return item
        if (item.quantityPending) throw Object.assign(new Error(quantityRequired), { status: 409 })
        const { stages } = serviceSettings(item)
        if (!stages.length) throw Object.assign(new Error('Selecione pelo menos uma etapa do serviço antes de fazer a proposta.'), { status: 400 })
        const problem = stagePlanProblem(stages, item.resources)
        if (problem) throw Object.assign(new Error(`${problem} ${stagePlanPlace}`), { status: 400 })
        item.status = 'review'
        item.creationFinishedAt = new Date().toISOString()
        item.creationFinishedBy = request.adminId ?? null
        item.creationFinishedByName = request.adminName || 'Administrador'
        delete item.editingBy
        return item
      })
      response.json({ item: offer })
    } catch (error) { handleError(response, error) }
  })
  // "Descartar oferta": an offer given up while being created is erased with its files. Its number is not reused (a short
  // record stays in discardedOffers); the requester and buyer registered with it stay registered.
  // A site offer also takes with it the pre-registration it created, but only while nobody touched it: the client is
  // still a pre-registration (sitePreRegistration.js), has no requesters or buyers, and no other offer or OS uses the
  // same document. The deletion joins the same transaction as the discard (commit/rollback of the store).
  configured.delete('/offers/:id', requireAdmin, async (request, response) => {
    let connection
    try {
      const removed = await mutateStore(async (store) => {
        const item = creatingOffer(store, request.params.id)
        store.offers = store.offers.filter((entry) => entry !== item)
        store.discardedOffers = [...(store.discardedOffers || []), { id: item.id, code: item.code, service: item.service, company: item.company, createdAt: item.createdAt, createdByName: item.createdByName, discardedAt: new Date().toISOString(), discardedBy: request.adminId ?? null, discardedByName: request.adminName || 'Administrador' }]
        const clientId = item.origin === 'Site' ? item.siteRequest?.preRegisteredClientId : null
        if (clientId != null && isPreRegisteredClient(store, clientId) && !clientRequesters(store, clientId, 'requesters') && !clientRequesters(store, clientId, 'buyers')) {
          const document = documentDigits(item.cnpj)
          const used = store.offers.some((entry) => documentDigits(entry.cnpj) === document) || (store.orders || []).some((entry) => documentDigits(entry.cnpj) === document)
          if (!used) {
            let client = null
            if (pool) {
              connection = await pool.getConnection()
              await connection.beginTransaction()
              const [[row]] = await connection.execute('SELECT id, name, document_type AS documentType, document, email FROM clients WHERE id = ?', [clientId])
              if (row && documentDigits(row.document) === document) {
                await connection.execute('DELETE FROM clients WHERE id = ?', [clientId])
                client = row
              }
            } else {
              const index = (store.clients || []).findIndex((row) => String(row.id) === String(clientId))
              if (index >= 0 && documentDigits(store.clients[index].document) === document) client = store.clients.splice(index, 1)[0]
            }
            if (client) recordRegistryChange(store, { registry: 'clients', recordId: clientId, type: 'deleted', actor: actorOf(request), before: { name: client.name, documentType: client.documentType, document: client.document, email: client.email || '', notes: client.notes || '' }, note: `Pré-cadastro apagado ao descartar a oferta ${item.code} do site.` })
          }
        }
        return item
      }, { commit: () => connection?.commit(), rollback: () => connection?.rollback() })
      await Promise.all((removed.attachments || []).map((file) => rm(path.join(filesDirectory, file.id), { force: true }).catch(() => {})))
      response.status(204).end()
    } catch (error) { handleError(response, error) }
    finally { connection?.release() }
  })
  configured.get('/offers/:id/attachments/:attachmentId', requireAdminOrOperator)
  configured.use(router)
  // Purchase orders back the billing of a service. They belong to the OS only (not the offer) and never reach operators.
  configured.post('/orders/:code/purchase-orders', requireAdmin, async (request, response) => {
    const filename = clean(request.query.name, 180)
    if (!filename) return response.status(400).json({ message: 'Selecione um arquivo válido.' })
    try {
      if (!(await readStore()).orders.some((entry) => entry.code === request.params.code)) return response.status(404).json({ message: 'OS não encontrada.' })
      const id = randomUUID()
      const received = await receiveFile(request, filesDirectory, id)
      if (!received) return response.status(400).json({ message: 'Selecione um arquivo válido.' })
      const file = { id, name: path.basename(filename), size: received.size, contentType: clean(request.query.type, 100) || 'application/octet-stream', uploadedAt: new Date().toISOString(), uploadedBy: request.adminName || 'Administrador' }
      const { discard } = received
      const order = await mutateStore((store) => {
        const item = store.orders.find((entry) => entry.code === request.params.code)
        if (!item) return null
        item.purchaseOrders = [...(item.purchaseOrders || []), file]
        recordOrderEvent(item, 'purchase_order_added', request.adminName, `Anexo administrativo adicionado: ${file.name}`)
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
        recordOrderEvent(item, 'purchase_order_removed', request.adminName, `Anexo administrativo removido: ${removed.name}`)
        return true
      })
      if (!removed) return response.status(404).json({ message: 'Anexo não encontrado.' })
      response.json({ ok: true })
    } catch (error) { handleError(response, error) }
  })
  // Nº do pedido de compra and Nota de entrada: asked when the offer is accepted ("Gerar OS com informações pendentes"
  // leaves them for later) and filled in or corrected in Ver OS. A field left out of the body is not touched; an empty
  // one is removed. Like the Anexos administrativos, they never reach the operators (operatorOrder).
  // [field, history type, label, gender ending of its words]
  const purchaseFields = [['purchaseOrderNumber', 'purchase_order_number', 'Nº do pedido de compra', 'o'], ['entryInvoiceNumber', 'entry_invoice_number', 'Nota de entrada', 'a']]
  configured.put('/orders/:code/purchase-info', requireAdmin, async (request, response) => {
    const body = request.body ?? {}
    try {
      const order = await mutateStore((store) => {
        const item = store.orders.find((entry) => entry.code === request.params.code)
        if (!item) throw Object.assign(new Error('OS não encontrada.'), { status: 404 })
        for (const [key, type, label, g] of purchaseFields) {
          if (!(key in body)) continue
          const value = clean(body[key], 80), before = item[key] || ''
          if (before === value) continue
          if (value) item[key] = value
          else delete item[key]
          recordOrderEvent(item, type, request.adminName, !value ? `${label} removid${g} (era ${before}).` : before ? `${label} alterad${g} de ${before} para ${value}.` : `${label} informad${g}: ${value}.`)
        }
        return item
      })
      response.json({ item: order })
    } catch (error) { handleError(response, error) }
  })
  // Interno/Externo of the OS: each switch is kept with who made it, to measure the time spent in each one.
  configured.put('/orders/:code/location', requireAdmin, async (request, response) => {
    if (!validServiceLocation(request.body?.location)) return response.status(400).json({ message: 'Escolha se o serviço é interno ou externo.' })
    try {
      const order = await mutateStore((store) => {
        const item = store.orders.find((entry) => entry.code === request.params.code)
        if (!item) return null
        const from = currentServiceLocation(item), to = request.body.location
        if (from !== to) {
          item.locationChanges = [...(item.locationChanges || []), { at: new Date().toISOString(), from, to, by: request.adminName || 'Administrador' }]
          recordOrderEvent(item, 'location_changed', request.adminName, `Tipo de serviço alterado de ${serviceLocationLabel(from)} para ${serviceLocationLabel(to)}.`)
        }
        return item
      })
      if (!order) return response.status(404).json({ message: 'OS não encontrada.' })
      response.json({ item: { code: order.code, serviceLocation: currentServiceLocation(order), locationChanges: order.locationChanges || [] } })
    } catch (error) { handleError(response, error) }
  })
  // Files of the OS added by mistake are removed from the OS (and its offer) and from the disk.
  configured.delete('/orders/:code/attachments/:attachmentId', requireAdmin, async (request, response) => {
    try {
      const removed = await mutateStore((store) => {
        const order = store.orders.find((entry) => entry.code === request.params.code)
        const file = order?.attachments?.find((item) => item.id === request.params.attachmentId)
        if (!file) return null
        order.attachments = order.attachments.filter((item) => item.id !== file.id)
        const offer = store.offers.find((entry) => entry.id === order.offerId)
        if (offer) offer.attachments = (offer.attachments || []).filter((item) => item.id !== file.id)
        order.updatedAt = new Date().toISOString()
        if (offer) offer.updatedAt = order.updatedAt
        recordOrderEvent(order, 'attachment_removed', request.adminName, `Anexo da OS removido: ${file.name}`)
        return file
      })
      if (!removed) return response.status(404).json({ message: 'Anexo não encontrado.' })
      await rm(path.join(filesDirectory, removed.id), { force: true }).catch(() => {})
      response.status(204).end()
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
        // Ofertas manuais em análise e, desde o formulário do site, também as ofertas do site ainda em criação.
        const allowed = item.origin === 'Inserida Manualmente' ? ['review', 'rejected'] : item.origin === 'Site' ? ['creating', 'review', 'rejected'] : []
        if (item.orderCode || !allowed.includes(item.status)) throw Object.assign(new Error('Somente ofertas manuais em análise ou ofertas do site podem ser recusadas.'), { status: 409 })
        if (item.status === 'rejected') return item
        item.status = 'rejected'
        item.rejectedAt = new Date().toISOString()
        item.rejectedBy = request.adminId
        // Uma oferta do site recusada ainda em criação deixa de estar "sendo criada".
        delete item.editingBy
        return item
      })
      response.json({ item: offer })
    } catch (error) { handleError(response, error) }
  })
  // TCK-0006: undoes a "Recusar" clicked by mistake. The offer goes back to "Em análise" with everything it had (draft,
  // e-mails, attachments, resources); a site offer refused while still being created goes back to "Criando oferta".
  // The refusal undone stays on the offer in rejectionHistory, like declineHistory.
  configured.post('/offers/:id/unreject', requireAdmin, async (request, response) => {
    try {
      const offer = await mutateStore((store) => {
        const item = store.offers.find((entry) => entry.id === request.params.id)
        if (!item) throw Object.assign(new Error('Oferta não encontrada.'), { status: 404 })
        if (item.status !== 'rejected' || item.proposalDecline || item.orderCode) throw Object.assign(new Error('Esta oferta não tem uma recusa para desfazer.'), { status: 409 })
        item.rejectionHistory = [...(item.rejectionHistory || []), { rejectedAt: item.rejectedAt || null, rejectedBy: item.rejectedBy ?? null, undoneAt: new Date().toISOString(), undoneBy: request.adminId ?? null, undoneByName: request.adminName || 'Administrador' }]
        item.status = item.origin === 'Site' && !item.creationFinishedAt ? 'creating' : 'review'
        delete item.rejectedAt
        delete item.rejectedBy
        return item
      })
      response.json({ item: offer })
    } catch (error) { handleError(response, error) }
  })
  configured.post('/offers/:id/accept', requireAdmin, async (request, response) => {
    let connection
    // Nº do pedido de compra and Nota de entrada: asked on the acceptance; "Gerar OS com informações pendentes" keeps what
    // was filled in and leaves the rest for Ver OS.
    const purchaseOrderNumber = clean(request.body?.purchaseOrderNumber, 80), entryInvoiceNumber = clean(request.body?.entryInvoiceNumber, 80)
    try {
      const order = await mutateStore(async (store) => {
        const item = store.offers.find((entry) => entry.id === request.params.id)
        if (item?.status === 'rejected') throw Object.assign(new Error('Esta oferta foi recusada e não pode gerar uma OS.'), { status: 409 })
        // Etiqueta: an offer with a label number and no proposal opens its OS now; the quote comes at the end (labelQuotes.js).
        const label = Boolean(String(item?.labelNumber ?? '').trim()) && !item?.proposal
        if (!item?.proposal && !label) return null
        if (label && item.status === 'creating') throw Object.assign(new Error(stillCreating), { status: 409 })
        if (item.quantityPending) throw Object.assign(new Error('Informe a quantidade de peças da oferta antes de abrir a OS.'), { status: 409 })
        if (label && !isDay(item.deadline)) throw Object.assign(new Error('Informe o prazo solicitado pelo cliente (em Informações do serviço) antes de abrir a OS da etiqueta.'), { status: 400 })
        const existing = item.orderCode && store.orders.find((entry) => entry.offerId === item.id)
        if (existing?.inventoryConsumption) return existing
        if (item.orderCode && !existing) { const error = new Error('OS vinculada não encontrada.'); error.status = 409; throw error }
        // A proposal generated before the planned times and resources became mandatory still needs them to become an OS.
        const problem = existing ? '' : stagePlanProblem(serviceSettings(item).stages, item.resources)
        if (problem) throw Object.assign(new Error(`${problem} Preencha nos detalhes da oferta antes de aceitar.`), { status: 400 })
        // Lançamento retroativo: an offer entered with an earlier "Data da solicitação" opens its OS on that same day, with
        // nothing asked again on the acceptance; the real moment of the entry is kept in registeredAt.
        const now = new Date(), orderDay = retroactiveOrderDay(item), retroactive = Boolean(orderDay)
        const created = existing || { code: nextCode('OS', [...store.orders, ...(store.cancelledOrders || [])]), offerId: item.id, createdAt: retroactive ? dayMoment(orderDay, now) : now.toISOString(), ...(retroactive ? { registeredAt: now.toISOString() } : {}), ...(purchaseOrderNumber ? { purchaseOrderNumber } : {}), ...(entryInvoiceNumber ? { entryInvoiceNumber } : {}), createdBy: request.adminId ?? null, status: 'Em andamento', company: item.company, cnpj: item.cnpj, service: item.service, description: item.description, labelNumber: item.labelNumber, quantity: item.quantity, quantityUnit: quantityUnitOf(item.quantityUnit), deadline: item.deadline, requestedAt: item.requestedAt, attachments: [...item.attachments], resources: item.resources, proposal: label ? labelPlaceholderProposal(item) : item.proposal, ...(label ? { labelQuote: { pending: true, openedAt: new Date().toISOString(), openedByName: request.adminName || 'Administrador', estimate: labelEstimate(item.resources) } } : {}) }
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
        if (!existing) { Object.assign(created, pieceTracking(store, created)); recordOrderEvent(created, 'order_created', request.adminName, [label ? `OS da etiqueta ${item.labelNumber} aberta sem proposta (${item.code || item.id}): o orçamento é gerado no fim, com as horas e o material usados.` : `OS gerada a partir da proposta aceita (${item.code || item.id}).`, purchaseOrderNumber ? `Nº do pedido de compra: ${purchaseOrderNumber}.` : 'Sem pedido de compra.', entryInvoiceNumber ? `Nota de entrada: ${entryInvoiceNumber}.` : 'Sem nota de entrada.', retroactive ? `Lançamento retroativo: data da OS ${brDay(orderDay)}.` : ''].filter(Boolean).join(' ')); store.orders.unshift(created) }
        else {
          if (purchaseOrderNumber && !existing.purchaseOrderNumber) existing.purchaseOrderNumber = purchaseOrderNumber
          if (entryInvoiceNumber && !existing.entryInvoiceNumber) existing.entryInvoiceNumber = entryInvoiceNumber
        }
        item.orderCode = created.code
        item.status = 'accepted'
        if (created.labelQuote) item.labelQuote = { pending: created.labelQuote.pending }
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
            const [[material]] = await connection.execute('SELECT id, name, unit, quantity_kg, unit_price FROM inventory_materials WHERE id = ? FOR UPDATE', [materialId])
            if (!material) continue
            const balance = Number((Number(material.quantity_kg) + amount).toFixed(3))
            await connection.execute('UPDATE inventory_materials SET quantity_kg = ? WHERE id = ?', [balance, materialId])
            await connection.execute("INSERT INTO inventory_movements (material_id, movement_type, quantity_kg, unit_price_kg, balance_after_kg, destination, order_code, notes) VALUES (?, 'entry', ?, ?, ?, ?, ?, ?)", [materialId, amount, Number(material.unit_price), balance, 'Estorno de OS', order.code, `Estorno da ${order.code}: aceite da oferta ${item.code} desfeito.`])
            returned.push({ materialId, name: material.name, unit: material.unit, quantity: amount })
          }
        }
        const at = new Date().toISOString(), byName = request.adminName || 'Administrador'
        recordOrderEvent(order, 'order_cancelled', byName, `Aceite desfeito: OS cancelada${returned.length ? `; devolvido ao estoque: ${returned.map((row) => `${row.name} ${formatQuantity(row.quantity, row.unit)}`).join(', ')}` : ''}.`)
        store.cancelledOrders ||= []
        store.cancelledOrders.push({ ...order, cancelledAt: at, cancelledBy: request.adminId, cancelledByName: byName, returnedMaterials: returned })
        store.orders = store.orders.filter((entry) => entry !== order)
        item.acceptHistory = [...(item.acceptHistory || []), { orderCode: order.code, acceptedAt: order.createdAt, undoneAt: at, undoneBy: request.adminId, undoneByName: byName }]
        item.orderCode = null
        // An etiqueta had no proposal: it goes back to analysis, where "Abrir OS da etiqueta" is again.
        item.status = item.labelQuote ? 'review' : 'proposed'
        delete item.labelQuote
        // The offer goes back to before the acceptance: what the OS took from the stock is not on it anymore, and the
        // decisions taken on its material requests during the OS (purchase requested, refused) are cleared, so a new
        // acceptance starts from zero. The notices of the cancelled OS go away with it.
        item.resources = { ...item.resources, materials: (item.resources?.materials || []).map(({ inventoryConsumedQuantity, inventoryConsumedCost, groupStockStatus, groupPurchaseQuantity, requestRejection, ...material }) => material) }
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
