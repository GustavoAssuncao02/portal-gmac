import test from 'node:test'
import assert from 'node:assert/strict'
import { lastDayOf, monthDays, monthTitle, shiftMonth, shortMonth, sundayOf, weekOf, weekTitle } from '../src/calendarDays.js'
import { amountsText, byDeliveryDay, deliveryTotals, kindsText, openDeliveries } from '../src/deliveryCalendar.js'
import { occurrencesBetween } from '../server/noteRules.js'

// The calendars of 2026-11-24 (Planejamento › Entregas, Tarefas › Calendário): weeks from Sunday, the open OS on their
// delivery day, and the next days of a repeated task.
test('calendar days: weeks from Sunday, whole weeks around the month', () => {
  assert.equal(sundayOf('2026-11-24'), '2026-11-22')
  assert.equal(sundayOf('2026-11-22'), '2026-11-22', 'a Sunday is its own week')
  assert.deepEqual(weekOf('2026-11-24'), ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'])
  const november = monthDays('2026-11')
  assert.deepEqual([november[0], november.at(-1), november.length], ['2026-11-01', '2026-12-05', 35])
  const february = monthDays('2026-02')
  assert.deepEqual([february[0], february.at(-1), february.length], ['2026-02-01', '2026-02-28', 28], 'four whole weeks')
  const may = monthDays('2026-05')
  assert.deepEqual([may[0], may.at(-1), may.length], ['2026-04-26', '2026-06-06', 42], 'six weeks')
  assert.deepEqual([shiftMonth('2026-12', 1), shiftMonth('2026-01', -1), shiftMonth('2026-11', 14)], ['2027-01', '2025-12', '2028-01'])
  assert.deepEqual([lastDayOf('2028-02'), lastDayOf('2026-02'), lastDayOf('2026-12')], ['2028-02-29', '2026-02-28', '2026-12-31'])
  assert.deepEqual([monthTitle('2026-11'), shortMonth('2026-12'), weekTitle('2026-11-24')], ['novembro de 2026', 'dez 2026', '22/11 a 28/11'])
})

test('deliveries: open OS on the agreed day, totals by kind and by measure', () => {
  const now = Date.parse('2026-11-24T15:00:00-03:00')
  const created = '2026-11-01T10:00:00Z'
  const rows = openDeliveries([
    { code: 'OS-2026-0002', service: 'Eixo', company: 'ACME', quantity: 10, deadline: '2026-11-30', createdAt: created, operation: { status: 'running', stages: [{ key: 'a' }, { key: 'b' }], stageCounts: { a: 5, b: 3 } } },
    { code: 'OS-2026-0001', quantity: 4, quantityUnit: 'par', proposal: { deadline: '2026-11-20' }, resources: { kind: 'product', urgency: 'emergency' }, deadline: '2026-12-30', createdAt: created },
    { code: 'OS-2026-0003', quantity: 6, operation: { status: 'completed' }, deadline: '2026-11-25', createdAt: created },
    { code: 'OS-2026-0004', quantity: 1200, deadline: '', createdAt: created },
    { code: 'OS-2026-0005', quantity: 2, quantityUnit: 'cj', deadline: '2026-11-30', createdAt: created, resources: { urgency: 'emergency' } },
  ], now)
  assert.deepEqual(rows.map((row) => [row.code, row.day, row.kind, row.unit, row.due.key]), [
    ['OS-2026-0001', '2026-11-20', 'product', 'par', 'late'],
    ['OS-2026-0005', '2026-11-30', 'service', 'cj', 'soon'],
    ['OS-2026-0002', '2026-11-30', 'service', 'un', 'soon'],
    ['OS-2026-0004', null, 'service', 'un', 'unknown'],
  ], 'the proposal date wins over the requested one; a concluded OS is out; on the same day the emergency comes first')
  assert.equal(rows.find((row) => row.code === 'OS-2026-0002').done, 3, 'pieces ready: the ones through every stage')
  const totals = deliveryTotals(rows)
  assert.deepEqual([totals.count, totals.services, totals.products, totals.amounts], [4, 3, 1, { par: 4, cj: 2, un: 1210 }])
  assert.equal(amountsText(totals.amounts), '1.210 unidades · 4 pares · 2 conjuntos')
  assert.equal(amountsText(totals.amounts, { short: true }), '1.210 un · 4 pares · 2 cj')
  assert.equal(amountsText({ un: 1, par: 1 }), '1 unidade · 1 par')
  assert.equal(kindsText(totals), '3 serviços · 1 produto')
  assert.equal(kindsText(deliveryTotals(rows.slice(0, 1))), '1 produto')
  assert.deepEqual([...byDeliveryDay(rows)].map(([day, list]) => [day, list.map((row) => row.code)]), [['2026-11-20', ['OS-2026-0001']], ['2026-11-30', ['OS-2026-0005', 'OS-2026-0002']]], 'without a date, not on the calendar')
})

test('repeated task: its next days inside the calendar, after its current day', () => {
  assert.deepEqual(occurrencesBetween({ dueDate: '2026-11-24', repeat: 'weekly' }, '2026-11-01', '2026-12-05'), ['2026-12-01'])
  assert.deepEqual(occurrencesBetween({ dueDate: '2026-11-24', repeat: 'daily' }, '2026-11-29', '2026-12-02'), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02'])
  assert.deepEqual(occurrencesBetween({ dueDate: '2026-11-30', repeat: 'monthly', repeatAnchor: 31 }, '2026-11-01', '2027-03-31'), ['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31'], 'a monthly task keeps its day, or the last one of a shorter month')
  assert.deepEqual(occurrencesBetween({ dueDate: '2026-11-24', repeat: 'none' }, '2026-11-01', '2026-12-31'), [])
  assert.deepEqual(occurrencesBetween({ dueDate: '', repeat: 'daily' }, '2026-11-01', '2026-11-30'), [])
  assert.deepEqual(occurrencesBetween({ dueDate: '2026-11-24', repeat: 'weekly' }, '2026-10-01', '2026-11-24'), [], 'nothing before or on the current day')
})
