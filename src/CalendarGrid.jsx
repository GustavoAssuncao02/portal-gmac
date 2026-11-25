import { useState } from 'react'
import { calendarWeekdays, dayTitle } from './calendarDays.js'
import './calendar.css'

const DRAG_TYPE = 'application/x-gmac-calendar'

// A month (or a week) of days, from Sunday, with what falls on each day: up to `limit` chips and then "+N mais"; on
// phones only colored dots. `entriesFor(day)` gives [{ key, label, time, title, tone, muted, drag, onOpen }]: a chip with
// `drag` can be dropped on another day (`onDrop(drag, day)`). A click on a day (or on "+N mais") calls `onSelectDay`.
// `summaryFor(day)` adds a short line at the foot of the day (the quantity to deliver...).
export function CalendarGrid({ days, month, today, selected, entriesFor, summaryFor, limit = 3, words = ['item', 'itens'], onSelectDay, onDrop, label, className = '' }) {
  const [over, setOver] = useState(null)
  const accepts = (event) => event.dataTransfer.types.includes(DRAG_TYPE)
  return <div className={`calendar-grid${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
    {calendarWeekdays.map((name) => <span key={name} className="calendar-weekday" aria-hidden="true">{name}</span>)}
    {days.map((day, index) => {
      const entries = entriesFor(day)
      const shown = entries.slice(0, limit), rest = entries.length - shown.length
      const summary = summaryFor?.(day)
      const state = [month && day.slice(0, 7) !== month && 'other', day === today && 'today', day === selected && 'selected', over === day && 'over', day < today && 'past'].filter(Boolean)
      return <div key={day} data-day={day} className={['calendar-day', ...state.map((name) => `calendar-day--${name}`)].join(' ')} onClick={() => onSelectDay?.(day)}
        onDragOver={onDrop ? (event) => { if (!accepts(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(day) } : undefined}
        onDragLeave={onDrop ? (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOver((current) => current === day ? null : current) } : undefined}
        onDrop={onDrop ? (event) => { if (!accepts(event)) return; event.preventDefault(); setOver(null); onDrop(event.dataTransfer.getData(DRAG_TYPE), day) } : undefined}>
        <div className="calendar-day-head">
          <button type="button" className="calendar-day-number" aria-pressed={day === selected} aria-label={`${dayTitle(day)}${day === today ? ' (hoje)' : ''}: ${entries.length ? `${entries.length} ${entries.length === 1 ? words[0] : words[1]}` : `nenhum${words[0].endsWith('a') ? 'a' : ''} ${words[0]}`}`} onClick={(event) => { event.stopPropagation(); onSelectDay?.(day) }}>
            <span className="calendar-day-name" aria-hidden="true">{calendarWeekdays[index % 7]}</span>{Number(day.slice(8))}
          </button>
          {entries.length > 0 && <span className="calendar-day-count" aria-hidden="true">{entries.length}</span>}
        </div>
        {shown.length > 0 && <div className="calendar-chips">{shown.map((entry) => <button key={entry.key} type="button" className={`calendar-chip calendar-chip--${entry.tone || 'default'}${entry.muted ? ' calendar-chip--muted' : ''}`} title={entry.title} draggable={Boolean(entry.drag)}
          onDragStart={entry.drag ? (event) => { event.stopPropagation(); event.dataTransfer.setData(DRAG_TYPE, entry.drag); event.dataTransfer.setData('text/plain', entry.title || entry.label); event.dataTransfer.effectAllowed = 'move' } : undefined}
          onClick={(event) => { event.stopPropagation(); entry.onOpen?.() }}>{entry.time && <b>{entry.time}</b>}<span>{entry.label}</span></button>)}
          {rest > 0 && <button type="button" className="calendar-more" onClick={(event) => { event.stopPropagation(); onSelectDay?.(day) }}>+{rest} mais</button>}
        </div>}
        {summary && <small className="calendar-day-summary">{summary}</small>}
        {entries.length > 0 && <span className="calendar-dots" aria-hidden="true">{entries.slice(0, 4).map((entry) => <i key={entry.key} className={`calendar-dot calendar-dot--${entry.tone || 'default'}`} />)}</span>}
      </div>
    })}
  </div>
}
