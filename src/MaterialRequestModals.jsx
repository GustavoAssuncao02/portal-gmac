import { useEffect, useRef, useState } from 'react'
import { CircleCheck, CircleX, Plus, X } from 'lucide-react'
import { formatQuantity, materialUnit, materialUnits, quantityStep, wholeUnit } from '../server/materialUnits.js'

function useRequestDialog() {
  const dialog = useRef(null)
  useEffect(() => {
    const element = dialog.current, previousFocus = document.activeElement, previousOverflow = document.body.style.overflow
    element.showModal()
    element.querySelector('[data-autofocus]')?.focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) }
  }, [])
  return dialog
}

export function MaterialRequestModal({ inventory, onSave, onClose }) {
  const dialog = useRequestDialog()
  const pending = useRef(false)
  const [mode, setMode] = useState('new')
  const [name, setName] = useState('')
  const [detail, setDetail] = useState('')
  const [inventoryId, setInventoryId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('kg')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = inventory.find((item) => String(item.id) === inventoryId)
  // A material of the stock is requested in its own unit; a new one in the unit chosen here.
  const requestUnit = mode === 'stock' ? materialUnit(selected?.unit) : unit
  const close = () => { if (!pending.current) onClose() }
  async function submit(event) {
    event.preventDefault()
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await onSave({ name: mode === 'stock' ? selected.name : name.trim(), detail: detail.trim(), unit: requestUnit, quantity: Number(quantity), inventoryId: mode === 'stock' ? selected.id : null })
      onClose()
    } catch (failure) { setError(failure.message) }
    finally { pending.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="os-history-modal os-action-modal material-request-modal" aria-labelledby="manual-material-request-title" onCancel={(event) => { event.preventDefault(); close() }}>
    <header className="os-history-heading"><h2 id="manual-material-request-title">Solicitar material</h2><button className="os-icon-button" type="button" disabled={busy} onClick={close} aria-label="Fechar" title="Fechar"><X size={18} /></button></header>
    <form className="material-request-form" onSubmit={submit}>
      <fieldset className="material-request-modes" disabled={busy}><legend>Material solicitado</legend><label><input data-autofocus type="radio" name="material-request-mode" checked={mode === 'new'} onChange={() => { setMode('new'); setDetail('') }} />Novo material</label><label><input type="radio" name="material-request-mode" checked={mode === 'stock'} onChange={() => { setMode('stock'); setDetail(selected?.detail || '') }} />Material do estoque</label></fieldset>
      {mode === 'stock' ? <label className="material-request-field">Material<select aria-label="Material" required disabled={busy} value={inventoryId} onChange={(event) => { setInventoryId(event.target.value); setDetail(inventory.find((item) => String(item.id) === event.target.value)?.detail || '') }}><option value="">Selecione</option>{inventory.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatQuantity(item.quantity, item.unit)} em estoque</option>)}</select></label> : <label className="material-request-field">Nome do material<input required maxLength={160} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>}
      <label className="material-request-field">Especificação<input maxLength={500} value={detail} disabled={busy} onChange={(event) => setDetail(event.target.value)} /></label>
      {mode === 'new' && <fieldset className="material-request-modes" disabled={busy}><legend>Unidade</legend>{materialUnits.map(([key, label]) => <label key={key}><input type="radio" name="material-request-unit" checked={unit === key} onChange={() => setUnit(key)} />{label}</label>)}</fieldset>}
      <label className="material-request-field">{`Quantidade solicitada (${requestUnit})`}<input required type="number" min={quantityStep(requestUnit)} max="1000000000" step={quantityStep(requestUnit)} inputMode={wholeUnit(requestUnit) ? 'numeric' : 'decimal'} value={quantity} disabled={busy} onChange={(event) => setQuantity(event.target.value)} /></label>
      {error && <p className="os-edit-error" role="alert">{error}</p>}
      <footer className="os-edit-actions"><button className="os-button" type="button" disabled={busy} onClick={close}>Cancelar</button><button className="os-button os-button--primary" disabled={busy} type="submit"><Plus size={16} />{busy ? 'Solicitando...' : 'Solicitar material'}</button></footer>
    </form>
  </dialog>
}

const labels = { requested: 'Material solicitado', received: 'Material adicionado', rejected: 'Pedido recusado' }
const icons = { requested: Plus, received: CircleCheck, rejected: CircleX }
const moment = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }) : 'Data não registrada'

export function MaterialRequestHistoryModal({ request, loadHistory, onClose }) {
  const dialog = useRequestDialog()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setItems(null)
    setError('')
    loadHistory(request.id, controller.signal).then((data) => { if (!controller.signal.aborted) setItems(data.items) }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [request.id, loadHistory, retry])
  return <dialog ref={dialog} className="os-history-modal os-action-modal material-request-modal" aria-labelledby="material-request-history-title" onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header className="os-history-heading"><div><h2 id="material-request-history-title">Histórico do pedido</h2><p>{request.name} · {request.orderCode || request.offerCode || request.code}</p></div><button data-autofocus className="os-icon-button" type="button" onClick={onClose} aria-label="Fechar histórico" title="Fechar histórico"><X size={18} /></button></header>
    <div className="material-request-history-content">
      {error ? <div className="material-request-history-error"><p className="os-edit-error" role="alert">{error}</p><button className="os-button" type="button" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button></div> : items === null ? <p role="status">Carregando histórico...</p> : <ol className="material-request-history-list">{items.map((item, index) => {
        const Symbol = icons[item.type] || Plus
        return <li className={`material-request-event material-request-event--${item.type}`} key={`${item.type}-${item.at}-${index}`}><Symbol size={19} aria-hidden="true" /><div><div className="material-request-event-heading"><strong>{labels[item.type]}</strong><time>{moment(item.at)}</time></div><span className="material-request-event-user">{item.userName}</span>{item.quantity != null && <small>{formatQuantity(item.quantity, request.unit)}{item.type === 'received' && item.orderCode ? ` · ${formatQuantity(item.allocatedQuantity, request.unit)} destinados à ${item.orderCode}` : item.type === 'received' ? ' · Entrada no estoque' : ''}</small>}</div></li>
      })}</ol>}
    </div>
  </dialog>
}
