import { useEffect, useRef, useState } from 'react'
import { Inbox, PencilLine, Trash2, X } from 'lucide-react'
import { backdropClose } from './dialogBackdrop.js'
import { upper } from './displayCase.js'

// A manual offer starts as "Criando oferta" (status 'creating'): the list shows who is creating it and for how long, and
// only "Fazer proposta" in its details puts it in analysis (server/offers.js).
export const isCreating = (offer) => offer?.status === 'creating'
// In real time (server/offerPresence.js): the person creating it left its details, so it is "Em aberto" since then.
// An editingBy saved before this rule has no `active` and counts as stopped.
export const stoppedCreating = (offer) => isCreating(offer) && Boolean(offer.editingBy) && !offer.editingBy.active
// "Em aberto": left for the team ("Deixar oferta em aberto e notificar") and not taken yet, or stopped.
export const isOpenOffer = (offer) => isCreating(offer) && ((offer.openForTeam && !offer.editingBy) || stoppedCreating(offer))
const lastActive = (offer) => offer.editingBy?.lastActiveAt || offer.editingBy?.at || offer.createdAt

export function creatingSinceText(at, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60000))
  if (!Number.isFinite(minutes) || minutes < 1) return 'agora há pouco'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
  const days = Math.floor(hours / 24)
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`
}

// The time counts from the creation of the offer, also after someone else takes it over.
const creatingSince = (offer) => offer.createdAt || offer.requestedAt

export function CreatingOfferBadge({ offer, onOpen }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  const name = offer.editingBy?.name || offer.createdByName || 'Administrador'
  const since = creatingSinceText(creatingSince(offer), now)
  // Inserted with "Deixar oferta em aberto e notificar": nobody is creating it yet; whoever opens it first takes it.
  if (offer.openForTeam && !offer.editingBy) return <button className="offer-creating-badge offer-creating-badge--open" type="button" onClick={onOpen} title={`Inserida por ${offer.createdByName || 'Administrador'} em ${new Date(creatingSince(offer)).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}. Quem abrir primeiro assume a oferta.`}>
    <strong><Inbox size={15} aria-hidden="true" />Em aberto</strong>
    <span>Aguardando responsável</span>
    <small>{since}</small>
  </button>
  // The person creating it left: anyone may go on with it ("Em aberto"), and the time is the one of the last edit.
  if (stoppedCreating(offer)) return <button className="offer-creating-badge offer-creating-badge--open" type="button" onClick={onOpen} title={`${name} começou esta oferta em ${new Date(creatingSince(offer)).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })} e não está mais nela. Última edição em ${new Date(lastActive(offer)).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}.`}>
    <strong><Inbox size={15} aria-hidden="true" />Em aberto</strong>
    <span>{name}</span>
    <small>editado {creatingSinceText(lastActive(offer), now)}</small>
  </button>
  return <button className="offer-creating-badge" type="button" onClick={onOpen} title={`${name} está criando esta oferta desde ${new Date(creatingSince(offer)).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}`}>
    <strong><PencilLine size={15} aria-hidden="true" />Criando oferta</strong>
    <span>{name}</span>
    <small>{since}</small>
  </button>
}

// Same dialog of the other confirmations of the list (RejectOfferModal.jsx).
function ConfirmDialog({ title, subtitle, children, confirmLabel, busyLabel, icon, tone, onConfirm, onClose }) {
  const dialog = useRef(null)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    element.showModal()
    element.querySelector('.offer-creating-cancel').focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) }
  }, [])
  const close = () => { if (!pending.current) onClose() }
  async function confirm() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try { await onConfirm(); onClose() } catch (caught) { setError(caught.message) } finally { pending.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className={`os-history-modal os-action-modal offer-creating-modal offer-creating-modal--${tone}`} aria-labelledby="offer-creating-title" onCancel={(event) => { event.preventDefault(); close() }} {...backdropClose(close)}>
    <header className="os-history-heading"><div><h2 id="offer-creating-title">{title}</h2><p>{subtitle}</p></div><button className="os-icon-button" type="button" disabled={busy} onClick={close} aria-label="Fechar confirmação" title="Fechar confirmação"><X size={18} /></button></header>
    <div className="os-action-content">{children}{error && <p className="os-edit-error" role="alert">{error}</p>}<footer className="os-edit-actions"><button className="os-button offer-creating-cancel" type="button" disabled={busy} onClick={close}>Cancelar</button><button className="os-button offer-creating-confirm" type="button" disabled={busy} onClick={confirm}>{icon}{busy ? busyLabel : confirmLabel}</button></footer></div>
  </dialog>
}

// Another administrator clicked the offer someone else is creating: confirming makes them the one creating it.
export function TakeOverOfferModal({ offer, onConfirm, onClose }) {
  const name = offer.editingBy?.name || offer.createdByName || 'Outro administrador'
  // Stopped: the person is not on it anymore, so it is only a matter of going on with it.
  if (stoppedCreating(offer)) return <ConfirmDialog title="Oferta em aberto" subtitle={`${offer.code} · ${upper(offer.service)}`} tone="take-over" icon={<PencilLine size={16} />} confirmLabel="Continuar a oferta" busyLabel="Abrindo..." onConfirm={onConfirm} onClose={onClose}>
    <p><strong>{name}</strong> começou esta oferta e parou de editar {creatingSinceText(lastActive(offer))}. Deseja continuar a criação?</p>
    <p className="offer-creating-note">A oferta passa a aparecer na lista como criada por você.</p>
  </ConfirmDialog>
  return <ConfirmDialog title="Oferta sendo criada" subtitle={`${offer.code} · ${upper(offer.service)}`} tone="take-over" icon={<PencilLine size={16} />} confirmLabel="Editar mesmo assim" busyLabel="Abrindo..." onConfirm={onConfirm} onClose={onClose}>
    <p><strong>{name}</strong> está criando esta oferta agora ({creatingSinceText(creatingSince(offer))}). Deseja editar mesmo assim?</p>
    <p className="offer-creating-note">A oferta passa a aparecer na lista como criada por você.</p>
  </ConfirmDialog>
}

export function DiscardOfferModal({ offer, onConfirm, onClose }) {
  return <ConfirmDialog title="Descartar oferta?" subtitle={`${offer.code} · ${upper(offer.service)}`} tone="discard" icon={<Trash2 size={16} />} confirmLabel="Descartar oferta" busyLabel="Descartando..." onConfirm={onConfirm} onClose={onClose}>
    <p>A oferta e os anexos dela serão apagados. O número {offer.code} não será usado de novo.</p>
    {offer.siteRequest?.preRegisteredClientId != null && <p>O pré-cadastro de <strong>{offer.company}</strong> também será apagado se ninguém o tiver editado.</p>}
  </ConfirmDialog>
}
