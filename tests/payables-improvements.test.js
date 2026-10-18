import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { filterPayables, dueLabel, todayBahia } from '../server/payableRules.js'

test('search finds accounts by value as typed in Brazil and by supplier CPF/CNPJ; due labels use the right plural', () => {
  const rows = [{ id: 'PAG-000001', supplierName: 'Fornecedor A', supplierDocument: '12345678000190', description: 'Chapas', documentNumber: 'NF1', valueCents: 123456, dueDate: '2026-10-10' }, { id: 'PAG-000002', supplierName: 'Fornecedor B', supplierDocument: '98765432000110', description: 'Frete', documentNumber: 'NF2', valueCents: 5000, dueDate: '2026-10-10' }]
  const found = (search) => filterPayables(rows, { search, status: 'all' }, '2026-10-01').map((row) => row.id)
  for (const value of ['1.234,56', '1234,56', '1234.56', 'R$ 1.234,56']) assert.deepEqual(found(value), ['PAG-000001'], value)
  assert.deepEqual(found('12.345.678/0001-90'), ['PAG-000001'])
  assert.deepEqual(found('98765432'), ['PAG-000002'])
  assert.deepEqual(found('50,00'), ['PAG-000002'])
  assert.deepEqual(found('7.777,77'), [])
  assert.deepEqual([-2, -1, 0, 1, 2].map(dueLabel), ['Vencida há 2 dias', 'Vencida há 1 dia', 'Vence hoje', 'Vence em 1 dia', 'Vence em 2 dias'])
})

test('recurring accounts can be generated ahead, OS links are validated and the OS real cost and margin add up', async () => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const request = (route, method, body) => f.request(route, method, body, { Authorization: `Bearer ${token}` })
    await f.mutateStore((store) => { store.orders = [{ code: 'OS-2026-0001', service: 'Eixo usinado', company: 'Cliente', proposal: { serviceValue: 1000, discount: 10, materials: 300, labor: 200, margin: 25 }, operation: { status: 'completed' } }] })
    const supplier = (await request('/suppliers', 'POST', { name: 'Aluguel Galpao', document: '12345678000190' })).data.item
    const category = (await request('/classifications', 'POST', { name: 'Aluguel' })).data.item
    const base = { supplierId: supplier.id, classificationId: category.id, issueDate: todayBahia(), value: '1500.00', dueDate: '2026-01-31', kind: 'recurring', recurrence: 'monthly' }
    assert.equal((await request('/payables', 'POST', { ...base, ahead: 25 })).status, 400)
    const series = await request('/payables', 'POST', { ...base, ahead: 11 })
    assert.equal(series.status, 201)
    const rows = series.data.items
    assert.equal(rows.length, 12)
    assert.deepEqual(rows.slice(0, 3).map((row) => row.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31'], 'Month ends are clamped without drifting')
    assert.equal(rows.at(-1).dueDate, '2026-12-31')
    assert.equal(new Set(rows.map((row) => row.seriesId)).size, 1)
    assert.deepEqual([rows[0].seriesIndex, rows[0].seriesCount, rows[11].seriesIndex], [1, 12, 12])
    const yearly = (await request('/payables', 'POST', { ...base, value: '900', recurrence: 'yearly', ahead: 1 })).data.items
    assert.deepEqual(yearly.map((row) => row.dueDate), ['2026-01-31', '2027-01-31'])
    assert.equal((await request('/payables', 'POST', { ...base, kind: 'normal', value: '10', dueDate: '2026-05-05', orderCode: 'OS-0000' })).status, 400)
    const steel = (await request('/payables', 'POST', { ...base, kind: 'normal', value: '400', dueDate: '2026-05-05', orderCode: 'OS-2026-0001', description: 'Aco' })).data.items[0]
    const freight = (await request('/payables', 'POST', { ...base, kind: 'normal', value: '120.50', dueDate: '2026-05-06', orderCode: 'OS-2026-0001', description: 'Frete' })).data.items[0]
    await request(`/payables/${steel.id}/pay`, 'POST', { date: todayBahia(), method: 'pix', interest: '10' })
    const costs = (await request('/payables/order-costs/OS-2026-0001')).data.item
    // The cost planned in the proposal is already posted; the linked accounts are what came up beyond it.
    assert.deepEqual([costs.valueCents, costs.estimatedCostCents, costs.extraCostCents, costs.costCents, costs.paidCostCents, costs.pendingCostCents, costs.marginCents, costs.marginPercent, costs.expectedMarginPercent], [90000, 50000, 53050, 103050, 41000, 12050, -13050, -14.5, 25])
    assert.deepEqual(costs.payables.map((row) => row.id).sort(), [steel.id, freight.id].sort())
    const list = (await request('/payables/order-costs')).data.items
    assert.equal(list.find((row) => row.code === 'OS-2026-0001').payableCount, 2)
    assert.equal((await request('/payables')).data.orders[0].code, 'OS-2026-0001')
    assert.equal((await request('/payables')).data.items.find((row) => row.id === steel.id).supplierDocument, '12345678000190')
    assert.equal((await request('/payables/order-costs/OS-9999')).status, 404)
  } finally { await f.close() }
})
