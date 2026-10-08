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
const days = (count) => `${count} ${count === 1 ? 'dia' : 'dias'}`
export const dueLabel = (daysLeft) => daysLeft < 0 ? `Vencida há ${days(-daysLeft)}` : daysLeft === 0 ? 'Vence hoje' : `Vence em ${days(daysLeft)}`
const plain = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
// Values are searchable as typed in Brazil (1.234,56), without thousands (1234,56) or with a dot (1234.56).
const valueTexts = (cents) => { const whole = Math.trunc(cents / 100), fraction = String(cents % 100).padStart(2, '0'); return `${whole.toLocaleString('pt-BR')},${fraction} ${whole},${fraction} ${whole}.${fraction}` }
export function matchesSearch(row, search) {
  const query = plain(search).replace(/r\$\s*/g, '').trim()
  if (!query) return true
  if (plain([row.id, row.supplierName, row.description, row.documentNumber, row.supplierDocument, row.orderCode, valueTexts(row.valueCents)].join(' ')).includes(query)) return true
  const digits = query.replace(/\D/g, '')
  return /^[\d.\-/\s]+$/.test(query) && digits.length >= 4 && String(row.supplierDocument || '').includes(digits)
}
export const payableStatus = (account, today = todayBahia()) => account.payment ? 'paid' : account.dueDate < today ? 'overdue' : 'pending'
export function filterPayables(rows, filters = {}, today = todayBahia(), useStatus = true) {
  return rows.filter((row) => {
    if (filters.supplierId && String(row.supplierId) !== String(filters.supplierId)) return false
    if (filters.classificationId && row.classificationId !== filters.classificationId) return false
    if (filters.orderCode && row.orderCode !== filters.orderCode) return false
    if (filters.start && row.dueDate < filters.start || filters.end && row.dueDate > filters.end) return false
    if (!matchesSearch(row, filters.search)) return false
    if (!useStatus || filters.status === 'all') return true
    if (filters.status === 'inactive') return row.inactive
    if (row.inactive) return false
    const status = payableStatus(row, today)
    return filters.status ? status === filters.status : status !== 'paid'
  })
}
