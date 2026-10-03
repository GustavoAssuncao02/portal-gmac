import { useEffect, useId, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import './notifications.css'

export default function NotificationsButton() {
  const id = useId()
  const button = useRef(null)
  const panel = useRef(null)
  const [open, setOpen] = useState(false)

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
    <button ref={button} className="notifications-trigger" type="button" title="Notificações" aria-label="Notificações" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} popovertarget={id} onClick={position}><Bell size={19} strokeWidth={1.7} aria-hidden="true" /></button>
    <div ref={panel} id={id} popover="auto" className="notifications-popup" role="dialog" aria-labelledby={`${id}-title`}>
      <header><h2 id={`${id}-title`}>Notificações</h2><button className="notifications-close" type="button" title="Fechar notificações" aria-label="Fechar notificações" onClick={() => { panel.current.hidePopover(); button.current.focus({ preventScroll: true }) }}><X size={16} aria-hidden="true" /></button></header>
      <div className="notifications-empty"><Bell size={26} strokeWidth={1.5} aria-hidden="true" /><p>Nenhuma notificação no momento.</p></div>
    </div>
  </div>
}
