import { addDays, bahiaDay, dateLabel } from './noteRules.js'

// TCK-0012 (2026-11-26): "Prazo para resposta do cliente". How many calendar days the client has to accept or refuse the
// proposal, counted from the Data da solicitação (today for a new offer, the informed day for a retroactive one). The
// offer keeps the days and the day they give (`responseDays`, `responseDeadline`); empty, there is no deadline and no
// notice. The notices (bell only, at 07:30, server/offerResponseNotices.js) stop once the client answers: the offer
// accepted (an OS) or refused. Shared by the server and the screens (no Node imports here).
export const RESPONSE_DAYS_MAX = 365
export const responseDaysMessage = `Prazo para resposta do cliente: informe de 1 a ${RESPONSE_DAYS_MAX} dias ou deixe em branco.`
export const responseNoticeTime = '07:30'
// Configurações › Notificações › Comercial: two notices some days before (1 to 30) and one on the day, each one can be
// turned off. Two notices with the same number of days arrive once.
export const RESPONSE_NOTICE_DAYS_MAX = 30
export const responseNoticeDefaults = { offerResponseFirst: true, offerResponseFirstDays: 3, offerResponseSecond: true, offerResponseSecondDays: 1, offerResponseDueDay: true }
export const responseNoticeSwitches = ['offerResponseFirst', 'offerResponseSecond', 'offerResponseDueDay']
export const responseNoticeDayKeys = ['offerResponseFirstDays', 'offerResponseSecondDays']
export const validResponseNoticeDays = (value) => Number.isInteger(value) && value >= 1 && value <= RESPONSE_NOTICE_DAYS_MAX

// '' or nothing: no deadline (null); a whole number of days from 1 to 365; anything else is invalid (NaN).
export function parseResponseDays(value) {
  if (value === '' || value == null) return null
  const days = Number(value)
  return Number.isInteger(days) && days >= 1 && days <= RESPONSE_DAYS_MAX ? days : Number.NaN
}
// The day of the request in Bahia, and the day the client has to answer by.
export const requestDayOf = (requestedAt) => { const ms = Date.parse(requestedAt); return Number.isFinite(ms) ? bahiaDay(ms) : '' }
export const responseDeadlineOf = (requestedAt, days) => { const day = typeof requestedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(requestedAt) ? requestedAt : requestDayOf(requestedAt); return day && days ? addDays(day, days) : '' }
// The client answered: the offer was accepted (it became an OS) or refused.
export const responseAnswered = (offer) => Boolean(offer?.orderCode) || ['accepted', 'rejected'].includes(offer?.status)

const weekdays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
// "06/12/2026 (dom)".
export const responseDateLabel = (day) => day ? `${dateLabel(day)} (${weekdays[new Date(`${day}T12:00:00Z`).getUTCDay()]})` : ''
const shortDay = (day) => dateLabel(day).slice(0, 5)
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000)

// The badge of the list and of the details: "em 2 dias", "vence hoje", "vencido há 1 dia". None once the client answered.
export function responseBadge(offer, today) {
  if (!offer?.responseDeadline || responseAnswered(offer)) return null
  const days = daysBetween(today, offer.responseDeadline)
  if (days > 0) return { days, label: `em ${days} ${days === 1 ? 'dia' : 'dias'}`, tone: days <= 3 ? 'soon' : 'ok' }
  if (days === 0) return { days, label: 'vence hoje', tone: 'today' }
  return { days, label: `vencido há ${-days} ${days === -1 ? 'dia' : 'dias'}`, tone: 'late' }
}

// The notices a person gets for a deadline, by their settings: the day of each one (at 07:30) and how many days before.
export function responseNoticePlan(deadline, settings) {
  if (!deadline) return []
  const plan = []
  for (const [kind, on, days] of [['first', settings.offerResponseFirst, settings.offerResponseFirstDays], ['second', settings.offerResponseSecond, settings.offerResponseSecondDays]]) {
    if (on && validResponseNoticeDays(days) && !plan.some((item) => item.days === days)) plan.push({ kind, days, day: addDays(deadline, -days) })
  }
  if (settings.offerResponseDueDay) plan.push({ kind: 'due', days: 0, day: deadline })
  return plan
}
// "OF-2026-0040 · CLIENTE: faltam 3 dias para o cliente responder a proposta (até 06/12)", "… vence hoje (06/12)", with
// "e a proposta ainda não foi feita" while no proposal was generated.
export function responseNoticeText(offer, days) {
  const deadline = shortDay(offer.responseDeadline)
  const what = days > 0 ? `${days === 1 ? 'falta 1 dia' : `faltam ${days} dias`} para o cliente responder a proposta (até ${deadline})` : `o prazo para o cliente responder a proposta vence hoje (${deadline})`
  return `${offer.code} · ${offer.company}: ${what}${offer.proposal ? '' : ' e a proposta ainda não foi feita'}`
}
