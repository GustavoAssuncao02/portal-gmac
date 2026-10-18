import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia, shiftMonth, treasuryEntry } from '../server/payableRules.js'
import { treasuryMovements, filterMovements, movementTotals, periodShortcuts } from '../src/treasuryMovements.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const day = (offset) => new Date(Date.parse(todayBahia()) + offset * 86400000).toISOString().slice(0, 10)

test('the cash book joins what was paid and received, by the settlement date and the amount actually moved', () => {
  const payables = [
    { id: 'PAG-000001', supplierName: 'Posto Avenida', supplierDocument: '12345678000190', description: 'Combustível', classificationName: 'Veículos', treasury: true, valueCents: 20000, payment: { date: '2026-10-05', method: 'cash', finalCents: 20000 } },
    { id: 'PAG-000002', supplierName: 'Coelba', description: 'Energia', classificationName: 'Energia', orderCode: 'OS-1', valueCents: 50000, inactive: true, payment: { date: '2026-10-10', method: 'boleto', finalCents: 50500 } },
    { id: 'PAG-000003', supplierName: 'Coelba', description: 'Energia de novembro', valueCents: 50000, payment: null },
  ]
  const receivables = [
    { id: 'REC-000001', customerName: 'Nestlé', customerDocument: '08334818000152', description: 'Venda de sucata', treasury: true, valueCents: 30000, receipt: { date: '2026-10-06', method: 'pix', finalCents: 30000 } },
    { id: 'REC-000002', customerName: 'Vipal', description: 'OS-2', orderCode: 'OS-2', valueCents: 90000, receipt: { date: '2026-09-30', method: 'transfer', finalCents: 88000 } },
    { id: 'REC-000003', customerName: 'Vipal', description: 'A receber', valueCents: 1000, receipt: null },
  ]
  const rows = treasuryMovements(payables, receivables)
  assert.deepEqual(rows.map((row) => [row.id, row.type, row.date, row.cents, row.origin, row.direct]), [
    ['PAG-000001', 'out', '2026-10-05', 20000, 'Tesouraria', true], ['PAG-000002', 'out', '2026-10-10', 50500, 'Contas a Pagar', false],
    ['REC-000001', 'in', '2026-10-06', 30000, 'Tesouraria', true], ['REC-000002', 'in', '2026-09-30', 88000, 'Contas a Receber', false],
  ])
  assert.deepEqual(treasuryMovements(), [])
  const ids = (filters) => filterMovements(rows, filters).map((row) => row.id)
  assert.deepEqual(ids({ start: '2026-10-01', end: '2026-10-31' }), ['PAG-000001', 'PAG-000002', 'REC-000001'])
  assert.deepEqual(ids({ direct: true }), ['PAG-000001', 'REC-000001'])
  assert.deepEqual(ids({ search: 'veiculos' }), ['PAG-000001'])
  assert.deepEqual(ids({ search: '505,00' }), ['PAG-000002'])
  assert.deepEqual(ids({ search: '08.334.818/0001-52' }), ['REC-000001'])
  assert.deepEqual(ids({ search: 'OS-2' }), ['REC-000002'])
  assert.deepEqual(movementTotals(filterMovements(rows, { start: '2026-10-01', end: '2026-10-31' })), { inCents: 30000, inCount: 1, outCents: 70500, outCount: 2, balanceCents: -40500 })
  assert.deepEqual(periodShortcuts('2026-03-15').map(([key, , start, end]) => [key, start, end]), [['today', '2026-03-15', '2026-03-15'], ['week', '2026-03-09', '2026-03-15'], ['month', '2026-03-01', '2026-03-31'], ['previous', '2026-02-01', '2026-02-28'], ['all', '', '']])
  assert.equal(treasuryEntry(payables[0]), true); assert.equal(treasuryEntry(payables[1]), false); assert.equal(treasuryEntry({ treasury: true, payment: null }), false); assert.equal(treasuryEntry(undefined), false)
})

