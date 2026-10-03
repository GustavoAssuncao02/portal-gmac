import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import express from 'express'
import PDFDocument from 'pdfkit'
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

export function mutateStore(change) {
  const operation = pendingWrite.catch(() => {}).then(async () => {
    await mkdir(dataDirectory, { recursive: true })
    const store = await readStore()
    const result = await change(store)
    const temporaryPath = `${storePath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, JSON.stringify(store, null, 2), 'utf8')
    // Windows may temporarily lock the destination during reads or antivirus scans.
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporaryPath, storePath); break } catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error
        await delay(20 * (attempt + 1))
      }
    }
    return result
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
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ margin: 48, size: 'A4' })
    const chunks = []
    document.on('data', (chunk) => chunks.push(chunk))
    document.on('error', reject)
    document.on('end', () => resolve(Buffer.concat(chunks)))
    const heading = layout === 'executive' ? '#173f6a' : '#0c4c91'
    document.fillColor(heading).fontSize(layout === 'compact' ? 19 : 23).text('GMAC Metalúrgica')
    document.fillColor('#333333').fontSize(11).text(`Proposta ${offer.code} · Modelo ${layout}`)
    document.moveDown().fontSize(17).text(offer.service)
    document.moveDown(0.5).fontSize(11)
      .text(`Cliente: ${offer.company}`)
      .text(`CNPJ: ${offer.cnpj}`)
      .text(`Número da etiqueta: ${offer.labelNumber}`)
      .text(`Quantidade: ${offer.quantity}`)
      .text(`Prazo solicitado: ${date(offer.deadline)}`)
    document.moveDown().fontSize(13).fillColor(heading).text('Descrição do serviço')
    document.fillColor('#333333').fontSize(11).text(offer.description)
    document.moveDown().fontSize(13).fillColor(heading).text('Materiais necessários')
    document.fillColor('#333333').fontSize(11)
    if (resources.materials?.length) {
      resources.materials.forEach((item) => document.text(`${item.name} · ${item.detail || 'Sem especificação'} · ${item.quantity} kg · ${money(item.quantity * item.unitPrice)}`))
    } else document.text('Nenhum material informado.')
    document.moveDown().fontSize(13).fillColor(heading).text('Mão de obra')
    document.fillColor('#333333').fontSize(11)
    if (resources.laborEntries?.length) {
      resources.laborEntries.forEach((item) => document.text(`${item.resource} · ${item.hours} h · ${money(item.hours * item.hourlyRate)}`))
    } else document.text('Nenhuma mão de obra informada.')
    document.moveDown().fontSize(13).fillColor(heading).text('Condições da proposta')
    document.fillColor('#333333').fontSize(11)
      .text(`Opção ${proposal.key} · ${proposal.title}`)
      .text(`Prazo de entrega: ${proposal.deadline}`)
      .text(`Valor do serviço: ${money(proposal.serviceValue)}`)
      .text(`Materiais: ${money(proposal.materials)}`)
      .text(`Mão de obra: ${money(proposal.labor)}`)
      .text(`Margem de lucro bruto: ${proposal.margin}%`)
      .text(`Desconto: ${proposal.discount}%`)
      .text(`Lucro bruto esperado: ${money(proposal.profit)}`)
      .text(`Tempo de máquina: ${proposal.machine}`)
      .text(`Tempo de serviço: ${proposal.serviceTime}`)
      .text(`Etapas: ${(proposal.stages || []).map(stageLabel).join(', ') || 'A definir'}`)
      .text(`Processo: ${serviceDetails(resources).strictProcess ? 'Sequência obrigatória' : 'Etapas livres'}`)
      .text(`Tipo: ${proposal.kind === 'product' ? 'Produto' : 'Serviço'}`)
      .text(`Fabricado a partir de: ${resources.manufacturedFrom === 'sample' ? 'Amostra' : resources.manufacturedFrom === 'drawing' ? 'Desenho' : 'Não informado'}`)
      .text(`Têmpera: ${resources.tempering === true ? 'Sim' : resources.tempering === false ? 'Não' : 'Não informada'}`)
    if (resources.stages?.includes('painting')) document.text(`Cor/Tipo: ${resources.paintColor || 'Não informado'}`)
    if (resources.serviceDescription) document.moveDown().text(`Detalhes do serviço: ${resources.serviceDescription}`)
    if (offer.attachments?.length) {
      document.moveDown().fontSize(13).fillColor(heading).text('Documentos vinculados')
      document.fillColor('#333333').fontSize(11)
      offer.attachments.forEach((attachment) => document.text(attachment.name))
    }
    document.end()
  })
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
      if (order) order.attachments = [...item.attachments]
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
    if (!offer?.proposal?.pdfId) return response.status(404).json({ message: 'Proposta não encontrada.' })
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
