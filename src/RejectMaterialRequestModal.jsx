import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

export default function RejectMaterialRequestModal({ request, onConfirm, onClose }) {
  const dialog = useRef(null)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    element.showModal()
    element.querySelector('.material-request-cancel').focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) }
  }, [])
  const close = () => { if (!pending.current) onClose() }
  async function confirm() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try { await onConfirm(request); onClose() } catch (caught) { setError(caught.message) } finally { pending.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="os-history-modal os-action-modal" aria-labelledby="material-request-reject-title" onCancel={(event) => { event.preventDefault(); close() }}>
    <header className="os-history-heading"><div><h2 id="material-request-reject-title">Recusar pedido de material?</h2><p>{request.orderCode || request.offerCode || request.code}</p></div><button className="os-icon-button" type="button" disabled={busy} onClick={close} aria-label="Fechar" title="Fechar"><X size={18} /></button></header>
    <div className="os-action-content"><dl className="pending-material-quantities"><div><dt>{request.name}{request.detail && <small>{request.detail}</small>}</dt><dd>{Number(request.quantity).toLocaleString('pt-BR')} kg</dd></div></dl><p>O pedido continuará na lista como recusado. O estoque{request.orderCode ? ' e a OS' : ''} não {request.orderCode ? 'serão alterados' : 'será alterado'}.{request.orderCode ? ' O material continuará pendente na OS.' : ''}</p>{error && <p className="os-edit-error" role="alert">{error}</p>}<footer className="os-edit-actions"><button className="os-button material-request-cancel" type="button" disabled={busy} onClick={close}>Cancelar</button><button className="os-button offer-reject-button" type="button" disabled={busy} onClick={confirm}><X size={16} />{busy ? 'Recusando...' : 'Recusar pedido'}</button></footer></div>
  </dialog>
}
