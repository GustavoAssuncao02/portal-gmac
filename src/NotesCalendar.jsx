import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Repeat } from 'lucide-react'
import { CalendarGrid } from './CalendarGrid.jsx'
import { dayTitle, monthDays, monthTitle, shiftDay, shiftMonth, weekOf, weekTitle } from './calendarDays.js'
import { PayableModal } from './PayableModal.jsx'
import { payableRequest } from './payablesApi.js'
import { upper } from './displayCase.js'
import { bahiaDay, dateLabel, isLate, labelOf, occurrencesBetween, taskRepeats } from '../server/noteRules.js'
import { TaskRow, sortTasks } from './notesShared.jsx'

const modeKey = 'gmac-notes-calendar-mode'
const readMode = () => { try { return sessionStorage.getItem(modeKey) === 'week' ? 'week' : 'month' } catch { return 'month' } }
const saveMode = (mode) => { try { sessionStorage.setItem(modeKey, mode) } catch { /* only a convenience */ } }
const UNDATED = 'sem-data'
// The other people who accepted a shared task: moving its day changes it for them too.
const othersIn = (item) => item.participants.filter((person) => person.status === 'accepted' && String(person.userId) !== String(item.me?.userId))

// Tarefas › Calendário (2026-11-24): the tasks on their days, the month or the week from Sunday. A task is moved by
// dragging it to another day (or to "Sem data"): it moves at once and the server confirms behind; a shared task asks
// first, since the day changes for everybody. If the server refuses, the task goes back and the reason shows. The next
// days of a repeated task show lighter; a click on a day lists its tasks below, with "Nova tarefa neste dia".
export default function NotesCalendar({ tasks, now, onOpen, onToggle, onOpenLink, onCreate, onSaved, onError, onReload }) {
  const today = bahiaDay(now)
  const [mode, setMode] = useState(readMode)
  const [anchor, setAnchor] = useState(today)
  const [selected, setSelected] = useState(today)
  const [showDone, setShowDone] = useState(true)
  const [moves, setMoves] = useState({})
  const [asking, setAsking] = useState(null)
  const days = mode === 'week' ? weekOf(anchor) : monthDays(anchor.slice(0, 7))
  const from = days[0], to = days.at(-1)
  // What is on the screen: a task dragged and not confirmed yet is already on its new day.
  const shown = useMemo(() => tasks.map((item) => moves[item.id] ? { ...item, ...moves[item.id] } : item).filter((item) => showDone || !item.done), [tasks, moves, showDone])
  const byDay = useMemo(() => {
    const map = new Map()
    const add = (day, item, projected) => map.set(day, [...(map.get(day) || []), { item, projected, day }])
    for (const item of sortTasks(shown)) {
      if (!item.dueDate) continue
      if (item.dueDate >= from && item.dueDate <= to) add(item.dueDate, item, false)
      if (!item.done) for (const day of occurrencesBetween(item, from, to)) add(day, item, true)
    }
    // Open first (by time), the concluded at the end of the day.
    for (const list of map.values()) list.sort((left, right) => Number(left.item.done) - Number(right.item.done) || (left.item.dueTime || '99').localeCompare(right.item.dueTime || '99'))
    return map
  }, [shown, from, to])
  const undated = sortTasks(shown.filter((item) => !item.dueDate && !item.done))
  const selectedList = selected ? byDay.get(selected) || (selected >= from && selected <= to ? [] : listOf(shown, selected)) : []

  const go = (step) => setAnchor((current) => mode === 'week' ? shiftDay(current, step * 7) : `${shiftMonth(current.slice(0, 7), step)}-01`)
  const pickMode = (value) => { setMode(value); saveMode(value); setAnchor(selected || today) }
  const entry = ({ item, projected, day }) => ({
    key: `${item.id}:${day}`, time: item.dueTime, label: item.title,
    title: `${item.title}${item.dueTime ? ` · ${item.dueTime}` : ''}${projected ? ` · repetição (${labelOf(taskRepeats, item.repeat).toLowerCase()})` : ''}${item.shared ? ' · compartilhada' : ''}${item.done ? ' · concluída' : ''}`,
    tone: projected ? 'projected' : !item.done && isLate(item, now) ? 'late' : 'default', muted: item.done && !projected,
    drag: !projected && !item.done && !moves[item.id] ? item.id : undefined,
    onOpen: () => onOpen(item),
  })

  // Dropped on a day (or on Sem data): a shared task asks first; then it moves at once.
  function drop(id, day) {
    const item = shown.find((row) => row.id === id)
    const dueDate = day === UNDATED ? '' : day
    if (!item || item.done || moves[id] || item.dueDate === dueDate) return
    if (!dueDate && item.repeat !== 'none') return onError('Uma tarefa que se repete precisa de data. Para tirar a data, tire antes a repetição.')
    if (othersIn(item).length) return setAsking({ item, dueDate })
    move(item, dueDate)
  }
  async function move(item, dueDate) {
    const original = tasks.find((row) => row.id === item.id) || item
    const change = dueDate ? { dueDate } : { dueDate: '', dueTime: '' }
    setMoves((current) => ({ ...current, [item.id]: change }))
    onError('')
    try {
      const result = await payableRequest(`/notes/${item.id}`, 'PUT', { ...change, baseUpdatedAt: original.updatedAt })
      onSaved(result.item, dueDate ? `“${item.title}” passou para ${dateLabel(dueDate)}.` : `“${item.title}” ficou sem data.`)
    } catch (caught) {
      // Someone else changed it meanwhile (409): their version comes, the task stays where it was.
      onError(`${caught.status === 409 ? `${caught.message.split('.')[0]}.` : caught.message} A tarefa voltou para o dia anterior.`)
      if (caught.status === 409) onReload?.()
    } finally {
      setMoves((current) => { const { [item.id]: _done, ...rest } = current; return rest })
    }
  }

  return <section className="notes-calendar" aria-label="Calendário de tarefas">
    <div className="notes-calendar-bar">
      <div className="notes-calendar-nav"><button type="button" aria-label={mode === 'week' ? 'Semana anterior' : 'Mês anterior'} title="Anterior" onClick={() => go(-1)}><ChevronLeft size={18} aria-hidden="true" /></button><button type="button" className="notes-calendar-today" onClick={() => { setAnchor(today); setSelected(today) }}>Hoje</button><button type="button" aria-label={mode === 'week' ? 'Próxima semana' : 'Próximo mês'} title="Próximo" onClick={() => go(1)}><ChevronRight size={18} aria-hidden="true" /></button></div>
      <strong className="notes-calendar-title">{mode === 'week' ? `Semana de ${weekTitle(anchor)}` : monthTitle(anchor.slice(0, 7))}</strong>
      <label className="notes-calendar-done"><input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />Mostrar concluídas</label>
      <div className="notes-chips" role="group" aria-label="Ver o calendário por">{[['month', 'Mês'], ['week', 'Semana']].map(([value, label]) => <button key={value} type="button" className="notes-chip" aria-pressed={mode === value} onClick={() => pickMode(value)}>{label}</button>)}</div>
    </div>
    <UndatedStrip tasks={undated} entry={entry} onDrop={drop} />
    <CalendarGrid days={days} month={mode === 'month' ? anchor.slice(0, 7) : null} today={today} selected={selected} limit={mode === 'week' ? Infinity : 3} words={['tarefa', 'tarefas']} className={mode === 'week' ? 'calendar-grid--week' : ''} label={mode === 'week' ? `Tarefas da semana de ${weekTitle(anchor)}` : `Tarefas de ${monthTitle(anchor.slice(0, 7))}`}
      entriesFor={(day) => (byDay.get(day) || []).map(entry)} onSelectDay={setSelected} onDrop={drop} />
    {selected && <section className="notes-calendar-day" aria-label={`Tarefas de ${dayTitle(selected)}`}>
      <header><h3>{dayTitle(selected)}{selected === today ? ' · hoje' : ''}</h3><button className="admin-tool-button" type="button" onClick={() => onCreate({ dueDate: selected })}><Plus size={16} aria-hidden="true" />Nova tarefa neste dia</button></header>
      {selectedList.length ? <div className="notes-tasks">{selectedList.map(({ item, projected, day }) => projected
        ? <button key={`${item.id}:${day}`} type="button" className="notes-calendar-projected" onClick={() => onOpen(item)}><Repeat size={14} aria-hidden="true" /><span><strong>{item.title}</strong> · repetição ({labelOf(taskRepeats, item.repeat).toLowerCase()}) · a atual é de {dateLabel(item.dueDate)}</span></button>
        : <TaskRow key={item.id} item={item} now={now} onOpen={onOpen} onToggle={onToggle} onOpenLink={onOpenLink} />)}</div>
        : <p className="notes-empty-line">Nenhuma tarefa neste dia.</p>}
    </section>}
    {asking && <PayableModal title="Mudar o dia da tarefa compartilhada" className="notes-complete-modal" onClose={() => setAsking(null)} footer={<><button className="admin-tool-button" type="button" onClick={() => setAsking(null)}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="button" onClick={() => { const { item, dueDate } = asking; setAsking(null); move(item, dueDate) }}>Mudar para todos</button></>}>
      <p className="payable-muted">“{asking.item.title}” está compartilhada com {othersIn(asking.item).map((person) => upper(person.userName)).join(', ')}. O dia muda para todos ({asking.item.dueDate ? dateLabel(asking.item.dueDate) : 'sem data'} → {asking.dueDate ? dateLabel(asking.dueDate) : 'sem data'}) e cada participante recebe um aviso.</p>
    </PayableModal>}
  </section>
}

