import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { AlarmClock, CalendarDays, Check, Flag, History, Link2, ListChecks, Lock, LogOut, MapPin, MessageSquare, Pin, Plus, Repeat, Save, Send, Trash2, UsersRound, X } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import { payableRequest } from './payablesApi.js'
import { latestOnly, pollWhileVisible } from './polling.js'
import { upper } from './displayCase.js'
import { CHECKLIST_MAX, CHECKLIST_TEXT_MAX, COMMENT_MAX, PLACE_MAX, TEXT_MAX, TITLE_MAX, dateLabel, defaultReminder, dueLabel, labelOf, noteColors, taskGroup, taskPriorities, taskReminders, taskRepeats, taskTypes } from '../server/noteRules.js'
import './notes.css'

// Anotações e Tarefas: the pieces shared by the full screen (NotesScreen.jsx) and the round button in the corner of the
// screens (NotesButton.jsx): the lists, the editor of an annotation or task, the question of how to conclude a shared task.
const same = (left, right) => String(left) === String(right)
const firstName = (name) => upper(String(name || '').trim().split(/\s+/)[0] || '')
const moment = (at) => new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })
const newEntryId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)

// The clock of the lists (late, today): a minute is enough.
export function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer) }, [])
  return now
}

// The person's annotations, tasks and invitations; they come again when someone changes one of them (live updates).
export function useNotes() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const read = useMemo(() => latestOnly(() => payableRequest('/notes')), [])
  const reload = useCallback(() => read((result) => { setData(result); setError('') }).catch((caught) => setError(caught.message)), [read])
  useEffect(() => { reload(); return pollWhileVisible(reload, 60000, ['notes']) }, [reload])
  // An item saved here shows at once, before the list comes again.
  const put = useCallback((item) => setData((current) => current && { ...current, items: [...current.items.filter((row) => row.id !== item.id), item], invites: current.invites.filter((row) => row.id !== item.id) }), [])
  const drop = useCallback((id) => setData((current) => current && { ...current, items: current.items.filter((row) => row.id !== id), invites: current.invites.filter((row) => row.id !== id) }), [])
  return { data, error, reload, put, drop }
}

export function usePeople(active = true) {
  const [people, setPeople] = useState(null)
  useEffect(() => {
    if (!active || people) return undefined
    let alive = true
    payableRequest('/notes/people').then((result) => { if (alive) setPeople(result.items) }).catch(() => { if (alive) setPeople([]) })
    return () => { alive = false }
  }, [active, people])
  return people
}

