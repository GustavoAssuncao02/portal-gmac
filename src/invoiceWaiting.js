import { todayBahia } from '../server/payableRules.js'

// "Aguardando NF-e" (2026-11-27): an OS whose operators finished every piece stays in Serviços em andamento until the
// receivable is scheduled (the green button). It no longer follows the production, so it goes to its own block at the
// end of the panel, the one waiting longest first, with how long it has been waiting: yellow from 5 days, red from 10.
export const INVOICE_WAIT_WARN_DAYS = 5
export const INVOICE_WAIT_LATE_DAYS = 10

export const awaitingInvoice = (order) => order?.operation?.status === 'completed'
const completedMs = (order) => { const at = Date.parse(order?.operation?.completedAt); return Number.isFinite(at) ? at : null }

// Whole days (Bahia) since the day the production was completed: "hoje", "há 1 dia", "há 12 dias".
export function invoiceWait(order, today = todayBahia()) {
  const at = completedMs(order)
  if (at == null) return null
  const days = Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${todayBahia(new Date(at))}T12:00:00Z`)) / 86400000))
  return { days, label: days === 0 ? 'hoje' : days === 1 ? 'há 1 dia' : `há ${days} dias`, tone: days >= INVOICE_WAIT_LATE_DAYS ? 'late' : days >= INVOICE_WAIT_WARN_DAYS ? 'warn' : 'ok' }
}

// The one waiting longest first; an OS without the moment of completion goes last.
export const byLongestWait = (orders) => [...orders].sort((left, right) => (completedMs(left) ?? Infinity) - (completedMs(right) ?? Infinity) || String(left.code).localeCompare(String(right.code), 'pt-BR', { numeric: true }))
