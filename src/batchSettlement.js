export const palette = ['#2f6fa5', '#2e9577', '#c9892f', '#8a5fb5', '#d1585b', '#3c9aa8', '#7a8f3a', '#b9577f']
// Share of the batch by classification; classifications beyond the palette are folded into "Outras".
export function batchByClassification(rows) {
  const totals = new Map()
  for (const row of rows) totals.set(row.classificationName, (totals.get(row.classificationName) || 0) + row.valueCents)
  const sorted = [...totals].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const head = sorted.slice(0, palette.length - 1), rest = sorted.slice(palette.length - 1)
  return rest.length ? [...head, { name: 'Outras', value: rest.reduce((sum, item) => sum + item.value, 0) }] : head
}
// Open balance by due month, today and after the batch is paid.
export function openBalanceByMonth(open, batchIds) {
  const months = new Map()
  for (const row of open) {
    const month = row.dueDate.slice(0, 7), entry = months.get(month) || { month, now: 0, after: 0 }
    entry.now += row.valueCents
    if (!batchIds.includes(row.id)) entry.after += row.valueCents
    months.set(month, entry)
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month))
}

