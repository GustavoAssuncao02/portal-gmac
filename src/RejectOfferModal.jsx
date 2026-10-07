import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

export default function RejectOfferModal({ offer, onConfirm, onClose }) {
  const dialog = useRef(null)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    element.showModal()
    element.querySelector('.offer-reject-cancel').focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) }
  }, [])
  const close = () => { if (!pending.current) onClose() }
  async function confirm() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try { await onConfirm(offer); onClose() } catch (caught) { setError(caught.message) } finally { pending.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="os-history-modal os-action-modal offer-reject-modal" aria-labelledby="offer-reject-title" onCancel={(event) => { event.preventDefault(); close() }} onClick={(event) => {
    if (event.target !== event.currentTarget) return
    const box = event.currentTarget.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close()
  }}>
    <header className="os-history-heading"><div><h2 id="offer-reject-title">Recusar oferta?</h2><p>{offer.code} · {offer.service}</p></div><button className="os-icon-button" type="button" disabled={busy} onClick={close} aria-label="Fechar confirmação" title="Fechar confirmação"><X size={18} /></button></header>
    <div className="os-action-content"><p>Esta oferta será cancelada e não poderá gerar uma OS. Os dados serão mantidos para consulta.</p>{error && <p className="os-edit-error" role="alert">{error}</p>}<footer className="os-edit-actions"><button className="os-button offer-reject-cancel" type="button" disabled={busy} onClick={close}>Cancelar</button><button className="os-button offer-reject-button" type="button" disabled={busy} onClick={confirm}><X size={16} />{busy ? 'Recusando...' : 'Recusar oferta'}</button></footer></div>
  </dialog>
}
