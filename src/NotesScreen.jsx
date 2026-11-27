import { useEffect, useMemo, useState } from 'react'
import { useSavedState } from './savedListState.js'
import { CalendarDays, Inbox, List, Lock, NotebookPen, Plus, Search, UsersRound } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { payableRequest } from './payablesApi.js'
import { upper } from './displayCase.js'
import { plain, taskGroup, taskGroups } from '../server/noteRules.js'
import { InviteRow, NoteCard, NoteEditor, TaskRow, answerInvite, linkOpener, sortNotes, sortTasks, useNotes, useNow, useTaskToggle } from './notesShared.jsx'
import NotesCalendar from './NotesCalendar.jsx'
import './payables.css'

// Anotações e Tarefas (menu, below Configurações): the full screen. Tarefas by day (late, today, next days, without a
// date, concluded), Anotações as cards, and the invitations to answer. Each item is personal or shared (the sign with
// the people).
const DONE_SHOWN = 10
const tabs = [['tasks', 'Tarefas'], ['notes', 'Anotações'], ['invites', 'Convites']]
const filters = [['all', 'Todas', null], ['personal', 'Pessoais', Lock], ['shared', 'Compartilhadas', UsersRound]]
const tabKey = 'gmac-notes-tab'
const readTab = () => { try { return tabs.some(([key]) => key === sessionStorage.getItem(tabKey)) ? sessionStorage.getItem(tabKey) : 'tasks' } catch { return 'tasks' } }
// Tarefas as a list (by day) or as a calendar (NotesCalendar.jsx), remembered in the session.
const viewKey = 'gmac-notes-view'
const readView = () => { try { return sessionStorage.getItem(viewKey) === 'calendar' ? 'calendar' : 'list' } catch { return 'list' } }
const matches = (item, search) => !search || plain([item.title, item.text, item.place, item.link, ...(item.checklist || []).map((entry) => entry.text), ...item.participants.map((person) => person.userName)].join(' ')).includes(plain(search))

