import express from 'express'
import { randomUUID } from 'node:crypto'
import { receiveFile, sendStoredFile } from './uploads.js'
import path from 'node:path'
import { dataDirectory } from './dataDirectory.js'
import { readStore, mutateStore } from './offers.js'
import { exportPdf, exportWorkbook } from './reports.js'
import { cents, validDate, todayBahia, daysUntil, makeInstallments, shiftMonth, matchesSearch, treasuryEntry } from './payableRules.js'
import { notificationSettings } from './accounts.js'
import { assertNotReconciled, reconciledTransaction } from './bankStatements.js'
import { normalizeText } from './ofx.js'
import { osValueOf } from './proposalMath.js'
import { operationStates } from './reportData.js'
import { settlementBank } from './banks.js'
import { classificationList, entryClassification } from './accountPlan.js'

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const clean = (value, limit = 1000) => String(value ?? '').trim().slice(0, limit)
const money = (value) => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const receiptMethods = { pix: 'Pix', boleto: 'Boleto', transfer: 'Transferência', card: 'Cartão', cash: 'Dinheiro' }
const statusLabel = { pending: 'Pendente', overdue: 'Vencido', received: 'Recebido' }
const actionLabel = { created: 'Conta criada', edited: 'Conta editada', received: 'Recebimento baixado', reversed: 'Recebimento estornado', deleted: 'Conta excluída', status_changed: 'Status alterado', attachment_added: 'Anexo adicionado', attachment_removed: 'Anexo removido' }
const directory = path.join(dataDirectory, 'receivable-files')
const init = (store) => { store.receivables ||= []; store.receivableEvents ||= []; store.orders ||= []; store.receivableNotifications ||= []; store.receivableUploads ||= [] }
export const receivableStatus = (row, today = todayBahia()) => row.receipt ? 'received' : row.dueDate < today ? 'overdue' : 'pending'
function event(store, actor, type, accountId, details = {}) { store.receivableEvents.push({ id: randomUUID(), at: new Date().toISOString(), type, accountId, userId: actor?.id ?? null, userName: actor?.name || 'Sistema', ...details }) }
function find(store, id) { const row = store.receivables.find((item) => item.id === id); if (!row) fail('Conta a receber não encontrada.', 404); return row }
// The name follows a classification renamed later.
const classificationNameOf = (store, row) => (store.classifications || []).find((item) => item.id === row.classificationId)?.name || row.classificationName || ''
const view = (row, store) => ({ ...row, classificationName: classificationNameOf(store, row), attachments: row.attachments || [], status: receivableStatus(row), daysUntil: daysUntil(row.dueDate), reconciled: Boolean(reconciledTransaction(store, 'receivable', row.id)) })
// Same search as payables: text, value as typed in Brazil and the payer CPF/CNPJ.
export const matchesReceivable = (row, search) => matchesSearch({ id: row.id, supplierName: row.customerName, supplierDocument: row.customerDocument, description: row.description, documentNumber: row.documentNumber, orderCode: row.orderCode, valueCents: row.valueCents }, search)
function claimFiles(store, ids, actor) {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) fail('Anexos inválidos.')
  const files = ids.map((id) => { const file = store.receivableUploads.find((item) => item.id === id && String(item.userId) === String(actor.id)); if (!file) fail('Anexo inválido ou já utilizado.'); const { userId, ...safe } = file; return safe })
  store.receivableUploads = store.receivableUploads.filter((item) => !ids.includes(item.id))
  return files
}
const dateLabel = (value) => value.split('-').reverse().join('/')
const groupOf = (store, row) => row.groupId ? store.receivables.filter((item) => item.groupId === row.groupId).sort((a, b) => a.installmentNumber - b.installmentNumber) : [row]
const hasReceiptHistory = (store, row) => Boolean(row.receipt) || store.receivableEvents.some((e) => e.accountId === row.id && ['received', 'reversed'].includes(e.type))
// Why an account (with its whole installment plan) cannot be deleted, or null when it can: a receipt history has to be
// preserved (a Tesouraria entry posted by mistake is the exception) and a bank reconciliation has to be undone first.
function deletionBlock(store, row, group = groupOf(store, row)) {
  if (!row.treasury && group.some((item) => hasReceiptHistory(store, item))) return { message: row.groupId ? 'Há parcela com recebimento: preserve o histórico do parcelamento.' : 'Conta com recebimento: preserve o histórico.', status: 409 }
  for (const item of group) { try { assertNotReconciled(store, 'receivable', item.id, 'excluir') } catch (error) { return { message: error.message, status: error.status || 409 } } }
  return null
}
const linkedReceivables = (store, orderCode) => store.receivables.filter((row) => row.orderCode === orderCode && !row.inactive)
// Reopening an OS may take the accounts posted for it along (the user decides); the history keeps what was deleted.
export function removeOrderReceivables(store, actor, orderCode) {
  init(store)
  const rows = linkedReceivables(store, orderCode), removed = [...new Set(rows.flatMap((row) => groupOf(store, row)))]
  for (const row of rows) { const block = deletionBlock(store, row); if (block) fail(`Não foi possível excluir ${row.id}. ${block.message}`, block.status) }
  for (const item of removed) event(store, actor, 'deleted', item.id, { details: { account: item, text: `Excluída ao reabrir a ${orderCode}` } })
  store.receivables = store.receivables.filter((item) => !removed.includes(item))
  return removed.map((item) => item.id)
}
// No expected receipt date (installments included) can come before the document's issue date.
function assertDueDates(parts, issueDate) {
  for (const part of parts) {
    if (!validDate(part.dueDate)) fail('Informe a data prevista de recebimento.')
    if (part.dueDate < issueDate) fail(`A data prevista de recebimento não pode ser anterior à data de emissão (${dateLabel(issueDate)}).`)
  }
}
// A single document can be received in installments; they must add up exactly to the total.
// The ISS expected for the document follows its parts: each occurrence of a contract carries it whole; installments split
// it in proportion to their values, the last one taking the rounding.
function withIss(parts, common) {
  const total = common.issCents || 0
  if (common.kind !== 'installment') return parts.map((part) => ({ ...part, issCents: total }))
  let given = 0
  return parts.map((part, index) => {
    const issCents = index === parts.length - 1 ? total - given : Math.round(total * part.valueCents / common.valueCents)
    given += issCents
    return { ...part, issCents }
  })
}
function partsOf(body, common, creating = false) {
  return withIss(splitParts(body, common, creating), common)
}
function splitParts(body, common, creating) {
  if (common.kind === 'recurring' && creating) {
    const ahead = Number(body.ahead ?? 0)
    if (!Number.isInteger(ahead) || ahead < 0 || ahead > 24) fail('Informe de 0 a 24 ocorrências futuras.')
    // Each occurrence is issued in its own month, so the DRE by competência spreads the contract over its months.
    const step = common.recurrence === 'yearly' ? 12 : 1
    return Array.from({ length: ahead + 1 }, (_, index) => ({ valueCents: common.valueCents, issueDate: shiftMonth(common.issueDate, index * step), dueDate: shiftMonth(common.dueDate, index * step) }))
  }
  if (common.kind !== 'installment') return [{ valueCents: common.valueCents, dueDate: common.dueDate }]
  const count = Number(body.count)
  if (!Number.isInteger(count) || count < 2 || count > 120) fail('Informe de 2 a 120 parcelas.')
  if (body.installments !== undefined && !Array.isArray(body.installments)) fail('Parcelas inválidas.')
  let rows
  try { rows = body.installments?.length ? body.installments.map((row) => ({ valueCents: cents(row.value), dueDate: row.dueDate })) : makeInstallments(common.valueCents, common.dueDate, count) } catch (error) { fail(error.message) }
  if (rows.length !== count || rows.some((row) => !validDate(row.dueDate) || row.valueCents <= 0) || rows.reduce((sum, row) => sum + row.valueCents, 0) !== common.valueCents) fail('A soma das parcelas deve ser exatamente igual ao valor total, com datas e valores válidos.')
  return rows
}

