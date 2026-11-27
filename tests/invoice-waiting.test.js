import test from 'node:test'
import assert from 'node:assert/strict'
import { awaitingInvoice, byLongestWait, invoiceWait } from '../src/invoiceWaiting.js'

// "Aguardando NF-e" (2026-11-27): how long an OS has been waiting since its production was completed (days in Bahia),
// yellow from 5 days and red from 10, the one waiting longest first.
const order = (code, completedAt, status = 'completed') => ({ code, operation: { status, completedAt } })

test('the waiting counts whole days in Bahia, with the colors of 5 and 10 days', () => {
  const today = '2026-11-27'
  assert.deepEqual(invoiceWait(order('A', '2026-11-27T10:00:00Z'), today), { days: 0, label: 'hoje', tone: 'ok' })
  assert.deepEqual(invoiceWait(order('A', '2026-11-26T12:00:00Z'), today), { days: 1, label: 'há 1 dia', tone: 'ok' })
  // 23:50 of 26/11 in Bahia is already 27/11 in UTC: one day, not "hoje".
  assert.equal(invoiceWait(order('A', '2026-11-27T02:50:00Z'), today).days, 1)
  assert.deepEqual([invoiceWait(order('A', '2026-11-23T12:00:00Z'), today).tone, invoiceWait(order('A', '2026-11-22T12:00:00Z'), today).tone], ['ok', 'warn'])
  assert.deepEqual([invoiceWait(order('A', '2026-11-18T12:00:00Z'), today).tone, invoiceWait(order('A', '2026-11-17T12:00:00Z'), today)], ['warn', { days: 10, label: 'há 10 dias', tone: 'late' }])
  assert.equal(invoiceWait(order('A', ''), today), null)
})

test('the block takes the completed OS, the one waiting longest first', () => {
  assert.equal(awaitingInvoice(order('A', '2026-11-27T10:00:00Z')), true)
  assert.equal(awaitingInvoice(order('A', '', 'finalizing')), false)
  const rows = [order('OS-2026-0003', '2026-11-26T12:00:00Z'), order('OS-2026-0001', ''), order('OS-2026-0002', '2026-11-20T12:00:00Z'), order('OS-2026-0004', '2026-11-26T12:00:00Z')]
  assert.deepEqual(byLongestWait(rows).map((row) => row.code), ['OS-2026-0002', 'OS-2026-0003', 'OS-2026-0004', 'OS-2026-0001'])
})
