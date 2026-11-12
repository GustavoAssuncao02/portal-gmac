import { useId, useState } from 'react'
import { PayableModal } from './PayableModal.jsx'

// An offer may be created without the requested deadline, but the proposal PDF is only generated with it: the OS comes
// from the accepted proposal, and the services panel, the operator's tablet and the planning follow that date.
export default function RequestedDeadlineModal({ offer, onConfirm, onClose }) {
  const formId = useId(), [deadline, setDeadline] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try { await onConfirm(deadline) } catch (caught) { setError(caught.message); setBusy(false) }
  }
  return <PayableModal title="Informe o prazo solicitado" busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={formId} disabled={busy}>{busy ? 'Salvando...' : 'Salvar e continuar'}</button></>}>
    <form id={formId} className="payable-form" onSubmit={submit}><fieldset disabled={busy}>
      <p><strong>{offer.code} · {offer.service}</strong></p>
      <p>Esta oferta ainda não tem o prazo solicitado pelo cliente. Sem ele, o PDF da proposta não é gerado e a oferta não pode ser aceita.</p>
      <label>Prazo solicitado *<input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} required autoFocus /></label>
      <p className="payable-hint">As opções sem prazo de entrega recebem esta mesma data.</p>
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}
