import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { receivableForecast } from '../src/receivableForecast.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123' }

test('ISS informed when the receivable is created: net value before the money arrives, split across installments', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const base = { customerName: 'Cliente ISS', issueDate: '2026-10-01', dueDate: '2026-11-10', description: 'Serviço', documentNumber: 'NF 123' }
    const single = (await f.adminRequest('/receivables', 'POST', { ...base, value: '1000.00', iss: '50.00', kind: 'single' })).data.item
    assert.deepEqual([single.valueCents, single.issCents], [100000, 5000])
    assert.equal((await f.adminRequest('/receivables', 'POST', { ...base, customerName: 'Outro', value: '100.00', iss: '100.00' })).status, 400, 'ISS cannot take the whole value')
    const parts = (await f.adminRequest('/receivables', 'POST', { ...base, customerName: 'Parcelado', value: '1000.00', iss: '100.01', kind: 'installment', count: 3 })).data.items
    assert.deepEqual(parts.map((row) => row.issCents), [3334, 3334, 3333], 'in proportion to each installment, the last one takes the rounding')
    assert.equal(parts.reduce((sum, row) => sum + row.issCents, 0), 10001, 'the parts add up to the ISS of the document')
    const received = (await f.adminRequest(`/receivables/${single.id}/receive`, 'POST', { date: '2026-10-05', method: 'pix', iss: '50.00' })).data.item
    assert.equal(received.receipt.finalCents, 95000)
    const bulk = (await f.adminRequest('/receivables/bulk', 'POST', { action: 'receive', ids: [parts[0].id], date: '2026-10-05', method: 'pix' })).data.items[0]
    assert.equal(bulk.receipt.issCents, parts[0].issCents, 'a bulk receipt applies the ISS registered with the account')
  } finally { await f.close() }
})

test('forecast: gross, ISS and net still to receive; six months ahead without the overdue ones', () => {
  const rows = [
    { valueCents: 10000, issCents: 500, dueDate: '2026-10-25', receipt: null },
    { valueCents: 20000, issCents: 0, dueDate: '2026-12-01', receipt: null },
    { valueCents: 5000, issCents: 100, dueDate: '2026-10-01', receipt: null },
    { valueCents: 9000, dueDate: '2026-11-01', receipt: { finalCents: 9000 } },
    { valueCents: 7000, dueDate: '2026-11-01', receipt: null, inactive: true },
    { valueCents: 3000, issCents: 300, dueDate: '2027-05-01', receipt: null },
  ]
  const forecast = receivableForecast(rows, '2026-10-22')
  assert.deepEqual([forecast.gross, forecast.iss, forecast.net, forecast.overdue], [38000, 900, 37100, 5000])
  assert.deepEqual(forecast.months.map((row) => row.month), ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'])
  assert.deepEqual(forecast.months.map((row) => [row.gross, row.net]), [[10000, 9500], [0, 0], [20000, 20000], [0, 0], [0, 0], [0, 0]])
})
