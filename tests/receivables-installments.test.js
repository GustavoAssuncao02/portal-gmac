import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const day = (offset) => new Date(Date.parse(todayBahia()) + offset * 86400000).toISOString().slice(0, 10)

test('expected dates cannot precede the issue date; one document can be received in installments that add up exactly', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const request = (route, method, body) => f.request(route, method, body, { Authorization: `Bearer ${token}` })
    const base = { customerName: 'Nestlé Nordeste Alimentos e Bebidas Ltda', customerDocument: '08334818000152', description: 'Acordo de manutenção', documentNumber: 'NF 1001' }
    const beforeIssue = await request('/receivables', 'POST', { ...base, value: '100', issueDate: day(-1), dueDate: day(-2) })
    assert.equal(beforeIssue.status, 400); assert.match(beforeIssue.data.message, /não pode ser anterior à data de emissão/)
    assert.equal((await request('/receivables', 'POST', { ...base, value: '75', issueDate: day(-2), dueDate: day(-1) })).status, 201, 'A past date after the issue date is valid')
    assert.equal((await request('/receivables', 'POST', { ...base, value: '100', dueDate: todayBahia() })).status, 201, 'Same day as the issue is allowed')

    const first = shiftMonth(todayBahia(), 1)
    assert.equal((await request('/receivables', 'POST', { ...base, value: '10000', dueDate: first, kind: 'installment', count: 1 })).status, 400)
    assert.equal((await request('/receivables', 'POST', { ...base, value: '10000', dueDate: first, kind: 'installment', count: 3, installments: [{ value: '5000', dueDate: first }, { value: '3000', dueDate: shiftMonth(first, 1) }, { value: '1000', dueDate: shiftMonth(first, 2) }] })).status, 400, 'Installments must add up to the total')
    assert.equal((await request('/receivables', 'POST', { ...base, value: '10000', dueDate: first, kind: 'installment', count: 2, installments: [{ value: '5000', dueDate: first }, { value: '5000', dueDate: day(-3) }] })).status, 400, 'No installment before the issue date')
    const created = await request('/receivables', 'POST', { ...base, value: '10000', dueDate: first, kind: 'installment', count: 3 })
    assert.equal(created.status, 201)
    const parts = created.data.items
    assert.deepEqual(parts.map((row) => [row.installmentNumber, row.installmentCount, row.valueCents, row.dueDate]), [[1, 3, 333334, first], [2, 3, 333333, shiftMonth(first, 1)], [3, 3, 333333, shiftMonth(first, 2)]])
    assert.equal(new Set(parts.map((row) => row.groupId)).size, 1)
    assert.ok(parts.every((row) => row.originalTotalCents === 1000000 && row.kind === 'installment'))
    let detail = (await request(`/receivables/${parts[1].id}`)).data
    assert.deepEqual([detail.siblings.length, detail.structureLocked, detail.canDelete], [3, false, true])

    // Restructuring while nothing was received keeps the existing ids and adds what is missing.
    const four = await request(`/receivables/${parts[1].id}`, 'PUT', { ...base, value: '10000', dueDate: first, kind: 'installment', count: 4 })
    assert.equal(four.status, 200)
    assert.deepEqual(four.data.items.map((row) => row.valueCents), [250000, 250000, 250000, 250000])
    assert.deepEqual(four.data.items.slice(0, 3).map((row) => row.id), parts.map((row) => row.id))
    assert.equal(four.data.item.id, parts[1].id)

    // Once an installment is received, values and dates are locked and the agreement cannot be deleted.
    assert.equal((await request(`/receivables/${parts[0].id}/receive`, 'POST', { date: todayBahia(), method: 'pix' })).status, 200)
    detail = (await request(`/receivables/${parts[1].id}`)).data
    assert.deepEqual([detail.structureLocked, detail.canDelete], [true, false])
    const locked = await request(`/receivables/${parts[1].id}`, 'PUT', { ...base, description: 'Descrição corrigida', value: '1', dueDate: first, kind: 'single' })
    assert.equal(locked.status, 200)
    assert.deepEqual([locked.data.item.description, locked.data.item.valueCents, locked.data.item.installmentCount], ['Descrição corrigida', 250000, 4])
    assert.equal((await request(`/receivables/${parts[1].id}`, 'DELETE')).status, 409)

    // An agreement without receipts is deleted as a whole.
    const other = (await request('/receivables', 'POST', { ...base, value: '900', dueDate: first, kind: 'installment', count: 2, documentNumber: 'NF 2002' })).data.items
    assert.equal((await request(`/receivables/${other[1].id}`, 'DELETE')).status, 200)
    const ids = (await request('/receivables')).data.items.map((row) => row.id)
    assert.ok(!ids.includes(other[0].id) && !ids.includes(other[1].id))

    // An OS can be scheduled in installments, and only once.
    await f.mutateStore((store) => { store.orders = [{ code: 'OS-2026-0009', company: 'Borrachas Vipal Nordeste S.A.', cnpj: '07.857.217/0001-61', service: 'Eixo', proposal: { serviceValue: 3000 }, operation: { status: 'completed' } }] })
    const order = await request('/receivables', 'POST', { orderCode: 'OS-2026-0009', value: '3000', dueDate: first, kind: 'installment', count: 3 })
    assert.equal(order.status, 201)
    assert.ok(order.data.items.every((row) => row.orderCode === 'OS-2026-0009' && row.valueCents === 100000))
    assert.equal((await request('/receivables/order/OS-2026-0009')).data.items.length, 3)
    assert.equal((await request('/receivables', 'POST', { orderCode: 'OS-2026-0009', value: '3000', dueDate: first })).status, 409)

    // Editing follows the issue date informed in the edit.
    const single = (await request('/receivables')).data.items.find((row) => row.documentNumber === 'NF 1001' && !row.groupId && row.valueCents === 10000)
    assert.equal((await request(`/receivables/${single.id}`, 'PUT', { ...base, value: '100', issueDate: day(-5), dueDate: day(-5) })).status, 200)
    assert.equal((await request(`/receivables/${single.id}`, 'PUT', { ...base, value: '100', issueDate: day(-5), dueDate: day(-6) })).status, 400)
  } finally { await f.close() }
})
