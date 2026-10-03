import { useEffect, useId, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import './notifications.css'
import { payableRequest, money, dateLabel } from './payablesApi.js'

export default function NotificationsButton({ onOpenAccount }) {
  const id = useId()
  const button = useRef(null)
  const panel = useRef(null)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!sessionStorage.getItem('gmac-admin-token')) return undefined
    let active = true
    const refresh = () => payableRequest('/payables/notifications').then((result) => { if (active) { setItems(result.items); setError('') } }).catch(() => { if (active) setError('Não foi possível carregar as notificações.') })
    refresh(); const timer = setInterval(refresh, 30000)
    return () => { active = false; clearInterval(timer) }
  }, [open])

  function position() {
    const box = button.current.getBoundingClientRect()
    if (box.bottom < 0 || box.top > window.innerHeight) {
      panel.current.hidePopover()
      return
    }
    const width = Math.min(320, window.innerWidth - 24)
    panel.current.style.left = `${Math.max(12, Math.min(box.right - width, window.innerWidth - width - 12))}px`
    panel.current.style.top = `${box.bottom + 9}px`
  }

  useEffect(() => {
    const element = panel.current
    const toggle = (event) => setOpen(event.newState === 'open')
    element.addEventListener('toggle', toggle)
    return () => element.removeEventListener('toggle', toggle)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true) }
  }, [open])

  return <div className="workspace-notifications">
    <button ref={button} className="notifications-trigger" type="button" title="Notificações" aria-label="Notificações" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} popovertarget={id} onClick={position}><Bell size={19} strokeWidth={1.7} aria-hidden="true" />{items.length > 0 && <span className="notifications-count">{items.length}</span>}</button>
    <div ref={panel} id={id} popover="auto" className="notifications-popup" role="dialog" aria-labelledby={`${id}-title`}>
      <header><h2 id={`${id}-title`}>Notificações</h2><button className="notifications-close" type="button" title="Fechar notificações" aria-label="Fechar notificações" onClick={() => { panel.current.hidePopover(); button.current.focus({ preventScroll: true }) }}><X size={16} aria-hidden="true" /></button></header>
      {error ? <p role="alert" className="notifications-error">{error}</p> : items.length ? <div className="notifications-payables">{items.map((item) => <button type="button" key={item.id} onClick={() => { panel.current.hidePopover(); onOpenAccount?.(item.accountId) }}><strong>{item.accountId} · {item.account.daysUntil < 0 ? `Vencida há ${Math.abs(item.account.daysUntil)} dias` : item.account.daysUntil === 0 ? 'Vence hoje' : `Vence em ${item.account.daysUntil} dias`}</strong><span>{item.account.supplierName} · {money(item.account.valueCents)}</span><small>{dateLabel(item.dueDate)} · {item.account.description}</small></button>)}</div> : <div className="notifications-empty"><Bell size={26} strokeWidth={1.5} aria-hidden="true" /><p>Nenhuma notificação no momento.</p></div>}
    </div>
  </div>
}