// Tasks still open for the person that are late or for today: the number on the round button.
export const pendingToday = (items, now) => items.filter((item) => item.kind === 'task' && !item.done && ['late', 'today'].includes(taskGroup(item, false, now)))
// Annotations: pinned first, then the latest changed.
export const sortNotes = (list) => [...list].sort((left, right) => Number(Boolean(right.me?.pinned)) - Number(Boolean(left.me?.pinned)) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
export const sortTasks = (list) => [...list].sort((left, right) => (left.dueDate || '9999').localeCompare(right.dueDate || '9999') || (left.dueTime || '99').localeCompare(right.dueTime || '99') || Date.parse(left.createdAt) - Date.parse(right.createdAt))

const tone = (name) => [...String(name || '')].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 6 + 1
const initials = (name) => { const words = String(name || '').trim().split(/\s+/); return [words[0], words.length > 1 ? words.at(-1) : ''].map((word) => word?.[0] || '').join('').toUpperCase() || '?' }
export function Avatar({ name, large = false }) {
  return <span className={`notes-avatar notes-avatar--${tone(name)}${large ? ' notes-avatar--large' : ''}`} title={upper(name)} aria-hidden="true">{initials(name)}</span>
}

const statusWords = { pending: 'Aguardando resposta', declined: 'Recusou' }
export const participantStatus = (person, task) => person.role === 'owner' && !(task && person.doneAt) ? 'Criou' : task && person.doneAt ? `Concluiu em ${moment(person.doneAt)}` : statusWords[person.status] || 'Aceitou'

// The sign of a shared item: who is in it (and how each answered), on every list.
export function SharedBadge({ item }) {
  if (!item.shared) return null
  const people = item.participants.filter((person) => person.status !== 'declined')
  const names = people.map((person) => `${upper(person.userName)} (${participantStatus(person, item.kind === 'task').toLowerCase()})`).join(', ')
  return <span className="notes-shared" title={`Compartilhada com ${names}`}><UsersRound size={14} aria-hidden="true" /><span>Compartilhada · {people.length}</span><span className="notes-avatar-stack">{people.slice(0, 4).map((person) => <Avatar key={String(person.userId)} name={person.userName} />)}</span></span>
}

function LinkPill({ code, onOpen }) {
  return <button className="notes-pill notes-pill--link" type="button" title={`Abrir ${code}`} onClick={(event) => { event.stopPropagation(); onOpen?.(code) }}><Link2 size={12} aria-hidden="true" />{code}</button>
}

export function TaskRow({ item, now, onOpen, onToggle, onOpenLink }) {
  const group = taskGroup(item, item.done, now)
  // A shared task still open for someone: whoever already did their part (or, for whoever did, who is missing).
  const others = item.shared && !item.completedAt ? item.participants.filter((person) => person.status === 'accepted' && String(person.userId) !== String(item.me?.userId)) : []
  const doneBy = others.filter((person) => person.doneAt).map((person) => firstName(person.userName))
  const missing = others.filter((person) => !person.doneAt).map((person) => firstName(person.userName))
  const progress = item.done && others.length ? `Sua parte concluída${missing.length ? ` · falta ${missing.join(', ')}` : ''}` : doneBy.length ? `Concluída por ${doneBy.join(', ')}` : ''
  const checked = item.checklist?.filter((entry) => entry.done).length || 0
  return <div className={`notes-task${item.done ? ' notes-task--done' : ''}${group === 'late' ? ' notes-task--late' : ''}`}>
    <button className={`notes-check${item.done ? ' notes-check--on' : doneBy.length ? ' notes-check--partial' : ''}`} type="button" role="checkbox" aria-checked={item.done} aria-label={`${item.done ? 'Reabrir' : 'Concluir'} ${item.title}`} title={item.done ? 'Reabrir' : 'Concluir'} onClick={() => onToggle(item)}><Check size={14} strokeWidth={3} aria-hidden="true" /></button>
    <button className="notes-task-body" type="button" onClick={() => onOpen(item)}>
      <strong>{item.title}</strong>
      <span className="notes-meta">
        <span className={group === 'late' ? 'notes-late' : ''}><CalendarDays size={13} aria-hidden="true" />{dueLabel(item, now)}{group === 'late' && ' · atrasada'}</span>
        {item.dueDate && item.me?.reminder && item.me.reminder !== 'none' && !item.done && <span><AlarmClock size={13} aria-hidden="true" />{labelOf(taskReminders, item.me.reminder)}</span>}
        {item.repeat !== 'none' && <span><Repeat size={13} aria-hidden="true" />{labelOf(taskRepeats, item.repeat)}</span>}
        {item.taskType === 'meeting' && <span className="notes-pill notes-pill--meeting">Reunião{item.place ? ` · ${item.place}` : ''}</span>}
        {item.priority === 'high' && <span className="notes-pill notes-pill--high"><Flag size={12} aria-hidden="true" />Prioridade alta</span>}
        {item.checklist?.length > 0 && <span><ListChecks size={13} aria-hidden="true" />{checked}/{item.checklist.length}</span>}
        {progress && <span className="notes-pill notes-pill--done">{progress}</span>}
      </span>
    </button>
    <span className="notes-task-side">{item.link && <LinkPill code={item.link} onOpen={onOpenLink} />}<SharedBadge item={item} /></span>
  </div>
}

export function NoteCard({ item, onOpen, onCheck, onOpenLink }) {
  const shown = item.checklist?.slice(0, 6) || []
  return <article className={`notes-card notes-card--${item.color || 'yellow'}`} onClick={() => onOpen(item)}>
    {item.me?.pinned && <Pin className="notes-card-pin" size={15} aria-label="Fixada" />}
    <button className="notes-card-open" type="button" onClick={(event) => { event.stopPropagation(); onOpen(item) }}>{item.title || <span className="notes-card-untitled">Sem título</span>}</button>
    {item.text && <p>{item.text}</p>}
    {shown.length > 0 && <ul>{shown.map((entry) => <li key={entry.id} className={entry.done ? 'done' : ''}><label onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={entry.done} onChange={(event) => onCheck?.(item, entry, event.target.checked)} /><span>{entry.text}</span></label></li>)}{item.checklist.length > shown.length && <li className="notes-card-more">+{item.checklist.length - shown.length} itens</li>}</ul>}
    <footer>{item.shared && <SharedBadge item={item} />}{item.link && <LinkPill code={item.link} onOpen={onOpenLink} />}<span>{moment(item.updatedAt)}{item.shared && item.updatedByName ? ` · ${firstName(item.updatedByName)}` : ''}</span></footer>
  </article>
}

export function InviteRow({ item, now, onAnswer, busy }) {
  const owner = item.participants.find((person) => person.role === 'owner')
  return <div className="notes-invite">
    <Avatar name={owner?.userName} large />
    <div><strong>{upper(owner?.userName)}</strong> convidou você para {item.kind === 'task' ? 'a tarefa' : 'a anotação'} <strong>“{item.title || item.text?.slice(0, 60)}”</strong>
      <small>{item.kind === 'task' ? `${item.taskType === 'meeting' ? 'Reunião · ' : ''}${dueLabel(item, now)}` : 'Anotação compartilhada'} · {item.participants.filter((person) => person.status !== 'declined').length} {item.participants.length === 1 ? 'pessoa' : 'pessoas'}</small></div>
    <div className="notes-invite-actions"><button className="admin-tool-button" type="button" disabled={busy} onClick={() => onAnswer(item, false)}>Recusar</button><button className="admin-tool-button admin-tool-button--primary" type="button" disabled={busy} onClick={() => onAnswer(item, true)}>Aceitar</button></div>
  </div>
}

export function CompleteDialog({ item, onClose, onChoose }) {
  const names = item.participants.filter((person) => person.status === 'accepted' && !same(person.userId, item.me?.userId)).map((person) => upper(person.userName))
  return <PayableModal title="Concluir tarefa compartilhada" className="notes-complete-modal" onClose={onClose} footer={<button className="admin-tool-button" type="button" onClick={onClose}>Cancelar</button>}>
    <p className="payable-muted">“{item.title}” está compartilhada com {names.join(', ')}. Como você quer concluir?</p>
    <div className="notes-choice">
      <button type="button" onClick={() => onChoose('me')}><strong>Concluir só para mim</strong><span>Os outros continuam com a tarefa em aberto e veem que você concluiu a sua parte.</span></button>
      <button type="button" onClick={() => onChoose('all')}><strong>Concluir para todos</strong><span>A tarefa fica concluída para todos, e cada participante recebe um aviso.</span></button>
    </div>
  </PayableModal>
}

// The checkbox of a task: concluded or reopened; a shared task asks first how to conclude.
export function useTaskToggle({ onChanged, onError }) {
  const [asking, setAsking] = useState(null)
  async function complete(item, scope) {
    try {
      const result = await payableRequest(`/notes/${item.id}/complete`, 'POST', { scope })
      onChanged(result.item, result.next ? `Concluída. A tarefa se repete: a próxima fica para ${dateLabel(result.next)}.` : scope === 'me' && item.shared ? 'Concluída para você. Os outros veem que você concluiu a sua parte.' : item.shared ? 'Concluída para todos. Os participantes foram avisados.' : 'Tarefa concluída.')
    } catch (caught) { onError(caught.message) }
  }
  async function toggle(item) {
    if (item.done) {
      try { onChanged((await payableRequest(`/notes/${item.id}/reopen`, 'POST', {})).item, 'Tarefa reaberta.') } catch (caught) { onError(caught.message) }
      return
    }
    if (item.participants.filter((person) => person.status === 'accepted').length > 1) setAsking(item)
    else complete(item, 'me')
  }
  const dialog = asking && <CompleteDialog item={asking} onClose={() => setAsking(null)} onChoose={(scope) => { const chosen = asking; setAsking(null); complete(chosen, scope) }} />
  return { toggle, dialog }
}

// Accepting or declining an invitation.
export async function answerInvite(item, accept) {
  return (await payableRequest(`/notes/${item.id}/answer`, 'POST', { accept })).item
}

// A link to an OS or offer opens it: the OS screen, or the offer.
export function linkOpener({ offers = [], onSelectOrder, onSelectOffer, onError }) {
  return (code) => {
    if (code.startsWith('OS')) return onSelectOrder?.(code)
    const offer = offers.find((row) => row.code === code)
    if (offer) onSelectOffer?.(offer.id)
    else onError?.(`A oferta ${code} não está mais na lista de ofertas.`)
  }
}

const emptyContent = { title: '', text: '', checklist: [], color: 'yellow', link: '', dueDate: '', dueTime: '', taskType: 'task', place: '', priority: 'normal', repeat: 'none' }

// The editor of an annotation or task: new (`draft`) or existing (`item`). Whoever created it chooses with whom it is
// shared; the others see the participants. The comments and the history of the changes come below.
export function NoteEditor({ kind, item, draft, offers = [], orders = [], onClose, onSaved, onRemoved, onConvert }) {
  const listId = useId()
  const own = !item || item.own
  const task = kind === 'task'
  const [current, setCurrent] = useState(item)
  const [form, setForm] = useState(() => ({ ...emptyContent, ...Object.fromEntries(Object.keys(emptyContent).map((key) => [key, (item || draft || {})[key] ?? emptyContent[key]])) }))
  const [reminder, setReminder] = useState(item?.me?.reminder || defaultReminder)
  const [pinned, setPinned] = useState(Boolean(item?.me?.pinned))
  const [shared, setShared] = useState(Boolean(item?.shared))
  const [share, setShare] = useState(() => (item?.participants || []).filter((person) => person.role !== 'owner' && person.status !== 'declined').map((person) => String(person.userId)))
  const [newEntry, setNewEntry] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null)
  const people = usePeople(own)
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }))
  const participants = current?.participants || []
  const statusOf = (id) => participants.find((person) => same(person.userId, id))
  const links = useMemo(() => [...orders.filter((order) => order.code).map((order) => [order.code, [upper(order.service), order.company].filter(Boolean).join(' · ')]), ...offers.filter((offer) => offer.code).map((offer) => [offer.code, [offer.service, offer.company].filter(Boolean).join(' · ')])], [offers, orders])

  function addEntry() {
    const text = newEntry.trim().slice(0, CHECKLIST_TEXT_MAX)
    if (!text || form.checklist.length >= CHECKLIST_MAX) return
    set('checklist', [...form.checklist, { id: newEntryId(), text, done: false }]); setNewEntry('')
  }
  async function save(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const content = { ...form, ...(task ? {} : { dueDate: '', dueTime: '', repeat: 'none' }) }
      const body = { ...content, reminder, pinned, ...(own ? { share: shared ? share : [] } : {}) }
      const result = current ? await payableRequest(`/notes/${current.id}`, 'PUT', { ...body, baseUpdatedAt: current.updatedAt }) : await payableRequest('/notes', 'POST', { kind, ...body })
      const invited = shared ? share.filter((id) => !statusOf(id) || statusOf(id).status === 'declined') : []
      const names = invited.map((id) => upper(people?.find((person) => same(person.id, id))?.name || '')).filter(Boolean)
      onSaved(result.item, names.length ? `Salvo. Convite enviado para ${names.join(', ')}.` : 'Salvo.')
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  async function sendComment() {
    const text = comment.trim()
    if (!text || busy) return
    setBusy(true); setError('')
    try { const result = await payableRequest(`/notes/${current.id}/comments`, 'POST', { text }); setCurrent(result.item); setComment('') } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  async function remove() {
    setBusy(true); setError('')
    try {
      if (confirm === 'delete') await payableRequest(`/notes/${current.id}`, 'DELETE')
      else await payableRequest(`/notes/${current.id}/leave`, 'POST', {})
      onRemoved(current.id, confirm === 'delete' ? (task ? 'Tarefa excluída.' : 'Anotação excluída.') : `Você saiu ${task ? 'da tarefa' : 'da anotação'}.`)
    } catch (caught) { setError(caught.message); setConfirm(null) } finally { setBusy(false) }
  }

  const title = current ? (task ? (form.taskType === 'meeting' ? 'Reunião' : 'Tarefa') : 'Anotação') : task ? 'Nova tarefa' : 'Nova anotação'
  const removable = current && (current.own ? 'delete' : 'leave')
  const footer = <>
    {removable && <button className="admin-tool-button notes-danger" type="button" disabled={busy} onClick={() => setConfirm(removable)}>{removable === 'delete' ? <Trash2 size={16} aria-hidden="true" /> : <LogOut size={16} aria-hidden="true" />}{removable === 'delete' ? 'Excluir' : task ? 'Sair da tarefa' : 'Sair da anotação'}</button>}
    {current && !task && onConvert && <button className="admin-tool-button" type="button" disabled={busy} onClick={() => onConvert({ title: form.title || form.text.split('\n')[0].slice(0, TITLE_MAX), text: form.title ? form.text : form.text.split('\n').slice(1).join('\n'), checklist: form.checklist.map((entry) => ({ ...entry, id: newEntryId() })), link: form.link })}>Transformar em tarefa</button>}
    <span className="notes-footer-space" />
    <button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button>
    <button className="admin-tool-button admin-tool-button--primary" type="submit" form={`${listId}-form`} disabled={busy}><Save size={16} aria-hidden="true" />{busy ? 'Salvando...' : current ? 'Salvar' : task ? (shared && share.length ? 'Criar e enviar convites' : 'Criar tarefa') : shared && share.length ? 'Salvar e enviar convites' : 'Salvar anotação'}</button>
  </>
  return <PayableModal title={title} wide className="notes-editor-modal" busy={busy} onClose={onClose} footer={footer}>
    <form id={`${listId}-form`} className="notes-editor" onSubmit={save}>
      {current && <p className="payable-muted notes-editor-origin">{current.own ? 'Você criou' : `${upper(current.ownerName)} criou`} em {moment(current.createdAt)}{current.updatedById && current.updatedAt !== current.createdAt ? ` · alterada por ${upper(current.updatedByName)} em ${moment(current.updatedAt)}` : ''}</p>}
      <div className="notes-fields">
        <label className="notes-field--full">Título<input value={form.title} maxLength={TITLE_MAX} required={task} autoFocus={!current} placeholder={task ? 'Ex.: Reunião com a produção' : 'Ex.: Ligar para o fornecedor'} onChange={(event) => set('title', event.target.value)} /></label>
        {task && <>
          <label>Tipo<select value={form.taskType} onChange={(event) => set('taskType', event.target.value)}>{taskTypes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Prioridade<select value={form.priority} onChange={(event) => set('priority', event.target.value)}>{taskPriorities.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Data<input type="date" value={form.dueDate} onChange={(event) => { set('dueDate', event.target.value); if (!event.target.value) setForm((previous) => ({ ...previous, dueDate: '', dueTime: '', repeat: 'none' })) }} /></label>
          <label>Hora<input type="time" value={form.dueTime} disabled={!form.dueDate} onChange={(event) => set('dueTime', event.target.value)} /></label>
          {form.taskType === 'meeting' && <label className="notes-field--full">Local ou link da reunião<input value={form.place} maxLength={PLACE_MAX} placeholder="Ex.: Sala de reunião da fábrica" onChange={(event) => set('place', event.target.value)} /></label>}
          <label>Meu lembrete<select value={reminder} onChange={(event) => setReminder(event.target.value)}>{taskReminders.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><small className="payable-hint">{form.dueTime ? 'No sininho e por e-mail. Cada participante escolhe o seu.' : 'Sem hora, conta a partir das 08:00 do dia.'}</small></label>
          <label>Repetir<select value={form.repeat} disabled={!form.dueDate} onChange={(event) => set('repeat', event.target.value)}>{taskRepeats.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        </>}
        {!task && <label>Cor<select value={form.color} onChange={(event) => set('color', event.target.value)}>{noteColors.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
        <label>Vincular a uma OS ou oferta<input value={form.link} list={`${listId}-links`} maxLength={20} placeholder="Ex.: OS-2026-0041" onChange={(event) => set('link', event.target.value.toUpperCase())} /><datalist id={`${listId}-links`}>{links.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</datalist></label>
        {!task && <label className="notes-pin-field"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} /><span><Pin size={14} aria-hidden="true" />Fixar no topo (só para você)</span></label>}
        <label className="notes-field--full">{task ? 'Descrição' : 'Texto'}<textarea value={form.text} maxLength={TEXT_MAX} rows={task ? 3 : 5} onChange={(event) => set('text', event.target.value)} /></label>
      </div>

      <section className="notes-checklist-editor" aria-label={task ? 'Subitens' : 'Lista'}>
        <h3>{task ? 'Subitens' : 'Lista'}</h3>
        {form.checklist.length > 0 && <ul>{form.checklist.map((entry, index) => <li key={entry.id}>
          <input type="checkbox" aria-label={`Feito: ${entry.text}`} checked={entry.done} onChange={(event) => set('checklist', form.checklist.map((row, position) => position === index ? { ...row, done: event.target.checked } : row))} />
          <input aria-label={`Item ${index + 1}`} value={entry.text} maxLength={CHECKLIST_TEXT_MAX} onChange={(event) => set('checklist', form.checklist.map((row, position) => position === index ? { ...row, text: event.target.value } : row))} />
          <button className="payable-icon" type="button" aria-label={`Remover ${entry.text}`} title="Remover" onClick={() => set('checklist', form.checklist.filter((_, position) => position !== index))}><X size={16} aria-hidden="true" /></button>
        </li>)}</ul>}
        {form.checklist.length < CHECKLIST_MAX && <div className="notes-checklist-add"><input aria-label={task ? 'Novo subitem' : 'Novo item da lista'} value={newEntry} maxLength={CHECKLIST_TEXT_MAX} placeholder={task ? 'Novo subitem' : 'Novo item da lista'} onChange={(event) => setNewEntry(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addEntry() } }} /><button className="admin-tool-button" type="button" disabled={!newEntry.trim()} onClick={addEntry}><Plus size={16} aria-hidden="true" />Adicionar</button></div>}
      </section>

      <section className="notes-share" aria-label="Compartilhamento">
        <h3>Compartilhamento</h3>
        {own ? <>
          <div className="notes-share-mode" role="radiogroup" aria-label="Pessoal ou compartilhada">
            <button type="button" role="radio" aria-checked={!shared} onClick={() => setShared(false)}><Lock size={15} aria-hidden="true" />Pessoal (só você vê)</button>
            <button type="button" role="radio" aria-checked={shared} onClick={() => setShared(true)}><UsersRound size={15} aria-hidden="true" />Compartilhada</button>
          </div>
          {shared && <>
            {!people ? <p className="payable-muted">Carregando pessoas...</p> : !people.length ? <p className="payable-muted">Ninguém mais tem acesso ao portal administrativo.</p> : <div className="notes-people" role="group" aria-label="Pessoas">{people.map((person) => {
              const status = statusOf(person.id), chosen = share.includes(String(person.id))
              return <button key={String(person.id)} type="button" className="notes-person-chip" aria-pressed={chosen} onClick={() => setShare((list) => chosen ? list.filter((id) => id !== String(person.id)) : [...list, String(person.id)])}><Avatar name={person.name} />{upper(person.name)}{status && status.role !== 'owner' && <small>{participantStatus(status, task)}</small>}</button>
            })}</div>}
            <p className="payable-hint">Cada pessoa recebe um convite no sininho e por e-mail e precisa aceitar. Depois disso {task ? 'a tarefa' : 'a anotação'} é a mesma para todos: o que um muda, os outros veem. Todos editam; só você exclui.</p>
          </>}
          {current?.shared && !shared && <p className="admin-tool-error notes-inline-warning">Ao salvar como pessoal, as outras pessoas saem {task ? 'da tarefa' : 'da anotação'}.</p>}
        </> : <p className="payable-muted">Compartilhada por {upper(current.ownerName)}. Todos editam; só quem criou exclui ou muda com quem está compartilhada.</p>}
        {current?.shared && <ul className="notes-participants">{participants.map((person) => <li key={String(person.userId)}><Avatar name={person.userName} large /><span><strong>{upper(person.userName)}</strong><small>{participantStatus(person, task)}</small></span>{task && person.status === 'accepted' && <span className={`notes-pill ${person.doneAt ? 'notes-pill--done' : 'notes-pill--open'}`}>{person.doneAt ? 'Concluída' : 'Em aberto'}</span>}{person.status === 'pending' && <span className="notes-pill notes-pill--waiting">Aguardando</span>}{person.status === 'declined' && <span className="notes-pill notes-pill--declined">Recusou</span>}</li>)}</ul>}
      </section>

      {current?.shared && <section className="notes-comments" aria-label="Comentários">
        <h3><MessageSquare size={16} aria-hidden="true" />Comentários</h3>
        {(current.comments || []).length ? <ol>{current.comments.map((entry) => <li key={entry.id}><Avatar name={entry.userName} /><div><strong>{upper(entry.userName)}</strong><small>{moment(entry.at)}</small><p>{entry.text}</p></div></li>)}</ol> : <p className="payable-muted">Nenhum comentário ainda.</p>}
        <div className="notes-comment-add"><input aria-label="Escrever comentário" value={comment} maxLength={COMMENT_MAX} placeholder="Escreva para os participantes" onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); sendComment() } }} /><button className="admin-tool-button" type="button" disabled={busy || !comment.trim()} onClick={sendComment}><Send size={16} aria-hidden="true" />Comentar</button></div>
      </section>}

      {current?.history?.length > 0 && <details className="notes-history"><summary><History size={15} aria-hidden="true" />Histórico de alterações ({current.history.length})</summary>
        <ol>{[...current.history].reverse().map((entry) => <li key={entry.id}><time>{moment(entry.at)}</time><span><strong>{upper(entry.userName)}</strong> {entry.text}</span></li>)}</ol>
      </details>}
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </form>
    {confirm && <PayableModal title={confirm === 'delete' ? `Excluir ${task ? 'tarefa' : 'anotação'}` : `Sair ${task ? 'da tarefa' : 'da anotação'}`} busy={busy} onClose={() => setConfirm(null)} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={() => setConfirm(null)}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary admin-tool-button--danger" type="button" disabled={busy} onClick={remove}>{confirm === 'delete' ? 'Excluir' : 'Sair'}</button></>}>
      <p>{confirm === 'delete' ? `“${current.title || 'Sem título'}” será excluída${current.shared ? ' para todos os participantes, que recebem um aviso' : ''}. Isso não pode ser desfeito.` : `“${current.title || 'Sem título'}” some da sua lista. Os outros participantes continuam com ela.`}</p>
    </PayableModal>}
  </PayableModal>
}