export default function NotesScreen({ offers = [], orders = [], onSelectOrder, onSelectOffer, ...props }) {
  const notes = useNotes()
  const now = useNow()
  const [tab, setTab] = useState(readTab)
  const [view, setView] = useState(readView)
  const [filter, setFilter] = useSavedState('notes', 'filter', 'all')
  const [search, setSearch] = useSavedState('notes', 'search', '')
  const [editing, setEditing] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [answering, setAnswering] = useState(false)
  const [allDone, setAllDone] = useState(false)
  const [pendingOpen, setPendingOpen] = useState(() => sessionStorage.getItem('gmac-note-open'))
  const changed = (item, text) => { notes.put(item); setMessage(text || ''); setError(''); notes.reload() }
  const { toggle, dialog } = useTaskToggle({ onChanged: changed, onError: setError })
  const openLink = linkOpener({ offers, onSelectOrder, onSelectOffer, onError: setError })
  useEffect(() => { try { sessionStorage.setItem(tabKey, tab) } catch { /* the tab is only a convenience */ } }, [tab])
  useEffect(() => { try { sessionStorage.setItem(viewKey, view) } catch { /* only a convenience */ } }, [view])

  // A notice of the bell opens its item here, also when the screen is already open.
  useEffect(() => {
    sessionStorage.removeItem('gmac-note-open')
    const open = ({ detail }) => { sessionStorage.removeItem('gmac-note-open'); setPendingOpen(detail) }
    window.addEventListener('gmac-note-open', open)
    return () => window.removeEventListener('gmac-note-open', open)
  }, [])
  // The list is read again first, so the item opens with the change the notice is about (a new comment...).
  const [freshFor, setFreshFor] = useState(null)
  useEffect(() => {
    if (!pendingOpen) return undefined
    let alive = true
    notes.reload().finally(() => { if (alive) setFreshFor(pendingOpen) })
    return () => { alive = false }
  }, [pendingOpen, notes.reload])
  useEffect(() => {
    if (!pendingOpen || freshFor !== pendingOpen || !notes.data) return
    const item = notes.data.items.find((row) => row.id === pendingOpen)
    if (item) { setTab(item.kind === 'task' ? 'tasks' : 'notes'); setEditing({ kind: item.kind, item }) }
    else if (notes.data.invites.some((row) => row.id === pendingOpen)) setTab('invites')
    else setError('Esta anotação ou tarefa não existe mais ou não está mais compartilhada com você.')
    setPendingOpen(null); setFreshFor(null)
  }, [pendingOpen, freshFor, notes.data])

  const items = notes.data?.items || []
  const invites = notes.data?.invites || []
  const visible = useMemo(() => items.filter((item) => (filter === 'all' || (filter === 'shared') === Boolean(item.shared)) && matches(item, search)), [items, filter, search])
  const tasks = visible.filter((item) => item.kind === 'task')
  const cards = sortNotes(visible.filter((item) => item.kind === 'note'))
  const groups = taskGroups.map(([key, label]) => {
    const rows = sortTasks(tasks.filter((item) => taskGroup(item, item.done, now) === key))
    return [key, label, key === 'done' ? rows.sort((left, right) => Date.parse(right.completedAt || right.me?.doneAt || right.updatedAt) - Date.parse(left.completedAt || left.me?.doneAt || left.updatedAt)) : rows]
  }).filter(([, , rows]) => rows.length)
  const counts = { tasks: items.filter((item) => item.kind === 'task' && !item.done).length, notes: items.filter((item) => item.kind === 'note').length, invites: invites.length }

  async function answer(item, accept) {
    setAnswering(true); setError('')
    try {
      const saved = await answerInvite(item, accept)
      if (saved) changed(saved, `Convite aceito. ${saved.kind === 'task' ? 'A tarefa' : 'A anotação'} agora está na sua lista.`)
      else { notes.drop(item.id); setMessage('Convite recusado. Quem convidou foi avisado.'); notes.reload() }
    } catch (caught) { setError(caught.message) } finally { setAnswering(false) }
  }
  async function check(item, entry, done) {
    try { changed((await payableRequest(`/notes/${item.id}/checklist/${entry.id}`, 'POST', { done })).item) } catch (caught) { setError(caught.message) }
  }
  const open = (item) => setEditing({ kind: item.kind, item })
  const create = (kind, draft) => { setMessage(''); setEditing({ kind, draft }) }

  return <AdminWorkspace {...props} title="Anotações e Tarefas">
    <div className="notes-screen">
      <div className="notes-screen-intro">
        <p className="payable-muted">Anotações avulsas e tarefas com lembrete pelo sininho e por e-mail. Cada uma pode ser pessoal ou compartilhada com outras pessoas do portal.</p>
        <div className="notes-actions"><button className="admin-tool-button" type="button" onClick={() => create('note')}><Plus size={16} aria-hidden="true" />Nova anotação</button><button className="admin-tool-button admin-tool-button--primary" type="button" onClick={() => create('task')}><Plus size={16} aria-hidden="true" />Nova tarefa</button></div>
      </div>
      <div className="notes-toolbar">
        <div className="payable-status-filters notes-tabs" role="group" aria-label="Mostrar">{tabs.map(([key, label]) => <button key={key} className="admin-tool-button" type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}<span className={key === 'invites' && counts.invites ? 'notes-count--alert' : undefined}>{counts[key]}</span></button>)}</div>
        {tab !== 'invites' && <div className="notes-filters">
          {tab === 'tasks' && <div className="notes-view-toggle" role="group" aria-label="Ver tarefas em">{[['list', 'Lista', List], ['calendar', 'Calendário', CalendarDays]].map(([key, label, Icon]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}><Icon size={15} aria-hidden="true" />{label}</button>)}</div>}
          <div className="notes-chips" role="group" aria-label="Filtrar">{filters.map(([key, label, Icon]) => <button key={key} type="button" className="notes-chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>{Icon && <Icon size={14} aria-hidden="true" />}{label}</button>)}</div>
          <label className="payable-search notes-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Buscar anotações e tarefas" placeholder="Buscar" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>}
      </div>
      {message && <p className="admin-tool-success" role="status">{message}</p>}
      {(error || notes.error) && <p className="admin-tool-error" role="alert">{error || notes.error}</p>}
      {!notes.data ? !notes.error && <p>Carregando...</p> : tab === 'tasks' && view === 'calendar' ? <NotesCalendar tasks={tasks} now={now} onOpen={open} onToggle={toggle} onOpenLink={openLink} onCreate={(draft) => create('task', draft)} onSaved={changed} onError={setError} onReload={notes.reload} />
        : tab === 'tasks' ? (groups.length ? groups.map(([key, label, rows]) => <section key={key} className={`notes-group notes-group--${key}`} aria-label={label}>
        <h2>{label}<span>{rows.length}</span></h2>
        <div className="notes-tasks">{(key === 'done' && !allDone ? rows.slice(0, DONE_SHOWN) : rows).map((item) => <TaskRow key={item.id} item={item} now={now} onOpen={open} onToggle={toggle} onOpenLink={openLink} />)}</div>
        {key === 'done' && rows.length > DONE_SHOWN && <button className="admin-tool-button notes-more" type="button" onClick={() => setAllDone((value) => !value)}>{allDone ? 'Mostrar só as últimas' : `Ver todas as concluídas (${rows.length})`}</button>}
      </section>) : <Empty icon={NotebookPen} text={items.some((item) => item.kind === 'task') ? 'Nenhuma tarefa com este filtro.' : 'Nenhuma tarefa ainda. Crie uma em “Nova tarefa”.'} />)
        : tab === 'notes' ? (cards.length ? <div className="notes-cards">{cards.map((item) => <NoteCard key={item.id} item={item} onOpen={open} onCheck={check} onOpenLink={openLink} />)}</div> : <Empty icon={NotebookPen} text={items.some((item) => item.kind === 'note') ? 'Nenhuma anotação com este filtro.' : 'Nenhuma anotação ainda. Crie uma em “Nova anotação”.'} />)
        : (invites.length ? <div className="notes-tasks">{invites.map((item) => <InviteRow key={item.id} item={item} now={now} busy={answering} onAnswer={answer} />)}</div> : <Empty icon={Inbox} text="Nenhum convite esperando resposta." />)}
      {tab !== 'invites' && invites.length > 0 && <p className="notes-invites-hint"><button className="account-release-link" type="button" onClick={() => setTab('invites')}>{invites.length === 1 ? `1 convite de ${upper(invites[0].ownerName)} esperando resposta` : `${invites.length} convites esperando resposta`}</button></p>}
    </div>
    {editing && <NoteEditor key={editing.item?.id || `new-${editing.kind}`} kind={editing.kind} item={editing.item} draft={editing.draft} offers={offers} orders={orders} onClose={() => setEditing(null)} onSaved={(item, text) => { setEditing(null); changed(item, text); setTab(item.kind === 'task' ? 'tasks' : 'notes') }} onRemoved={(id, text) => { setEditing(null); notes.drop(id); setMessage(text); notes.reload() }} onConvert={(draft) => create('task', draft)} />}
    {dialog}
  </AdminWorkspace>
}

function Empty({ icon: Icon, text }) {
  return <div className="notes-empty"><Icon size={26} strokeWidth={1.5} aria-hidden="true" /><p>{text}</p></div>
}
