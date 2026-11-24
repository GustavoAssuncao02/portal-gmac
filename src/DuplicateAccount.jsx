import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import { money, dateLabel } from './payablesApi.js'

// Possible duplicate (TCK-0007): another account with the same supplier/client, value and date. The save is refused with
// a warning that names the account found; the user may still post it, after confirming in a modal (`allowDuplicate`).
const statusText = { pending: 'Pendente', overdue: 'Vencida', paid: 'Paga', received: 'Recebida', inactive: 'Desativada' }

// The refusal of the server, kept with what was sent, so the confirmation sends the same data (and attachments) again.
export const duplicateOf = (caught, payload, extra = {}) => caught?.data?.duplicate && payload ? { message: caught.message, matches: caught.data.matches || [], payload, ...extra } : null

export function DuplicateWarning({ duplicate, edit = false, onProceed }) {
  return <div className="duplicate-warning payable-form-wide" role="alert">
    <TriangleAlert size={18} aria-hidden="true" />
    <p>{duplicate.message}</p>
    <button type="button" className="admin-tool-button" onClick={onProceed}>{edit ? 'Salvar mesmo assim' : 'Lançar mesmo assim'}</button>
  </div>
}

// `kind`: 'payable' or 'receivable'.
export function DuplicateConfirm({ duplicate, kind, edit = false, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const payable = kind === 'payable', many = duplicate.matches.length > 1
  const fields = payable ? 'fornecedor, valor e vencimento' : 'cliente, valor e data prevista'
  const action = edit ? 'Salvar mesmo assim' : 'Lançar mesmo assim'
  async function confirm() {
    setBusy(true); setError('')
    try { await onConfirm() } catch (caught) { setError(caught.message); setBusy(false) }
  }
  return <PayableModal title="Confirmar possível duplicidade" busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Voltar e revisar</button><button className="admin-tool-button admin-tool-button--primary" type="button" disabled={busy} onClick={confirm}>{busy ? 'Salvando...' : action}</button></>}>
    <div className="duplicate-confirm">
      {duplicate.matches.length ? <>
        <p>{many ? 'Já existem contas' : 'Já existe uma conta'} {payable ? 'a pagar' : 'a receber'} com o mesmo {fields}:</p>
        <ul className="duplicate-matches">{duplicate.matches.map((row) => <li key={row.id}>
          <div><strong>{row.id}</strong><span className={`duplicate-status duplicate-status--${row.status}`}>{statusText[row.status] || row.status}</span></div>
          <span>{row.name}</span>
          {(row.description || row.documentNumber) && <small>{[row.description, row.documentNumber && `Doc. ${row.documentNumber}`].filter(Boolean).join(' · ')}</small>}
          <small>{money(row.valueCents)} · {payable ? 'Vencimento' : 'Previsto para'} {dateLabel(row.dueDate)}</small>
        </li>)}</ul>
      </> : <p>{duplicate.message}</p>}
      <p>Confirme somente se forem lançamentos diferentes, e não a mesma conta registrada duas vezes. A confirmação fica registrada no histórico da conta.</p>
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </div>
  </PayableModal>
}
