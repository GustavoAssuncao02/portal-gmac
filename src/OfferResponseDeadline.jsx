import { todayBahia } from '../server/payableRules.js'
import { RESPONSE_DAYS_MAX, parseResponseDays, responseAnswered, responseBadge, responseDateLabel, responseDeadlineOf } from '../server/offerResponseRules.js'

// TCK-0012: "Prazo para resposta do cliente (dias)", in the manual offer and in Editar informações. Days from the Data
// da solicitação, with the day they give beside: "Resposta até 06/12/2026 (dom)". Empty: no deadline and no notice.
export function ResponseDaysField({ value, requestedAt, onChange }) {
  const days = parseResponseDays(value)
  const deadline = days && !Number.isNaN(days) && requestedAt ? responseDeadlineOf(requestedAt, days) : ''
  return <div className="offer-form-field--full offer-response-field">
    <label>Prazo para resposta do cliente (dias)<input type="number" min="1" max={RESPONSE_DAYS_MAX} step="1" inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Opcional" /></label>
    <small className={deadline ? 'offer-response-date' : undefined} aria-live="polite">{deadline ? `Resposta até ${responseDateLabel(deadline)}` : Number.isNaN(days) ? `Informe de 1 a ${RESPONSE_DAYS_MAX} dias.` : 'Dias corridos a partir da data da solicitação. Em branco: sem prazo e sem avisos.'}</small>
  </div>
}

// "em 2 dias", "vence hoje", "vencido há 1 dia".
export function ResponseBadge({ offer, today = todayBahia() }) {
  const badge = responseBadge(offer, today)
  return badge ? <span className={`offer-response-badge offer-response-badge--${badge.tone}`}>{badge.label}</span> : null
}

// The cell of "Resposta até" in the list: the day and the badge; "—" with no deadline or once the client answered.
export function ResponseDeadlineCell({ offer }) {
  if (!offer.responseDeadline || responseAnswered(offer)) return <span data-label="Resposta até">—</span>
  return <span data-label="Resposta até" className="offer-response-cell"><span>{offer.responseDeadline.split('-').reverse().join('/')}</span><ResponseBadge offer={offer} /></span>
}

// Ver oferta: "10 dias · até 06/12/2026 (dom)" with the badge.
export function ResponseDeadlineDetail({ offer }) {
  return <div className="offer-detail-text offer-response-detail"><h3>Prazo para resposta do cliente</h3>
    <p>{offer.responseDeadline ? <>{offer.responseDays} {offer.responseDays === 1 ? 'dia' : 'dias'} · até {responseDateLabel(offer.responseDeadline)}{responseAnswered(offer) ? <span className="offer-response-answered">{offer.status === 'rejected' ? 'Oferta recusada' : 'Oferta aceita'}</span> : <ResponseBadge offer={offer} />}</> : 'Não informado'}</p>
  </div>
}