test('Tesouraria posts money out and in already settled, editable and removable without a reversal', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const headers = { Authorization: `Bearer ${token}` }
    const request = (route, method, body) => f.request(route, method, body, headers)
    async function upload(route) { const response = await fetch(`${f.url}/api${route}?name=cupom.pdf&type=application/pdf`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: Buffer.from('%PDF-1.4 teste') }); return { status: response.status, data: await response.json() } }
    const supplier = (await request('/suppliers', 'POST', { name: 'Posto Avenida', document: '12345678000190' })).data.item
    const category = (await request('/classifications', 'POST', { name: 'Combustível' })).data.item
    const exit = { treasury: true, supplierId: supplier.id, classificationId: category.id, description: 'Abastecimento', value: '200', date: day(-1), method: 'cash' }

    // Money out: one account, issued, due and paid on the informed date.
    assert.equal((await request('/payables', 'POST', { ...exit, date: day(1) })).status, 400, 'no future payment')
    assert.equal((await request('/payables', 'POST', { ...exit, method: 'cheque' })).status, 400)
    assert.equal((await request('/payables', 'POST', { ...exit, supplierId: 'missing' })).status, 400)
    const file = await upload('/payables/uploads')
    const created = await request('/payables', 'POST', { ...exit, fileIds: [file.data.item.id], kind: 'installment', count: 3 })
    assert.equal(created.status, 201, JSON.stringify(created.data))
    assert.equal(created.data.items.length, 1)
    const out = created.data.items[0]
    assert.deepEqual([out.treasury, out.kind, out.issueDate, out.dueDate, out.valueCents, out.lastStatus], [true, 'normal', day(-1), day(-1), 20000, 'paid'])
    assert.deepEqual(out.payment, { date: day(-1), method: 'cash', interestCents: 0, discountCents: 0, finalCents: 20000, note: '', receipts: [] })
    assert.equal(out.attachments.length, 1)
    // The same purchase twice on the same day is legitimate, and does not block an ordinary account either.
    assert.equal((await request('/payables', 'POST', exit)).status, 201)
    assert.equal((await request('/payables', 'POST', { supplierId: supplier.id, classificationId: category.id, description: 'Conta comum', issueDate: day(-1), value: '200', dueDate: day(-1), kind: 'normal' })).status, 201)
    let detail = (await request(`/payables/${out.id}`)).data
    assert.equal(detail.item.status, 'paid'); assert.equal(detail.canDelete, true)
    assert.deepEqual(detail.history.map((row) => row.type).sort(), ['attachment_added', 'created', 'paid'])
    assert.equal((await request(`/payables/${out.id}/pay`, 'POST', { date: day(0), method: 'pix' })).status, 409, 'already paid')
    // It is corrected in place, staying paid; an ordinary edit is still refused.
    assert.equal((await request(`/payables/${out.id}`, 'PUT', { ...exit, issueDate: day(-1), dueDate: day(-1), kind: 'normal', treasury: false })).status, 409)
    const edited = await request(`/payables/${out.id}`, 'PUT', { ...exit, value: '250.50', date: day(-2), method: 'transfer', description: 'Abastecimento da frota' })
    assert.equal(edited.status, 200, JSON.stringify(edited.data))
    assert.deepEqual([edited.data.items[0].valueCents, edited.data.items[0].dueDate, edited.data.items[0].payment.finalCents, edited.data.items[0].payment.method, edited.data.items[0].description], [25050, day(-2), 25050, 'transfer', 'Abastecimento da frota'])
    assert.equal((await upload(`/payables/${out.id}/files`)).status, 201, 'files can be added while it stays paid')
    // An ordinary paid account keeps its locks.
    const bill = (await request('/payables', 'POST', { supplierId: supplier.id, classificationId: category.id, description: 'Boleto', issueDate: day(0), value: '80', dueDate: day(5), kind: 'normal' })).data.items[0]
    assert.equal((await request(`/payables/${bill.id}/pay`, 'POST', { date: day(0), method: 'cash' })).status, 400, 'Contas a Pagar keeps its own ways of paying')
    assert.equal((await request(`/payables/${bill.id}/pay`, 'POST', { date: day(0), method: 'boleto' })).status, 200)
    assert.equal((await request(`/payables/${bill.id}`, 'PUT', { ...exit, treasury: true })).status, 409)
    assert.equal((await request(`/payables/${bill.id}`, 'DELETE')).status, 409)
    assert.equal((await request(`/payables/${out.id}`, 'DELETE')).status, 200)
    assert.equal((await request(`/payables/${out.id}`)).status, 404)

    // Money in: same rules on the receivable side, with or without a registered client.
    const entry = { treasury: true, customerName: 'Sucata Bahia', description: 'Venda de sucata', value: '300', date: day(0), method: 'cash' }
    assert.equal((await request('/receivables', 'POST', { ...entry, date: day(2) })).status, 400)
    assert.equal((await request('/receivables', 'POST', { ...entry, method: 'cheque' })).status, 400)
    const received = await request('/receivables', 'POST', entry)
    assert.equal(received.status, 201, JSON.stringify(received.data))
    const money = received.data.item
    assert.deepEqual([money.treasury, money.origin, money.kind, money.status, money.issueDate, money.dueDate, money.receipt.finalCents, money.receipt.method], [true, 'manual', 'single', 'received', day(0), day(0), 30000, 'cash'])
    assert.equal((await request('/receivables', 'POST', entry)).status, 201, 'equal sales on the same day are accepted')
    assert.equal((await request(`/receivables/${money.id}/receive`, 'POST', { date: day(0), method: 'pix' })).status, 409)
    const changed = await request(`/receivables/${money.id}`, 'PUT', { ...entry, value: '320', date: day(-3), method: 'pix' })
    assert.equal(changed.status, 200, JSON.stringify(changed.data))
    assert.deepEqual([changed.data.item.valueCents, changed.data.item.dueDate, changed.data.item.receipt.date, changed.data.item.receipt.method, changed.data.item.status], [32000, day(-3), day(-3), 'pix', 'received'])
    assert.equal((await upload(`/receivables/${money.id}/files`)).status, 201)
    detail = (await request(`/receivables/${money.id}`)).data
    assert.equal(detail.canDelete, true); assert.equal(detail.item.attachments.length, 1)
    assert.ok(detail.history.some((row) => row.type === 'received' && row.details.treasury))
    // Reversing it turns it into an ordinary open account.
    assert.equal((await request(`/receivables/${money.id}/reverse`, 'POST', { reason: 'Recebimento lançado antes da hora' })).status, 200)
    assert.equal((await request(`/receivables/${money.id}`, 'PUT', { ...entry, treasury: true })).status, 400, 'no longer a settled entry: the ordinary form applies')
    assert.equal((await request(`/receivables/${money.id}`, 'DELETE')).status, 200)

    const lists = [(await request('/payables')).data.items, (await request('/receivables')).data.items]
    const book = treasuryMovements(...lists)
    assert.deepEqual(book.map((row) => [row.type, row.origin, row.cents]).sort(), [['in', 'Tesouraria', 30000], ['out', 'Contas a Pagar', 8000], ['out', 'Tesouraria', 20000]])
  } finally { await f.close() }
})

