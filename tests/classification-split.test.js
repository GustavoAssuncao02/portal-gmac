import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia, filterPayables, scaleSplit } from '../server/payableRules.js'
import { payableAnalytics } from '../src/payableAnalytics.js'
import { batchByClassification } from '../src/batchSettlement.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }

test('scaled parts keep the proportion and add up exactly', () => {
  const split = [{ classificationId: 'a', valueCents: 6667 }, { classificationId: 'b', valueCents: 3333 }]
  assert.deepEqual(scaleSplit(split, 3333).map((part) => part.valueCents), [2222, 1111])
  assert.equal(scaleSplit(split, 3334).reduce((sum, part) => sum + part.valueCents, 0), 3334)
  assert.equal(scaleSplit(null, 100), null)
})

test('one bill divided among classifications: a single account, the parts add up to its value', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const request = (route, method, body) => f.request(route, method, body, { Authorization: `Bearer ${token}` })
    const supplier = (await request('/suppliers', 'POST', { name: 'Posto e Energia', document: '12345678000190' })).data.item
    const energy = (await request('/classifications', 'POST', { name: 'Energia elétrica' })).data.item
    const fuel = (await request('/classifications', 'POST', { name: 'Combustível' })).data.item
    const base = { supplierId: supplier.id, description: 'Boleto', issueDate: todayBahia(), dueDate: '2027-01-10', kind: 'normal', value: '100.00' }
    const split = (a, b) => [{ classificationId: energy.id, value: a }, { classificationId: fuel.id, value: b }]

    assert.equal((await request('/payables', 'POST', { ...base, classificationSplit: split('50.00', '40.00') })).status, 400, 'the parts must add up to the value')
    assert.equal((await request('/payables', 'POST', { ...base, classificationSplit: [{ classificationId: energy.id, value: '50.00' }, { classificationId: energy.id, value: '50.00' }] })).status, 400, 'each classification once')
    const created = (await request('/payables', 'POST', { ...base, classificationSplit: split('50.00', '50.00') })).data.items
    assert.equal(created.length, 1, 'still a single account')
    const bill = created[0]
    assert.equal(bill.valueCents, 10000)
    assert.deepEqual(bill.classificationSplit.map((part) => [part.classificationName, part.valueCents]), [['Energia elétrica', 5000], ['Combustível', 5000]])
    assert.equal(bill.classificationName, 'Energia elétrica + Combustível')

    // Installments keep the division in proportion to each installment.
    const parts = (await request('/payables', 'POST', { ...base, supplierId: supplier.id, dueDate: '2027-02-10', kind: 'installment', count: 3, value: '300.00', classificationSplit: split('200.00', '100.00') })).data.items
    assert.deepEqual(parts.map((row) => row.classificationSplit.map((part) => part.valueCents)), [[6667, 3333], [6667, 3333], [6666, 3334]], 'the last installment takes the rounding')
    assert.deepEqual([0, 1].map((index) => parts.reduce((sum, row) => sum + row.classificationSplit[index].valueCents, 0)), [20000, 10000], 'each classification adds up to its part')
    assert.deepEqual(parts.map((row) => row.classificationSplit.reduce((sum, part) => sum + part.valueCents, 0)), parts.map((row) => row.valueCents))

    // Tesouraria uses the same form: an exit already paid, divided too.
    const exit = (await request('/payables', 'POST', { treasury: true, supplierId: supplier.id, description: 'Saída dividida', value: '80.00', date: todayBahia(), method: 'pix', classificationSplit: split('30.00', '50.00') })).data.items[0]
    assert.deepEqual(exit.classificationSplit.map((part) => part.valueCents), [3000, 5000])

    // Editing back to a single classification removes the division.
    const edited = (await request(`/payables/${bill.id}`, 'PUT', { ...base, classificationId: fuel.id, classificationSplit: null })).data.items[0]
    assert.deepEqual([edited.classificationSplit, edited.classificationName], [null, 'Combustível'])
    await request(`/payables/${bill.id}`, 'PUT', { ...base, classificationSplit: split('70.00', '30.00') })

    const items = (await request('/payables')).data.items
    assert.ok(filterPayables(items, { classificationId: fuel.id, status: 'all' }).some((row) => row.id === bill.id), 'the account appears under each of its classifications')
    const analytics = payableAnalytics(items.filter((row) => row.id === bill.id), { start: '2000-01-01', end: '2100-01-01' })
    assert.deepEqual(analytics.classifications.map((row) => [row.name, row.value]), [['Energia elétrica', 7000], ['Combustível', 3000]], 'Business Intelligence counts each part for its classification')
    assert.deepEqual(batchByClassification(items.filter((row) => row.id === bill.id)).map((row) => [row.name, row.value]), [['Energia elétrica', 7000], ['Combustível', 3000]])
    assert.equal((await request(`/classifications/${fuel.id}`, 'DELETE')).status, 409, 'a classification used in a division stays')
    assert.equal((await request('/classifications')).data.items.find((row) => row.id === fuel.id).count, 5)
  } finally { await f.close() }
})
