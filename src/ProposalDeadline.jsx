import { todayBahia } from '../server/payableRules.js'
import { addDays } from '../server/noteRules.js'
import { daysBetween, deadlineDateLabel, parseProposalDeadline, proposalDeadlineBadge, proposalPending } from '../server/proposalDeadlineRules.js'

const dayText = (day) => day.split('-').reverse().join('/')
const fromToday = (days) => days === 0 ? 'hoje' : days === 1 ? 'amanhã' : days > 1 ? `em ${days} dias` : 'já passou'

// TCK-0012: "Prazo para enviar a proposta", in the manual offer and in Editar informações. The day the client wants to
// receive the proposal, never before the Data da solicitação, with shortcuts from today. Empty: no deadline, no notice.
export function ProposalDeadlineField({ value, requestedDay, onChange }) {
  const today = todayBahia()
  const invalid = Number.isNaN(parseProposalDeadline(value, requestedDay))
  return <div className="offer-form-field--full offer-response-field">
    <label>Prazo para enviar a proposta<input type="date" min={requestedDay || undefined} value={value} onChange={(event) => onChange(event.target.value)} /></label>
    <span className="proposal-deadline-shortcuts">
      {[3, 7].map((days) => <button type="button" key={days} onClick={() => onChange(addDays(today, days))}>+{days} dias</button>)}
      {value && <button type="button" onClick={() => onChange('')}>Limpar</button>}
    </span>
    <small className={value && !invalid ? 'offer-response-date' : undefined} aria-live="polite">{invalid ? 'Escolha uma data a partir da data da solicitação.' : value ? `Enviar até ${deadlineDateLabel(value)} · ${fromToday(daysBetween(today, value))}` : 'Opcional: o dia em que o cliente quer receber a proposta. Em branco, sem prazo e sem avisos.'}</small>
  </div>
}

// "amanhã", "em 3 dias", "vence hoje", "atrasada há 1 dia": only while the offer waits for its proposal.
export function ProposalDeadlineBadge({ offer, today = todayBahia() }) {
  const badge = proposalDeadlineBadge(offer, today)
  return badge ? <span className={`offer-response-badge offer-response-badge--${badge.tone}`}>{badge.label}</span> : null
}

// The cell "Proposta até" of the list: the day and, while the proposal is not generated, how close it is.
export function ProposalDeadlineCell({ offer, today }) {
  if (!offer.proposalDeadline) return <span data-label="Proposta até">—</span>
  return <span data-label="Proposta até" className="offer-response-cell"><span>{dayText(offer.proposalDeadline)}</span><ProposalDeadlineBadge offer={offer} today={today} /></span>
}

// Ver oferta: "até 02/12/2026 (qua)" with the badge, or what stopped the deadline.
export function ProposalDeadlineDetail({ offer }) {
  const stopped = offer.status === 'rejected' ? 'Oferta recusada' : offer.orderCode || offer.status === 'accepted' ? 'Oferta aceita' : 'Proposta gerada'
  return <div className="offer-detail-text offer-response-detail"><h3>Prazo para enviar a proposta</h3>
    <p>{offer.proposalDeadline ? <>até {deadlineDateLabel(offer.proposalDeadline)}{proposalPending(offer) ? <ProposalDeadlineBadge offer={offer} /> : <span className="offer-response-answered">{stopped}</span>}</> : 'Não informado'}</p>
  </div>
}