test('a finished OS can be received on the spot: the entry goes to Tesouraria linked to the OS', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const request = (route, method, body) => f.request(route, method, body, { Authorization: `Bearer ${token}` })
    const offer = (await f.adminRequest('/offers', 'POST', offerDraft)).data.item
    await f.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cutting'], kind: 'service' })
    await f.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 1000 } })
    const order = (await f.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
    // R$ 1.020,00 received for an OS of R$ 1.000,00: the R$ 20,00 beyond it is interest.
    const body = { orderCode: order.code, treasury: true, value: '1000', received: '1020', date: day(-1), method: 'pix' }
    assert.equal((await request('/receivables', 'POST', body)).status, 409, 'the OS must be finished')
    await f.mutateStore((store) => { store.orders.find((item) => item.code === order.code).operation = { status: 'completed', stages: [], stageCounts: {}, activeSessions: [] } })
    const posted = await request('/receivables', 'POST', body)
    assert.equal(posted.status, 201, JSON.stringify(posted.data))
    const row = posted.data.item
    assert.deepEqual([row.origin, row.orderCode, row.treasury, row.status, row.customerName, row.issueDate, row.dueDate, row.receipt.date, row.valueCents, row.receipt.interestCents, row.receipt.discountCents, row.receipt.finalCents], ['order', order.code, true, 'received', offerDraft.company, day(-1), day(-1), day(-1), 100000, 2000, 0, 102000])
    assert.equal((await request('/receivables', 'POST', { orderCode: order.code, value: '1000', dueDate: shiftMonth(todayBahia(), 1) })).status, 409, 'one receivable per OS')
    const info = (await request(`/receivables/order/${order.code}`)).data
    assert.equal(info.item.id, row.id); assert.equal(info.item.receipt.finalCents, 102000)
    // The payer of an OS stays the one of the OS when the entry is corrected.
    const edited = await request(`/receivables/${row.id}`, 'PUT', { treasury: true, customerName: 'Outro', value: '900', date: day(0), method: 'cash' })
    assert.equal(edited.status, 200, JSON.stringify(edited.data))
    assert.deepEqual([edited.data.item.customerName, edited.data.item.valueCents, edited.data.item.receipt.method], [offerDraft.company, 90000, 'cash'])
    // Received less: the difference is a discount; the same amount: neither. The value of the OS is kept.
    const settle = async (received) => (await request(`/receivables/${row.id}`, 'PUT', { treasury: true, value: '1000', ...(received === undefined ? {} : { received }), date: day(0), method: 'pix' })).data.item
    const less = await settle('950')
    assert.deepEqual([less.valueCents, less.receipt.interestCents, less.receipt.discountCents, less.receipt.finalCents], [100000, 0, 5000, 95000])
    const exact = await settle('1000')
    assert.deepEqual([exact.receipt.interestCents, exact.receipt.discountCents, exact.receipt.finalCents], [0, 0, 100000])
    const more = await settle('1.020,50'.replace(/\./g, '').replace(',', '.'))
    assert.deepEqual([more.receipt.interestCents, more.receipt.finalCents], [2050, 102050])
    const without = await settle(undefined)
    assert.deepEqual([without.receipt.interestCents, without.receipt.discountCents, without.receipt.finalCents], [0, 0, 100000], 'without an amount received, the value of the OS is what was received')
    for (const invalid of ['0', '-5', 'abc', '1e3']) assert.equal((await request(`/receivables/${row.id}`, 'PUT', { treasury: true, value: '1000', received: invalid, date: day(0), method: 'pix' })).status, 400, `received ${invalid}`)
    // The movement of the cash book is the amount received, and a document is sent to Tesouraria with it.
    assert.equal((await request('/receivables')).data.items.find((item) => item.id === row.id).receipt.finalCents, 100000)
  } finally { await f.close() }
})
