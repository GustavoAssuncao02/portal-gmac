import { useState } from 'react'
import { PayableModal } from './PayableModal.jsx'
import { activeSessions, sessionResourceName } from '../server/operationSessions.js'

// "Concluir atividades do Operador" on the services panel: confirms the completion of an OS whose stages already have every
// piece, naming the operators whose work is still open (their sessions end with it). The OS then waits for the NF-e.
export default function CompleteOperatorModal({ order, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const sessions = activeSessions(order.operation)
  async function confirm() {
    setBusy(true); setError('')
    try { await onConfirm(order.code) } catch (caught) { setError(caught.message); setBusy(false) }
  }
  return <PayableModal title="Concluir OS" busy={busy} onClose={onClose} className="complete-operator-modal" footer={<><button type="button" className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button><button type="button" className="admin-tool-button admin-tool-button--primary" disabled={busy} onClick={confirm}>{busy ? 'Concluindo...' : 'Concluir OS'}</button></>}>
    <p className="complete-operator-os"><strong>{order.code}</strong> · {order.service}</p>
    <p>Tem certeza que deseja concluir a OS? Isso fará com que a OS saia do painel dos Operadores.</p>
    {sessions.length > 0 && <section className="complete-operator-sessions" aria-label="Sessões que serão encerradas"><h3>{sessions.length === 1 ? 'Esta sessão será encerrada:' : 'Estas sessões serão encerradas:'}</h3><ul>{sessions.map((session) => <li key={session.id}>{session.employeeName}{sessionResourceName(session) ? ` · ${sessionResourceName(session)}` : ''}</li>)}</ul></section>}
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}