// The OS price is the OS value of the accepted proposal: what the customer pays, already with margin and discount.
export function orderValue(order) {
  const proposal = order?.proposal || {}
  // A proposal made with the commercial models states the amount agreed with the customer; newer ones carry the OS value.
  if (Number(proposal.document?.total) > 0 || proposal.osValue != null) {
    const valueCents = Math.round(osValueOf(proposal) * 100)
    return { serviceCents: valueCents, discount: 0, valueCents }
  }
  // Proposals saved before the OS value existed: the service value was the price, with the discount applied.
  const serviceCents = Math.round(Number(proposal.serviceValue || 0) * 100)
  const discount = Math.min(100, Math.max(0, Number(proposal.discount || 0)))
  return { serviceCents, discount, valueCents: Math.round(serviceCents * (100 - discount) / 100) }
}

export function filterReceivables(rows, filters = {}, today = todayBahia()) {
  return rows.filter((row) => {
    if (filters.start && row.dueDate < filters.start || filters.end && row.dueDate > filters.end) return false
    if (!matchesReceivable(row, filters.search)) return false
    // Only received accounts have a bank: filtering by bank lists the receipts that entered it.
    if (filters.bankId && row.receipt?.bankId !== filters.bankId) return false
    const status = receivableStatus(row, today)
    if (filters.status === 'all' || filters.bankId && !filters.status) return true
    return filters.status ? status === filters.status : status !== 'received'
  })
}

