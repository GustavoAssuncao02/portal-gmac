import express from 'express'
import { randomUUID } from 'node:crypto'
import { receiveFile, sendStoredFile } from './uploads.js'
import path from 'node:path'
import { dataDirectory } from './dataDirectory.js'
import { readStore, mutateStore } from './offers.js'
import { exportPdf, exportWorkbook } from './reports.js'
import { cents, validDate, todayBahia, payableStatus, daysUntil, makeInstallments, shiftMonth, filterPayables, settlementMethods, treasuryEntry, classificationParts, splitInstallments } from './payableRules.js'
import { notificationSettings } from './accounts.js'
import { assertNotReconciled, reconciledTransaction } from './bankStatements.js'
import { orderValue } from './receivables.js'
import { settlementBank, bankFilterNote } from './banks.js'
import { classificationList, entryClassification } from './accountPlan.js'

const directory = path.join(dataDirectory, 'payable-files')
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const clean = (value, limit = 1000) => String(value ?? '').trim().slice(0, limit)
const money = (value) => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const statusLabel = { pending: 'Pendente', overdue: 'Vencido', paid: 'Pago' }
const actionLabel = { created: 'Conta criada', edited: 'Conta editada', paid: 'Pagamento baixado', reversed: 'Baixa estornada', deleted: 'Conta excluída', deactivated: 'Conta desativada', reactivated: 'Conta reativada', attachment_added: 'Anexo adicionado', attachment_removed: 'Anexo removido', status_changed: 'Status alterado' }
const paymentLabel = settlementMethods
const billMethods = ['pix', 'boleto', 'card']
const detailLabel = { before: 'Antes', after: 'Depois', valueCents: 'Valor', finalCents: 'Valor pago', interestCents: 'Juros', discountCents: 'Desconto', dueDate: 'Vencimento', date: 'Data', method: 'Forma de pagamento', note: 'Observação', text: 'Descrição', name: 'Nome', supplierName: 'Fornecedor', classificationName: 'Classificação', description: 'Descrição', documentNumber: 'Documento', issueDate: 'Emissão', previousId: 'Origem recorrente', payment: 'Pagamento', bulk: 'Baixa em massa', batch: 'Baixa em lote', receipt: 'Comprovante', changes: 'Alterações' }
function readableDetails(value, key = '') {
  if (value == null) return 'Não informado'
  if (Array.isArray(value)) return value.map((item) => readableDetails(item)).join('\n')
  if (typeof value === 'object') return Object.entries(value).map(([field, item]) => `${detailLabel[field] || field}: ${readableDetails(item, field)}`).join('\n')
  if (/Cents$/.test(key)) return money(Number(value))
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value).split('-').reverse().join('/')
  return Object.hasOwn(statusLabel, value) ? statusLabel[value] : Object.hasOwn(paymentLabel, value) ? paymentLabel[value] : String(value)
}
const init = (store) => { store.payables ||= []; store.payableEvents ||= []; store.classifications ||= []; store.payableNotifications ||= [] }
function event(store, actor, type, accountId, details = {}) {
  store.payableEvents.push({ id: randomUUID(), at: new Date().toISOString(), type, accountId, userId: actor?.id ?? null, userName: actor?.name || 'Sistema', ...details })
}
function find(store, id) { const row = store.payables.find((item) => item.id === id); if (!row) fail('Conta não encontrada.', 404); return row }
function editable(row) { if (row.payment || row.inactive) fail('Estorne a baixa antes de editar esta conta.', 409) }
// A Tesouraria entry stays paid while its files are changed.
function attachable(row) { if (!treasuryEntry(row)) editable(row) }
// Tesouraria posts money that already left: a single account, issued, due and paid on the same date.
const treasuryBody = (body) => ({ ...body, kind: 'normal', issueDate: body.date, dueDate: body.date, count: 1, installments: undefined, ahead: 0, previousId: undefined })
function claimFiles(store, ids, actor) {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) fail('Anexos inválidos.')
  const files = ids.map((id) => { const file = (store.payableUploads || []).find((f) => f.id === id && String(f.userId) === String(actor.id)); if (!file) fail('Anexo inválido ou já utilizado.'); const { userId, ...safe } = file; return safe })
  store.payableUploads = (store.payableUploads || []).filter((f) => !ids.includes(f.id))
  return files
}
function duplicates(store, proposed, ignored = []) {
  const seen = new Set()
  // Tesouraria entries are not checked: two equal purchases on the same day are legitimate.
  for (const row of [...store.payables.filter((item) => !ignored.includes(item.id) && !item.treasury), ...proposed]) {
    const key = JSON.stringify([String(row.supplierId), row.valueCents, row.dueDate])
    if (seen.has(key)) fail('Conta duplicada: fornecedor, valor e vencimento já cadastrados.', 409)
    seen.add(key)
  }
}
function fields(store, body, current) {
  const supplier = (store.suppliers || []).find((item) => String(item.id) === String(body.supplierId))
  if (!supplier) fail('Selecione um fornecedor cadastrado.')
  // Money out takes expense classifications (or one outside the result). A classification already in the account stays
  // accepted even if it was deactivated later.
  const kept = current ? classificationParts(current).map((part) => part.classificationId) : []
  const usable = (id) => entryClassification(store, id, 'payable', kept)
  const classification = usable(body.classificationSplit?.length > 1 ? body.classificationSplit[0]?.classificationId : body.classificationId)
  if (!classification) fail('Selecione uma classificação ativa de despesa.')
  if (!validDate(body.issueDate) || !validDate(body.dueDate)) fail('Informe emissão e vencimento válidos.')
  if (!['normal', 'installment', 'recurring'].includes(body.kind)) fail('Tipo de conta inválido.')
  if (body.kind === 'recurring' && !['monthly', 'yearly'].includes(body.recurrence)) fail('Selecione recorrência mensal ou anual.')
  let valueCents
  try { valueCents = cents(body.value) } catch (error) { fail(error.message) }
  if (!valueCents) fail('O valor deve ser maior que zero.')
  let classificationSplit = null
  if (body.classificationSplit != null && !Array.isArray(body.classificationSplit)) fail('Divisão entre classificações inválida.')
  if (body.classificationSplit?.length > 1) {
    if (body.classificationSplit.length > 20) fail('Divida a conta em até 20 classificações.')
    classificationSplit = body.classificationSplit.map((part) => {
      const item = usable(part?.classificationId)
      if (!item) fail('Selecione uma classificação ativa em cada parte da divisão.')
      let partCents
      try { partCents = cents(part.value) } catch (error) { fail(error.message) }
      if (!partCents) fail(`Informe o valor de ${item.name} na divisão.`)
      return { classificationId: item.id, classificationName: item.name, valueCents: partCents }
    })
    if (new Set(classificationSplit.map((part) => part.classificationId)).size !== classificationSplit.length) fail('Cada classificação aparece uma vez na divisão.')
    if (classificationSplit.reduce((sum, part) => sum + part.valueCents, 0) !== valueCents) fail('A soma da divisão entre classificações deve ser igual ao valor da conta.')
  }
  const orderCode = clean(body.orderCode, 40) || null
  if (orderCode && !(store.orders || []).some((order) => order.code === orderCode)) fail('OS vinculada não encontrada.')
  return { orderCode, supplierId: supplier.id, supplierName: supplier.name, classificationId: classification.id, classificationName: classificationSplit ? classificationSplit.map((part) => part.classificationName).join(' + ') : classification.name, classificationSplit, description: clean(body.description, 5000), documentNumber: clean(body.documentNumber, 160), issueDate: body.issueDate, dueDate: body.dueDate, valueCents, kind: body.kind, recurrence: body.kind === 'recurring' ? body.recurrence : null }
}
function installments(body, valueCents, dueDate) {
  const count = Number(body.count ?? 1)
  if (body.installments !== undefined && !Array.isArray(body.installments)) fail('Parcelas inválidas.')
  let rows
  try { rows = body.installments === undefined ? makeInstallments(valueCents, dueDate, count) : body.installments.map((row) => ({ valueCents: cents(row.value), dueDate: row.dueDate })) } catch (error) { fail(error.message) }
  if (!Number.isInteger(count) || count < 1 || count > 120 || rows.length !== count || rows.some((row) => !validDate(row.dueDate) || row.valueCents <= 0) || rows.reduce((sum, row) => sum + row.valueCents, 0) !== valueCents) fail('A soma das parcelas deve ser exatamente igual ao valor total, com datas e valores válidos.')
  return rows
}
// With `store`, the bank of the settlement is required once banks are registered (Cadastros > Bancos).
function payment(body, valueCents, bulk = false, methods = billMethods, store = null) {
  if (!validDate(body.date) || body.date > todayBahia()) fail('Data de pagamento inválida ou futura.')
  if (!methods.includes(body.method)) fail(methods === billMethods ? 'Selecione Pix, Boleto ou Cartão.' : 'Selecione a forma de pagamento.')
  let interestCents = 0, discountCents = 0
  try { interestCents = cents(body.interest || '0'); discountCents = cents(body.discount || '0') } catch (error) { fail(error.message) }
  if (interestCents && discountCents || bulk && (interestCents || discountCents || body.receipts?.length || body.fileIds?.length)) fail('Juros e desconto são exclusivos; baixa em massa não aceita ajustes nem comprovante compartilhado.')
  const finalCents = valueCents + interestCents - discountCents
  if (finalCents < 0) fail('O desconto não pode ultrapassar o valor da conta.')
  return { date: body.date, method: body.method, interestCents, discountCents, finalCents, note: clean(body.note, 5000), receipts: [], ...(store ? settlementBank(store, body.bankId) : {}) }
}
// Payment of a Tesouraria entry: the full value, on the informed date, with any way of paying.
const treasuryPayment = (body, valueCents, store) => payment({ date: body.date, method: body.method, note: body.note, bankId: body.bankId }, valueCents, false, Object.keys(settlementMethods), store)
// Names follow a classification renamed later.
function classificationView(row, store) {
  const nameOf = (part) => store.classifications.find((item) => item.id === part.classificationId)?.name || part.classificationName
  if (!row.classificationSplit?.length) return { classificationName: nameOf(row) }
  const classificationSplit = row.classificationSplit.map((part) => ({ ...part, classificationName: nameOf(part) }))
  return { classificationSplit, classificationName: classificationSplit.map((part) => part.classificationName).join(' + ') }
}
function view(row, store) {
  const supplier = (store.suppliers || []).find((item) => String(item.id) === String(row.supplierId))
  return { ...row, supplierDocument: supplier?.document || null, supplierName: supplier?.name || row.supplierName, ...classificationView(row, store), status: payableStatus(row), daysUntil: daysUntil(row.dueDate) }
}
// Real cost of an OS against its price. The materials and labor planned in the proposal are already part of it;
// every payable linked to the OS (archived ones were still paid) is an additional cost that came up later.
export function orderCosts(store, order) {
  const value = orderValue(order), proposal = order.proposal || {}
  const linked = (store.payables || []).filter((row) => row.orderCode === order.code)
  const amount = (row) => row.payment ? row.payment.finalCents : row.valueCents
  const estimatedCostCents = Math.round((Number(proposal.materials || 0) + Number(proposal.labor || 0)) * 100)
  const extraCostCents = linked.reduce((sum, row) => sum + amount(row), 0), paidCostCents = linked.filter((row) => row.payment).reduce((sum, row) => sum + amount(row), 0)
  const costCents = estimatedCostCents + extraCostCents
  const receivables = (store.receivables || []).filter((row) => row.orderCode === order.code && !row.inactive)
  const marginCents = value.valueCents - costCents
  return { code: order.code, service: order.service, company: order.company, status: order.operation?.status || 'waiting', ...value, estimatedCostCents, expectedMarginPercent: Number(proposal.margin || 0), extraCostCents, costCents, paidCostCents, pendingCostCents: extraCostCents - paidCostCents, marginCents, marginPercent: value.valueCents ? Math.round(marginCents / value.valueCents * 1000) / 10 : null, receivableCents: receivables.reduce((sum, row) => sum + row.valueCents, 0), receivedCents: receivables.reduce((sum, row) => sum + (row.receipt?.finalCents || 0), 0), payables: linked.map((row) => view(row, store)) }
}
export function activeNotifications(store, userId) {
  const { payableReminderDays } = notificationSettings(store, userId)
  if (payableReminderDays === 'never') return []
  return (store.payableNotifications || []).filter((notice) => {
    const row = (store.payables || []).find((item) => item.id === notice.accountId)
    return row && !row.payment && !row.inactive && notice.dueDate === row.dueDate && [0, payableReminderDays].includes(notice.days)
  })
}
export function notificationItems(store, userId) {
  return activeNotifications(store, userId).map(({ readBy, ...notice }) => ({ ...notice, readAt: readBy?.find((entry) => String(entry.userId) === String(userId))?.at || null, account: view(find(store, notice.accountId), store) })).reverse()
}
function report(rows, store, individual = false, filters = {}) {
  const columns = ['ID', 'Fornecedor', 'Descrição', 'Classificação', 'Documento', 'Emissão', 'Valor (R$)', 'Vencimento', 'Status', 'Parcela', 'Pagamento', 'Forma', 'Banco', 'Juros (R$)', 'Desconto (R$)', 'Pago (R$)', 'Observação da baixa', 'Compra original (R$)', 'Origem recorrente']
  const sections = [{ name: 'Contas a pagar', columns, rows: rows.map((raw) => { const r = view(raw, store), p = r.payment; return [r.id, r.supplierName, `${r.description}${r.inactive ? ' (D)' : ''}`, r.classificationSplit ? r.classificationSplit.map((part) => `${part.classificationName} (${money(part.valueCents)})`).join(' + ') : r.classificationName, r.documentNumber, r.issueDate, r.valueCents / 100, r.dueDate, `${statusLabel[r.status]}${r.inactive ? ' (D)' : ''}`, r.groupId ? `${r.installmentNumber} de ${r.installmentCount}` : '', p?.date, paymentLabel[p?.method] || p?.method, p?.bankName || '', (p?.interestCents || 0) / 100, (p?.discountCents || 0) / 100, p ? p.finalCents / 100 : '', p?.note, (r.originalTotalCents || r.valueCents) / 100, r.previousId] }) }]
  if (individual) {
    const ids = rows.map((row) => row.id)
    sections.push({ name: 'Histórico', columns: ['Conta', 'Data/hora (Bahia)', 'Usuário', 'Ação', 'Detalhes'], rows: store.payableEvents.filter((e) => ids.includes(e.accountId)).map((e) => [e.accountId, new Date(e.at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }), e.userName, actionLabel[e.type] || e.type, [e.reason, readableDetails(e.changes || e.details || '')].filter(Boolean).join('\n')]) })
    sections.push({ name: 'Anexos e comprovantes', columns: ['Conta', 'Arquivo', 'Tipo', 'Tamanho (bytes)'], rows: rows.flatMap((r) => [...(r.attachments || []), ...(r.payment?.receipts || [])].map((f) => [r.id, f.name, f.contentType, f.size])) })
  }
  const notes = individual ? [] : [`Situação: ${{ all: 'Todas', inactive: 'Desativadas', ...statusLabel }[filters.status] || (filters.bankId ? 'Pagas' : 'Pendentes e vencidas')}`, ...bankFilterNote(store, filters.bankId), ...(filters.search ? [`Busca: ${filters.search}`] : []), ...(filters.supplierId ? [`Fornecedor: ${store.suppliers?.find((row) => row.id === filters.supplierId)?.name || filters.supplierId}`] : []), ...(filters.classificationId ? [`Classificação: ${store.classifications.find((row) => row.id === filters.classificationId)?.name || filters.classificationId}`] : [])]
  return { title: individual ? `Conta ${rows[0]?.id || ''}` : 'Contas a pagar', eyebrow: 'Financeiro', generatedAt: new Date().toISOString(), start: filters.start, end: filters.end, summary: [['Contas', rows.length], ['Valor original', money(rows.reduce((sum, r) => sum + r.valueCents, 0))]], notes, sections }
}

