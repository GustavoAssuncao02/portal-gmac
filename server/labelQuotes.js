import express from 'express'
import { readStore, mutateStore } from './offers.js'
import { buildDraft, claimNestleNumber, claimQuoteNumber, clientOfOffer, documentProposal, fromSaved, normalizeDocument, paymentClientView, proposalSettings, remember, rememberClientPaymentDays } from './proposalDocuments.js'
import { actorOf } from './registryHistory.js'
import { renderProposalDocument } from './proposalPdf.js'
import { osValueOf, round2 } from './proposalMath.js'
import { stageMinutes } from './pieces.js'
import { stageLabel } from './serviceStages.js'
import { recordOrderEvent } from './orderHistory.js'
import { consumeOrderIncrease, consumedCost } from './orderMaterials.js'
import { formatQuantity, materialUnit, validQuantityFor } from './materialUnits.js'
import { labelPlaceholderProposal } from './labelQuoteRules.js'

// "Aguardando NF-e" of an etiqueta OS (labelQuoteRules.js): once the operators finish every piece, the window of the OS
// shows the hours really worked and the material used. The material is corrected there (less returns to the stock, more
// leaves it, as in Editar OS); then the quote is generated in one of the proposal models with those numbers, sent by
// e-mail (proposalEmails.js, "Medição de etiqueta") and the OS is concluded with the receivable of the quote's value.
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const kg = (value) => Number(Number(value).toFixed(3))
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const json = (value) => typeof value === 'string' ? JSON.parse(value) : value
export const labelQuoteWaiting = 'O orçamento da etiqueta é feito depois que os operadores concluem todas as peças.'

function labelOrder(store, code) {
  const order = (store.orders || []).find((item) => item.code === code)
  if (!order?.labelQuote) fail('OS de etiqueta não encontrada.', 404)
  return order
}

// What left the stock for the OS (the rest of the quantity is still pending purchase). A material not linked to the stock
// never had anything taken from it.
const fromStock = (material) => material.inventoryId == null ? 0 : Number(material.inventoryConsumedQuantity ?? (Number(material.quantity) - (Number(material.purchaseQuantity) || 0))) || 0

// Real hours of each stage, from the time the operators spent on it, with the machine or service planned for the stage
// (the same name the offer's labor used, so the proposal models put it on the same line of their price list).
export function realLabor(order, operation) {
  return Object.entries(stageMinutes(operation)).map(([code, minutes]) => ({ code, stage: stageLabel(code), resource: order.resources?.stageResources?.[code]?.name || stageLabel(code), hours: round2(minutes / 60) })).filter((row) => row.hours > 0)
}

export function labelQuoteView(order, operation, offer) {
  const estimate = order.labelQuote?.estimate || {}
  const real = realLabor(order, operation)
  const codes = [...new Set([...(order.resources?.stages || []), ...real.map((row) => row.code)])]
  const versions = order.labelQuote?.versions || []
  return {
    order: { code: order.code, offerId: order.offerId, service: order.service, company: order.company, cnpj: order.cnpj, labelNumber: order.labelNumber, quantity: order.quantity, deadline: order.proposal?.deadline || order.deadline },
    completed: operation?.status === 'completed', concluded: Boolean(operation?.completionAcknowledgedAt),
    hours: codes.map((code) => ({ code, stage: stageLabel(code), resource: order.resources?.stageResources?.[code]?.name || '', estimatedHours: round2((Number(estimate.stages?.[code] ?? order.resources?.stageTimes?.[code]) || 0) / 60), realHours: real.find((row) => row.code === code)?.hours || 0 })),
    materials: (order.resources?.materials || []).map((material) => ({ id: material.id, name: material.name, detail: material.detail || '', unit: materialUnit(material.unit), estimated: Number(estimate.materials?.[material.id] ?? material.requestedQuantity ?? material.quantity) || 0, quantity: Number(material.quantity) || 0, fromStock: fromStock(material), pending: Number(material.purchaseQuantity) || 0, linked: material.inventoryId != null })),
    quote: { pending: Boolean(order.labelQuote?.pending), generatedAt: order.labelQuote?.generatedAt || null, generatedByName: order.labelQuote?.generatedByName || null, total: order.labelQuote?.pending ? null : osValueOf(order.proposal), document: order.labelQuote?.pending ? null : order.proposal?.document ? { model: order.proposal.document.model, number: order.proposal.document.quoteNumber || order.proposal.document.labelNumber || order.proposal.document.number || '' } : null, versions },
    emails: (offer?.proposalEmails || []).map(({ id, sentAt, sentByName, subject, to }) => ({ id, sentAt, sentByName, subject, to })),
  }
}

