import { useEffect, useId, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import './notifications.css'
import { payableRequest, money, dateLabel } from './payablesApi.js'
import { pollWhileVisible } from './polling.js'
import { dueLabel } from '../server/payableRules.js'
import { claimNotificationSound, playNotificationSound, unlockNotificationSound } from './notificationSounds.js'
import { formatQuantity } from '../server/materialUnits.js'

unlockNotificationSound()
// What the bell already knew in this session (each screen mounts its own bell): only notifications that arrive
// afterwards play the sound, never the ones found at login or brought back by a change of preferences.
const heard = { token: null, ids: new Set() }
function announce(token, { items = [], sound }, silent) {
  const ids = items.map((item) => String(item.id))
  if (heard.token !== token) { heard.token = token; heard.ids = new Set(ids); return }
  const fresh = ids.filter((id) => !heard.ids.has(id))
  for (const id of fresh) heard.ids.add(id)
  if (!silent && fresh.length && sound && sound !== 'off' && claimNotificationSound(fresh)) playNotificationSound(sound)
}

export default function NotificationsButton({ onOpenAccount, onOpenReceivable, onOpenNotice }) {
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
    const refresh = (silent = false) => {
      // A closing refresh waits for the read acknowledgement, avoiding a stale badge.
      requestQueue.current = requestQueue.current.then(async () => {
        if (sessionStorage.getItem('gmac-admin-token') !== token || !active && !open) return
        const result = await payableRequest(open ? '/notifications/read-all' : '/notifications', open ? 'POST' : 'GET')
        if (active) { setItems(result.items); setError(''); announce(token, result, silent) }
      }).catch(() => { if (active) setError(open ? 'Não foi possível marcar as notificações como lidas. Abra o sino novamente para tentar.' : 'Não foi possível carregar as notificações.') })
    }
    const settingsChanged = () => refresh(true)
    refresh(); const stopPolling = pollWhileVisible(() => refresh(), 10000)
    window.addEventListener('gmac-notification-settings-changed', settingsChanged)
    return () => { active = false; stopPolling(); window.removeEventListener('gmac-notification-settings-changed', settingsChanged) }
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
      {items.length ? <div className="notifications-payables">{items.map((item) => <button type="button" key={item.id} onClick={() => { panel.current.hidePopover(); if (item.type === 'payable') onOpenAccount?.(item.accountId); else if (item.type === 'receivable') onOpenReceivable?.(item.accountId); else onOpenNotice?.(item) }}>
        {item.type === 'payable' ? <><strong>{item.accountId} · {dueLabel(item.account.daysUntil)}</strong><span>{item.account.supplierName} · {money(item.account.valueCents)}</span><small>{dateLabel(item.dueDate)} · {item.account.description}</small></> : item.type === 'receivable' ? <><strong>A receber · {item.accountId} · {dueLabel(item.account.daysUntil)}</strong><span>{item.account.customerName} · {money(item.account.valueCents)}</span><small>{dateLabel(item.dueDate)}{item.account.description ? ` · ${item.account.description}` : ''}</small></> : <><strong>{item.title}</strong><span>{item.description}</span>{item.type === 'low-stock' && <span>{formatQuantity(item.quantity, item.unit)} disponíveis · mínimo {formatQuantity(item.minimum, item.unit)}</span>}<small>{new Date(item.at).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })}{item.orderCode && ` · ${item.orderCode}`}{item.employeeName && ` · ${item.employeeName}`}</small></>}
      </button>)}</div> : <div className="notifications-empty"><Bell size={26} strokeWidth={1.5} aria-hidden="true" /><p>Nenhuma notificação no momento.</p></div>}
    </div>
  </div>
}