export default function createPayablesRouter(accounts, requireAdmin) {
  const router = express.Router()
  router.use(['/payables', '/suppliers'], requireAdmin)
  router.use(['/payables', '/suppliers'], async (request, _response, next) => { try { request.actor = await accounts.account(request.adminId); if (!request.actor) fail('Administrador não encontrado.', 401); next() } catch (error) { next(error) } })
  const handle = (fn) => async (req, res, next) => { try { await fn(req, res) } catch (error) { next(error) } }
  async function sweep(userId) {
    const today = todayBahia()
    const snapshot = await readStore(); init(snapshot)
    const reminderDay = (store, row) => {
      const { payableReminderDays } = notificationSettings(store, userId)
      const days = daysUntil(row.dueDate, today)
      return payableReminderDays !== 'never' && days >= 0 && days <= payableReminderDays ? days === 0 ? 0 : payableReminderDays : null
    }
    const needsWrite = snapshot.payables.some((row) => {
      const days = reminderDay(snapshot, row)
      return row.lastStatus !== payableStatus(row, today) || !row.payment && !row.inactive && days !== null && !snapshot.payableNotifications.some((n) => n.id === `${row.id}:${row.dueDate}:${days}`)
    })
    if (!needsWrite) return snapshot
    return mutateStore((store) => {
      init(store)
      for (const row of store.payables) {
        const status = payableStatus(row, today)
        if (row.lastStatus !== status) { event(store, null, 'status_changed', row.id, { details: { before: row.lastStatus || 'pending', after: status } }); row.lastStatus = status }
        const days = reminderDay(store, row)
        if (!row.payment && !row.inactive && days !== null) {
          const id = `${row.id}:${row.dueDate}:${days}`
          if (!store.payableNotifications.some((n) => n.id === id)) store.payableNotifications.push({ id, accountId: row.id, dueDate: row.dueDate, days, at: new Date().toISOString() })
        }
      }
      return store
    })
  }
  router.get('/payables', handle(async (req, res) => { const store = await sweep(); res.json({ items: req.actor.role === 'staff' ? [] : store.payables.map((r) => view(r, store)), classifications: classificationList(store), suppliers: store.suppliers || [], orders: (store.orders || []).map((order) => ({ code: order.code, service: order.service, company: order.company, status: order.operation?.status || 'waiting' })) }) }))
  router.get('/payables/history', handle(async (_req, res) => { const store = await sweep(); res.json({ items: [...store.payableEvents].reverse() }) }))
  router.get('/payables/order-costs', handle(async (_req, res) => { const store = await sweep(); res.json({ items: (store.orders || []).map((order) => { const { payables, ...summary } = orderCosts(store, order); return { ...summary, payableCount: payables.length } }) }) }))
  router.get('/payables/order-costs/:code', handle(async (req, res) => { const store = await sweep(); const order = (store.orders || []).find((item) => item.code === req.params.code); if (!order) fail('OS não encontrada.', 404); res.json({ item: orderCosts(store, order) }) }))
  router.get('/payables/notifications', handle(async (req, res) => { const store = await sweep(req.actor.id); res.set('Cache-Control', 'no-store').json({ items: notificationItems(store, req.actor.id) }) }))
  router.post('/payables/notifications/read-all', handle(async (req, res) => {
    let store = await sweep(req.actor.id)
    if (notificationItems(store, req.actor.id).some((notice) => !notice.readAt)) {
      store = await mutateStore((current) => {
        init(current)
        const at = new Date().toISOString()
        for (const notice of activeNotifications(current, req.actor.id)) {
          notice.readBy ||= []
          if (!notice.readBy.some((entry) => String(entry.userId) === String(req.actor.id))) notice.readBy.push({ userId: req.actor.id, at })
        }
        return current
      })
    }
    res.json({ items: notificationItems(store, req.actor.id) })
  }))
  // Baixa em lote: one list shared by every administrator. Entries that were paid or deactivated elsewhere drop out on their own.
  const batchOpen = (store, row) => row && !row.payment && !row.inactive
  const batchView = (store) => { const batch = store.payableBatch || {}; return { ids: (batch.ids || []).filter((id) => batchOpen(store, store.payables.find((row) => row.id === id))), updatedAt: batch.updatedAt || null, updatedByName: batch.updatedByName || null } }
  const changeBatch = (req, change) => mutateStore((store) => {
    init(store)
    if (req.actor.role === 'staff') fail('Acesso negado.', 403)
    const ids = batchView(store).ids, next = change(ids, store)
    store.payableBatch = { ids: next, updatedAt: new Date().toISOString(), updatedByName: req.actor.name || 'Sistema' }
    return batchView(store)
  })
  router.get('/payables/batch', handle(async (req, res) => { const store = await sweep(); if (req.actor.role === 'staff') fail('Acesso negado.', 403); res.set('Cache-Control', 'no-store').json(batchView(store)) }))
  router.post('/payables/batch/items', handle(async (req, res) => {
    if (!Array.isArray(req.body.ids) || !req.body.ids.length || req.body.ids.length > 500) fail('Selecione contas válidas.')
    res.json(await changeBatch(req, (ids, store) => { for (const id of req.body.ids) if (!batchOpen(store, store.payables.find((row) => row.id === id))) fail(`A conta ${id} não está em aberto.`, 409); return [...new Set([...ids, ...req.body.ids])] }))
  }))
  router.delete('/payables/batch/items', handle(async (req, res) => { res.json(await changeBatch(req, () => [])) }))
  router.delete('/payables/batch/items/:id', handle(async (req, res) => { res.json(await changeBatch(req, (ids) => ids.filter((id) => id !== req.params.id))) }))
  router.post('/payables/batch/settle', handle(async (req, res) => {
    const result = await mutateStore((store) => {
      init(store)
      if (req.actor.role === 'staff') fail('Acesso negado.', 403)
      const rows = batchView(store).ids.map((id) => find(store, id))
      if (!rows.length) fail('A lista de baixa em lote está vazia.', 409)
      // The list is read from the store inside the same write, so two people settling at once cannot pay an account twice.
      const data = rows.map((row) => payment(req.body, row.valueCents, true, billMethods, store))
      rows.forEach((row, i) => { row.payment = data[i]; row.lastStatus = 'paid'; event(store, req.actor, 'paid', row.id, { details: { ...data[i], bulk: true, batch: true } }) })
      store.payableBatch = { ids: [], updatedAt: new Date().toISOString(), updatedByName: req.actor.name || 'Sistema' }
      return rows
    }); res.json({ items: result })
  }))
  router.get('/payables/:id', handle(async (req, res) => { const store = await sweep(), row = find(store, req.params.id); const siblings = row.groupId ? store.payables.filter((r) => r.groupId === row.groupId) : []; res.json({ item: view(row, store), siblings: siblings.map((r) => view(r, store)), structureLocked: siblings.some((r) => r.payment), canDelete: row.treasury ? !reconciledTransaction(store, 'payable', row.id) : !row.payment && !row.groupId && !store.payableEvents.some((e) => e.accountId === row.id && ['paid', 'reversed'].includes(e.type)) && !store.payables.some((r) => r.previousId === row.id), history: store.payableEvents.filter((e) => e.accountId === row.id).reverse() }) }))
  router.post('/payables', handle(async (req, res) => {
    const result = await mutateStore((store) => {
      init(store)
      const treasury = req.body.treasury === true
      // The date and the way of paying are checked before the account fields that derive from them.
      if (treasury) treasuryPayment(req.body, 0, store)
      const body = treasury ? treasuryBody(req.body) : req.body
      const common = fields(store, body)
      const parts = common.kind === 'installment' ? installments(body, common.valueCents, common.dueDate) : [{ valueCents: common.valueCents, dueDate: common.dueDate }]
      if (common.kind !== 'installment' && (Number(body.count || 1) !== 1 || body.installments?.length > 1)) fail('Recorrência e parcelamento não podem ser combinados.')
      const previous = body.previousId ? find(store, body.previousId) : null
      if (previous && (!previous.payment || previous.kind !== 'recurring' || common.kind !== 'recurring')) fail('Origem recorrente inválida.')
      const groupId = common.kind === 'installment' ? randomUUID() : null
      // Recurring accounts can be generated ahead so future months show up in planning; each occurrence stays independent.
      const ahead = common.kind === 'recurring' ? Number(body.ahead || 0) : 0
      if (!Number.isInteger(ahead) || ahead < 0 || ahead > 24) fail('Informe de 0 a 24 ocorrências futuras.')
      const seriesId = ahead ? randomUUID() : null
      // Each occurrence is issued in its own month, so the DRE by competência spreads the contract over its months.
      const step = common.recurrence === 'yearly' ? 12 : 1
      const occurrences = ahead ? Array.from({ length: ahead + 1 }, (_, index) => ({ valueCents: common.valueCents, issueDate: shiftMonth(common.issueDate, index * step), dueDate: shiftMonth(common.dueDate, index * step) })) : parts
      const splits = common.kind === 'installment' ? splitInstallments(common.classificationSplit, occurrences.map((part) => part.valueCents)) : occurrences.map(() => common.classificationSplit)
      const proposed = occurrences.map((part, index) => ({ ...common, ...part, classificationSplit: splits[index], groupId, installmentNumber: seriesId ? 1 : index + 1, installmentCount: seriesId ? 1 : parts.length, seriesId, seriesIndex: seriesId ? index + 1 : null, seriesCount: seriesId ? occurrences.length : null, originalTotalCents: common.valueCents, previousId: index === 0 ? previous?.id || null : null, inactive: false, payment: null, attachments: [], createdAt: new Date().toISOString() }))
      if (!treasury) duplicates(store, proposed)
      const attachments = claimFiles(store, req.body.fileIds || [], req.actor)
      for (const [index, row] of proposed.entries()) {
        row.attachments = seriesId && index > 0 ? [] : [...attachments]
        if (treasury) Object.assign(row, { treasury: true, payment: treasuryPayment(req.body, row.valueCents, store) })
        store.payableSequence = (store.payableSequence || 0) + 1; row.id = `PAG-${String(store.payableSequence).padStart(6, '0')}`; row.lastStatus = payableStatus(row); store.payables.push(row)
        event(store, req.actor, 'created', row.id, { details: { valueCents: row.valueCents, dueDate: row.dueDate, previousId: row.previousId, text: treasury ? 'Saída lançada na Tesouraria, já baixada' : previous ? `Criada a partir de ${previous.id}` : seriesId ? `Recorrência ${index + 1} de ${proposed.length}, gerada antecipadamente` : '' } })
        if (treasury) event(store, req.actor, 'paid', row.id, { details: { ...row.payment, treasury: true } })
        if (!seriesId || index === 0) for (const file of attachments) event(store, req.actor, 'attachment_added', row.id, { details: { name: file.name } })
      }
      return proposed
    }); res.status(201).json({ items: result })
  }))
  router.put('/payables/:id', handle(async (req, res) => {
    const result = await mutateStore((store) => {
      init(store); const row = find(store, req.params.id)
      // A Tesouraria entry is corrected in place and stays paid.
      const treasury = treasuryEntry(row) && req.body.treasury === true
      if (treasury) treasuryPayment(req.body, 0, store); else editable(row)
      assertNotReconciled(store, 'payable', row.id, 'editar')
      const common = fields(store, treasury ? treasuryBody(req.body) : req.body, row)
      const attachments = claimFiles(store, req.body.fileIds || [], req.actor)
      const addAttachments = (target) => { target.attachments.push(...attachments); for (const file of attachments) event(store, req.actor, 'attachment_added', target.id, { details: { name: file.name } }) }
      if (treasury) {
        const before = { ...row }
        Object.assign(row, common, { originalTotalCents: common.valueCents, payment: { ...treasuryPayment(req.body, common.valueCents, store), receipts: row.payment.receipts || [] }, lastStatus: 'paid' })
        event(store, req.actor, 'edited', row.id, { changes: { before, after: { ...row } } }); addAttachments(row); return [row]
      }
      if (row.kind === 'installment') {
        const siblings = store.payables.filter((r) => r.groupId === row.groupId).sort((a, b) => a.installmentNumber - b.installmentNumber)
        if (common.kind !== 'installment' || common.valueCents !== row.originalTotalCents) fail('Preserve o parcelamento e o valor total original.')
        const parts = installments(req.body, row.originalTotalCents, common.dueDate)
        if (siblings.some((r) => r.payment)) {
          if (parts.length !== siblings.length || parts.some((p, i) => p.valueCents !== siblings[i].valueCents || p.dueDate !== siblings[i].dueDate) || common.dueDate !== row.dueDate) fail('Existe parcela paga. A estrutura do parcelamento está bloqueada.', 409)
          const before = { ...row }; Object.assign(row, common, { valueCents: row.valueCents, originalTotalCents: row.originalTotalCents }); event(store, req.actor, 'edited', row.id, { changes: { before, after: { ...row } } }); addAttachments(row); return [row]
        }
        const splits = splitInstallments(common.classificationSplit, parts.map((part) => part.valueCents))
        const proposed = parts.map((part, index) => ({ ...(siblings[index] || row), ...common, ...part, classificationSplit: splits[index], originalTotalCents: row.originalTotalCents, installmentNumber: index + 1, installmentCount: parts.length, attachments: siblings[index]?.attachments || [], id: siblings[index]?.id }))
        duplicates(store, proposed, siblings.map((r) => r.id))
        if (siblings.slice(parts.length).some((r) => r.attachments.length || store.payables.some((p) => p.previousId === r.id) || store.payableEvents.some((e) => e.accountId === r.id && ['paid', 'reversed'].includes(e.type)))) fail('Não é possível remover parcelas com anexos, pagamentos anteriores ou vínculos.', 409)
        store.payables = store.payables.filter((r) => r.groupId !== row.groupId)
        for (const [index, updated] of proposed.entries()) {
          if (!updated.id) { store.payableSequence++; updated.id = `PAG-${String(store.payableSequence).padStart(6, '0')}` }
          const before = siblings[index] || null; updated.lastStatus = payableStatus(updated); store.payables.push(updated); event(store, req.actor, 'edited', updated.id, { changes: { before, after: updated } })
        }
        for (const removed of siblings.slice(parts.length)) event(store, req.actor, 'deleted', removed.id, { details: { installmentRestructure: true } })
        addAttachments(proposed.find((r) => r.id === row.id) || proposed[0])
        return proposed
      }
      if (common.kind === 'installment') {
        const parts = installments(req.body, common.valueCents, common.dueDate), groupId = randomUUID(), before = { ...row }
        const splits = splitInstallments(common.classificationSplit, parts.map((part) => part.valueCents))
        const proposed = parts.map((part, index) => ({ ...row, ...common, ...part, classificationSplit: splits[index], id: index === 0 ? row.id : undefined, groupId, installmentNumber: index + 1, installmentCount: parts.length, originalTotalCents: common.valueCents, previousId: index === 0 ? row.previousId : null, attachments: index === 0 ? [...row.attachments] : [], createdAt: index === 0 ? row.createdAt : new Date().toISOString() }))
        duplicates(store, proposed, [row.id])
        store.payables = store.payables.filter((r) => r.id !== row.id)
        for (const [index, updated] of proposed.entries()) {
          if (!updated.id) { store.payableSequence++; updated.id = `PAG-${String(store.payableSequence).padStart(6, '0')}` }
          updated.lastStatus = payableStatus(updated); store.payables.push(updated)
          event(store, req.actor, index === 0 ? 'edited' : 'created', updated.id, index === 0 ? { changes: { before, after: { ...updated } } } : { details: { valueCents: updated.valueCents, dueDate: updated.dueDate, groupId } })
        }
        addAttachments(proposed[0]); return proposed
      }
      duplicates(store, [{ ...row, ...common }], [row.id])
      const before = { ...row }; Object.assign(row, common, { originalTotalCents: common.valueCents, lastStatus: payableStatus({ ...row, ...common }) }); event(store, req.actor, 'edited', row.id, { changes: { before, after: { ...row } } }); addAttachments(row); return [row]
    }); res.json({ items: result })
  }))
  router.post('/payables/bulk', handle(async (req, res) => {
    const result = await mutateStore((store) => {
      init(store)
      if (!Array.isArray(req.body.ids) || !req.body.ids.length || new Set(req.body.ids).size !== req.body.ids.length) fail('Selecione contas válidas.')
      const rows = req.body.ids.map((id) => find(store, id))
      if (!['pay', 'deactivate'].includes(req.body.action)) fail('Ação inválida.')
      if (req.body.action === 'pay') {
        for (const row of rows) editable(row)
        const data = rows.map((row) => payment(req.body, row.valueCents, true, billMethods, store))
        rows.forEach((row, i) => { row.payment = data[i]; row.lastStatus = 'paid'; event(store, req.actor, 'paid', row.id, { details: { ...data[i], bulk: true } }) })
      } else {
        if (rows.some((row) => !row.payment || row.inactive)) fail('Somente contas pagas e ativas podem ser desativadas.')
        for (const row of rows) assertNotReconciled(store, 'payable', row.id, 'desativar')
        for (const row of rows) { row.inactive = true; event(store, req.actor, 'deactivated', row.id) }
      }
      return rows
    }); res.json({ items: result })
  }))
  router.post('/payables/:id/pay', handle(async (req, res) => { const item = await mutateStore((store) => { init(store); const row = find(store, req.params.id); editable(row); const data = payment(req.body, row.valueCents, false, billMethods, store); data.receipts = claimFiles(store, req.body.fileIds || [], req.actor); row.payment = data; row.lastStatus = 'paid'; event(store, req.actor, 'paid', row.id, { details: row.payment }); for (const file of data.receipts) event(store, req.actor, 'attachment_added', row.id, { details: { name: file.name, receipt: true } }); return row }); res.json({ item }) }))
  router.post('/payables/:id/reverse', handle(async (req, res) => { const item = await mutateStore((store) => { init(store); const row = find(store, req.params.id); if (!row.payment || row.inactive) fail('Reative a conta antes de estornar.', 409); assertNotReconciled(store, 'payable', row.id, 'estornar'); const reason = clean(req.body.reason); if (reason.length < 10) fail('Informe um motivo com pelo menos 10 caracteres.'); event(store, req.actor, 'reversed', row.id, { reason, details: { payment: row.payment } }); row.payment = null; row.lastStatus = payableStatus(row); return row }); res.json({ item }) }))
  router.post('/payables/:id/activation', handle(async (req, res) => { const item = await mutateStore((store) => { init(store); const row = find(store, req.params.id); if (!row.payment || typeof req.body.inactive !== 'boolean') fail('Somente contas pagas podem ser desativadas ou reativadas.'); if (req.body.inactive) assertNotReconciled(store, 'payable', row.id, 'desativar'); if (row.inactive !== req.body.inactive) { row.inactive = req.body.inactive; event(store, req.actor, row.inactive ? 'deactivated' : 'reactivated', row.id) } return row }); res.json({ item }) }))
  router.delete('/payables/:id', handle(async (req, res) => { await mutateStore((store) => { init(store); const row = find(store, req.params.id); /* A Tesouraria entry posted by mistake is removed directly; the history keeps its data. */ if (!row.treasury && (row.payment || store.payableEvents.some((e) => e.accountId === row.id && ['paid', 'reversed'].includes(e.type)) || row.groupId || store.payables.some((r) => r.previousId === row.id))) fail('Conta com pagamento, parcelamento ou vínculo: preserve o histórico; desative quando paga.', 409); assertNotReconciled(store, 'payable', row.id, 'excluir'); event(store, req.actor, 'deleted', row.id, { details: { account: row } }); store.payables = store.payables.filter((r) => r.id !== row.id) }); res.json({ ok: true }) }))
  // Files up to the attachment limit (uploads.js): written to the disk first, then recorded; a record that is not saved removes its file.
  router.post('/payables/uploads', handle(async (req, res) => {
    const file = { id: randomUUID(), name: path.basename(clean(req.query.name, 200)), contentType: clean(req.query.type, 160) || 'application/octet-stream', userId: req.actor.id }
    if (!file.name) fail('Nome de arquivo inválido.')
    const received = await receiveFile(req, directory, file.id)
    if (!received) fail('Selecione um arquivo.')
    file.size = received.size
    await mutateStore((store) => { store.payableUploads ||= []; store.payableUploads.push(file) }).catch(async (error) => { await received.discard(); throw error }); res.status(201).json({ item: { id: file.id } })
  }))
  router.post('/payables/:id/files', handle(async (req, res) => {
    const file = { id: randomUUID(), name: path.basename(clean(req.query.name, 200)), contentType: clean(req.query.type, 160) || 'application/octet-stream' }
    if (!file.name) fail('Nome de arquivo inválido.')
    const received = await receiveFile(req, directory, file.id)
    if (!received) fail('Selecione um arquivo.')
    file.size = received.size
    await mutateStore((store) => { init(store); const row = find(store, req.params.id); attachable(row); row.attachments.push(file); event(store, req.actor, 'attachment_added', row.id, { details: { name: file.name } }) }).catch(async (error) => { await received.discard(); throw error }); res.status(201).json({ item: file })
  }))
  router.get('/payables/:id/files/:fileId', handle(async (req, res) => { const store = await readStore(); init(store); const row = find(store, req.params.id); const file = [...row.attachments, ...(row.payment?.receipts || [])].find((f) => f.id === req.params.fileId); if (!file) fail('Arquivo não encontrado.', 404); res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`); await sendStoredFile(res, path.join(directory, file.id)) }))
  router.delete('/payables/:id/files/:fileId', handle(async (req, res) => { await mutateStore((store) => { init(store); const row = find(store, req.params.id); attachable(row); const file = row.attachments.find((f) => f.id === req.params.fileId); if (!file) fail('Arquivo não encontrado.', 404); row.attachments = row.attachments.filter((f) => f.id !== file.id); event(store, req.actor, 'attachment_removed', row.id, { details: { name: file.name } }) }); res.json({ ok: true }) }))
  router.post('/payables/export', handle(async (req, res) => { const store = await sweep(); if (req.body.ids !== undefined && !Array.isArray(req.body.ids)) fail('Seleção inválida.'); const rows = req.body.id ? [find(store, req.body.id)] : filterPayables(store.payables.map((r) => view(r, store)), req.body.filters).filter((r) => !req.body.ids || req.body.ids.includes(r.id)); if (!['pdf', 'xlsx'].includes(req.body.format)) fail('Formato inválido.'); const data = report(rows, store, Boolean(req.body.id), req.body.filters); const output = req.body.format === 'pdf' ? await exportPdf(data) : await exportWorkbook(data); res.setHeader('Content-Type', req.body.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="gmac-contas-a-pagar.${req.body.format}"`); res.send(Buffer.from(output)) }))
  router.get('/suppliers', handle(async (_req, res) => { res.json({ items: (await readStore()).suppliers || [] }) }))
  for (const method of ['post', 'put']) router[method](method === 'post' ? '/suppliers' : '/suppliers/:id', handle(async (req, res) => { const item = await mutateStore((store) => {
    init(store); store.suppliers ||= []
    const fields = { name: clean(req.body.name, 120), document: String(req.body.document || '').replace(/\D/g, ''), email: clean(req.body.email, 160), phone: clean(req.body.phone, 30), notes: clean(req.body.notes, 1000) }
    if (!fields.name || ![11, 14].includes(fields.document.length)) fail('Informe nome e CPF/CNPJ com 11 ou 14 dígitos.')
    if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) fail('E-mail inválido.')
    if (store.suppliers.some((s) => s.id !== req.params.id && s.document === fields.document)) fail('Fornecedor já cadastrado.', 409)
    let row = store.suppliers.find((s) => s.id === req.params.id); if (method === 'put' && !row) fail('Fornecedor não encontrado.', 404)
    const before = row ? { ...row } : null
    if (!row) { row = { id: randomUUID(), createdAt: new Date().toISOString() }; store.suppliers.push(row) }
    Object.assign(row, fields); event(store, req.actor, before ? 'supplier_edited' : 'supplier_created', null, { details: { before, after: row } }); return row
  }); res.json({ item }) }))
  router.delete('/suppliers/:id', handle(async (req, res) => { await mutateStore((store) => { init(store); const row = (store.suppliers || []).find((s) => s.id === req.params.id); if (!row) fail('Fornecedor não encontrado.', 404); if (store.payables.some((r) => String(r.supplierId) === row.id)) fail('Existem contas vinculadas a este fornecedor.', 409); store.suppliers = store.suppliers.filter((s) => s.id !== row.id); event(store, req.actor, 'supplier_deleted', null, { details: row }) }); res.json({ ok: true }) }))
  router.sweep = sweep
  return router
}
