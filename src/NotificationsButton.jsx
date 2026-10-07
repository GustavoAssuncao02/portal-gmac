import { useEffect, useId, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import './notifications.css'
import { payableRequest, money, dateLabel } from './payablesApi.js'

export default function NotificationsButton({ onOpenAccount, onOpenNotice }) {
  const id = useId()
  const button = useRef(null)
  const panel = useRef(null)
  const requestQueue = useRef(Promise.resolve())
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const token = sessionStorage.getItem('gmac-admin-token')
  useEffect(() => {
    if (!token) return undefined
    let active = true
    const refresh = () => {
      // A closing refresh waits for the read acknowledgement, avoiding a stale badge.
      requestQueue.current = requestQueue.current.then(async () => {
        if (sessionStorage.getItem('gmac-admin-token') !== token || !active && !open) return
        const result = await payableRequest(open ? '/notifications/read-all' : '/notifications', open ? 'POST' : 'GET')
        if (active) { setItems(result.items); setError('') }
      }).catch(() => { if (active) setError(open ? 'Não foi possível marcar as notificações como lidas. Abra o sino novamente para tentar.' : 'Não foi possível carregar as notificações.') })
    }
    refresh(); const timer = setInterval(refresh, 10000)
    window.addEventListener('gmac-notification-settings-changed', refresh)
    return () => { active = false; clearInterval(timer); window.removeEventListener('gmac-notification-settings-changed', refresh) }
  }, [open, token])
  const unreadCount = items.filter((item) => !item.readAt).length

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
    <button ref={button} className="notifications-trigger" type="button" title="Notificações" aria-label="Notificações" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} popovertarget={id} onClick={position}><Bell size={19} strokeWidth={1.7} aria-hidden="true" />{!open && unreadCount > 0 && <span className="notifications-count">{unreadCount}</span>}</button>
    <div ref={panel} id={id} popover="auto" className="notifications-popup" role="dialog" aria-labelledby={`${id}-title`}>
      <header><h2 id={`${id}-title`}>Notificações</h2><button className="notifications-close" type="button" title="Fechar notificações" aria-label="Fechar notificações" onClick={() => { panel.current.hidePopover(); button.current.focus({ preventScroll: true }) }}><X size={16} aria-hidden="true" /></button></header>
      {error && <p role="alert" className="notifications-error">{error}</p>}
      {items.length ? <div className="notifications-payables">{items.map((item) => <button type="button" key={item.id} onClick={() => { panel.current.hidePopover(); if (item.type === 'payable') onOpenAccount?.(item.accountId); else onOpenNotice?.(item) }}>
        {item.type === 'payable' ? <><strong>{item.accountId} · {item.account.daysUntil < 0 ? `Vencida há ${Math.abs(item.account.daysUntil)} dias` : item.account.daysUntil === 0 ? 'Vence hoje' : `Vence em ${item.account.daysUntil} dias`}</strong><span>{item.account.supplierName} · {money(item.account.valueCents)}</span><small>{dateLabel(item.dueDate)} · {item.account.description}</small></> : <><strong>{item.title}</strong><span>{item.description}</span>{item.type === 'low-stock' && <span>{Number(item.quantity).toLocaleString('pt-BR')} kg disponíveis · mínimo {Number(item.minimum).toLocaleString('pt-BR')} kg</span>}<small>{new Date(item.at).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })}{item.orderCode && ` · ${item.orderCode}`}{item.employeeName && ` · ${item.employeeName}`}</small></>}
      </button>)}</div> : <div className="notifications-empty"><Bell size={26} strokeWidth={1.5} aria-hidden="true" /><p>Nenhuma notificação no momento.</p></div>}
    </div>
  </div>
}
