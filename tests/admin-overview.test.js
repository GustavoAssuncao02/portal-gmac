import assert from 'node:assert/strict'
import test from 'node:test'
import { adminFirstName, adminOverview } from '../src/adminOverview.js'

const now = Date.parse('2026-10-03T15:00:00-03:00')
const order = (code, deadline, status = 'waiting', fields = {}) => ({ code, deadline, createdAt: '2026-09-01T12:00:00Z', operation: { status }, ...fields })

test('overview orders open OS by the accepted delivery date, excludes completed OS and leaves missing dates last', () => {
  const orders = [order('OS-2', '2026-10-06'), order('OS-4', 'invalid'), order('OS-3', '2026-10-03', 'running'), order('OS-1', '2026-12-20', 'paused', { proposal: { deadline: '2026-10-02' } }), order('OS-5', '2026-10-01', 'completed'), order('OS-6', '2026-02-30')]
  const snapshot = structuredClone(orders)
  const result = adminOverview(orders, [], [], [], now)
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
  const result = adminOverview([], [], inventory, [], now)
  assert.deepEqual(result.lowStock.map((item) => item.id), [5, 4, 3, 1])
  assert.deepEqual(inventory, snapshot)
})

test('management counts respect material approval and manual completion acknowledgement', () => {
  const offers = [{ id: 'offer', code: 'OF-1', status: 'review', resources: { materials: [{ id: 'new', name: 'Novo metal', quantity: 10, purchaseQuantity: 10, stockStatus: 'unknown' }] } }, { id: 'accepted', status: 'review', orderCode: 'OS-1' }, { id: 'proposed', status: 'proposed' }]
  const orders = [order('OS-1', '2026-10-05', 'completed'), order('OS-2', '2026-10-05', 'completed', { operation: { status: 'completed', completionAcknowledgedAt: '2026-10-02' } })]
  let summary = adminOverview(orders, offers, [], [], now)
  assert.equal(summary.reviewing, 1)
  assert.equal(summary.pendingMaterials, 1)
  assert.equal(summary.purchaseRequests, 0)
  assert.equal(summary.unacknowledged, 1)
  summary = adminOverview(orders, offers, [], [{ id: 'offer-new', status: 'purchase-requested' }], now)
  assert.equal(summary.pendingMaterials, 0)
  assert.equal(summary.purchaseRequests, 1)
  assert.equal(summary.openOrders.length, 0)
})

test('welcome uses the linked first name and does not invent a name for missing identity', () => {
  assert.equal(adminFirstName(' Gustavo Almeida '), 'Gustavo')
  assert.equal(adminFirstName('Maria Clara'), 'Maria')
  assert.equal(adminFirstName(null), 'Administrador')
  assert.equal(adminFirstName('   '), 'Administrador')
})