// `accounts` (optional): the client of the OS, whose payment term fills the letter models and is learned from them.
export default function createLabelQuotesRouter({ pool, inventoryPool = pool, requireAdmin, accounts = null }) {
  const router = express.Router()
  router.use(['/orders/:code/label-quote', '/orders/:code/label-quote-draft', '/orders/:code/label-quote-document', '/orders/:code/label-quote/materials'], requireAdmin)
  const handle = (task) => async (request, response) => {
    try { await task(request, response) } catch (error) {
      if (!error.status) console.error('Falha no orçamento da etiqueta:', error)
      response.status(error.status || 500).json({ message: error.status ? error.message : 'Não foi possível concluir a operação do orçamento da etiqueta.' })
    }
  }
  async function operationOf(order) {
    if (!pool?.execute) return order.operation || null
    const [rows] = await pool.execute('SELECT data FROM order_operations WHERE order_code = ?', [order.code])
    return rows.length ? json(rows[0].data) : order.operation || null
  }
  // Material and quote change only while the OS waits for its NF-e: every piece done, OS not concluded yet.
  function assertWaiting(operation) {
    if (operation?.status !== 'completed') fail(labelQuoteWaiting, 409)
    if (operation.completionAcknowledgedAt) fail('Esta OS já foi concluída: o orçamento da etiqueta não pode mais mudar.', 409)
  }

  router.get('/orders/:code/label-quote', handle(async (request, response) => {
    const store = await readStore()
    const order = labelOrder(store, request.params.code)
    response.set('Cache-Control', 'no-store').json(labelQuoteView(order, await operationOf(order), store.offers.find((item) => item.id === order.offerId)))
  }))

  // The material really used. Less than what left the stock returns to it ("Devolução da OS"); more takes it from the
  // stock (what the stock lacks stays pending purchase, as in Editar OS). A quote already generated is discarded: it was
  // made with the old quantities.
  router.put('/orders/:code/label-quote/materials', handle(async (request, response) => {
    const sent = Array.isArray(request.body?.materials) ? request.body.materials : fail('Informe o material consumido.')
    const before = await readStore()
    const operation = await operationOf(labelOrder(before, request.params.code))
    assertWaiting(operation)
    let connection = null
    try {
      const result = await mutateStore(async (store) => {
        const order = labelOrder(store, request.params.code)
        const materials = order.resources?.materials || []
        const previous = structuredClone(materials)
        const lines = []
        for (const entry of sent) {
          const material = materials.find((item) => item.id === entry?.id) || fail('Material da OS não encontrado. Abra a janela de novo.', 409)
          const quantity = Number(entry.quantity), unit = materialUnit(material.unit)
          if (entry.quantity === '' || entry.quantity == null || !Number.isFinite(quantity) || quantity < 0 || quantity > 1e9) fail(`${material.name}: informe a quantidade consumida.`)
          if (!validQuantityFor(quantity, unit)) fail(`${material.name}: material contado por unidade aceita só quantidades inteiras.`)
          if (kg(quantity) === kg(material.quantity)) continue
          const taken = fromStock(material)
          if (material.inventoryId != null && !connection) {
            if (!inventoryPool?.getConnection) fail('O banco de estoque precisa estar disponível para ajustar o material.', 503)
            connection = await inventoryPool.getConnection()
            await connection.beginTransaction()
          }
          lines.push(`${material.name}: ${formatQuantity(material.quantity, unit)} → ${formatQuantity(quantity, unit)}`)
          if (quantity >= taken) {
            Object.assign(material, { quantity: kg(quantity), purchaseQuantity: kg(quantity - taken) })
            if (material.inventoryId != null) material.stockStatus = quantity - taken > 0 ? taken > 0 ? 'partial' : 'missing' : 'available'
            continue
          }
          // Less than what the stock gave: the difference goes back to it.
          const back = kg(taken - quantity)
          const [[item]] = await connection.execute('SELECT id, quantity_kg, unit_price FROM inventory_materials WHERE id = ? FOR UPDATE', [material.inventoryId])
          if (item) {
            const balance = kg(Number(item.quantity_kg) + back)
            await connection.execute('UPDATE inventory_materials SET quantity_kg = ? WHERE id = ?', [balance, item.id])
            await connection.execute(`INSERT INTO inventory_movements (material_id, movement_type, quantity_kg, unit_price_kg, balance_after_kg, destination, order_code, notes)
                                      VALUES (?, 'entry', ?, ?, ?, ?, ?, ?)`, [item.id, back, Number(item.unit_price), balance, 'Devolução da OS', order.code, `Material consumido corrigido no orçamento da etiqueta: ${formatQuantity(material.quantity, unit)} → ${formatQuantity(quantity, unit)}.`])
            const summary = order.inventoryConsumption?.materials?.find((row) => row.inventoryId === material.inventoryId)
            if (summary) summary.balance = balance
          }
          // What goes back leaves the real cost of the OS at the average price of what it had taken.
          Object.assign(material, { quantity: kg(quantity), inventoryConsumedQuantity: kg(quantity), inventoryConsumedCost: Number((consumedCost(material) * quantity / taken).toFixed(4)), stockAvailable: kg(quantity), purchaseQuantity: 0, stockStatus: 'available' })
        }
        if (!lines.length) return { order, changed: false }
        if (connection) await consumeOrderIncrease(connection, order, previous)
        // The totals of each stock item of the OS follow its lines.
        for (const material of materials.filter((item) => item.inventoryId != null)) {
          const group = materials.filter((item) => item.inventoryId === material.inventoryId)
          const pending = kg(group.reduce((total, item) => total + (Number(item.purchaseQuantity) || 0), 0))
          Object.assign(material, { groupPurchaseQuantity: pending, groupStockStatus: pending > 0 ? 'partial' : 'available' })
          const summary = order.inventoryConsumption?.materials?.find((row) => row.inventoryId === material.inventoryId)
          if (summary) Object.assign(summary, { quantity: kg(group.reduce((total, item) => total + Number(item.quantity), 0)), consumedQuantity: kg(group.reduce((total, item) => total + fromStock(item), 0)), purchaseQuantity: pending })
        }
        const offer = store.offers.find((item) => item.id === order.offerId)
        const discarded = !order.labelQuote.pending
        order.labelQuote = { ...order.labelQuote, pending: true, ...(discarded ? { discardedAt: new Date().toISOString() } : {}) }
        order.proposal = { ...labelPlaceholderProposal({ ...order, deadline: order.proposal?.deadline || order.deadline }), strictProcess: order.proposal?.strictProcess ?? true }
        if (offer) {
          offer.resources = structuredClone(order.resources)
          if (discarded) offer.proposal = null
          offer.labelQuote = { pending: true }
          offer.updatedAt = new Date().toISOString()
        }
        order.updatedAt = new Date().toISOString()
        recordOrderEvent(order, 'label_materials_adjusted', request.adminName, `Material consumido corrigido para o orçamento da etiqueta: ${lines.join('; ')}.${discarded ? ' O orçamento gerado antes foi descartado.' : ''}`)
        return { order, changed: true, discarded }
      }, { commit: () => connection?.commit(), rollback: () => connection?.rollback() })
      const store = await readStore()
      const order = labelOrder(store, request.params.code)
      response.json({ ...labelQuoteView(order, operation, store.offers.find((item) => item.id === order.offerId)), changed: result.changed, discarded: Boolean(result.discarded) })
    } finally { connection?.release() }
  }))

  // The form of the quote, in the chosen model: hours from the real time of each stage, material as used in the OS.
  router.get('/orders/:code/label-quote-draft', handle(async (request, response) => {
    const store = await readStore()
    const order = labelOrder(store, request.params.code)
    const operation = await operationOf(order)
    const model = String(request.query.model || '')
    const source = { ...order, resources: { ...order.resources, laborEntries: realLabor(order, operation).map(({ resource, hours }) => ({ resource, hours })) } }
    const client = await clientOfOffer(accounts, order)
    const fresh = await buildDraft({ model, store, offer: source, client, value: order.labelQuote.pending ? 0 : osValueOf(order.proposal), deadline: order.proposal?.deadline || order.deadline })
    if (fresh.usage) fresh.usage = fresh.usage.map((item) => ({ ...item, source: item.kind === 'labor' ? 'Horas reais da OS' : 'Consumido na OS' }))
    const saved = order.labelQuote.pending ? null : order.proposal?.document
    const draft = saved?.model === model && !request.query.fresh ? { ...fromSaved(saved, proposalSettings(store)), ...(fresh.quoteNumber ? { quoteNumber: fresh.quoteNumber } : {}), ...(model === 'nestle' ? { number: fresh.number } : {}), usage: fresh.usage } : fresh
    response.set('Cache-Control', 'no-store').json({ draft, settings: proposalSettings(store), paymentClient: paymentClientView(client) })
  }))

  router.post('/orders/:code/label-quote-document', handle(async (request, response) => {
    const { model, document: input, assignments } = request.body || {}
    const before = await readStore()
    const operation = await operationOf(labelOrder(before, request.params.code))
    assertWaiting(operation)
    const document = await normalizeDocument(model, input, before)
    await renderProposalDocument(document)
    await mutateStore((store) => {
      const order = labelOrder(store, request.params.code)
      const offer = store.offers.find((item) => item.id === order.offerId)
      claimQuoteNumber(store, document)
      claimNestleNumber(store, document, order.offerId)
      const proposal = { ...documentProposal({ item: order, option: { key: 'A', title: 'Etiqueta', deadline: order.proposal?.deadline || order.deadline }, document, model, stages: order.resources?.stages || [], generatedBy: request.adminName || null }), strictProcess: order.proposal?.strictProcess ?? true }
      const version = { model, number: document.quoteNumber || document.labelNumber || document.number || '', total: document.total, generatedAt: proposal.generatedAt, generatedByName: request.adminName || 'Administrador' }
      order.proposal = proposal
      order.labelQuote = { ...order.labelQuote, pending: false, generatedAt: version.generatedAt, generatedByName: version.generatedByName, versions: [...(order.labelQuote.versions || []), version] }
      // The offer carries the same proposal: its PDF and its e-mail are the ones of every proposal.
      if (offer) { offer.proposal = structuredClone(proposal); offer.labelQuote = { pending: false, generatedAt: version.generatedAt }; offer.updatedAt = version.generatedAt }
      remember(store, model, document, assignments)
      order.updatedAt = version.generatedAt
      recordOrderEvent(order, 'label_quote_generated', request.adminName, `Orçamento da etiqueta gerado${version.number ? ` (nº ${version.number})` : ''}: ${money(document.total)}.`)
    })
    const store = await readStore()
    const order = labelOrder(store, request.params.code)
    const paymentRegistered = await rememberClientPaymentDays({ accounts, offer: order, document, actor: actorOf(request) })
    response.json({ ...labelQuoteView(order, operation, store.offers.find((item) => item.id === order.offerId)), paymentRegistered })
  }))
  return router
}
