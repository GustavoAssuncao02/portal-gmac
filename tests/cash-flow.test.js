import test from 'node:test'
import assert from 'node:assert/strict'
import { weekStart, cashFlowPeriod, cashFlowBuckets, classificationShares, pieSlices, changeOf } from '../src/cashFlow.js'

const move = (type, date, cents) => ({ id: `${type}${date}${cents}`, type, date, cents })

test('weeks run Monday to Sunday and a month is split into its weeks, cut at its edges', () => {
  assert.equal(weekStart('2026-10-26'), '2026-10-26')
  assert.equal(weekStart('2026-11-01'), '2026-10-26', 'Sunday closes the week')
  const week = cashFlowPeriod('week', '2026-10-29')
  assert.deepEqual([week.start, week.end, week.previous.start, week.previous.end], ['2026-10-26', '2026-11-01', '2026-10-19', '2026-10-25'])
  assert.deepEqual(week.buckets.map((bucket) => bucket.label), ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'])
  const month = cashFlowPeriod('month', '2026-10-15')
  assert.deepEqual(month.buckets.map((bucket) => [bucket.start, bucket.end]), [['2026-10-01', '2026-10-04'], ['2026-10-05', '2026-10-11'], ['2026-10-12', '2026-10-18'], ['2026-10-19', '2026-10-25'], ['2026-10-26', '2026-10-31']])
  assert.deepEqual([month.previous.start, month.previous.end], ['2026-09-01', '2026-09-30'])
  const day = cashFlowPeriod('day', '2026-10-26')
  assert.deepEqual([day.start, day.end, day.previous.start, day.buckets[0].label], ['2026-10-26', '2026-10-26', '2026-10-25', 'Segunda'])
})

test('each day is compared with the day before by its balance; days to come have no change', () => {
  const movements = [move('in', '2026-10-25', 10000), move('in', '2026-10-26', 15000), move('out', '2026-10-26', 3000), move('out', '2026-10-27', 2000), move('in', '2026-10-30', 999)]
  const buckets = cashFlowBuckets(movements, cashFlowPeriod('week', '2026-10-27'), '2026-10-28')
  assert.deepEqual(buckets.slice(0, 3).map((bucket) => [bucket.inCents, bucket.outCents, bucket.balanceCents]), [[15000, 3000, 12000], [0, 2000, -2000], [0, 0, 0]])
  assert.equal(buckets[0].change, 20, 'Monday kept R$ 120 against R$ 100 on Sunday: 20% more')
  assert.equal(buckets[1].change, (-2000 - 12000) / 12000 * 100, 'less money: negative')
  assert.equal(buckets[2].change, 100, 'a negative balance back to zero is an improvement')
  assert.equal(buckets[4].future, true); assert.equal(buckets[4].change, null)
  assert.equal(changeOf(500, 0), null, 'nothing to compare with')
})

test('classification shares follow what was actually paid, spread over the parts of a divided account', () => {
  const classifications = [{ id: 'raw', code: '1.01', name: 'Matéria-prima' }, { id: 'power', code: '1.23', name: 'Energia da produção' }, { id: 'sale', code: '7.01', name: 'Receita de Serviços à Vista' }]
  const payables = [
    { id: 'P1', classificationId: 'raw', valueCents: 10000, payment: { date: '2026-10-26', finalCents: 10500, bankId: 'b1' } },
    { id: 'P2', classificationId: 'raw', valueCents: 20000, classificationSplit: [{ classificationId: 'raw', valueCents: 15000 }, { classificationId: 'power', valueCents: 5000 }], payment: { date: '2026-10-27', finalCents: 20000, bankId: 'b2' } },
    { id: 'P3', classificationId: 'gone', valueCents: 700, payment: { date: '2026-10-27', finalCents: 700 } },
    { id: 'P4', classificationId: 'raw', valueCents: 9999, payment: null },
    { id: 'P5', classificationId: 'raw', valueCents: 9999, payment: { date: '2026-09-30', finalCents: 9999 } },
  ]
  const receivables = [{ id: 'R1', classificationId: 'sale', valueCents: 30000, receipt: { date: '2026-10-26', finalCents: 28500, bankId: 'b1' } }]
  const shares = classificationShares(payables, receivables, classifications, { start: '2026-10-26', end: '2026-11-01' })
  assert.deepEqual(shares.out.map((row) => [row.name, row.cents]), [['Matéria-prima', 25500], ['Energia da produção', 5000], ['Sem classificação', 700]])
  assert.deepEqual(shares.in.map((row) => [row.code, row.cents]), [['7.01', 28500]])
  assert.deepEqual(classificationShares(payables, receivables, classifications, { start: '2026-10-26', end: '2026-11-01', bankId: 'b2' }).out.map((row) => row.cents), [15000, 5000], 'the bank filter keeps only its money')
})

test('a pie keeps six slices and folds the rest into "Outras"', () => {
  const rows = Array.from({ length: 9 }, (_, index) => ({ id: `c${index}`, name: `C${index}`, cents: 900 - index * 100 }))
  const { total, slices } = pieSlices(rows)
  assert.equal(total, 900 + 800 + 700 + 600 + 500 + 400 + 300 + 200 + 100)
  assert.deepEqual(slices.map((row) => row.id), ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'other'])
  assert.equal(slices.at(-1).name, 'Outras (3)'); assert.equal(slices.at(-1).cents, 600)
  assert.equal(Math.round(slices.reduce((sum, row) => sum + row.percent, 0)), 100)
  assert.equal(pieSlices(rows.slice(0, 7)).slices.length, 7, 'seven classifications fit without "Outras"')
})
