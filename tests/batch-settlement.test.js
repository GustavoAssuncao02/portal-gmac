import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'
import { balanceYears, batchByClassification, openBalanceByPeriod } from '../src/batchSettlement.js'

test('chart helpers group the batch by classification and project the open balance after paying it', () => {
  const rows = [{ id: 'A', classificationName: 'Energia', valueCents: 1000 }, { id: 'B', classificationName: 'Energia', valueCents: 500 }, { id: 'C', classificationName: 'Água', valueCents: 700 }]
  assert.deepEqual(batchByClassification(rows), [{ name: 'Energia', value: 1500 }, { name: 'Água', value: 700 }])
  const open = [{ id: 'A', dueDate: '2026-10-05', valueCents: 1000 }, { id: 'B', dueDate: '2026-10-20', valueCents: 500 }, { id: 'C', dueDate: '2026-11-01', valueCents: 700 }, { id: 'D', dueDate: '2031-03-10', valueCents: 900 }]
  assert.deepEqual(balanceYears(open, '2026-11-12'), [2026, 2031])
  const pick = (periods) => periods.map(({ label, now, after }) => [label, now, after])

  // Without months chosen: the twelve months of the year, empty months at zero; later years stay out.
  const year = openBalanceByPeriod(open, ['A', 'C'], { year: 2026 })
  assert.equal(year.length, 12)
  assert.deepEqual(pick(year).slice(8), [['set/26', 0, 0], ['out/26', 1500, 500], ['nov/26', 700, 0], ['dez/26', 0, 0]])

  // One or two months: their weeks, Monday to Sunday, cut at the month's edges (01/10/2026 is a Thursday).
  assert.deepEqual(pick(openBalanceByPeriod(open, ['A', 'C'], { year: 2026, months: [10] })), [['01–04/10', 0, 0], ['05–11/10', 1000, 0], ['12–18/10', 0, 0], ['19–25/10', 500, 500], ['26–31/10', 0, 0]])
  const two = openBalanceByPeriod(open, ['A', 'C'], { year: 2026, months: [11, 10] })
  assert.deepEqual([two.length, two[5].label, two[5].now, two.at(-1).label], [11, '01/11', 700, '30/11'], '01/11/2026 is a Sunday and 30/11 a Monday: weeks of one day')

  // Three months or more: only those months.
  assert.deepEqual(pick(openBalanceByPeriod(open, [], { year: 2026, months: [12, 10, 11] })), [['out/26', 1500, 1500], ['nov/26', 700, 700], ['dez/26', 0, 0]])
})

test('the batch list is shared between administrators and settles every account once', async () => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    assert.equal((await f.request('/payables/batch')).status, 401)
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const request = (route, method, body) => f.request(route, method, body, { Authorization: `Bearer ${token}` })
    const supplier = (await request('/suppliers', 'POST', { name: 'Fornecedor', document: '12345678000190' })).data.item
    const category = (await request('/classifications', 'POST', { name: 'Energia' })).data.item
    const base = { supplierId: supplier.id, classificationId: category.id, description: 'Compra', issueDate: todayBahia(), dueDate: '2027-01-31', kind: 'normal' }
    const [one, two] = [(await request('/payables', 'POST', { ...base, value: '100' })).data.items[0], (await request('/payables', 'POST', { ...base, value: '50' })).data.items[0]]

    assert.deepEqual((await request('/payables/batch')).data.ids, [])
    assert.equal((await request('/payables/batch/items', 'POST', { ids: ['PAG-999999'] })).status, 409)
    assert.deepEqual((await request('/payables/batch/items', 'POST', { ids: [one.id, two.id, one.id] })).data.ids, [one.id, two.id])
    assert.deepEqual((await request('/payables/batch')).data.ids, [one.id, two.id])
    assert.deepEqual((await request(`/payables/batch/items/${one.id}`, 'DELETE')).data.ids, [two.id])

    assert.equal((await request('/payables/batch/settle', 'POST', { date: '2099-01-01', method: 'pix' })).status, 400)
    await request('/payables/batch/items', 'POST', { ids: [one.id] })
    const settled = await request('/payables/batch/settle', 'POST', { date: todayBahia(), method: 'pix' })
    assert.equal(settled.status, 200); assert.equal(settled.data.items.length, 2)
    assert.equal((await request(`/payables/${one.id}`)).data.item.payment.finalCents, 10000)
    assert.deepEqual((await request('/payables/batch')).data.ids, [])
    assert.equal((await request('/payables/batch/settle', 'POST', { date: todayBahia(), method: 'pix' })).status, 409)
    assert.equal((await request('/payables/batch/items', 'POST', { ids: [one.id] })).status, 409)
  } finally { await f.close() }
})
