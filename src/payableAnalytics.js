import { payableStatus, daysUntil, filterPayables, todayBahia } from '../server/payableRules.js'

export function payableAnalytics(rows, filters, today = todayBahia()) {
  const selected = filterPayables(rows, { ...filters, status: 'all' }, today)
  const metrics = Object.fromEntries(['total', 'paid', 'pending', 'overdue', 'soon', 'interest', 'discount'].map((key) => [key, { value: 0, count: 0 }]))
  const classifications = new Map(), suppliers = new Map(), months = new Map()
  const add = (key, value) => { metrics[key].value += value; metrics[key].count++ }
  const group = (map, id, name, value) => { const row = map.get(id) || { id, name, value: 0, count: 0 }; row.value += value; row.count++; map.set(id, row) }
  for (const row of selected) {
    const status = payableStatus(row, today), amount = row.payment ? row.payment.finalCents : row.valueCents
    add('total', amount); add(status, amount)
    if (!row.payment && daysUntil(row.dueDate, today) >= 0 && daysUntil(row.dueDate, today) <= 3) add('soon', row.valueCents)
    group(classifications, row.classificationId, row.classificationName, amount)
    group(suppliers, row.supplierId, row.supplierName, amount)
    if (row.payment) {
      add('interest', row.payment.interestCents); add('discount', row.payment.discountCents)
      const month = row.payment.date.slice(0, 7)
      group(months, month, month, amount)
    }
  }
  const order = (map) => [...map.values()].sort((a, b) => b.value - a.value)
  return { selected, metrics, classifications: order(classifications), suppliers: order(suppliers), months: [...months.values()].sort((a, b) => a.id.localeCompare(b.id)), upcoming: selected.filter((r) => !r.payment && r.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), overdue: selected.filter((r) => !r.payment && r.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate)) }
}
