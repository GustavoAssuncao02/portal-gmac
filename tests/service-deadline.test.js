import assert from 'node:assert/strict'
import test from 'node:test'
import { serviceDeadline } from '../src/serviceDeadline.js'

const start = Date.parse('2026-10-01T12:00:00-03:00')
const end = Date.parse('2026-10-11T12:00:00-03:00')
const order = { createdAt: new Date(start).toISOString(), deadline: new Date(end).toISOString() }

test('deadline status follows time consumed, including exact boundaries and overdue time', () => {
  for (const [percent, expected] of [[0, 'on-time'], [70, 'on-time'], [70.1, 'soon'], [71, 'soon'], [90, 'soon'], [90.1, 'at-deadline'], [100, 'at-deadline'], [100.1, 'late']]) {
    const state = serviceDeadline(order, start + (end - start) * percent / 100)
    assert.equal(state.key, expected, `${percent}%`)
  }
})

test('remaining time switches from days to hours below 24 hours and shows overdue duration', () => {
  const hours = 3600000
  assert.equal(serviceDeadline(order, end - 48 * hours).remaining, '2 dias')
  assert.equal(serviceDeadline(order, end - 24 * hours).remaining, '1 dia')
  assert.equal(serviceDeadline(order, end - 23.5 * hours).remaining, '23 h 30 min')
  assert.equal(serviceDeadline(order, end - 0.5 * hours).remaining, '30 min')
  assert.equal(serviceDeadline(order, end + 2 * hours).remaining, '2 h de atraso')
  assert.equal(serviceDeadline(order, end + 48 * hours).remaining, '2 dias de atraso')
})

test('date-only deadlines run until the end of the delivery day in Bahia', () => {
  const scheduled = { createdAt: '2026-10-01T12:00:00-03:00', deadline: '2026-10-02' }
  assert.equal(serviceDeadline(scheduled, Date.parse('2026-10-02T23:00:00-03:00')).remaining, '1 h')
  assert.equal(serviceDeadline(scheduled, Date.parse('2026-10-02T23:00:00-03:00')).key, 'at-deadline')
  assert.equal(serviceDeadline(scheduled, Date.parse('2026-10-03T00:00:00-03:00')).key, 'late')
})

test('missing and inconsistent dates do not produce invalid percentages', () => {
  assert.equal(serviceDeadline({ createdAt: order.createdAt }, start).key, 'unknown')
  assert.equal(serviceDeadline({ ...order, deadline: '2026-02-31' }, start).key, 'unknown')
  assert.equal(serviceDeadline({ deadline: order.deadline }, start).percentage, null)
  assert.equal(serviceDeadline({ createdAt: order.deadline, deadline: order.createdAt }, end).key, 'late')
  assert.equal(serviceDeadline({ requestedAt: order.createdAt, deadline: order.deadline }, start).key, 'on-time')
})
