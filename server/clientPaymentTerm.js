// The payment term of a client (Cadastros › Clientes), in days. Only the number is stored (clients.payment_days); the
// proposal PDF writes it as "45 dias". Shared by the server and the screens.
export const PAYMENT_DAYS_MAX = 365

// Blank is "no term"; anything else must be a whole number of days.
export function paymentDaysValue(value) {
  if (value == null || String(value).trim() === '') return null
  const days = Number(String(value).trim())
  if (!Number.isInteger(days) || days < 1 || days > PAYMENT_DAYS_MAX) throw Object.assign(new Error(`Informe o prazo de pagamento em dias: um número inteiro de 1 a ${PAYMENT_DAYS_MAX}.`), { status: 400 })
  return days
}

export const paymentDaysText = (days) => (days ? `${days} ${Number(days) === 1 ? 'dia' : 'dias'}` : '')

// Proposals generated before kept the payment as free text ("45 DDL"): its leading number is the term when the form is
// reopened; a text without one ("À vista") reopens blank.
export function legacyPaymentDays(text) {
  const match = /^\s*(\d{1,3})(?!\d)/.exec(String(text || ''))
  const days = match ? Number(match[1]) : 0
  return days >= 1 && days <= PAYMENT_DAYS_MAX ? days : null
}
