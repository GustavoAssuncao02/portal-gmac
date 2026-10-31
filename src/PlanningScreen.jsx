import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Gauge, ListChecks, Plus, Trash2, Wrench } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import { payableRequest } from './payablesApi.js'
import { pollWhileVisible } from './polling.js'
import { DAY_MS, SLOT_MS, addDays, blockEnd, blockStart, clockTime, dayStart, localDay, operatorQueue, planningSnapshot, resourceKey } from '../server/planningRules.js'
import './adminTools.css'
import './planning.css'

const HOUR_WIDTH = 88
const PX_PER_MINUTE = HOUR_WIDTH / 60
const statusLabels = { planned: 'Planejado', running: 'Em execução', done: 'Concluído', late: 'Atrasado' }
const weekDays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const duration = (minutes) => { const value = Math.max(0, Math.round(minutes)); const hours = Math.floor(value / 60), rest = value % 60; return hours ? `${hours}h${rest ? String(rest).padStart(2, '0') : ''}` : `${rest}min` }
const percent = (value) => `${Math.round(value * 100)}%`
const weekStart = (date) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7))
const longDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const shortDate = (date) => date.split('-').reverse().slice(0, 2).join('/')
const monthLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const slots = Array.from({ length: 96 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, '0')}:${String(index % 4 * 15).padStart(2, '0')}`)
// Minutes of a block (or a real interval) inside one day.
const overlap = (start, end, from) => Math.max(0, Math.min(end, from + DAY_MS) - Math.max(start, from)) / 60000

function rangeOf(view, date) {
  if (view === 'day') return [date, date]
  if (view === 'week') return [weekStart(date), addDays(weekStart(date), 6)]
  const first = `${date.slice(0, 8)}01`, start = weekStart(first)
  return [start, addDays(start, 41)]
}

// The planning of the machines: a calendar (day, week, month) of blocks — one stage of one OS on one machine or labor
// service — read again every 10 seconds, with the real work drawn over it.
export default function PlanningScreen({ Sidebar, WorkspaceTabs, navigationProps }) {
  const [view, setView] = useState('day')
  const [date, setDate] = useState(() => localDay(Date.now()))
  const [sector, setSector] = useState('')
  const [machine, setMachine] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [selectedAt, setSelectedAt] = useState(null)
  const [editing, setEditing] = useState(null)
  const [preview, setPreview] = useState('')
  const [fit, setFit] = useState(null)
  const [from, to] = rangeOf(view, date)
  const request = useRef(0)

  async function refresh() {
    const id = ++request.current
    try {
      const result = await payableRequest(`/planning?from=${from}&to=${to}`)
      if (id !== request.current) return
      setData(result); setError('')
    } catch (caught) { if (id === request.current) setError(caught.message) }
  }
  useEffect(() => {
    setData((current) => current && current.from === from && current.to === to ? current : null)
    refresh()
    return pollWhileVisible(refresh, 10000)
  }, [from, to])
  useEffect(() => { setSelectedAt(null); setFit(null) }, [date, view])

  const today = localDay(data?.now ?? Date.now())
  const now = data?.now ?? Date.now()
  const resources = useMemo(() => (data?.resources || []).filter((item) => (!sector || item.sectors.includes(sector)) && (!machine || resourceKey(item.type, item.id) === machine)), [data, sector, machine])
  const machines = resources.filter((item) => item.type === 'machine')
  const keys = new Set(resources.map((item) => resourceKey(item.type, item.id)))
  const blocks = (data?.blocks || []).filter((block) => keys.has(resourceKey(block.resourceType, block.resourceId)))
  // An OS is listed whole when any of its stages belongs to the sector (by the group of the stage or the sector of its machine).
  const inSector = new Set((data?.backlog || []).filter((row) => !sector || row.group === sector || (data?.resources || []).some((item) => row.suggested && item.type === row.suggested.type && item.id === String(row.suggested.id) && item.sectors.includes(sector))).map((row) => row.orderCode))
  const backlog = (data?.backlog || []).filter((row) => inSector.has(row.orderCode))
  const allSectors = data?.sectors || []
  const move = (days) => setDate(view === 'month' ? addDays(`${date.slice(0, 8)}01`, days > 0 ? 32 : -1).slice(0, 8) + '01' : addDays(date, days * (view === 'week' ? 7 : 1)))
  const openDay = (day) => { setDate(day); setView('day') }

  return <div className="dashboard-shell admin-tools-shell planning-shell"><Sidebar {...navigationProps} /><main className="admin-tools-main planning-main"><WorkspaceTabs {...navigationProps} />
    <header className="planning-heading">
      <div><h1>Planejamento</h1><p>Organize os serviços por máquina e acompanhe a execução ao longo do dia.</p></div>
      <div className="planning-heading-actions">
        <button className="admin-tool-button admin-tool-button--primary" type="button" disabled={!data} onClick={() => setEditing({ plan: {} })}><Plus size={17} aria-hidden="true" />Planejar OS</button></div>
    </header>
    <div className="planning-toolbar">
      <div className="planning-views" role="group" aria-label="Período">{[['day', 'Dia'], ['week', 'Semana'], ['month', 'Mês']].map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}</div>
      <div className="planning-date"><button type="button" aria-label="Anterior" title="Anterior" onClick={() => move(-1)}><ChevronLeft size={18} /></button><input type="date" aria-label="Data" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} /><button type="button" aria-label="Próximo" title="Próximo" onClick={() => move(1)}><ChevronRight size={18} /></button><button type="button" className="planning-today" onClick={() => setDate(localDay(Date.now()))}>Hoje</button></div>
      <strong className="planning-period">{view === 'day' ? longDate(date) : view === 'week' ? `Semana de ${shortDate(from)} a ${shortDate(to)}` : monthLabel(date)}</strong>
      <div className="planning-filters">
        <select aria-label="Setor" value={sector} onChange={(event) => { setSector(event.target.value); setMachine('') }}><option value="">Todos os setores</option>{allSectors.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <select aria-label="Máquina" value={machine} onChange={(event) => setMachine(event.target.value)}><option value="">Todas as máquinas</option>{(data?.resources || []).filter((item) => item.type === 'machine' && (!sector || item.sectors.includes(sector))).map((item) => <option key={item.id} value={resourceKey(item.type, item.id)}>{item.name}</option>)}</select>
      </div>
    </div>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    {!data ? <p className="planning-loading">Carregando planejamento...</p> : <>
      <Indicators view={view} from={from} to={to} date={date} machines={machines} blocks={blocks} now={now} />
      {view === 'day' && <DayAgenda date={date} today={today} now={now} resources={resources} blocks={blocks} actual={data.actual} selectedAt={selectedAt} onSelect={setSelectedAt} onPlan={(fields) => setEditing({ plan: fields })} onEdit={(block) => setEditing({ block })} onMoved={refresh} onError={setError} />}
      {view === 'week' && <WeekTable from={from} machines={machines} blocks={blocks} today={today} onOpen={openDay} />}
      {view === 'month' && <MonthCalendar from={from} month={date.slice(0, 7)} sectors={sector ? [sector] : allSectors} resources={data.resources} blocks={blocks} today={today} onOpen={openDay} />}
      <div className="planning-lower">
        <Backlog rows={backlog} resources={data.resources} fit={fit} onClearFit={() => setFit(null)} onPlan={(item) => setEditing({ plan: { item, resourceKey: fit?.resourceKey, start: fit?.start } })} />
        <div className="planning-side">
          {view === 'day' && <Snapshot date={date} today={today} now={now} selectedAt={selectedAt} onSelect={setSelectedAt} resources={resources} blocks={blocks} actual={data.actual} onFit={setFit} />}
          <OperatorPreview sectors={allSectors} sector={preview || sector || allSectors[0] || ''} onSector={setPreview} resources={data.resources} blocks={data.blocks} now={now} />
        </div>
      </div>
    </>}
    {editing && data && (editing.block
      ? <BlockModal data={data} block={editing.block} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />
      : <OrderPlanModal data={data} initial={editing.plan} date={date} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setFit(null); refresh() }} />)}
  </main></div>
}

function Indicators({ view, from, to, date, machines, blocks, now }) {
  const days = view === 'day' ? [date] : Array.from({ length: Math.round((dayStart(to) - dayStart(from)) / DAY_MS) + 1 }, (_, index) => addDays(from, index))
  const machineKeys = new Set(machines.map((item) => resourceKey(item.type, item.id)))
  const planned = days.reduce((sum, day) => sum + blocks.filter((block) => machineKeys.has(resourceKey(block.resourceType, block.resourceId))).reduce((total, block) => total + overlap(blockStart(block), blockEnd(block), dayStart(day)), 0), 0)
  const capacity = machines.length * days.length * 1440
  const inRange = blocks.filter((block) => blockStart(block) < dayStart(addDays(to, 1)) && blockEnd(block) > dayStart(view === 'day' ? date : from))
  const late = inRange.filter((block) => block.status === 'late')
  return <section className="planning-indicators" aria-label="Indicadores do período">
    <article><Gauge size={22} aria-hidden="true" /><div><span>Ocupação planejada das máquinas</span><strong>{capacity ? percent(planned / capacity) : '—'}</strong><small>{duration(planned)} de {duration(capacity)} · 24 h por dia</small></div></article>
    <article><ListChecks size={22} aria-hidden="true" /><div><span>Blocos planejados</span><strong>{inRange.length}</strong><small>{new Set(inRange.map((block) => block.orderCode)).size} OS</small></div></article>
    <article className="planning-indicator--done"><CheckCircle2 size={22} aria-hidden="true" /><div><span>Concluídos</span><strong>{inRange.filter((block) => block.status === 'done').length} de {inRange.length}</strong><small>{inRange.filter((block) => block.status === 'running').length} em execução agora</small></div></article>
    <article className={late.length ? 'planning-indicator--late' : ''}><AlertTriangle size={22} aria-hidden="true" /><div><span>Atenção</span><strong>{late.length ? `${late.length} ${late.length === 1 ? 'atrasado' : 'atrasados'}` : 'Nada atrasado'}</strong><small>{late.length ? late.slice(0, 2).map((block) => `${block.orderCode} · ${block.stageName}`).join(' · ') : now ? 'Tudo dentro do plano' : ''}</small></div></article>
  </section>
}

// The day of every machine on a 24-hour ruler. A click on the ruler picks a moment (15-minute steps); a click on an
// empty part of a row plans there; a block is moved by dragging it sideways, or opened by a click.
function DayAgenda({ date, today, now, resources, blocks, actual, selectedAt, onSelect, onPlan, onEdit, onMoved, onError }) {
  const scroller = useRef(null)
  const [drag, setDrag] = useState(null)
  const from = dayStart(date)
  useEffect(() => { if (scroller.current && date === today) scroller.current.scrollLeft = Math.max(0, (now - from) / 60000 * PX_PER_MINUTE - 240) }, [date])
  const minuteAt = (event, element) => Math.min(1425, Math.max(0, Math.round((event.clientX - element.getBoundingClientRect().left) / PX_PER_MINUTE / 15) * 15))
  const machines = resources.filter((item) => item.type === 'machine')
  const groups = [...new Set(machines.map((item) => item.sectors[0] || 'Sem setor'))].map((name) => [name, machines.filter((item) => (item.sectors[0] || 'Sem setor') === name)])
  const services = resources.filter((item) => item.type === 'labor-service' && blocks.some((block) => block.resourceType === item.type && String(block.resourceId) === item.id))
  if (services.length) groups.push(['Serviços (hora homem)', services])
  const width = 24 * HOUR_WIDTH
  async function drop(block, minutes) {
    const start = new Date(blockStart(block) + minutes * 60000).toISOString()
    try { await payableRequest(`/planning/blocks/${block.id}`, 'PUT', { orderCode: block.orderCode, stageCode: block.stageCode, resourceType: block.resourceType, resourceId: block.resourceId, start, minutes: block.minutes, quantity: block.quantity }); onError(''); onMoved() } catch (caught) { onError(caught.message) }
  }
  function pointerDown(event, block) {
    if (event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ id: block.id, x: event.clientX, shift: 0, moved: false })
  }
  const pointerMove = (event) => setDrag((current) => current && { ...current, shift: Math.round((event.clientX - current.x) / PX_PER_MINUTE / 15) * 15, moved: current.moved || Math.abs(event.clientX - current.x) > 4 })
  function pointerUp(event, block) {
    event.stopPropagation()
    const current = drag
    setDrag(null)
    if (!current?.moved) return onEdit(block)
    if (current.shift) drop(block, current.shift)
  }
  const nowLeft = date === today ? (now - from) / 60000 * PX_PER_MINUTE : null
  const selectedLeft = selectedAt != null && selectedAt >= from && selectedAt < from + DAY_MS ? (selectedAt - from) / 60000 * PX_PER_MINUTE : null
  return <section className="planning-agenda" aria-labelledby="planning-agenda-title">
    <header><h2 id="planning-agenda-title">Agenda por máquina</h2><p>Planejado × realizado · arraste um bloco para mudar o horário, ou clique num espaço vazio para planejar uma OS nesta máquina.</p>
      <ul className="planning-legend"><li><i className="planning-dot planning-dot--done" />Concluído</li><li><i className="planning-dot planning-dot--running" />Em execução</li><li><i className="planning-dot planning-dot--planned" />Planejado</li><li><i className="planning-dot planning-dot--late" />Atrasado</li><li><i className="planning-dot planning-dot--overrun" />Tempo em atraso</li><li><i className="planning-dot planning-dot--early" />Concluído antes do previsto</li><li><i className="planning-dot planning-dot--actual" />Realizado</li></ul></header>
    <div className="planning-scroll" ref={scroller}>
      <div className="planning-grid" style={{ '--timeline-width': `${width}px`, '--hour-width': `${HOUR_WIDTH}px` }}>
        <div className="planning-corner">Máquina / setor</div>
        <div className="planning-ruler" role="slider" tabIndex={0} aria-label="Horário do dia" aria-valuemin={0} aria-valuemax={1425} aria-valuenow={selectedLeft != null ? Math.round(selectedLeft / PX_PER_MINUTE) : 0} aria-valuetext={selectedAt != null ? clockTime(selectedAt) : 'Nenhum horário escolhido'}
          onClick={(event) => onSelect(from + minuteAt(event, event.currentTarget) * 60000)}
          onKeyDown={(event) => { const step = { ArrowRight: 15, ArrowLeft: -15 }[event.key]; if (!step) return; event.preventDefault(); onSelect(Math.min(from + 1425 * 60000, Math.max(from, (selectedAt ?? Math.floor(now / SLOT_MS) * SLOT_MS) + step * 60000))) }}>
          {Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ left: hour * HOUR_WIDTH }}>{String(hour).padStart(2, '0')}:00</span>)}
          {nowLeft != null && <b className="planning-now-label" style={{ left: nowLeft }}>Agora · {clockTime(now)}</b>}
          {selectedLeft != null && <b className="planning-selected-label" style={{ left: selectedLeft }}>{clockTime(selectedAt)}</b>}
        </div>
        {groups.map(([group, items]) => [<div key={`group-${group}`} className="planning-group"><span>{group}</span></div>, ...items.map((resource) => {
          const own = blocks.filter((block) => block.resourceType === resource.type && String(block.resourceId) === resource.id)
          const planned = own.reduce((sum, block) => sum + overlap(blockStart(block), blockEnd(block), from), 0)
          const real = actual.filter((item) => item.resourceType === resource.type && item.resourceId === resource.id)
          return [<div key={`label-${resource.type}-${resource.id}`} className={`planning-label${resource.maintenance ? ' planning-label--maintenance' : ''}`}>
              <strong>{resource.name}</strong><span>{resource.sectors.map((name) => <em key={name}>{name}</em>)}</span>
              <small>{resource.maintenance ? <><Wrench size={12} aria-hidden="true" /> Em manutenção</> : `${duration(planned)} planejadas · ${percent(planned / 1440)}`}</small></div>,
            <div key={`track-${resource.type}-${resource.id}`} className={`planning-track${resource.maintenance ? ' planning-track--maintenance' : ''}`} aria-label={`Agenda de ${resource.name}`}
              onClick={(event) => onPlan({ resourceKey: resourceKey(resource.type, resource.id), start: from + minuteAt(event, event.currentTarget) * 60000 })}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); const item = JSON.parse(event.dataTransfer.getData('text/plain') || 'null'); if (item) onPlan({ item, resourceKey: resourceKey(resource.type, resource.id), start: from + minuteAt(event, event.currentTarget) * 60000 }) }}>
              {real.map((item) => { const covered = own.some((block) => block.orderCode === item.orderCode && blockStart(block) < item.end && blockEnd(block) > item.start); return <i key={`${item.orderCode}-${item.start}`} className={`planning-actual${covered ? '' : ' planning-actual--outside'}`} style={{ left: (Math.max(item.start, from) - from) / 60000 * PX_PER_MINUTE, width: Math.max(2, overlap(item.start, item.end, from) * PX_PER_MINUTE) }} title={`${covered ? 'Realizado' : 'Fora do planejamento'}: ${item.employeeName} · ${item.orderCode} · ${clockTime(item.start)}–${item.active ? 'agora' : clockTime(item.end)}`} /> })}
              {own.map((block) => {
                const start = Math.max(blockStart(block), from), shift = drag?.id === block.id ? drag.shift : 0
                // Past the planned end, a late block grows a red tail up to now; a stage done before the end marks the
                // unused part of the block. Both show their time on hover, of the mark or of the block.
                const end = blockEnd(block), dayEnd = from + DAY_MS
                const overrun = block.status === 'late' && drag?.id !== block.id ? [Math.max(end, from), Math.min(now, dayEnd)] : null
                const early = block.earlyMinutes > 0 && drag?.id !== block.id ? [Math.max(Date.parse(block.doneAt), start), Math.min(end, dayEnd)] : null
                return [<button key={block.id} type="button" className={`planning-block planning-block--${block.status}${drag?.id === block.id ? ' planning-block--dragging' : ''}`} style={{ left: (start - from) / 60000 * PX_PER_MINUTE + shift * PX_PER_MINUTE, width: Math.max(18, overlap(blockStart(block), blockEnd(block), from) * PX_PER_MINUTE - 2) }}
                  title={`${block.orderCode} · ${block.service} · ${block.stageName}\n${clockTime(blockStart(block))}–${clockTime(blockEnd(block))} (${duration(block.minutes)}) · ${statusLabels[block.status]}${block.delayMinutes ? ` · ${duration(block.delayMinutes)} de atraso` : ''}${block.earlyMinutes ? ` · ${duration(block.earlyMinutes)} antes do previsto` : ''}`}
                  onPointerDown={(event) => pointerDown(event, block)} onPointerMove={drag?.id === block.id ? pointerMove : undefined} onPointerUp={(event) => pointerUp(event, block)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdit(block) } }}>
                  <strong>{block.orderCode} · {block.stageName}</strong><span>{shift ? `→ ${clockTime(blockStart(block) + shift * 60000)}` : `${clockTime(blockStart(block))}–${clockTime(blockEnd(block))}`}{block.urgency === 'emergency' ? ' · Emergência' : ''}{block.status === 'late' && block.delayMinutes > 0 && <b> · {duration(block.delayMinutes)} de atraso</b>}{block.status === 'running' && ` · ${block.progress}%`}</span>
                  {block.status === 'running' && <i className="planning-progress" style={{ width: `${block.progress}%` }} aria-hidden="true" />}
                </button>,
                overrun && overrun[1] > overrun[0] && <span key={`${block.id}-overrun`} className="planning-overrun" style={{ left: (overrun[0] - from) / 60000 * PX_PER_MINUTE - 2, width: (overrun[1] - overrun[0]) / 60000 * PX_PER_MINUTE + 2 }}
                  onClick={(event) => { event.stopPropagation(); onEdit(block) }} aria-hidden="true">
                  <b className="planning-flag">{duration(block.delayMinutes)} de atraso · previsto até {clockTime(end)}</b></span>,
                early && early[1] > early[0] && <span key={`${block.id}-early`} className="planning-early" style={{ left: (early[0] - from) / 60000 * PX_PER_MINUTE, width: Math.max(4, (early[1] - early[0]) / 60000 * PX_PER_MINUTE - 2) }} aria-hidden="true">
                  <b className="planning-flag">Concluído {duration(block.earlyMinutes)} antes do previsto · às {clockTime(Date.parse(block.doneAt))}</b></span>]
              })}
            </div>]
        })])}
        {nowLeft != null && <i className="planning-now" style={{ left: `calc(var(--label-width) + ${nowLeft}px)` }} aria-hidden="true" />}
        {selectedLeft != null && <i className="planning-selected" style={{ left: `calc(var(--label-width) + ${selectedLeft}px)` }} aria-hidden="true" />}
        {!groups.length && <p className="planning-empty">Nenhuma máquina neste filtro.</p>}
      </div>
    </div>
  </section>
}

function WeekTable({ from, machines, blocks, today, onOpen }) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(from, index))
  return <section className="planning-agenda planning-week" aria-labelledby="planning-week-title">
    <header><h2 id="planning-week-title">Semana por máquina</h2><p>Horas planejadas e ocupação de cada máquina (24 h por dia). Clique num dia para ver o cronograma.</p></header>
    <div className="planning-table-scroll"><table><thead><tr><th>Máquina</th>{days.map((day, index) => <th key={day} className={day === today ? 'planning-today-column' : ''}><button type="button" onClick={() => onOpen(day)}>{weekDays[index]} {shortDate(day)}</button></th>)}</tr></thead>
      <tbody>{machines.map((item) => <tr key={item.id}><th scope="row">{item.name}{item.maintenance && <small> · em manutenção</small>}</th>{days.map((day) => {
        const own = blocks.filter((block) => block.resourceType === 'machine' && String(block.resourceId) === item.id)
        const minutes = own.reduce((sum, block) => sum + overlap(blockStart(block), blockEnd(block), dayStart(day)), 0)
        const late = own.some((block) => block.status === 'late' && overlap(blockStart(block), blockEnd(block), dayStart(day)) > 0)
        return <td key={day}><button type="button" className="planning-cell" onClick={() => onOpen(day)} aria-label={`${item.name}, ${shortDate(day)}: ${duration(minutes)} planejadas`}><span className="planning-bar"><i style={{ width: percent(minutes / 1440) }} /></span><small>{minutes ? `${duration(minutes)} · ${percent(minutes / 1440)}` : 'Livre'}{late ? ' · atraso' : ''}</small></button></td>
      })}</tr>)}</tbody></table></div>
  </section>
}

// The month as a calendar: each day sums up the occupation of each sector; a click opens the day.
function MonthCalendar({ from, month, sectors, resources, blocks, today, onOpen }) {
  const days = Array.from({ length: 42 }, (_, index) => addDays(from, index))
  return <section className="planning-agenda planning-month" aria-labelledby="planning-month-title">
    <header><h2 id="planning-month-title">Calendário do mês</h2><p>Ocupação planejada de cada setor por dia. Clique num dia para ver o cronograma.</p></header>
    <div className="planning-calendar">{weekDays.map((name) => <span key={name} className="planning-weekday">{name}</span>)}
      {days.map((day) => {
        const inDay = blocks.filter((block) => overlap(blockStart(block), blockEnd(block), dayStart(day)) > 0)
        return <button key={day} type="button" className={`planning-day${day.slice(0, 7) !== month ? ' planning-day--other' : ''}${day === today ? ' planning-day--today' : ''}`} onClick={() => onOpen(day)} aria-label={`Abrir ${shortDate(day)}`}>
          <strong>{Number(day.slice(8))}</strong>
          {sectors.slice(0, 3).map((name) => {
            const machines = resources.filter((item) => item.type === 'machine' && item.sectors.includes(name))
            const keys = new Set(machines.map((item) => resourceKey(item.type, item.id)))
            const minutes = inDay.filter((block) => keys.has(resourceKey(block.resourceType, block.resourceId))).reduce((sum, block) => sum + overlap(blockStart(block), blockEnd(block), dayStart(day)), 0)
            const share = machines.length ? minutes / (machines.length * 1440) : 0
            return <span key={name} className="planning-day-sector"><em>{name}</em><span className="planning-bar"><i style={{ width: percent(share) }} /></span><small>{percent(share)}</small></span>
          })}
          <small className="planning-day-count">{inDay.length ? `${new Set(inDay.map((block) => block.orderCode)).size} OS · ${inDay.length} blocos` : 'Sem planejamento'}{inDay.some((block) => block.status === 'late') && <b> · atraso</b>}</small>
        </button>
      })}</div>
  </section>
}

// The OS waiting for a plan, each one with its stages in order: the machine or service defined for the stage and the time
// still to plan. "Planejar" opens all of them together.
function Backlog({ rows, resources, fit, onClearFit, onPlan }) {
  const nameOf = (stage) => stage.suggested ? resources.find((item) => item.type === stage.suggested.type && item.id === String(stage.suggested.id))?.name || stage.suggested.name : 'Sem máquina definida'
  const fits = (order) => !fit || order.stages.some((stage) => stageKeyOf(stage) === fit.resourceKey && stage.toPlanMinutes != null && stage.toPlanMinutes <= fit.minutes)
  const orders = groupBacklog(rows).filter(fits)
  return <section className="planning-backlog" aria-labelledby="planning-backlog-title">
    <header><h2 id="planning-backlog-title">Serviços para planejar</h2><p>{fit ? <>OS com etapa em <strong>{fit.name}</strong> que cabe no horário livre de {duration(fit.minutes)} a partir das {clockTime(fit.start)}. <button type="button" className="planning-link" onClick={onClearFit}>Mostrar todas</button></> : 'Cada OS com as suas etapas e a máquina de cada uma. Use Planejar, ou arraste a OS para uma máquina na agenda.'}</p></header>
    <div className="planning-table-scroll"><table><thead><tr><th>OS</th><th>Etapas a planejar</th><th>Prazo</th><th><span className="sr-only">Ação</span></th></tr></thead>
      <tbody>{orders.map((order) => <tr key={order.orderCode} draggable onDragStart={(event) => { event.dataTransfer.setData('text/plain', JSON.stringify({ orderCode: order.orderCode })); event.dataTransfer.effectAllowed = 'copy' }}>
        <td><strong>{order.orderCode}</strong><small>{order.service} · {order.company}</small></td>
        <td><ol className="planning-backlog-stages">{order.stages.map((stage) => <li key={stage.stageCode}><b>{stage.position}</b><span><strong>{stage.stageName}</strong> · {nameOf(stage)}<small>{stage.toPlanMinutes == null ? <span className="planning-warning">Sem tempo previsto</span> : `${duration(stage.toPlanMinutes)} a planejar`} · {stage.done} de {stage.quantity} peças</small></span></li>)}</ol></td>
        <td>{order.deadline ? fullDate(order.deadline) : '—'}{order.urgency === 'emergency' && <span className="planning-emergency">Emergência</span>}</td>
        <td><button className="admin-tool-button" type="button" onClick={() => onPlan({ orderCode: order.orderCode })}>Planejar</button></td>
      </tr>)}
      {!orders.length && <tr><td colSpan={4} className="planning-empty">{fit ? 'Nenhuma etapa desta máquina cabe nesse intervalo.' : 'Tudo planejado: nenhuma OS aguardando.'}</td></tr>}</tbody></table></div>
  </section>
}

// A group of the snapshot shows up to four machines; the others scroll inside the list. Cards have different heights
// (wrapped names, the "Real" line), so the limit is measured on the fourth card.
const SNAPSHOT_VISIBLE = 4
function SnapshotList({ children }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const list = ref.current, last = list.children[SNAPSHOT_VISIBLE - 1]
    list.style.maxHeight = list.children.length > SNAPSHOT_VISIBLE ? `${last.offsetTop + last.offsetHeight}px` : ''
  })
  return <ul ref={ref}>{children}</ul>
}

// One moment of the day (the one clicked on the ruler, or now): which machines are planned busy, idle (and until when)
// or unavailable; up to now, also what really happened.
function Snapshot({ date, today, now, selectedAt, onSelect, resources, blocks, actual, onFit }) {
  const from = dayStart(date)
  const at = selectedAt ?? (date === today ? now : null)
  const machines = resources.filter((item) => item.type === 'machine')
  const rows = at == null ? [] : planningSnapshot(machines, blocks, actual, at, now)
  const past = at != null && at <= now
  const groups = [['busy', 'Ocupadas'], ['idle', 'Ociosas'], ['unavailable', 'Em manutenção']]
  return <section className="planning-snapshot" aria-labelledby="planning-snapshot-title">
    <header><h2 id="planning-snapshot-title">{at == null ? 'Escolha um horário' : selectedAt == null ? `Agora · ${clockTime(at)}` : `${past ? 'Às' : 'Previsão às'} ${clockTime(at)}`}</h2>
      <label className="sr-only" htmlFor="planning-snapshot-time">Horário</label>
      <select id="planning-snapshot-time" value={selectedAt == null ? '' : clockTime(Math.floor(selectedAt / SLOT_MS) * SLOT_MS)} onChange={(event) => onSelect(event.target.value ? Date.parse(`${date}T${event.target.value}:00-03:00`) : null)}><option value="">{date === today ? 'Agora' : 'Horário'}</option>{slots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</select></header>
    {at == null ? <p className="planning-muted">Clique na régua de horas da agenda, ou escolha o horário acima, para ver quais máquinas estarão ocupadas e quais estarão livres.</p>
      : groups.map(([state, title]) => { const list = rows.filter((row) => row.state === state); return list.length > 0 && <div key={state} className={`planning-snapshot-group planning-snapshot-group--${state}`}><h3>{title} ({list.length} de {rows.length})</h3><SnapshotList>{list.map((row) => <li key={row.resource.id}>
        <strong>{row.resource.name}</strong>
        {state === 'busy' && <span>{row.block.orderCode} · {row.block.stageName} · até {clockTime(blockEnd(row.block))}</span>}
        {state === 'idle' && <span>Livre {row.freeFrom ? `das ${clockTime(Math.max(row.freeFrom, from))}` : 'desde 00:00'} {row.freeUntil && row.freeUntil < from + DAY_MS ? `às ${clockTime(row.freeUntil)}` : 'até o fim do dia'}{' '}<button type="button" className="planning-link" onClick={() => { const start = Math.max(Math.ceil(Math.max(at, now) / SLOT_MS) * SLOT_MS, row.freeFrom || 0), end = Math.min(row.freeUntil || from + DAY_MS, from + DAY_MS); onFit({ resourceKey: resourceKey(row.resource.type, row.resource.id), name: row.resource.name, start, minutes: Math.max(0, (end - start) / 60000) }) }}>ver o que cabe</button></span>}
        {state === 'unavailable' && <span>{row.resource.maintenance.reason}</span>}
        {past && <small className={row.real.length ? 'planning-real' : 'planning-real planning-real--none'}>{row.real.length ? `Real: ${row.real.map((item) => `${item.employeeName} · ${item.orderCode}`).join(', ')}` : 'Real: parada'}</small>}
      </li>)}</SnapshotList></div> })}
  </section>
}

function OperatorPreview({ sectors, sector, onSector, resources, blocks, now }) {
  const queue = sector ? operatorQueue(blocks, resources, [sector], now, 4) : []
  return <section className="planning-operator" aria-labelledby="planning-operator-title">
    <header><h2 id="planning-operator-title">Visão do operador <span>Prévia</span></h2><select aria-label="Setor da prévia" value={sector} onChange={(event) => onSector(event.target.value)}>{sectors.map((name) => <option key={name} value={name}>{name}</option>)}</select></header>
    {queue.length ? <ol>{queue.map((block, index) => <li key={block.id} className={block.now ? 'planning-operator-now' : ''}><b>{block.now ? 'Agora' : block.status === 'late' ? 'Atrasado' : index === 0 || queue[index - 1].now ? 'A seguir' : 'Depois'}</b><div><strong>{block.orderCode} · {block.stageName}</strong><small>{block.resourceName} · {clockTime(blockStart(block))}–{clockTime(blockEnd(block))}</small></div></li>)}</ol>
      : <p className="planning-muted">Nada planejado para {sector || 'este setor'} no período aberto.</p>}
    <p className="planning-muted">É a fila que o operador do setor vê no tablet, na ordem do plano.</p>
  </section>
}

const fullDate = (date) => date.split('-').reverse().join('/')
const roundUp = (ms) => Math.ceil(ms / SLOT_MS) * SLOT_MS
const stageKeyOf = (stage) => stage?.suggested ? resourceKey(stage.suggested.type, stage.suggested.id) : ''
// The stages still to plan, by OS, in the order of the OS.
function groupBacklog(rows) {
  const orders = new Map()
  for (const row of rows) {
    if (!orders.has(row.orderCode)) orders.set(row.orderCode, { orderCode: row.orderCode, service: row.service, company: row.company, deadline: row.deadline, urgency: row.urgency, stages: [] })
    orders.get(row.orderCode).stages.push(row)
  }
  return [...orders.values()].map((order) => ({ ...order, stages: order.stages.sort((left, right) => (left.position || 0) - (right.position || 0)) }))
}
// The first start, from `from` on, when a machine is free for `minutes`. Labor services are people: any time works.
function firstFree(blocks, key, from, minutes) {
  let start = roundUp(from)
  if (!key.startsWith('machine:')) return start
  const own = blocks.filter((block) => resourceKey(block.resourceType, block.resourceId) === key)
  for (let guard = 0; guard < 500; guard += 1) {
    const clash = own.find((block) => blockStart(block) < start + minutes * 60000 && start < blockEnd(block))
    if (!clash) return start
    start = roundUp(blockEnd(clash))
  }
  return start
}

// The chosen day of the machine on a 24-hour bar: what is already planned on it, the other stages of this OS on it and
// this stage (red when it clashes).
function DayStrip({ day, resourceKeyValue, name, agenda, planned, current, clash }) {
  const from = dayStart(day), to = from + DAY_MS
  const place = (start, end) => ({ left: `${(Math.max(start, from) - from) / DAY_MS * 100}%`, width: `${Math.max(0.5, (Math.min(end, to) - Math.max(start, from)) / DAY_MS * 100)}%` })
  const busy = agenda.filter((block) => resourceKey(block.resourceType, block.resourceId) === resourceKeyValue && blockStart(block) < to && blockEnd(block) > from).sort((left, right) => blockStart(left) - blockStart(right))
  const mine = planned.filter((item) => item.key === resourceKeyValue && item.minutes && item.start < to && item.end > from)
  const busyText = busy.map((block) => `${clockTime(Math.max(blockStart(block), from))}–${blockEnd(block) >= to ? '24:00' : clockTime(blockEnd(block))} (${block.orderCode})`).join(', ')
  return <div className="planning-strip-wrap">
    <div className="planning-strip" role="img" aria-label={`${name} em ${shortDate(day)}: ${busy.length ? `ocupada ${busyText}` : 'livre o dia todo'}`}>
      {busy.map((block) => <i key={block.id} className="planning-strip-busy" style={place(blockStart(block), blockEnd(block))} title={`${block.orderCode} · ${block.stageName} · ${clockTime(blockStart(block))}–${clockTime(blockEnd(block))}`} />)}
      {mine.map((item) => <i key={item.stage.stageCode} className={`planning-strip-new${item === current ? clash ? ' planning-strip-new--clash' : '' : ' planning-strip-new--other'}`} style={place(item.start, item.end)} title={`${item.stage.stageName} · ${clockTime(item.start)}–${clockTime(item.end)}`} />)}
    </div>
    {/* A line under the bar with a tick going up at every hour (taller every 3 and 6 hours), then the hours. */}
    <div className="planning-strip-ruler" aria-hidden="true">{Array.from({ length: 25 }, (_, hour) => <i key={hour} className={`planning-strip-tick${hour % 6 === 0 ? ' planning-strip-tick--major' : hour % 3 === 0 ? ' planning-strip-tick--mid' : ''}`} style={{ left: `calc(${hour / 24 * 100}% - ${hour === 24 ? 1 : 0}px)` }} />)}</div>
    <div className="planning-strip-axis" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => index * 3).map((hour) => <span key={hour} className={hour % 6 ? 'planning-strip-hour--minor' : ''} style={{ left: `${hour / 24 * 100}%` }}>{String(hour).padStart(2, '0')}h</span>)}</div>
    <small>{name} em {shortDate(day)}: {busy.length ? `ocupada ${busyText}` : 'livre o dia todo'}</small>
  </div>
}

// Plans the stages of one OS at once. Each stage keeps the machine or service defined in the OS; the administrator chooses
// the day and the start of each one. A stage not changed by hand starts when the previous one ends, on the first moment
// its machine is free. Opened from a machine row of the agenda, it brings only the stages of that machine checked.
function OrderPlanModal({ data, initial, date, onClose, onSaved }) {
  const orders = useMemo(() => groupBacklog(data.backlog), [data.backlog])
  const focus = initial.resourceKey && initial.start != null ? { resourceKey: initial.resourceKey, start: initial.start } : null
  const choices = focus && !initial.item ? orders.filter((order) => order.stages.some((stage) => stageKeyOf(stage) === focus.resourceKey)) : orders
  const [orderCode, setOrderCode] = useState(initial.item?.orderCode ?? choices[0]?.orderCode ?? '')
  const order = orders.find((item) => item.orderCode === orderCode)
  const today = localDay(data.now)
  const [agenda, setAgenda] = useState(null)
  const [rows, setRows] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The plan of the next two months, to find the free time of each machine and the clashes.
  useEffect(() => {
    let active = true
    const from = date < today ? date : today
    payableRequest(`/planning?from=${from}&to=${addDays(from, 61)}`).then((result) => { if (active) setAgenda(result.blocks) }).catch(() => { if (active) setAgenda(data.blocks) })
    return () => { active = false }
  }, [])
  const resourceName = (key) => data.resources.find((item) => resourceKey(item.type, item.id) === key)?.name || ''
  const keyOf = (stage, row) => stageKeyOf(stage) || row?.resource || ''
  const startOf = (row) => Date.parse(`${row.day}T${row.time}:00-03:00`)
  const minutesOf = (row) => Math.max(0, Math.floor(Number(row.hours) || 0)) * 60 + Math.max(0, Math.floor(Number(row.minutes) || 0))
  function schedule(current, plan = agenda) {
    if (!order || !plan) return current
    let cursor = Math.max(roundUp(data.now), dayStart(date)), focused = false
    const next = { ...current }
    for (const stage of order.stages) {
      const row = current[stage.stageCode]
      if (!row?.checked) continue
      const key = keyOf(stage, row), minutes = minutesOf(row) || 60
      let start
      if (row.touched) start = startOf(row)
      else if (focus && !focused && key === focus.resourceKey) { start = focus.start; focused = true }
      else start = firstFree(plan, key, cursor, minutes)
      if (!row.touched) next[stage.stageCode] = { ...row, day: localDay(start), time: clockTime(start) }
      cursor = start + minutes * 60000
    }
    return next
  }
  useEffect(() => {
    if (!order || !agenda) return
    const onFocus = focus && order.stages.some((stage) => stageKeyOf(stage) === focus.resourceKey)
    setRows(schedule(Object.fromEntries(order.stages.map((stage) => {
      const minutes = stage.toPlanMinutes || 60
      return [stage.stageCode, { checked: !onFocus || stageKeyOf(stage) === focus.resourceKey, hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60), day: date, time: '00:00', touched: false, resource: stageKeyOf(stage) ? '' : focus?.resourceKey || '' }]
    }))))
  }, [orderCode, agenda])
  const change = (code, fields, touch = false) => setRows((current) => schedule({ ...current, [code]: { ...current[code], ...fields, ...(touch ? { touched: true } : {}) } }))
  const rechain = () => setRows((current) => schedule(Object.fromEntries(Object.entries(current).map(([code, row]) => [code, { ...row, touched: false }]))))
  const planned = order ? order.stages.filter((stage) => rows[stage.stageCode]?.checked).map((stage) => {
    const row = rows[stage.stageCode], start = startOf(row), minutes = minutesOf(row)
    return { stage, row, key: keyOf(stage, row), start, end: start + minutes * 60000, minutes }
  }) : []
  function clashOf(item) {
    if (!item.key.startsWith('machine:') || !item.minutes) return ''
    const block = (agenda || []).find((entry) => resourceKey(entry.resourceType, entry.resourceId) === item.key && blockStart(entry) < item.end && item.start < blockEnd(entry))
    if (block) return `${resourceName(item.key)} já tem a ${block.orderCode} · ${block.stageName} das ${clockTime(blockStart(block))} às ${clockTime(blockEnd(block))}${localDay(blockStart(block)) !== localDay(item.start) ? ` de ${shortDate(localDay(blockStart(block)))}` : ''}.`
    const other = planned.find((entry) => entry !== item && entry.key === item.key && entry.minutes && entry.start < item.end && item.start < entry.end)
    return other ? `Ao mesmo tempo que a etapa ${other.stage.stageName}, na mesma máquina.` : ''
  }
  async function submit(event) {
    event.preventDefault()
    if (!planned.length) return setError('Marque pelo menos uma etapa para planejar.')
    const missing = planned.find((item) => !item.key)
    if (missing) return setError(`Escolha a máquina ou o serviço da etapa ${missing.stage.stageName}.`)
    const empty = planned.find((item) => !item.minutes)
    if (empty) return setError(`Informe a duração da etapa ${empty.stage.stageName}.`)
    setBusy(true); setError('')
    try {
      await payableRequest('/planning/blocks/batch', 'POST', { items: planned.map((item) => { const [type, ...id] = item.key.split(':'); return { orderCode: order.orderCode, stageCode: item.stage.stageCode, resourceType: type, resourceId: id.join(':'), start: new Date(item.start).toISOString(), minutes: item.minutes } }) })
      onSaved()
    } catch (caught) { setError(caught.message); setBusy(false) }
  }
  const machines = data.resources.filter((item) => item.type === 'machine'), services = data.resources.filter((item) => item.type === 'labor-service')
  return <PayableModal title="Planejar OS" className="planning-modal planning-modal--order" busy={busy} onClose={onClose} footer={<>
    <button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button>
    <button className="admin-tool-button admin-tool-button--primary" type="submit" form="planning-order-form" disabled={busy || !order || !agenda}><CalendarClock size={16} aria-hidden="true" />{busy ? 'Salvando...' : planned.length > 1 ? `Planejar ${planned.length} etapas` : 'Planejar etapa'}</button></>}>
    <form id="planning-order-form" className="planning-form" onSubmit={submit}><fieldset disabled={busy}>
      {!choices.length ? <p className="planning-muted">{focus ? `Nenhuma OS tem etapa aguardando em ${resourceName(focus.resourceKey) || 'este recurso'}.` : 'Nenhuma OS aguardando planejamento.'}</p> : <>
        <label>OS<select value={orderCode} onChange={(event) => setOrderCode(event.target.value)}>{choices.map((item) => <option key={item.orderCode} value={item.orderCode}>{item.orderCode} · {item.service} · {item.company}</option>)}</select></label>
        {order && <p className="planning-order-facts">{order.stages.length} {order.stages.length === 1 ? 'etapa' : 'etapas'} a planejar · prazo {order.deadline ? fullDate(order.deadline) : 'não informado'}{order.urgency === 'emergency' && <span className="planning-emergency">Emergência</span>}</p>}
        {!agenda ? <p className="planning-muted">Carregando a agenda das máquinas...</p> : order && <>
          <p className="planning-muted">Cada etapa já vem com a máquina ou o serviço da OS: escolha o dia e o horário. A etapa seguinte começa quando a anterior termina, na primeira hora livre da máquina, até você mudar o horário dela.{planned.some((item) => item.row.touched) && <> <button type="button" className="planning-link" onClick={rechain}>Encadear de novo</button></>}</p>
          <ol className="planning-stage-rows">{order.stages.map((stage) => {
            const row = rows[stage.stageCode]
            if (!row) return null
            const item = planned.find((entry) => entry.stage === stage)
            const key = keyOf(stage, row), name = resourceName(key) || stage.suggested?.name || ''
            const resource = data.resources.find((entry) => resourceKey(entry.type, entry.id) === key)
            const clash = item ? clashOf(item) : ''
            return <li key={stage.stageCode} className={`planning-stage-row${row.checked ? '' : ' planning-stage-row--off'}`}>
              <label className="planning-stage-check"><input type="checkbox" checked={row.checked} onChange={(event) => change(stage.stageCode, { checked: event.target.checked })} aria-label={`Planejar a etapa ${stage.stageName}`} /><b>{stage.position}</b><span><strong>{stage.stageName}</strong><small>{stageKeyOf(stage) ? name : 'Sem máquina definida na OS'} · {stage.toPlanMinutes == null ? 'sem tempo previsto na OS' : `falta planejar ${duration(stage.toPlanMinutes)}`} · {stage.done} de {stage.quantity} peças</small></span></label>
              {row.checked && <>
                <div className="planning-stage-fields">
                  {!stageKeyOf(stage) && <label>Máquina ou serviço<select aria-label={`Máquina ou serviço da etapa ${stage.stageName}`} value={row.resource} onChange={(event) => change(stage.stageCode, { resource: event.target.value })}><option value="">Escolher</option><optgroup label="Máquinas">{machines.map((entry) => <option key={entry.id} value={resourceKey(entry.type, entry.id)}>{entry.name}</option>)}</optgroup>{services.length > 0 && <optgroup label="Serviços (hora homem)">{services.map((entry) => <option key={entry.id} value={resourceKey(entry.type, entry.id)}>{entry.name}</option>)}</optgroup>}</select></label>}
                  <label>Dia<input type="date" aria-label={`Dia da etapa ${stage.stageName}`} value={row.day} onChange={(event) => event.target.value && change(stage.stageCode, { day: event.target.value }, true)} required /></label>
                  <label>Início<select aria-label={`Início da etapa ${stage.stageName}`} value={row.time} onChange={(event) => change(stage.stageCode, { time: event.target.value }, true)}>{slots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</select></label>
                  <label>Horas<input type="number" min="0" step="1" inputMode="numeric" aria-label={`Horas da etapa ${stage.stageName}`} value={row.hours} onChange={(event) => change(stage.stageCode, { hours: event.target.value })} /></label>
                  <label>Minutos<input type="number" min="0" max="59" step="1" inputMode="numeric" aria-label={`Minutos da etapa ${stage.stageName}`} value={row.minutes} onChange={(event) => change(stage.stageCode, { minutes: event.target.value })} /></label>
                </div>
                {key && <DayStrip day={row.day} resourceKeyValue={key} name={name} agenda={agenda} planned={planned} current={item} clash={Boolean(clash)} />}
                {item?.minutes > 0 && <p className="planning-form-summary">Das <strong>{clockTime(item.start)}</strong> de {shortDate(localDay(item.start))} às <strong>{clockTime(item.end)}</strong> de {shortDate(localDay(item.end))} · {duration(item.minutes)}</p>}
                {clash && <p className="planning-warning planning-warning--clash" role="status"><AlertTriangle size={14} aria-hidden="true" /> {clash}</p>}
                {resource?.maintenance && <p className="planning-warning" role="status"><Wrench size={14} aria-hidden="true" /> {resource.name} está em manutenção: {resource.maintenance.reason}</p>}
                {order.deadline && item?.minutes > 0 && localDay(item.end) > order.deadline && <p className="planning-warning" role="status"><AlertTriangle size={14} aria-hidden="true" /> Termina depois do prazo da OS ({fullDate(order.deadline)}).</p>}
              </>}
            </li>
          })}</ol>
        </>}
      </>}
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}

// One block of the plan: its day, start, duration and pieces. The machine or service is the one defined in the OS for the
// stage; only a stage without it (an older OS) lets the block choose.
function BlockModal({ data, block, onClose, onSaved }) {
  const fixed = block.stageResource && data.resources.find((item) => item.type === block.stageResource.type && item.id === String(block.stageResource.id))
  const [resource, setResource] = useState(fixed ? resourceKey(fixed.type, fixed.id) : resourceKey(block.resourceType, block.resourceId))
  const [day, setDay] = useState(localDay(blockStart(block)))
  const [time, setTime] = useState(clockTime(blockStart(block)))
  const [hours, setHours] = useState(String(Math.floor(block.minutes / 60)))
  const [minutes, setMinutes] = useState(String(block.minutes % 60))
  const [quantity, setQuantity] = useState(block.quantity ? String(block.quantity) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const total = Math.max(0, Math.floor(Number(hours) || 0)) * 60 + Math.max(0, Math.floor(Number(minutes) || 0))
  const start = Date.parse(`${day}T${time}:00-03:00`), end = start + total * 60000
  const chosen = data.resources.find((item) => resourceKey(item.type, item.id) === resource)
  async function submit(event) {
    event.preventDefault()
    if (!total) return setError('Informe a duração.')
    const [type, ...id] = resource.split(':')
    setBusy(true); setError('')
    try {
      await payableRequest(`/planning/blocks/${block.id}`, 'PUT', { orderCode: block.orderCode, stageCode: block.stageCode, resourceType: type, resourceId: id.join(':'), start: new Date(start).toISOString(), minutes: total, quantity: quantity ? Number(quantity) : null })
      onSaved()
    } catch (caught) { setError(caught.message); setBusy(false) }
  }
  async function remove() {
    if (!window.confirm(`Tirar ${block.orderCode} · ${block.stageName} do planejamento?`)) return
    setBusy(true)
    try { await payableRequest(`/planning/blocks/${block.id}`, 'DELETE'); onSaved() } catch (caught) { setError(caught.message); setBusy(false) }
  }
  const machines = data.resources.filter((item) => item.type === 'machine'), services = data.resources.filter((item) => item.type === 'labor-service')
  return <PayableModal title="Bloco do planejamento" className="planning-modal" busy={busy} onClose={onClose} footer={<>
    <button className="admin-tool-button planning-remove" type="button" disabled={busy} onClick={remove}><Trash2 size={16} aria-hidden="true" />Tirar do plano</button>
    <button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button>
    <button className="admin-tool-button admin-tool-button--primary" type="submit" form="planning-form" disabled={busy}><CalendarClock size={16} aria-hidden="true" />{busy ? 'Salvando...' : 'Salvar bloco'}</button></>}>
    <form id="planning-form" className="planning-form" onSubmit={submit}><fieldset disabled={busy}>
      <p className="planning-order-facts"><strong>{block.orderCode} · {block.stageName}</strong> · {block.service}</p>
      {fixed ? <p className="planning-order-facts">Máquina ou serviço: <strong>{fixed.name}</strong> (definido na OS)</p> : <label>Máquina ou serviço<select value={resource} onChange={(event) => setResource(event.target.value)}>
        <optgroup label="Máquinas">{machines.map((item) => <option key={item.id} value={resourceKey(item.type, item.id)}>{item.name}{item.maintenance ? ' (em manutenção)' : ''}</option>)}</optgroup>
        {services.length > 0 && <optgroup label="Serviços (hora homem)">{services.map((item) => <option key={item.id} value={resourceKey(item.type, item.id)}>{item.name}</option>)}</optgroup>}
      </select></label>}
      <div className="planning-form-row"><label>Dia<input type="date" value={day} onChange={(event) => event.target.value && setDay(event.target.value)} required /></label><label>Início<select value={time} onChange={(event) => setTime(event.target.value)}>{slots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</select></label></div>
      <div className="planning-form-row"><label>Duração (horas)<input type="number" min="0" step="1" inputMode="numeric" value={hours} onChange={(event) => setHours(event.target.value)} /></label><label>Minutos<input type="number" min="0" max="59" step="1" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label><label>Peças (opcional)<input type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label></div>
      <p className="planning-form-summary">{total ? <>Termina às <strong>{clockTime(end)}</strong>{localDay(end) !== day ? ` de ${shortDate(localDay(end))}` : ''} · {duration(total)}</> : 'Informe a duração.'}</p>
      {chosen?.maintenance && <p className="planning-warning" role="status"><Wrench size={14} aria-hidden="true" /> {chosen.name} está em manutenção: {chosen.maintenance.reason}</p>}
      {block.deadline && total > 0 && localDay(end) > block.deadline && <p className="planning-warning" role="status"><AlertTriangle size={14} aria-hidden="true" /> Termina depois do prazo da OS ({fullDate(block.deadline)}).</p>}
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}
