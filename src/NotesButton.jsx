import { useEffect, useRef, useState } from 'react'
import { Maximize2, NotebookPen, Plus, X } from 'lucide-react'
import { payableRequest } from './payablesApi.js'
import { backdropClose } from './dialogBackdrop.js'
import { TITLE_MAX } from '../server/noteRules.js'
import { InviteRow, NoteCard, NoteEditor, TaskRow, answerInvite, linkOpener, pendingToday, sortNotes, sortTasks, useNotes, useNow, useTaskToggle } from './notesShared.jsx'

// The round button of Anotações e Tarefas in the bottom right corner of every screen of the administrative portal. It
// opens a side panel: a quick annotation, the tasks of today (and the late ones), the latest annotations and the
// invitations, without leaving the screen. Configurações › Anotações e Tarefas turns it off (the menu stays).
export const NOTES_SCREEN = 'Anotações e Tarefas'

export default function NotesButton({ activeNav, ...props }) {
  const [enabled, setEnabled] = useState(null)
  useEffect(() => {
    let alive = true
    const load = () => payableRequest('/account/notifications').then((result) => { if (alive) setEnabled(result.settings.notesButton !== false) }).catch(() => { if (alive) setEnabled((current) => current ?? true) })
    load()
    window.addEventListener('gmac-notification-settings-changed', load)
    return () => { alive = false; window.removeEventListener('gmac-notification-settings-changed', load) }
  }, [])
  if (!enabled || activeNav === NOTES_SCREEN) return null
  return <NotesDock {...props} />
}

const panelTabs = [['today', 'Hoje'], ['notes', 'Anotações'], ['invites', 'Convites']]

