export const DAY = 86400000
export const todayBahia = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
}
export function cents(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Informe um valor em reais com até duas casas decimais.')
  const [whole, fraction = ''] = text.split('.')
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(result) || result > 999999999999) throw new Error('Valor fora do limite permitido.')
  return result
}
export function shiftMonth(value, months) {
  const [year, month, day] = value.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1, 12))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, last))
  return target.toISOString().slice(0, 10)
}
export function makeInstallments(valueCents, dueDate, count) {
  if (!Number.isInteger(count) || count < 1 || count > 120) throw new Error('Informe de 1 a 120 parcelas.')
  const base = Math.floor(valueCents / count)
  return Array.from({ length: count }, (_, index) => ({ valueCents: base + (index < valueCents % count ? 1 : 0), dueDate: shiftMonth(dueDate, index) }))
}
export const daysUntil = (date, today = todayBahia()) => Math.round((Date.parse(date) - Date.parse(today)) / DAY)
export const payableStatus = (account, today = todayBahia()) => account.payment ? 'paid' : account.dueDate < today ? 'overdue' : 'pending'
export function filterPayables(rows, filters = {}, today = todayBahia(), useStatus = true) {
  const search = String(filters.search || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return rows.filter((row) => {
    if (filters.supplierId && String(row.supplierId) !== String(filters.supplierId)) return false
    if (filters.classificationId && row.classificationId !== filters.classificationId) return false
    if (filters.start && row.dueDate < filters.start || filters.end && row.dueDate > filters.end) return false
    if (search && ![row.id, row.supplierName, row.description, row.documentNumber].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(search)) return false
    if (!useStatus || filters.status === 'all') return true
    if (filters.status === 'inactive') return row.inactive
    if (row.inactive) return false
    const status = payableStatus(row, today)
    return filters.status ? status === filters.status : status !== 'paid'
  })
}