async function fields(store, body, accounts, current) {
  let customer
  if (body.clientId) {
    const client = (await accounts.clients()).find((item) => String(item.id) === String(body.clientId))
    if (!client) fail('Cliente não encontrado.')
    customer = { clientId: String(client.id), customerName: client.name, customerDocument: String(client.document || '').replace(/\D/g, '') || null }
  } else customer = { clientId: null, customerName: clean(body.customerName, 160), customerDocument: String(body.customerDocument || '').replace(/\D/g, '') || null }
  if (!customer.customerName) fail('Selecione um cliente ou informe o nome do pagador.')
  if (customer.customerDocument && ![11, 14].includes(customer.customerDocument.length)) fail('O CPF/CNPJ do cliente deve ter 11 ou 14 dígitos.')
  if (!validDate(body.dueDate)) fail('Informe a data prevista de recebimento.')
  const issueDate = body.issueDate || current?.issueDate || todayBahia()
  if (!validDate(issueDate)) fail('Data de emissão inválida.')
  if (issueDate > body.dueDate) fail(`A data prevista de recebimento não pode ser anterior à data de emissão (${dateLabel(issueDate)}).`)
  const kind = ['installment', 'recurring'].includes(body.kind) ? body.kind : 'single'
  if (kind === 'recurring' && !['monthly', 'yearly'].includes(body.recurrence)) fail('Selecione recorrência mensal ou anual.')
  let valueCents
  try { valueCents = cents(body.value) } catch (error) { fail(error.message) }
  if (!valueCents) fail('O valor deve ser maior que zero.')
  // ISS the customer already said will be withheld: the account shows the net value before the money arrives.
  let issCents = 0
  try { issCents = cents(body.iss || '0') } catch (error) { fail(error.message) }
  if (issCents >= valueCents) fail('O ISS deve ser menor que o valor da conta.')
  return { ...customer, description: clean(body.description, 5000), documentNumber: clean(body.documentNumber, 160), issueDate, dueDate: body.dueDate, valueCents, issCents, kind, recurrence: kind === 'recurring' ? body.recurrence : null }
}
function duplicates(store, proposed, ignored = []) {
  const key = (row) => JSON.stringify([normalizeText(row.customerName), row.valueCents, row.dueDate])
  // Tesouraria entries are not checked: two equal sales on the same day are legitimate.
  if (store.receivables.some((row) => !ignored.includes(row.id) && !row.inactive && !row.treasury && key(row) === key(proposed))) fail('Conta duplicada: cliente, valor e vencimento já cadastrados.', 409)
}
// Money in takes a revenue classification (or one outside the result, like a loan received). Without one in the request,
// an account being edited keeps the classification it has.
function revenueClassification(store, body, current) {
  const id = body.classificationId || current?.classificationId
  const item = entryClassification(store, id, 'receivable', current?.classificationId ? [current.classificationId] : [])
  if (!item) fail('Selecione a classificação da receita.')
  return { classificationId: item.id, classificationName: item.name }
}
// `expectedIss`: the ISS registered with the account; a bulk receipt applies it, since it accepts no adjustment typed by hand.
// With `store`, the bank of the settlement is required once banks are registered (Cadastros > Bancos).
function receipt(body, valueCents, bulk = false, expectedIss = 0, store = null) {
  if (!validDate(body.date) || body.date > todayBahia()) fail('Data de recebimento inválida ou futura.')
  if (!Object.hasOwn(receiptMethods, body.method)) fail('Selecione a forma de recebimento.')
  // The ISS withheld by the customer is subtracted from what arrives, like the discount, and may come with interest or discount.
  let interestCents = 0, discountCents = 0, issCents = 0
  try { interestCents = cents(body.interest || '0'); discountCents = cents(body.discount || '0'); issCents = cents(body.iss || '0') } catch (error) { fail(error.message) }
  if (interestCents && discountCents) fail('Juros e desconto são exclusivos.')
  if (bulk && (interestCents || discountCents || issCents || body.fileIds?.length)) fail('A baixa em massa não aceita juros, desconto, ISS ou comprovante; faça a baixa individual.')
  if (bulk) issCents = expectedIss
  const finalCents = valueCents + interestCents - discountCents - issCents
  if (finalCents < 0) fail('O desconto e o ISS não podem ultrapassar o valor da conta.')
  return { date: body.date, method: body.method, interestCents, discountCents, issCents, finalCents, note: clean(body.note, 5000), receipts: [], ...(store ? settlementBank(store, body.bankId) : {}) }
}
// Tesouraria posts money already received: a single account, issued, due and received on the same date.
const treasuryBody = (body) => ({ ...body, kind: 'single', issueDate: body.date, dueDate: body.date, ahead: 0, count: 1, installments: undefined })
// When the amount received (`received`) differs from the value of the account, the difference is interest (more) or discount (less).
function treasuryReceipt(body, valueCents, store) {
  const base = { date: body.date, method: body.method, note: body.note, bankId: body.bankId }
  if (body.received === undefined || body.received === null || body.received === '') return receipt(base, valueCents, false, 0, store)
  let receivedCents
  try { receivedCents = cents(body.received) } catch (error) { fail(error.message) }
  if (!receivedCents) fail('O valor recebido deve ser maior que zero.')
  const difference = receivedCents - valueCents
  return receipt({ ...base, interest: difference > 0 ? (difference / 100).toFixed(2) : '', discount: difference < 0 ? (-difference / 100).toFixed(2) : '' }, valueCents, false, 0, store)
}
// Reminders mirror Contas a Pagar (N days before and on the day) plus one notice once the date has passed.
export function activeReceivableNotices(store, userId) {
  const { receivableReminderDays } = notificationSettings(store, userId)
  if (receivableReminderDays === 'never') return []
  return (store.receivableNotifications || []).filter((notice) => {
    const row = (store.receivables || []).find((item) => item.id === notice.accountId)
    return row && !row.receipt && !row.inactive && notice.dueDate === row.dueDate && [0, receivableReminderDays, 'overdue'].includes(notice.days)
  })
}
export function receivableNotificationItems(store, userId) {
  return activeReceivableNotices(store, userId).map(({ readBy, ...notice }) => ({ ...notice, readAt: readBy?.find((entry) => String(entry.userId) === String(userId))?.at || null, account: view(store.receivables.find((row) => row.id === notice.accountId), store) })).reverse()
}
function report(rows, filters = {}, individual = false) {
  const columns = ['ID', 'Cliente', 'CPF/CNPJ', 'Descrição', 'Classificação', 'Origem', 'Documento', 'Parcela', 'Emissão', 'Valor (R$)', 'Vencimento', 'Status', 'Recebimento', 'Forma', 'Banco', 'Juros (R$)', 'Desconto (R$)', 'ISS (R$)', 'Recebido (R$)', 'Observação']
  return { title: individual ? `Conta ${rows[0]?.id || ''}` : 'Contas a receber', eyebrow: 'Financeiro', generatedAt: new Date().toISOString(), start: filters.start, end: filters.end, summary: [['Contas', rows.length], ['Valor original', money(rows.reduce((sum, row) => sum + row.valueCents, 0))]], notes: [`Situação: ${{ all: 'Todas', ...statusLabel }[filters.status] || 'Pendentes e vencidas'}`, ...(filters.search ? [`Busca: ${filters.search}`] : [])], sections: [{ name: 'Contas a receber', columns, rows: rows.map((row) => { const r = row.receipt; return [row.id, row.customerName, row.customerDocument, row.description, row.classificationName || '', row.orderCode || 'Manual', row.documentNumber, row.groupId ? `${row.installmentNumber} de ${row.installmentCount}` : '', row.issueDate, row.valueCents / 100, row.dueDate, statusLabel[receivableStatus(row)], r?.date, receiptMethods[r?.method] || '', r?.bankName || '', (r?.interestCents || 0) / 100, (r?.discountCents || 0) / 100, (r?.issCents || 0) / 100, r ? r.finalCents / 100 : '', r?.note] }) }] }
}