// A day outside the weeks on the screen (chosen before changing the month): its tasks, without the repetitions.
const listOf = (tasks, day) => sortTasks(tasks.filter((item) => item.dueDate === day)).map((item) => ({ item, projected: false, day }))

// The open tasks without a day, above the calendar: dragging one to a day gives it that day; a dated task dropped here
// loses its day.
function UndatedStrip({ tasks, entry, onDrop }) {
  const [over, setOver] = useState(false)
  const accepts = (event) => event.dataTransfer.types.includes('application/x-gmac-calendar')
  return <div className={`notes-calendar-undated${over ? ' notes-calendar-undated--over' : ''}`} role="group" aria-label={`Sem data (${tasks.length})`}
    onDragOver={(event) => { if (!accepts(event)) return; event.preventDefault(); setOver(true) }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(false) }}
    onDrop={(event) => { if (!accepts(event)) return; event.preventDefault(); setOver(false); onDrop(event.dataTransfer.getData('application/x-gmac-calendar'), UNDATED) }}>
    <span className="notes-calendar-undated-title">Sem data <b>{tasks.length}</b></span>
    {tasks.length ? tasks.map((item) => { const chip = entry({ item, projected: false, day: UNDATED }); return <button key={item.id} type="button" className="calendar-chip calendar-chip--default" title={chip.title} draggable={Boolean(chip.drag)}
      onDragStart={chip.drag ? (event) => { event.dataTransfer.setData('application/x-gmac-calendar', chip.drag); event.dataTransfer.setData('text/plain', item.title); event.dataTransfer.effectAllowed = 'move' } : undefined}
      onClick={chip.onOpen}><span>{item.title}</span></button> }) : <small>Arraste uma tarefa para cá para tirar a data dela.</small>}
  </div>
}
