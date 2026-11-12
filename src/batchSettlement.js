import { classificationParts } from '../server/payableRules.js'

export const palette = ['#2f6fa5', '#2e9577', '#c9892f', '#8a5fb5', '#d1585b', '#3c9aa8', '#7a8f3a', '#b9577f']
// Share of the batch by classification; classifications beyond the palette are folded into "Outras".
export function batchByClassification(rows) {
  const totals = new Map()
  for (const row of rows) for (const part of classificationParts(row)) totals.set(part.classificationName, (totals.get(part.classificationName) || 0) + part.valueCents)
  const sorted = [...totals].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const head = sorted.slice(0, palette.length - 1), rest = sorted.slice(palette.length - 1)
  return rest.length ? [...head, { name: 'Outras', value: rest.reduce((sum, item) => sum + item.value, 0) }] : head
}
export const monthNames = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const two = (value) => String(value).padStart(2, '0')

// Years with open accounts, and the current one, for the year filter of the chart.
export function balanceYears(open, today) {
  return [...new Set([...open.map((row) => Number(row.dueDate.slice(0, 4))), Number(today.slice(0, 4))])].filter(Number.isFinite).sort((a, b) => a - b)
}

// Weeks of a month, Monday to Sunday, cut at the month's first and last day.
function monthWeeks(year, month) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate(), weeks = []
  for (let day = 1; day <= last;) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    const end = Math.min(last, day + (weekday === 0 ? 0 : 7 - weekday))
    weeks.push({ start: `${year}-${two(month)}-${two(day)}`, end: `${year}-${two(month)}-${two(end)}`, label: day === end ? `${two(day)}/${two(month)}` : `${two(day)}–${two(end)}/${two(month)}`, weekly: true })
    day = end + 1
  }
  return weeks
}

// Open balance of the year by due period, today and after the batch is paid. Without months chosen, the twelve months of
// the year; with one or two months, their weeks; with more, only those months.
export function openBalanceByPeriod(open, batchIds, { year, months = [] }) {
  const chosen = (months.length ? [...months] : monthNames.map((_, index) => index + 1)).sort((a, b) => a - b)
  const periods = chosen.length <= 2 && months.length ? chosen.flatMap((month) => monthWeeks(year, month)) : chosen.map((month) => ({
    start: `${year}-${two(month)}-01`, end: `${year}-${two(month)}-${two(new Date(Date.UTC(year, month, 0)).getUTCDate())}`, label: `${monthNames[month - 1]}/${String(year).slice(2)}`, weekly: false,
  }))
  const batch = new Set(batchIds)
  return periods.map((period) => {
    const rows = open.filter((row) => row.dueDate >= period.start && row.dueDate <= period.end)
    const now = rows.reduce((sum, row) => sum + row.valueCents, 0)
    return { ...period, key: period.start, now, after: now - rows.filter((row) => batch.has(row.id)).reduce((sum, row) => sum + row.valueCents, 0) }
  })
}

