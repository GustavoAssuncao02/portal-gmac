import { classificationParts, scaleSplit, shiftMonth } from '../server/payableRules.js'

// Fluxo de caixa: the money that actually entered and left (the same movements as Tesouraria), by day, week or month.
const DAY = 86400000
const iso = (time) => new Date(time).toISOString().slice(0, 10)
export const addDays = (date, count) => iso(Date.parse(`${date}T12:00:00Z`) + count * DAY)
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay()
// Weeks run from Monday to Sunday.
export const weekStart = (date) => addDays(date, -((weekdayOf(date) + 6) % 7))
const lastOfMonth = (date) => addDays(shiftMonth(`${date.slice(0, 7)}-01`, 1), -1)
const short = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
const weekdays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const length = (bucket) => Math.round((Date.parse(bucket.end) - Date.parse(bucket.start)) / DAY) + 1

// The period around `anchor` and its columns: the day itself; the 7 days of its week; or the weeks of its month (the
// first and the last ones cut at the month's edges). `previous` is the period before, for the comparison of the totals.
export function cashFlowPeriod(mode, anchor) {
  if (mode === 'week') {
    const start = weekStart(anchor)
    const buckets = Array.from({ length: 7 }, (_, index) => { const day = addDays(start, index); return { key: day, start: day, end: day, label: weekdays[weekdayOf(day)].slice(0, 3), detail: short(day), title: `${weekdays[weekdayOf(day)]}, ${short(day)}` } })
    return { mode, start, end: addDays(start, 6), buckets, previous: { start: addDays(start, -7), end: addDays(start, -1) } }
  }
  if (mode === 'month') {
    const start = `${anchor.slice(0, 7)}-01`, end = lastOfMonth(anchor), buckets = []
    for (let day = start; day <= end;) {
      const sunday = addDays(weekStart(day), 6), last = sunday < end ? sunday : end
      buckets.push({ key: day, start: day, end: last, label: `Semana ${buckets.length + 1}`, detail: day === last ? short(day) : `${short(day)} a ${short(last)}`, shortLabel: `S${buckets.length + 1}`, shortDetail: day === last ? day.slice(8) : `${day.slice(8)}–${last.slice(8)}`, title: `Semana ${buckets.length + 1} · ${short(day)} a ${short(last)}` })
      day = addDays(last, 1)
    }
    return { mode, start, end, buckets, previous: { start: shiftMonth(start, -1), end: addDays(start, -1) } }
  }
  return { mode: 'day', start: anchor, end: anchor, buckets: [{ key: anchor, start: anchor, end: anchor, label: weekdays[weekdayOf(anchor)], detail: short(anchor), title: `${weekdays[weekdayOf(anchor)]}, ${short(anchor)}` }], previous: { start: addDays(anchor, -1), end: addDays(anchor, -1) } }
}

export function totalsOf(movements, start, end) {
  let inCents = 0, outCents = 0, count = 0
  for (const row of movements) {
    if (row.date < start || row.date > end) continue
    if (row.type === 'in') inCents += row.cents; else outCents += row.cents
    count++
  }
  return { inCents, outCents, balanceCents: inCents - outCents, count }
}
// More or less than before, in % of the size of the previous balance (a negative balance that shrinks is an improvement).
export const changeOf = (current, previous) => previous ? (current - previous) / Math.abs(previous) * 100 : null

// Each column with its entries, exits and balance, and the change of its balance against the column before (the first
// one against the same number of days right before it). Days still to come have no change.
export function cashFlowBuckets(movements, period, today) {
  return period.buckets.map((bucket, index) => {
    const before = index ? period.buckets[index - 1] : { start: addDays(bucket.start, -length(bucket)), end: addDays(bucket.start, -1) }
    const totals = totalsOf(movements, bucket.start, bucket.end), previous = totalsOf(movements, before.start, before.end)
    const future = bucket.start > today
    return { ...bucket, ...totals, previousBalanceCents: previous.balanceCents, future, change: future ? null : changeOf(totals.balanceCents, previous.balanceCents) }
  })
}

// What was paid and received in the period, by classification: the amount actually moved (with interest or discount)
// spread over the parts of an account divided among classifications.
export function classificationShares(payables = [], receivables = [], classifications = [], { start, end, bankId } = {}) {
  const known = new Map(classifications.map((item) => [item.id, item]))
  const out = new Map(), entries = new Map()
  const add = (map, id, cents) => {
    const item = known.get(id), key = item ? id : 'none'
    const row = map.get(key) || { id: key, code: item?.code || '', name: item?.name || 'Sem classificação', cents: 0 }
    row.cents += cents
    map.set(key, row)
  }
  const inside = (settlement) => settlement && settlement.date >= start && settlement.date <= end && (!bankId || settlement.bankId === bankId)
  for (const row of payables) if (inside(row.payment)) for (const part of scaleSplit(classificationParts(row), row.payment.finalCents, row.valueCents)) add(out, part.classificationId, part.valueCents)
  for (const row of receivables) if (inside(row.receipt)) add(entries, row.classificationId, row.receipt.finalCents)
  const sorted = (map) => [...map.values()].filter((row) => row.cents > 0).sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name, 'pt-BR'))
  return { out: sorted(out), in: sorted(entries) }
}

// The largest slices keep their own color; past `limit`, the rest joins "Outras" (a pie reads well with few slices).
export function pieSlices(rows, limit = 6) {
  const total = rows.reduce((sum, row) => sum + row.cents, 0)
  const kept = rows.length > limit + 1 ? rows.slice(0, limit) : rows, rest = rows.slice(kept.length)
  const slices = rest.length ? [...kept, { id: 'other', code: '', name: `Outras (${rest.length})`, cents: rest.reduce((sum, row) => sum + row.cents, 0), others: rest }] : kept
  return { total, slices: slices.map((row) => ({ ...row, percent: total ? row.cents / total * 100 : 0 })) }
}
