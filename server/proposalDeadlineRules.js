import { addDays, dateLabel } from './noteRules.js'
import { requestDay } from './retroactiveEntry.js'

// TCK-0012 (revised 2026-11-27): "Prazo para enviar a proposta". The day the client wants to receive the proposal (the
// first version counted the days for the client to answer it, which the commercial team does not need: the proposal
// itself is valid for 10 days). Optional, never before the Data da solicitação. While the offer has no proposal (Criando
// oferta, Em aberto, Em análise, the offers of the site) the list shows how close it is, brings the urgent ones to the
// top and the bell warns at 07:30; once the proposal is generated (or the offer accepted or refused) all of that stops,
// and it comes back if the proposal is discarded. Shared by the server and the screens (no Node imports here).
export const proposalDeadlineMessage = 'Prazo para enviar a proposta: escolha uma data a partir da data da solicitação ou deixe em branco.'
export const proposalNoticeTime = '07:30'
// From 3 days before the deadline an offer is urgent (2026-11-27): yellow, at the top of the list and in "Prazo vencendo",
// with the ones of today and the late ones.
export const PROPOSAL_URGENT_DAYS = 3

// Configurações › Notificações › Comercial: the 1st and 2nd notice some days before (1 to 30) and the notice on the day
// it falls due, each one with its switch. Off by default; on by default for the CPFs of PROPOSAL_DEADLINE_NOTICE_CPFS
// (server/accounts.js).
export const PROPOSAL_NOTICE_DAYS_MAX = 30
export const proposalNoticeSwitches = ['proposalDeadlineFirst', 'proposalDeadlineSecond', 'proposalDeadlineDueDay']
export const proposalNoticeDayKeys = ['proposalDeadlineFirstDays', 'proposalDeadlineSecondDays']
export const proposalNoticeDays = { proposalDeadlineFirstDays: 3, proposalDeadlineSecondDays: 1 }
export const proposalNoticeDefaults = (on = false) => ({ ...Object.fromEntries(proposalNoticeSwitches.map((key) => [key, on])), ...proposalNoticeDays })
export const validProposalNoticeDays = (value) => Number.isInteger(value) && value >= 1 && value <= PROPOSAL_NOTICE_DAYS_MAX
// The kinds of the notice in the bell and the switch of each one.
export const proposalNoticeTypes = { first: 'proposal-deadline-first', second: 'proposal-deadline-second', due: 'proposal-deadline-due' }
export const proposalNoticePreference = { [proposalNoticeTypes.first]: 'proposalDeadlineFirst', [proposalNoticeTypes.second]: 'proposalDeadlineSecond', [proposalNoticeTypes.due]: 'proposalDeadlineDueDay' }

const validDay = (text) => /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T12:00:00Z`).toISOString().slice(0, 10) === text
// '' or nothing: no deadline (null); a real day not before the day of the request: that day; anything else: NaN.
export function parseProposalDeadline(value, requestedDay = '') {
  if (value === '' || value == null) return null
  const text = String(value)
  if (!validDay(text)) return Number.NaN
  return requestedDay && text < requestDay(requestedDay) ? Number.NaN : text
}

// Still waiting for its proposal: the deadline counts. A generated proposal (Proposta gerada), an accepted or a refused
// offer stop it.
export const proposalPending = (offer) => !offer?.orderCode && ['creating', 'review'].includes(offer?.status)
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000)
// Days until the deadline of an offer still waiting for its proposal (negative: late); null without one.
export const proposalDaysLeft = (offer, today) => offer?.proposalDeadline && proposalPending(offer) ? daysBetween(today, offer.proposalDeadline) : null

// The badge of the list, of Ver oferta and of the Início: only from 3 days before ("amanhã", "em 3 dias"), on the day
// ("vence hoje") and late ("atrasada há 3 dias"). Further away the date is enough.
export function proposalDeadlineBadge(offer, today) {
  const days = proposalDaysLeft(offer, today)
  if (days == null || days > PROPOSAL_URGENT_DAYS) return null
  if (days > 0) return { days, label: days === 1 ? 'amanhã' : `em ${days} dias`, tone: 'soon' }
  if (days === 0) return { days, label: 'vence hoje', tone: 'today' }
  return { days, label: `atrasada há ${-days} ${days === -1 ? 'dia' : 'dias'}`, tone: 'late' }
}
// "Prazo vencendo" (filter of Ofertas, Início): every highlighted offer, from 3 days before the deadline to late.
export const proposalDue = (offer, today) => { const days = proposalDaysLeft(offer, today); return days != null && days <= PROPOSAL_URGENT_DAYS }
// The order of the list when no title was chosen: the urgent offers first (the most late first, then today, then the
// next 3 days, the nearest first); the others keep their order.
export function urgentFirst(offers, today) {
  const urgent = [], rest = []
  for (const offer of offers) { const days = proposalDaysLeft(offer, today); (days != null && days <= PROPOSAL_URGENT_DAYS ? urgent : rest).push(offer) }
  urgent.sort((left, right) => left.proposalDeadline.localeCompare(right.proposalDeadline))
  return [...urgent, ...rest]
}
// Início › Propostas com prazo próximo: every offer still waiting for its proposal with a deadline, the late ones first.
export const deadlineOffers = (offers, today) => offers.filter((offer) => proposalDaysLeft(offer, today) != null).sort((left, right) => left.proposalDeadline.localeCompare(right.proposalDeadline) || String(left.code).localeCompare(String(right.code), 'pt-BR', { numeric: true }))

const weekdays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
// "06/12/2026 (dom)".
export const deadlineDateLabel = (day) => day ? `${dateLabel(day)} (${weekdays[new Date(`${day}T12:00:00Z`).getUTCDay()]})` : ''
const shortDay = (day) => dateLabel(day).slice(0, 5)

// The notices a person gets for a deadline, by their settings: the day of each one (at 07:30) and how many days before.
export function proposalNoticePlan(deadline, settings) {
  if (!deadline) return []
  const plan = []
  for (const [kind, on, days] of [['first', settings.proposalDeadlineFirst, settings.proposalDeadlineFirstDays], ['second', settings.proposalDeadlineSecond, settings.proposalDeadlineSecondDays]]) {
    if (on && validProposalNoticeDays(days) && !plan.some((item) => item.days === days)) plan.push({ kind, days, day: addDays(deadline, -days) })
  }
  if (settings.proposalDeadlineDueDay) plan.push({ kind: 'due', days: 0, day: deadline })
  return plan
}
// "OF-2026-0040 · CLIENTE: faltam 3 dias para enviar a proposta (até 06/12)", "… o prazo para enviar a proposta vence hoje (06/12)".
export function proposalNoticeText(offer, days) {
  const deadline = shortDay(offer.proposalDeadline)
  const what = days > 0 ? `${days === 1 ? 'falta 1 dia' : `faltam ${days} dias`} para enviar a proposta (até ${deadline})` : `o prazo para enviar a proposta vence hoje (${deadline})`
  return `${offer.code} · ${offer.company}: ${what}`
}
