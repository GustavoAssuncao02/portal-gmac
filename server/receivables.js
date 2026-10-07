import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'
import { exportPdf, exportWorkbook } from './reports.js'
import { cents, validDate, todayBahia, daysUntil } from './payableRules.js'
import { assertNotReconciled, reconciledTransaction } from './bankStatements.js'
import { normalizeText } from './ofx.js'

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const clean = (value, limit = 1000) => String(value ?? '').trim().slice(0, limit)
const money = (value) => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const receiptMethods = { pix: 'Pix', boleto: 'Boleto', transfer: 'Transferência', card: 'Cartão', cash: 'Dinheiro' }
const statusLabel = { pending: 'Pendente', overdue: 'Vencido', received: 'Recebido' }
const actionLabel = { created: 'Conta criada', edited: 'Conta editada', received: 'Recebimento baixado', reversed: 'Recebimento estornado', deleted: 'Conta excluída', status_changed: 'Status alterado' }
const init = (store) => { store.receivables ||= []; store.receivableEvents ||= []; store.orders ||= [] }
export const receivableStatus = (row, today = todayBahia()) => row.receipt ? 'received' : row.dueDate < today ? 'overdue' : 'pending'
function event(store, actor, type, accountId, details = {}) { store.receivableEvents.push({ id: randomUUID(), at: new Date().toISOString(), type, accountId, userId: actor?.id ?? null, userName: actor?.name || 'Sistema', ...details }) }
function find(store, id) { const row = store.receivables.find((item) => item.id === id); if (!row) fail('Conta a receber não encontrada.', 404); return row }
const view = (row, store) => ({ ...row, status: receivableStatus(row), daysUntil: daysUntil(row.dueDate), reconciled: Boolean(reconciledTransaction(store, 'receivable', row.id)) })

// The OS price is the accepted proposal: service value with the proposal discount applied.
export function orderValue(order) {
  const proposal = order?.proposal || {}
  const serviceCents = Math.round(Number(proposal.serviceValue || 0) * 100)
  const discount = Math.min(100, Math.max(0, Number(proposal.discount || 0)))
  return { serviceCents, discount, valueCents: Math.round(serviceCents * (100 - discount) / 100) }
}

