import { useEffect, useRef } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { formatQuantity, materialUnit } from '../server/materialUnits.js'

export default function PendingMaterialsModal({ orderCode, materials, busy, error, onConfirm, onClose, onOpenRequest }) {
  const inspection = Boolean(onOpenRequest)
  const dialog = useRef(null)
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    element.showModal()
    element.querySelector('.pending-material-cancel').focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) }
  }, [])
  const close = () => { if (!busy) onClose() }
  // Kilos and units are totalled apart.
  const totals = ['kg', 'un'].map((unit) => [unit, Number(materials.filter((material) => materialUnit(material.unit) === unit).reduce((sum, material) => sum + material.quantity, 0).toFixed(3))]).filter(([, total]) => total > 0)
  return <dialog ref={dialog} className="pending-material-dialog" aria-labelledby="pending-material-title" onCancel={(event) => { event.preventDefault(); close() }}>
    <header><div><h2 id="pending-material-title"><TriangleAlert size={22} aria-hidden="true" />Material pendente</h2><p>{orderCode}</p></div><button type="button" className="pending-material-close" onClick={close} disabled={busy} aria-label={inspection ? 'Fechar' : 'Fechar confirmação'} title={inspection ? 'Fechar' : 'Fechar confirmação'}><X size={20} /></button></header>
    <dl className="pending-material-quantities">{materials.map((material) => <div key={material.key}><dt>{material.name}{material.detail && <small>{material.detail}</small>}</dt><dd>{formatQuantity(material.quantity, material.unit)}</dd></div>)}</dl>
    <p className="pending-material-total">Total pendente <strong>{totals.map(([unit, total]) => formatQuantity(total, unit)).join(' + ')}</strong></p>
    {!inspection && <p className="pending-material-question">Deseja começar o serviço mesmo assim?</p>}
    {error && <p className="operator-error" role="alert">{error}</p>}
    <footer><button className="operator-outline pending-material-cancel" type="button" disabled={busy} onClick={close}>{inspection ? 'Fechar' : 'Cancelar'}</button><button className="operator-primary" type="button" disabled={busy} onClick={inspection ? onOpenRequest : onConfirm}>{inspection ? 'Ir ao pedido' : busy ? 'Iniciando...' : 'Sim, iniciar serviço'}</button></footer>
  </dialog>
}
