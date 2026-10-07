import assert from 'node:assert/strict'
import test from 'node:test'
import { servicePanelOrders } from '../src/servicePanels.js'

test('completed services move only after acknowledgement and reopened OS returns to the active panel', () => {
  const orders = [
    { code: 'waiting', operation: { status: 'waiting' } },
    { code: 'pending-confirmation', operation: { status: 'completed', completedAt: '2026-10-04T14:00:00Z' } },
    { code: 'archived', operation: { status: 'completed', completedAt: '2026-10-04T13:00:00Z', completionAcknowledgedAt: '2026-10-04T15:00:00Z' } },
    { code: 'reopened', operation: { status: 'paused', completionAcknowledgedAt: '2026-10-04T15:00:00Z' } },
  ]
  assert.deepEqual(servicePanelOrders(orders).map((row) => row.code), ['waiting', 'pending-confirmation', 'reopened'])
  assert.deepEqual(servicePanelOrders(orders, true).map((row) => row.code), ['archived'])
  orders[1].operation.completionAcknowledgedAt = '2026-10-04T15:30:00Z'
  assert.deepEqual(servicePanelOrders(orders, true).map((row) => row.code), ['pending-confirmation', 'archived'])
})

test('archive sorts by actual completion, handles legacy dates and does not mutate original data', () => {
  const orders = [
    { code: 'OS-0001', operation: { status: 'completed', completedAt: '2026-10-01T13:00:00Z', completionAcknowledgedAt: '2026-10-04T13:00:00Z' } },
    { code: 'OS-0002', operation: { status: 'completed', completedAt: '2026-10-02T13:00:00Z', completionAcknowledgedAt: '2026-10-03T13:00:00Z' } },
    { code: 'OS-0003', operation: { status: 'completed', completedAt: 'invalid', completionAcknowledgedAt: '2026-10-03T13:00:00Z' } },
  ]
  const before = structuredClone(orders)
  assert.deepEqual(servicePanelOrders(orders, true).map((row) => row.code), ['OS-0003', 'OS-0002', 'OS-0001'])
  assert.deepEqual(orders, before)
  assert.deepEqual(servicePanelOrders([], true), [])
})