export function filterReceivables(rows, filters = {}, today = todayBahia()) {
  const search = normalizeText(filters.search)
  return rows.filter((row) => {
    if (filters.start && row.dueDate < filters.start || filters.end && row.dueDate > filters.end) return false
    if (search && !normalizeText([row.id, row.customerName, row.customerDocument, row.description, row.documentNumber, row.orderCode].join(' ')).includes(search)) return false
    const status = receivableStatus(row, today)
    if (filters.status === 'all') return true
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
  let valueCents
  try { valueCents = cents(body.value) } catch (error) { fail(error.message) }
  if (!valueCents) fail('O valor deve ser maior que zero.')
  return { ...customer, description: clean(body.description, 5000), documentNumber: clean(body.documentNumber, 160), issueDate, dueDate: body.dueDate, valueCents }
}
function duplicates(store, proposed, ignored) {
  const key = (row) => JSON.stringify([normalizeText(row.customerName), row.valueCents, row.dueDate])
  if (store.receivables.some((row) => row.id !== ignored && !row.inactive && key(row) === key(proposed))) fail('Conta duplicada: cliente, valor e vencimento já cadastrados.', 409)
}
function receipt(body, valueCents) {
  if (!validDate(body.date) || body.date > todayBahia()) fail('Data de recebimento inválida ou futura.')
  if (!Object.hasOwn(receiptMethods, body.method)) fail('Selecione a forma de recebimento.')
  let interestCents = 0, discountCents = 0
  try { interestCents = cents(body.interest || '0'); discountCents = cents(body.discount || '0') } catch (error) { fail(error.message) }
  if (interestCents && discountCents) fail('Juros e desconto são exclusivos.')
  const finalCents = valueCents + interestCents - discountCents
  if (finalCents < 0) fail('O desconto não pode ultrapassar o valor da conta.')
  return { date: body.date, method: body.method, interestCents, discountCents, finalCents, note: clean(body.note, 5000) }
}
function report(rows, filters = {}, individual = false) {
  const columns = ['ID', 'Cliente', 'CPF/CNPJ', 'Descrição', 'Origem', 'Documento', 'Emissão', 'Valor (R$)', 'Vencimento', 'Status', 'Recebimento', 'Forma', 'Juros (R$)', 'Desconto (R$)', 'Recebido (R$)', 'Observação']
  return { title: individual ? `Conta ${rows[0]?.id || ''}` : 'Contas a receber', eyebrow: 'Financeiro', generatedAt: new Date().toISOString(), start: filters.start, end: filters.end, summary: [['Contas', rows.length], ['Valor original', money(rows.reduce((sum, row) => sum + row.valueCents, 0))]], notes: [`Situação: ${{ all: 'Todas', ...statusLabel }[filters.status] || 'Pendentes e vencidas'}`, ...(filters.search ? [`Busca: ${filters.search}`] : [])], sections: [{ name: 'Contas a receber', columns, rows: rows.map((row) => { const r = row.receipt; return [row.id, row.customerName, row.customerDocument, row.description, row.orderCode || 'Manual', row.documentNumber, row.issueDate, row.valueCents / 100, row.dueDate, statusLabel[receivableStatus(row)], r?.date, receiptMethods[r?.method] || '', (r?.interestCents || 0) / 100, (r?.discountCents || 0) / 100, r ? r.finalCents / 100 : '', r?.note] }) }] }
}

export default function createReceivablesRouter(accounts, requireAdmin) {
  const router = express.Router()
  router.use('/receivables', requireAdmin, async (request, _response, next) => { try { request.actor = (await accounts.admins()).find((item) => String(item.id) === String(request.adminId)); if (!request.actor) fail('Administrador não encontrado.', 401); next() } catch (error) { next(error) } })
  const handle = (fn) => async (req, res, next) => { try { await fn(req, res) } catch (error) { next(error) } }
  router.get('/receivables', handle(async (_req, res) => {
    const store = await readStore(); init(store)
    let clients = []
    try { clients = await accounts.clients() } catch { /* The list still works when the client registry is unavailable. */ }
    res.json({ items: store.receivables.map((row) => view(row, store)), clients: clients.map((row) => ({ id: String(row.id), name: row.name, document: row.document })) })
  }))
  router.get('/receivables/history', handle(async (_req, res) => { const store = await readStore(); init(store); res.json({ items: [...store.receivableEvents].reverse() }) }))
  router.get('/receivables/order/:code', handle(async (req, res) => {
    const store = await readStore(); init(store)
    const order = store.orders.find((item) => item.code === req.params.code)
    if (!order) fail('OS não encontrada.', 404)
    const existing = store.receivables.find((row) => row.orderCode === order.code && !row.inactive)
    res.json({ order: { code: order.code, company: order.company, cnpj: String(order.cnpj || '').replace(/\D/g, ''), service: order.service, completed: order.operation?.status === 'completed', ...orderValue(order) }, item: existing ? view(existing, store) : null })
  }))
  router.get('/receivables/:id', handle(async (req, res) => { const store = await readStore(); init(store); const row = find(store, req.params.id); res.json({ item: view(row, store), canDelete: !row.receipt && !store.receivableEvents.some((e) => e.accountId === row.id && ['received', 'reversed'].includes(e.type)), history: store.receivableEvents.filter((e) => e.accountId === row.id).reverse() }) }))
  router.post('/receivables', handle(async (req, res) => {
    const draft = req.body.orderCode ? null : await fields(null, req.body, accounts)
    const item = await mutateStore(async (store) => {
      init(store)
      let common = draft, origin = 'manual', order = null
      if (req.body.orderCode) {
        order = store.orders.find((row) => row.code === req.body.orderCode)
        if (!order) fail('OS não encontrada.', 404)
        if (order.operation?.status !== 'completed') fail('A OS precisa estar concluída para programar o recebimento.', 409)
        const existing = store.receivables.find((row) => row.orderCode === order.code && !row.inactive)
        if (existing) fail(`Esta OS já possui a conta a receber ${existing.id}.`, 409)
        const document = String(order.cnpj || '').replace(/\D/g, '')
        common = await fields(store, { customerName: order.company, customerDocument: [11, 14].includes(document.length) ? document : '', description: req.body.description || `${order.code} · ${order.service}`, documentNumber: order.code, value: req.body.value, dueDate: req.body.dueDate }, accounts)
        origin = 'order'
      }
      // An OS is unique by its code; equal client/value/date across different OSs is legitimate.
      if (origin === 'manual') duplicates(store, common)
      store.receivableSequence = (store.receivableSequence || 0) + 1
      const row = { id: `REC-${String(store.receivableSequence).padStart(6, '0')}`, origin, orderCode: order?.code || null, offerId: order?.offerId || null, ...common, receipt: null, inactive: false, createdAt: new Date().toISOString() }
      row.lastStatus = receivableStatus(row)
      store.receivables.push(row)
      event(store, req.actor, 'created', row.id, { details: { valueCents: row.valueCents, dueDate: row.dueDate, text: order ? `Programada na conclusão da ${order.code}` : '' } })
      return view(row, store)
    })
    res.status(201).json({ item })
  }))
  router.put('/receivables/:id', handle(async (req, res) => {
    const item = await mutateStore(async (store) => {
      init(store); const row = find(store, req.params.id)
      if (row.receipt) fail('Estorne o recebimento antes de editar esta conta.', 409)
      assertNotReconciled(store, 'receivable', row.id, 'editar')
      // The payer of an OS receivable comes from the OS and stays fixed.
      const common = row.origin === 'order' ? await fields(store, { ...req.body, clientId: undefined, customerName: row.customerName, customerDocument: row.customerDocument ?? '' }, accounts, row) : await fields(store, req.body, accounts, row)
      if (row.origin === 'manual') duplicates(store, common, row.id)
      const before = { ...row }; Object.assign(row, common); row.lastStatus = receivableStatus(row)
      event(store, req.actor, 'edited', row.id, { changes: { before, after: { ...row } } })
      return view(row, store)
    })
    res.json({ item })
  }))
  router.post('/receivables/:id/receive', handle(async (req, res) => {
    const item = await mutateStore((store) => { init(store); const row = find(store, req.params.id); if (row.receipt) fail('Esta conta já foi recebida.', 409); row.receipt = receipt(req.body, row.valueCents); row.lastStatus = 'received'; event(store, req.actor, 'received', row.id, { details: row.receipt }); return view(row, store) })
    res.json({ item })
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
      init(store); const row = find(store, req.params.id)
      if (row.receipt || store.receivableEvents.some((e) => e.accountId === row.id && ['received', 'reversed'].includes(e.type))) fail('Conta com recebimento: preserve o histórico.', 409)
      assertNotReconciled(store, 'receivable', row.id, 'excluir')
      event(store, req.actor, 'deleted', row.id, { details: { account: row } }); store.receivables = store.receivables.filter((item) => item.id !== row.id)
    })
    res.json({ ok: true })
  }))
  router.post('/receivables/export', handle(async (req, res) => {
    const store = await readStore(); init(store)
    if (!['pdf', 'xlsx'].includes(req.body.format)) fail('Formato inválido.')
    if (req.body.ids !== undefined && !Array.isArray(req.body.ids)) fail('Seleção inválida.')
    const rows = req.body.id ? [find(store, req.body.id)] : filterReceivables(store.receivables, req.body.filters).filter((row) => !req.body.ids || req.body.ids.includes(row.id))
    const data = report(rows, req.body.filters, Boolean(req.body.id))
    if (req.body.id) data.sections.push({ name: 'Histórico', columns: ['Data/hora (Bahia)', 'Usuário', 'Ação', 'Motivo'], rows: store.receivableEvents.filter((e) => e.accountId === req.body.id).map((e) => [new Date(e.at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }), e.userName, actionLabel[e.type] || e.type, e.reason || '']) })
    const output = req.body.format === 'pdf' ? await exportPdf(data) : await exportWorkbook(data)
    res.setHeader('Content-Type', req.body.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="gmac-contas-a-receber.${req.body.format}"`)
    res.send(Buffer.from(output))
  }))
  return router
}