export default function createReceivablesRouter(accounts, requireAdmin, pool = null) {
  const router = express.Router()
  router.use('/receivables', requireAdmin, async (request, _response, next) => { try { request.actor = await accounts.account(request.adminId); if (!request.actor) fail('Administrador não encontrado.', 401); next() } catch (error) { next(error) } })
  const handle = (fn) => async (req, res, next) => { try { await fn(req, res) } catch (error) { next(error) } }
  // With the database, the state of the operation (and so whether the OS is finished) lives in order_operations, not in the saved order.
  async function operationStatus(order) {
    if (pool) {
      const [row] = await operationStates([order], pool)
      if (row) return (typeof row.data === 'string' ? JSON.parse(row.data) : row.data)?.status
    }
    return order.operation?.status
  }
  async function sweep(userId) {
    const today = todayBahia(), snapshot = await readStore(); init(snapshot)
    const noticeDay = (store, row) => {
      const { receivableReminderDays } = notificationSettings(store, userId), days = daysUntil(row.dueDate, today)
      if (days < 0) return 'overdue'
      return receivableReminderDays !== 'never' && days <= receivableReminderDays ? days === 0 ? 0 : receivableReminderDays : null
    }
    const pending = (store) => store.receivables.filter((row) => !row.receipt && !row.inactive)
    const missing = (store) => pending(store).some((row) => { const days = noticeDay(store, row); return days !== null && !store.receivableNotifications.some((n) => n.id === `${row.id}:${row.dueDate}:${days}`) })
    const statusChanged = (store) => store.receivables.some((row) => row.lastStatus !== receivableStatus(row, today))
    if (!missing(snapshot) && !statusChanged(snapshot)) return snapshot
    return mutateStore((store) => {
      init(store)
      for (const row of store.receivables) {
        const status = receivableStatus(row, today)
        if (row.lastStatus !== status) { event(store, null, 'status_changed', row.id, { details: { before: row.lastStatus || 'pending', after: status } }); row.lastStatus = status }
      }
      for (const row of pending(store)) {
        const days = noticeDay(store, row), id = `${row.id}:${row.dueDate}:${days}`
        if (days !== null && !store.receivableNotifications.some((n) => n.id === id)) store.receivableNotifications.push({ id, accountId: row.id, dueDate: row.dueDate, days, at: new Date().toISOString() })
      }
      return store
    })
  }
  router.sweep = sweep
  router.get('/receivables', handle(async (req, res) => {
    const store = await sweep(req.actor.id); init(store)
    let clients = []
    try { clients = await accounts.clients() } catch { /* The list still works when the client registry is unavailable. */ }
    res.json({ items: store.receivables.map((row) => view(row, store)), clients: clients.map((row) => ({ id: String(row.id), name: row.name, document: row.document })), classifications: classificationList(store) })
  }))
  router.get('/receivables/history', handle(async (_req, res) => { const store = await readStore(); init(store); res.json({ items: [...store.receivableEvents].reverse() }) }))
  router.get('/receivables/order/:code', handle(async (req, res) => {
    const store = await readStore(); init(store)
    const order = store.orders.find((item) => item.code === req.params.code)
    if (!order) fail('OS não encontrada.', 404)
    const existing = linkedReceivables(store, order.code).sort((a, b) => (a.installmentNumber || 1) - (b.installmentNumber || 1))
    // `deleteBlock` tells why the accounts cannot be removed (when reopening the OS, for instance).
    const deleteBlock = existing.map((row) => deletionBlock(store, row)).find(Boolean)?.message || null
    res.json({ order: { code: order.code, company: order.company, cnpj: String(order.cnpj || '').replace(/\D/g, ''), service: order.service, completed: await operationStatus(order) === 'completed', ...orderValue(order) }, item: existing.length ? view(existing[0], store) : null, items: existing.map((row) => view(row, store)), deleteBlock, classifications: classificationList(store).filter((item) => !item.inactive && !item.groupInactive && item.nature !== 'expense') })
  }))
  router.get('/receivables/:id', handle(async (req, res) => {
    const store = await readStore(); init(store); const row = find(store, req.params.id), group = groupOf(store, row)
    res.json({ item: view(row, store), siblings: row.groupId ? group.map((item) => view(item, store)) : [], structureLocked: group.some((item) => item.receipt), canDelete: row.treasury ? !reconciledTransaction(store, 'receivable', row.id) : group.every((item) => !hasReceiptHistory(store, item) && !reconciledTransaction(store, 'receivable', item.id)), history: store.receivableEvents.filter((e) => e.accountId === row.id).reverse() })
  }))
  router.post('/receivables', handle(async (req, res) => {
    const treasury = req.body.treasury === true
    // The date and the way of receiving are checked before the account fields that derive from them.
    if (treasury) treasuryReceipt(req.body, 0)
    const body = treasury ? treasuryBody(req.body) : req.body
    const draft = body.orderCode ? null : await fields(null, body, accounts)
    const item = await mutateStore(async (store) => {
      init(store)
      let common = draft, origin = 'manual', order = null
      if (body.orderCode) {
        order = store.orders.find((row) => row.code === body.orderCode)
        if (!order) fail('OS não encontrada.', 404)
        if (await operationStatus(order) !== 'completed') fail('A OS precisa estar concluída para programar o recebimento.', 409)
        const existing = store.receivables.find((row) => row.orderCode === order.code && !row.inactive)
        if (existing) fail(`Esta OS já possui a conta a receber ${existing.id}.`, 409)
        const document = String(order.cnpj || '').replace(/\D/g, '')
        common = await fields(store, { customerName: order.company, customerDocument: [11, 14].includes(document.length) ? document : '', description: body.description || `${order.code} · ${order.service}`, documentNumber: order.code, value: body.value, iss: body.iss, issueDate: treasury ? body.issueDate : undefined, dueDate: body.dueDate, kind: body.kind }, accounts)
        origin = 'order'
      }
      common = { ...common, ...revenueClassification(store, body) }
      const parts = partsOf(body, common, true)
      assertDueDates(parts, common.issueDate)
      const recurring = common.kind === 'recurring'
      const groupId = parts.length > 1 && !recurring ? randomUUID() : null, seriesId = recurring && parts.length > 1 ? randomUUID() : null, createdAt = new Date().toISOString()
      const rows = parts.map((part, index) => ({ origin, orderCode: order?.code || null, offerId: order?.offerId || null, ...common, ...part, kind: recurring ? 'recurring' : groupId ? 'installment' : 'single', groupId, installmentNumber: groupId ? index + 1 : 1, installmentCount: groupId ? parts.length : 1, seriesId, seriesIndex: seriesId ? index + 1 : null, seriesCount: seriesId ? parts.length : null, originalTotalCents: groupId ? common.valueCents : part.valueCents, receipt: null, inactive: false, createdAt }))
      // An OS is unique by its code; equal client/value/date across different OSs is legitimate.
      if (origin === 'manual' && !treasury) for (const row of rows) duplicates(store, row)
      const attachments = claimFiles(store, req.body.fileIds || [], req.actor)
      for (const [index, row] of rows.entries()) {
        // Installments share the document's files; a recurring contract keeps them on its first occurrence.
        row.attachments = common.kind === 'recurring' && index > 0 ? [] : [...attachments]
        if (treasury) Object.assign(row, { treasury: true, receipt: treasuryReceipt(req.body, row.valueCents, store) })
        store.receivableSequence = (store.receivableSequence || 0) + 1
        row.id = `REC-${String(store.receivableSequence).padStart(6, '0')}`
        row.lastStatus = receivableStatus(row)
        store.receivables.push(row)
        event(store, req.actor, 'created', row.id, { details: { valueCents: row.valueCents, dueDate: row.dueDate, text: [treasury ? `Entrada lançada na Tesouraria, já recebida${order ? `, na conclusão da ${order.code}` : ''}` : order ? `Programada na conclusão da ${order.code}` : '', groupId ? `Parcela ${row.installmentNumber} de ${rows.length} de ${money(common.valueCents)}` : '', seriesId ? `Contrato recorrente: ocorrência ${row.seriesIndex} de ${rows.length}` : ''].filter(Boolean).join(' · ') } })
        if (treasury) event(store, req.actor, 'received', row.id, { details: { ...row.receipt, treasury: true } })
        for (const file of row.attachments) event(store, req.actor, 'attachment_added', row.id, { details: { name: file.name } })
      }
      return rows.map((row) => view(row, store))
    })
    res.status(201).json({ item: item[0], items: item })
  }))
  router.put('/receivables/:id', handle(async (req, res) => {
    const item = await mutateStore(async (store) => {
      init(store); const row = find(store, req.params.id), group = groupOf(store, row)
      // A Tesouraria entry is corrected in place and stays received.
      if (treasuryEntry(row) && req.body.treasury === true) {
        assertNotReconciled(store, 'receivable', row.id, 'editar')
        treasuryReceipt(req.body, 0)
        const body = treasuryBody(req.body)
        const common = { ...await fields(store, row.origin === 'order' ? { ...body, clientId: undefined, customerName: row.customerName, customerDocument: row.customerDocument ?? '' } : body, accounts, row), ...revenueClassification(store, body, row) }
        const before = { ...row }
        Object.assign(row, common, { originalTotalCents: common.valueCents, receipt: { ...treasuryReceipt(req.body, common.valueCents, store), receipts: row.receipt.receipts || [] }, lastStatus: 'received' })
        event(store, req.actor, 'edited', row.id, { changes: { before, after: { ...row } } })
        return [view(row, store)]
      }
      if (row.receipt) fail('Estorne o recebimento antes de editar esta conta.', 409)
      assertNotReconciled(store, 'receivable', row.id, 'editar')
      // The payer of an OS receivable comes from the OS and stays fixed.
      const common = { ...(row.origin === 'order' ? await fields(store, { ...req.body, clientId: undefined, customerName: row.customerName, customerDocument: row.customerDocument ?? '' }, accounts, row) : await fields(store, req.body, accounts, row)), ...revenueClassification(store, req.body, row) }
      if (group.some((item) => item.receipt)) {
        const { valueCents, dueDate, kind, issCents, ...descriptive } = common
        const before = { ...row }; Object.assign(row, descriptive); row.lastStatus = receivableStatus(row)
        event(store, req.actor, 'edited', row.id, { changes: { before, after: { ...row } }, details: { text: 'Parcelamento com parcela recebida: valores e datas preservados.' } })
        return [view(row, store)]
      }
      const parts = partsOf(req.body, common)
      assertDueDates(parts, common.issueDate)
      for (const item of group) assertNotReconciled(store, 'receivable', item.id, 'alterar o parcelamento')
      const removed = group.slice(parts.length)
      if (removed.some((item) => hasReceiptHistory(store, item))) fail('Não é possível remover parcelas com histórico de recebimento.', 409)
      const groupId = parts.length > 1 ? row.groupId || randomUUID() : null, ids = group.map((item) => item.id)
      const updated = parts.map((part, index) => ({ target: group[index], data: { ...common, ...part, kind: groupId ? 'installment' : common.kind === 'recurring' ? 'recurring' : 'single', groupId, installmentNumber: index + 1, installmentCount: parts.length, originalTotalCents: common.valueCents } }))
      if (row.origin === 'manual') for (const { data } of updated) duplicates(store, data, ids)
      const result = []
      for (const { target, data } of updated) {
        if (target) {
          const before = { ...target }; Object.assign(target, data); target.lastStatus = receivableStatus(target)
          event(store, req.actor, 'edited', target.id, { changes: { before, after: { ...target } } })
          result.push(target)
        } else {
          store.receivableSequence = (store.receivableSequence || 0) + 1
          const created = { origin: row.origin, orderCode: row.orderCode, offerId: row.offerId, ...data, id: `REC-${String(store.receivableSequence).padStart(6, '0')}`, attachments: [...(row.attachments || [])], receipt: null, inactive: false, createdAt: row.createdAt }
          created.lastStatus = receivableStatus(created); store.receivables.push(created)
          event(store, req.actor, 'created', created.id, { details: { valueCents: created.valueCents, dueDate: created.dueDate, text: `Parcela ${created.installmentNumber} de ${parts.length}, criada ao editar o parcelamento` } })
          result.push(created)
        }
      }
      for (const item of removed) event(store, req.actor, 'deleted', item.id, { details: { account: item, text: 'Parcela removida ao editar o parcelamento' } })
      store.receivables = store.receivables.filter((item) => !removed.includes(item))
      return result.map((item) => view(item, store))
    })
    res.json({ item: item.find((row) => row.id === req.params.id) || item[0], items: item })
  }))
  router.post('/receivables/:id/receive', handle(async (req, res) => {
    const item = await mutateStore((store) => {
      init(store); const row = find(store, req.params.id)
      if (row.receipt) fail('Esta conta já foi recebida.', 409)
      const data = receipt(req.body, row.valueCents, false, 0, store); data.receipts = claimFiles(store, req.body.fileIds || [], req.actor)
      row.receipt = data; row.lastStatus = 'received'; event(store, req.actor, 'received', row.id, { details: row.receipt })
      for (const file of data.receipts) event(store, req.actor, 'attachment_added', row.id, { details: { name: file.name, receipt: true } })
      return view(row, store)
    })
    res.json({ item })
  }))
  router.post('/receivables/bulk', handle(async (req, res) => {
    const items = await mutateStore((store) => {
      init(store)
      if (req.body.action !== 'receive') fail('Ação inválida.')
      if (!Array.isArray(req.body.ids) || !req.body.ids.length || new Set(req.body.ids).size !== req.body.ids.length) fail('Selecione contas válidas.')
      const rows = req.body.ids.map((id) => find(store, id))
      if (rows.some((row) => row.receipt || row.inactive)) fail('Selecione apenas contas ainda não recebidas.', 409)
      const data = rows.map((row) => receipt(req.body, row.valueCents, true, row.issCents || 0, store))
      rows.forEach((row, index) => { row.receipt = data[index]; row.lastStatus = 'received'; event(store, req.actor, 'received', row.id, { details: { ...data[index], bulk: true } }) })
      return rows.map((row) => view(row, store))
    })
    res.json({ items })
  }))
  // Files of any size: written to the disk first, then recorded; a record that is not saved removes its file.
  router.post('/receivables/uploads', handle(async (req, res) => {
    const file = { id: randomUUID(), name: path.basename(clean(req.query.name, 200)), contentType: clean(req.query.type, 160) || 'application/octet-stream', userId: req.actor.id }
    if (!file.name) fail('Nome de arquivo inválido.')
    const received = await receiveFile(req, directory, file.id)
    if (!received) fail('Selecione um arquivo.')
    file.size = received.size
    await mutateStore((store) => { init(store); store.receivableUploads.push(file) }).catch(async (error) => { await received.discard(); throw error })
    res.status(201).json({ item: { id: file.id } })
  }))
  router.post('/receivables/:id/files', handle(async (req, res) => {
    const file = { id: randomUUID(), name: path.basename(clean(req.query.name, 200)), contentType: clean(req.query.type, 160) || 'application/octet-stream' }
    if (!file.name) fail('Nome de arquivo inválido.')
    const received = await receiveFile(req, directory, file.id)
    if (!received) fail('Selecione um arquivo.')
    file.size = received.size
    await mutateStore((store) => {
      init(store); const row = find(store, req.params.id)
      if (row.receipt && !treasuryEntry(row)) fail('Estorne o recebimento antes de alterar os anexos.', 409)
      row.attachments = [...(row.attachments || []), file]; event(store, req.actor, 'attachment_added', row.id, { details: { name: file.name } })
    }).catch(async (error) => { await received.discard(); throw error })
    res.status(201).json({ item: file })
  }))
  router.get('/receivables/:id/files/:fileId', handle(async (req, res) => {
    const store = await readStore(); init(store); const row = find(store, req.params.id)
    const file = [...(row.attachments || []), ...(row.receipt?.receipts || [])].find((item) => item.id === req.params.fileId)
    if (!file) fail('Arquivo não encontrado.', 404)
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    await sendStoredFile(res, path.join(directory, file.id))
  }))
  router.delete('/receivables/:id/files/:fileId', handle(async (req, res) => {
    await mutateStore((store) => {
      init(store); const row = find(store, req.params.id)
      if (row.receipt && !treasuryEntry(row)) fail('Estorne o recebimento antes de alterar os anexos.', 409)
      const file = (row.attachments || []).find((item) => item.id === req.params.fileId)
      if (!file) fail('Arquivo não encontrado.', 404)
      row.attachments = row.attachments.filter((item) => item.id !== file.id); event(store, req.actor, 'attachment_removed', row.id, { details: { name: file.name } })
    })
    res.json({ ok: true })
  }))
  router.post('/receivables/:id/reverse', handle(async (req, res) => {
    const item = await mutateStore((store) => {
      init(store); const row = find(store, req.params.id)
      if (!row.receipt) fail('Esta conta não possui recebimento.', 409)
      assertNotReconciled(store, 'receivable', row.id, 'estornar')
      const reason = clean(req.body.reason); if (reason.length < 10) fail('Informe um motivo com pelo menos 10 caracteres.')
      event(store, req.actor, 'reversed', row.id, { reason, details: { receipt: row.receipt } }); row.receipt = null; row.lastStatus = receivableStatus(row)
      return view(row, store)
    })
    res.json({ item })
  }))
  router.delete('/receivables/:id', handle(async (req, res) => {
    await mutateStore((store) => {
      init(store); const row = find(store, req.params.id), group = groupOf(store, row)
      const block = deletionBlock(store, row, group)
      if (block) fail(block.message, block.status)
      for (const item of group) event(store, req.actor, 'deleted', item.id, { details: { account: item, text: row.groupId ? `Parcelamento excluído (${group.length} parcelas)` : '' } })
      store.receivables = store.receivables.filter((item) => !group.includes(item))
      return group.map((item) => item.id)
    })
    res.json({ ok: true })
  }))
  router.post('/receivables/export', handle(async (req, res) => {
    const store = await readStore(); init(store)
    if (!['pdf', 'xlsx'].includes(req.body.format)) fail('Formato inválido.')
    if (req.body.ids !== undefined && !Array.isArray(req.body.ids)) fail('Seleção inválida.')
    const rows = req.body.id ? [find(store, req.body.id)] : filterReceivables(store.receivables, req.body.filters).filter((row) => !req.body.ids || req.body.ids.includes(row.id))
    const data = report(rows.map((row) => ({ ...row, classificationName: classificationNameOf(store, row) })), req.body.filters, Boolean(req.body.id))
    if (req.body.id) data.sections.push({ name: 'Histórico', columns: ['Data/hora (Bahia)', 'Usuário', 'Ação', 'Motivo'], rows: store.receivableEvents.filter((e) => e.accountId === req.body.id).map((e) => [new Date(e.at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }), e.userName, actionLabel[e.type] || e.type, e.reason || '']) })
    const output = req.body.format === 'pdf' ? await exportPdf(data) : await exportWorkbook(data)
    res.setHeader('Content-Type', req.body.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="gmac-contas-a-receber.${req.body.format}"`)
    res.send(Buffer.from(output))
  }))
  return router
}
