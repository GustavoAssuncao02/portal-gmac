import { useEffect, useRef, useState } from 'react'
import { Hash, X } from 'lucide-react'
import { backdropClose } from './dialogBackdrop.js'
import { quantityLabel, quantityUnitOf, quantityUnits } from '../server/quantityUnits.js'

// "Sem quantidade definida" (TCK-0005): the request arrived before anyone counted the pieces at the client. The offer shows
// "A definir" and, before the proposal options (or the OS of an etiqueta), this dialog asks the quantity
// (PUT /api/offers/:id/quantity). Per piece, materials and stage times follow it.
export const quantityPending = (offer) => Boolean(offer?.quantityPending)
// With its measure (TCK-0009): "2 pares"; `short` for the lists ("2 un").
export const quantityText = (offer, { short = false } = {}) => (quantityPending(offer) ? 'A definir' : quantityLabel(offer.quantity, offer.quantityUnit, { short }))

// Unidades, pares ou conjuntos: next to the quantity of the offer and of the OS. The number is what production counts.
export function QuantityUnitSelect({ value, onChange, ...props }) {
  return <select aria-label="Medida da quantidade" value={quantityUnitOf(value)} onChange={(event) => onChange(event.target.value)} {...props}>{quantityUnits.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
}

export default function OfferQuantityModal({ offer, onConfirm, onClose }) {
  const dialog = useRef(null), input = useRef(null), pending = useRef(false)
  const [value, setValue] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    element.showModal()
    input.current?.focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) }
  }, [])
  const close = () => { if (!pending.current) onClose() }
  async function confirm(event) {
    event.preventDefault()
    if (pending.current) return
    const quantity = Number(value)
    if (!Number.isInteger(quantity) || quantity < 1) return setError('Informe a quantidade de peças (número inteiro, a partir de 1).')
    pending.current = true
    setBusy(true)
    setError('')
    try { await onConfirm(quantity) } catch (caught) { setError(caught.message) } finally { pending.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="os-history-modal os-action-modal offer-creating-modal offer-quantity-modal" aria-labelledby="offer-quantity-title" onCancel={(event) => { event.preventDefault(); close() }} {...backdropClose(close)}>
    <header className="os-history-heading"><div><h2 id="offer-quantity-title">Quantidade de peças</h2><p>{offer.code} · {offer.service}</p></div><button className="os-icon-button" type="button" disabled={busy} onClick={close} aria-label="Fechar" title="Fechar"><X size={18} /></button></header>
    <form className="os-action-content" onSubmit={confirm}>
      <p>Esta oferta foi inserida <strong>sem quantidade definida</strong>. Informe quantas peças serão feitas antes de montar a proposta.</p>
      <label className="offer-quantity-field">Quantidade *<input ref={input} type="number" min="1" step="1" inputMode="numeric" value={value} disabled={busy} onChange={(event) => setValue(event.target.value)} required /></label>
      {offer.resources?.entryMode === 'piece' && <p className="offer-creating-note">Os materiais e tempos lançados por peça serão recalculados para essa quantidade.</p>}
      {error && <p className="os-edit-error" role="alert">{error}</p>}
      <footer className="os-edit-actions"><button className="os-button offer-creating-cancel" type="button" disabled={busy} onClick={close}>Cancelar</button><button className="os-button offer-creating-confirm" type="submit" disabled={busy}><Hash size={16} />{busy ? 'Salvando...' : 'Confirmar quantidade'}</button></footer>
    </form>
  </dialog>
}