function NotesDock({ onNavigate, offers = [], orders = [], onSelectOrder, onSelectOffer }) {
  const notes = useNotes()
  const now = useNow()
  const dialog = useRef(null)
  const trigger = useRef(null)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('today')
  const [quick, setQuick] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const changed = (item, text) => { notes.put(item); setMessage(text || ''); setError(''); notes.reload() }
  const { toggle, dialog: completeDialog } = useTaskToggle({ onChanged: changed, onError: setError })
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }
  const go = (action) => { setOpen(false); action() }
  const openLink = linkOpener({ offers, onSelectOrder: (code) => go(() => onSelectOrder?.(code)), onSelectOffer: (id) => go(() => onSelectOffer?.(id)), onError: setError })
  useEffect(() => {
    const element = dialog.current
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  const items = notes.data?.items || []
  const invites = notes.data?.invites || []
  const today = sortTasks(pendingToday(items, now))
  const recent = sortNotes(items.filter((item) => item.kind === 'note')).slice(0, 5)
  const count = today.length + invites.length

  async function saveQuick(event) {
    event.preventDefault()
    const text = quick.trim()
    if (!text || busy) return
    setBusy(true); setError('')
    try {
      const short = text.length <= 80 && !text.includes('\n')
      changed((await payableRequest('/notes', 'POST', { kind: 'note', title: short ? text : '', text: short ? '' : text.slice(0, 5000) })).item, 'Anotação salva.')
      setQuick(''); setTab('notes')
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  async function answer(item, accept) {
    setBusy(true); setError('')
    try {
      const saved = await answerInvite(item, accept)
      if (saved) changed(saved, 'Convite aceito.')
      else { notes.drop(item.id); setMessage('Convite recusado.'); notes.reload() }
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  async function check(item, entry, done) {
    try { changed((await payableRequest(`/notes/${item.id}/checklist/${entry.id}`, 'POST', { done })).item) } catch (caught) { setError(caught.message) }
  }
  const openItem = (item) => setEditing({ kind: item.kind, item })

  return <>
    <button ref={trigger} className="notes-fab" type="button" title="Anotações e Tarefas" aria-label={`Abrir Anotações e Tarefas${count ? ` (${count} ${count === 1 ? 'pendência' : 'pendências'})` : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setMessage(''); setError(''); setOpen(true) }}>
      <NotebookPen size={22} aria-hidden="true" />{count > 0 && <span className="notes-fab-count">{count > 99 ? '99+' : count}</span>}
    </button>
    <dialog ref={dialog} className="notes-drawer" aria-labelledby="notes-drawer-title" onCancel={(event) => { event.preventDefault(); close() }} onClose={() => setOpen(false)} {...backdropClose(close)}>
      {open && <>
        <header><h2 id="notes-drawer-title">Anotações e Tarefas</h2>
          <button className="payable-icon" type="button" title="Abrir a tela completa" aria-label="Abrir a tela completa" onClick={() => go(() => onNavigate(NOTES_SCREEN))}><Maximize2 size={18} aria-hidden="true" /></button>
          <button className="payable-icon" type="button" title="Fechar" aria-label="Fechar Anotações e Tarefas" onClick={close}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="notes-drawer-body">
          <form className="notes-quick" onSubmit={saveQuick}><input aria-label="Anotação rápida" placeholder="Anotação rápida… (Enter para salvar)" value={quick} maxLength={TITLE_MAX * 40} disabled={busy} onChange={(event) => setQuick(event.target.value)} /><button className="admin-tool-button admin-tool-button--primary" type="submit" aria-label="Salvar anotação" title="Salvar anotação" disabled={busy || !quick.trim()}><Plus size={18} aria-hidden="true" /></button></form>
          <div className="payable-status-filters notes-tabs" role="group" aria-label="Mostrar">{panelTabs.map(([key, label]) => <button key={key} className="admin-tool-button" type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}<span className={key === 'invites' && invites.length ? 'notes-count--alert' : undefined}>{key === 'today' ? today.length : key === 'notes' ? items.filter((item) => item.kind === 'note').length : invites.length}</span></button>)}</div>
          {message && <p className="admin-tool-success" role="status">{message}</p>}
          {(error || notes.error) && <p className="admin-tool-error" role="alert">{error || notes.error}</p>}
          {!notes.data ? !notes.error && <p>Carregando...</p> : tab === 'today' ? (today.length ? <div className="notes-tasks">{today.map((item) => <TaskRow key={item.id} item={item} now={now} onOpen={openItem} onToggle={toggle} onOpenLink={openLink} />)}</div> : <p className="notes-empty-line">Nenhuma tarefa atrasada ou para hoje.</p>)
            : tab === 'notes' ? (recent.length ? <div className="notes-cards notes-cards--column">{recent.map((item) => <NoteCard key={item.id} item={item} onOpen={openItem} onCheck={check} onOpenLink={openLink} />)}</div> : <p className="notes-empty-line">Nenhuma anotação ainda.</p>)
            : (invites.length ? <div className="notes-tasks">{invites.map((item) => <InviteRow key={item.id} item={item} now={now} busy={busy} onAnswer={answer} />)}</div> : <p className="notes-empty-line">Nenhum convite esperando resposta.</p>)}
          <div className="notes-drawer-actions"><button className="admin-tool-button" type="button" onClick={() => setEditing({ kind: 'task' })}><Plus size={16} aria-hidden="true" />Nova tarefa</button><button className="admin-tool-button" type="button" onClick={() => setEditing({ kind: 'note' })}><Plus size={16} aria-hidden="true" />Nova anotação</button><button className="account-release-link" type="button" onClick={() => go(() => onNavigate(NOTES_SCREEN))}>Ver tudo em Anotações e Tarefas</button></div>
        </div>
        {editing && <NoteEditor key={editing.item?.id || `new-${editing.kind}`} kind={editing.kind} item={editing.item} draft={editing.draft} offers={offers} orders={orders} onClose={() => setEditing(null)} onSaved={(item, text) => { setEditing(null); changed(item, text); setTab(item.kind === 'task' ? 'today' : 'notes') }} onRemoved={(id, text) => { setEditing(null); notes.drop(id); setMessage(text); notes.reload() }} onConvert={(draft) => setEditing({ kind: 'task', draft })} />}
        {completeDialog}
      </>}
    </dialog>
  </>
}
