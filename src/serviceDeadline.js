const hourMs = 60 * 60 * 1000
const dayMs = 24 * hourMs

export const deadlineCategories = [
  ['on-time', 'Dentro do prazo'],
  ['soon', 'Pr\u00f3ximo do prazo'],
  ['at-deadline', 'Em cima do prazo'],
  ['late', 'Atrasado'],
]

export function deliveryTimestamp(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    const date = new Date(`${value}T00:00:00Z`)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return NaN
    // Date-only deadlines include the full delivery day in Bahia.
    return Date.parse(`${value}T23:59:59.999-03:00`)
  }
  return value ? Date.parse(value) : NaN
}

function remainingLabel(milliseconds) {
  const absolute = Math.abs(milliseconds)
  let label
  if (absolute >= dayMs) {
    const days = Math.floor(absolute / dayMs)
    label = `${days} ${days === 1 ? 'dia' : 'dias'}`
  } else {
    const minutes = milliseconds < 0 ? Math.max(1, Math.floor(absolute / 60000)) : Math.ceil(absolute / 60000)
    const hours = Math.floor(minutes / 60)
    const remainder = minutes % 60
    label = hours ? `${hours} h${remainder ? ` ${remainder} min` : ''}` : `${remainder} min`
  }
  return milliseconds < 0 ? `${label} de atraso` : label
}

export function serviceDeadline(order, now = Date.now()) {
  const delivery = deliveryTimestamp(order.deadline)
  const start = Date.parse(order.createdAt || order.requestedAt || '')
  const remainingMs = delivery - now
  if (!Number.isFinite(remainingMs)) return { key: 'unknown', label: 'Sem previs\u00e3o', remaining: '\u2014', percentage: null }
  const remaining = remainingLabel(remainingMs)
  const totalMs = delivery - start
  const percentage = Number.isFinite(totalMs) && totalMs > 0 ? Math.max(0, (now - start) / totalMs * 100) : null
  if (remainingMs < 0) return { key: 'late', label: 'Atrasado', remaining, percentage }
  if (percentage === null) return { key: 'unknown', label: 'Sem previs\u00e3o', remaining, percentage }
  const key = percentage <= 70 ? 'on-time' : percentage <= 90 ? 'soon' : 'at-deadline'
  return { key, label: deadlineCategories.find(([code]) => code === key)[1], remaining, percentage }
}
