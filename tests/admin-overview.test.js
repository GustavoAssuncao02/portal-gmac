import assert from 'node:assert/strict'
import test from 'node:test'
import { adminFirstName, adminOverview, payableOverview } from '../src/adminOverview.js'
import { filterPayables } from '../server/payableRules.js'

const now = Date.parse('2026-10-03T15:00:00-03:00')
const order = (code, deadline, status = 'waiting', fields = {}) => ({ code, deadline, createdAt: '2026-09-01T12:00:00Z', operation: { status }, ...fields })

test('overview orders open OS by the accepted delivery date, excludes completed OS and leaves missing dates last', () => {
  const orders = [order('OS-2', '2026-10-06'), order('OS-4', 'invalid'), order('OS-3', '2026-10-03', 'running'), order('OS-1', '2026-12-20', 'paused', { proposal: { deadline: '2026-10-02' } }), order('OS-5', '2026-10-01', 'completed'), order('OS-6', '2026-02-30')]
  const snapshot = structuredClone(orders)
  const result = adminOverview(orders, [], [], now)
  assert.deepEqual(result.openOrders.map((item) => item.code), ['OS-1', 'OS-3', 'OS-2', 'OS-4', 'OS-6'])
  assert.equal(result.openOrders[0].deliveryDeadline, '2026-10-02')
  assert.equal(result.late, 1)
  assert.equal(result.running, 1)
  assert.equal(result.openOrders[1].due.key, 'at-deadline')
  assert.equal(result.openOrders[3].due.key, 'unknown')
  assert.deepEqual(orders, snapshot)
})

test('low inventory prioritizes empty and scarce materials without counting healthy stock or mutating input', () => {
  const inventory = [{ id: 1, name: 'No minimo', quantity: 5, minimum: 5 }, { id: 2, name: 'Disponivel', quantity: 100, minimum: 10 }, { id: 3, name: 'Baixo', quantity: 2, minimum: 10 }, { id: 4, name: 'Vazio', quantity: 0, minimum: 10 }, { id: 5, name: 'Sem minimo', quantity: 0, minimum: 0 }]
  const snapshot = structuredClone(inventory)
  const result = adminOverview([], [], inventory, now)
  assert.deepEqual(result.lowStock.map((item) => item.id), [5, 4, 3, 1])
  assert.deepEqual(inventory, snapshot)
})

test('management counts include new material requests without approval and respect manual completion acknowledgement', () => {
  const offers = [{ id: 'offer', code: 'OF-1', status: 'review', resources: { materials: [{ id: 'new', name: 'Novo metal', quantity: 10, purchaseQuantity: 10, stockStatus: 'unknown' }] } }, { id: 'accepted', status: 'review', orderCode: 'OS-1' }, { id: 'proposed', status: 'proposed' }]
  const orders = [order('OS-1', '2026-10-05', 'completed'), order('OS-2', '2026-10-05', 'completed', { operation: { status: 'completed', completionAcknowledgedAt: '2026-10-02' } })]
  const summary = adminOverview(orders, offers, [], now)
  assert.equal(summary.reviewing, 1)
  assert.equal(summary.pendingMaterials, undefined)
  assert.equal(summary.purchaseRequests, 1)
  assert.equal(summary.unacknowledged, 1)
  assert.equal(summary.openOrders.length, 0)
})

test('welcome uses the linked first name and does not invent a name for missing identity', () => {
  assert.equal(adminFirstName(' Gustavo Almeida '), 'Gustavo')
  assert.equal(adminFirstName('Maria Clara'), 'Maria')
  assert.equal(adminFirstName(null), 'Administrador')
  assert.equal(adminFirstName('   '), 'Administrador')
})

test('home payable summaries match shortcut filters, exclude paid/inactive accounts and include seven-day boundaries', () => {
  const rows = [
    { id: 1, dueDate: '2026-10-02', valueCents: 10000 },
    { id: 2, dueDate: '2026-10-03', valueCents: 20000 },
    { id: 3, dueDate: '2026-10-04', valueCents: 30000 },
    { id: 4, dueDate: '2026-10-10', valueCents: 40000 },
    { id: 5, dueDate: '2026-10-11', valueCents: 50000 },
    { id: 6, dueDate: '2026-10-03', valueCents: 60000, payment: { finalCents: 61000 } },
    { id: 7, dueDate: '2026-10-02', valueCents: 70000, inactive: true },
  ]
  const snapshot = structuredClone(rows)
  const summary = payableOverview(rows, now)
  assert.deepEqual(summary.map((item) => [item.key, item.count, item.valueCents]), [['open', 5, 150000], ['overdue', 1, 10000], ['today', 1, 20000], ['upcoming', 2, 70000]])
  for (const item of summary) {
    const selected = filterPayables(rows, item.filters, '2026-10-03')
    assert.equal(selected.length, item.count)
    assert.equal(selected.reduce((sum, row) => sum + row.valueCents, 0), item.valueCents)
  }
  assert.deepEqual(rows, snapshot)
  assert.ok(payableOverview([], now).every((item) => item.count === 0 && item.valueCents === 0))
})

test('home payable dates follow Bahia midnight and seven days may cross months and years', () => {
  const rows = [{ dueDate: '2026-12-31', valueCents: 101 }, { dueDate: '2027-01-01', valueCents: 102 }, { dueDate: '2027-01-07', valueCents: 103 }, { dueDate: '2027-01-08', valueCents: 104 }]
  const lateNight = payableOverview(rows, Date.parse('2027-01-01T02:59:59Z'))
  assert.equal(lateNight.find((item) => item.key === 'today').valueCents, 101)
  assert.deepEqual(lateNight.find((item) => item.key === 'upcoming').filters, { status: 'pending', start: '2027-01-01', end: '2027-01-07' })
  const midnight = payableOverview(rows, Date.parse('2027-01-01T03:00:00Z'))
  assert.equal(midnight.find((item) => item.key === 'today').valueCents, 102)
  assert.equal(midnight.find((item) => item.key === 'overdue').valueCents, 101)
})
