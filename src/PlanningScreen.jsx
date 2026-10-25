import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [updatedAt, setUpdatedAt] = useState(null)
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
      setData(result); setError(''); setUpdatedAt(new Date())
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
  const backlog = (data?.backlog || []).filter((row) => !sector || row.group === sector || (data?.resources || []).some((item) => row.suggested && item.type === row.suggested.type && item.id === String(row.suggested.id) && item.sectors.includes(sector)))
  const allSectors = data?.sectors || []
  const move = (days) => setDate(view === 'month' ? addDays(`${date.slice(0, 8)}01`, days > 0 ? 32 : -1).slice(0, 8) + '01' : addDays(date, days * (view === 'week' ? 7 : 1)))
  const openDay = (day) => { setDate(day); setView('day') }

  return <div className="dashboard-shell admin-tools-shell planning-shell"><Sidebar {...navigationProps} /><main className="admin-tools-main planning-main"><WorkspaceTabs {...navigationProps} />
    <header className="planning-heading">
      <div><h1>Planejamento</h1><p>Organize os serviços por máquina e acompanhe a execução ao longo do dia.</p></div>
      <div className="planning-heading-actions"><span className="planning-live" role="status"><i aria-hidden="true" />Atualização a cada 10 s{updatedAt && <small>Última atualização {updatedAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia' })}</small>}</span>
        <button className="admin-tool-button admin-tool-button--primary" type="button" disabled={!data} onClick={() => setEditing({ start: view === 'day' ? Math.max(dayStart(date), Math.ceil(now / SLOT_MS) * SLOT_MS) : null })}><Plus size={17} aria-hidden="true" />Planejar serviço</button></div>
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
      {view === 'day' && <DayAgenda date={date} today={today} now={now} resources={resources} blocks={blocks} actual={data.actual} selectedAt={selectedAt} onSelect={setSelectedAt} onPlan={(fields) => setEditing(fields)} onEdit={(block) => setEditing({ block })} onMoved={refresh} onError={setError} />}
      {view === 'week' && <WeekTable from={from} machines={machines} blocks={blocks} today={today} onOpen={openDay} />}
      {view === 'month' && <MonthCalendar from={from} month={date.slice(0, 7)} sectors={sector ? [sector] : allSectors} resources={data.resources} blocks={blocks} today={today} onOpen={openDay} />}
      <div className="planning-lower">
        <Backlog rows={backlog} resources={data.resources} fit={fit} onClearFit={() => setFit(null)} onPlan={(item) => setEditing({ item, resourceKey: fit?.resourceKey, start: fit?.start })} />
        <div className="planning-side">
          {view === 'day' && <Snapshot date={date} today={today} now={now} selectedAt={selectedAt} onSelect={setSelectedAt} resources={resources} blocks={blocks} actual={data.actual} onFit={setFit} />}
          <OperatorPreview sectors={allSectors} sector={preview || sector || allSectors[0] || ''} onSector={setPreview} resources={data.resources} blocks={data.blocks} now={now} />
        </div>
      </div>
    </>}
    {editing && data && <PlanModal data={data} initial={editing} date={date} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setFit(null); refresh() }} />}
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
    <header><h2 id="planning-agenda-title">Agenda por máquina</h2><p>Planejado × realizado · arraste um bloco para mudar o horário, ou clique num espaço vazio para planejar.</p>
      <ul className="planning-legend"><li><i className="planning-dot planning-dot--done" />Concluído</li><li><i className="planning-dot planning-dot--running" />Em execução</li><li><i className="planning-dot planning-dot--planned" />Planejado</li><li><i className="planning-dot planning-dot--late" />Atrasado</li><li><i className="planning-dot planning-dot--actual" />Realizado</li></ul></header>
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
                return <button key={block.id} type="button" className={`planning-block planning-block--${block.status}${drag?.id === block.id ? ' planning-block--dragging' : ''}`} style={{ left: (start - from) / 60000 * PX_PER_MINUTE + shift * PX_PER_MINUTE, width: Math.max(18, overlap(blockStart(block), blockEnd(block), from) * PX_PER_MINUTE - 2) }}
                  title={`${block.orderCode} · ${block.service} · ${block.stageName}\n${clockTime(blockStart(block))}–${clockTime(blockEnd(block))} (${duration(block.minutes)}) · ${statusLabels[block.status]}${block.delayMinutes ? ` · ${duration(block.delayMinutes)} de atraso` : ''}`}
                  onPointerDown={(event) => pointerDown(event, block)} onPointerMove={drag?.id === block.id ? pointerMove : undefined} onPointerUp={(event) => pointerUp(event, block)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdit(block) } }}>
                  <strong>{block.orderCode} · {block.stageName}</strong><span>{shift ? `→ ${clockTime(blockStart(block) + shift * 60000)}` : `${clockTime(blockStart(block))}–${clockTime(blockEnd(block))}`}{block.urgency === 'emergency' ? ' · Emergência' : ''}{block.status === 'late' && block.delayMinutes > 0 && <b> · {duration(block.delayMinutes)} de atraso</b>}{block.status === 'running' && ` · ${block.progress}%`}</span>
                  {block.status === 'running' && <i className="planning-progress" style={{ width: `${block.progress}%` }} aria-hidden="true" />}
                </button>
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

function Backlog({ rows, resources, fit, onClearFit, onPlan }) {
  const suggestedName = (row) => row.suggested ? resources.find((item) => item.type === row.suggested.type && item.id === String(row.suggested.id))?.name || row.suggested.name : '—'
  const fits = (row) => !fit || (row.toPlanMinutes != null && row.toPlanMinutes <= fit.minutes)
  return <section className="planning-backlog" aria-labelledby="planning-backlog-title">
    <header><h2 id="planning-backlog-title">Serviços para planejar</h2><p>{fit ? <>Cabem em <strong>{fit.name}</strong>, livre por {duration(fit.minutes)} a partir das {clockTime(fit.start)}. <button type="button" className="planning-link" onClick={onClearFit}>Mostrar todos</button></> : 'Arraste uma linha para a máquina na agenda, ou use Planejar.'}</p></header>
    <div className="planning-table-scroll"><table><thead><tr><th>OS</th><th>Etapa</th><th>Setor</th><th>Máquina sugerida</th><th>A planejar</th><th>Prazo</th><th><span className="sr-only">Ação</span></th></tr></thead>
      <tbody>{rows.filter(fits).map((row) => <tr key={`${row.orderCode}-${row.stageCode}`} draggable onDragStart={(event) => { event.dataTransfer.setData('text/plain', JSON.stringify(row)); event.dataTransfer.effectAllowed = 'copy' }}>
        <td><strong>{row.orderCode}</strong><small>{row.service} · {row.company}</small></td>
        <td>{row.stageName}<small>{row.done} de {row.quantity} peças</small></td>
        <td>{row.group || '—'}</td>
        <td>{suggestedName(row)}</td>
        <td>{row.toPlanMinutes == null ? <span className="planning-warning">Sem tempo previsto</span> : duration(row.toPlanMinutes)}</td>
        <td>{row.deadline ? shortDate(row.deadline) + '/' + row.deadline.slice(0, 4) : '—'}{row.urgency === 'emergency' && <span className="planning-emergency">Emergência</span>}</td>
        <td><button className="admin-tool-button" type="button" onClick={() => onPlan(row)}>Planejar</button></td>
      </tr>)}
      {!rows.filter(fits).length && <tr><td colSpan={7} className="planning-empty">{fit ? 'Nenhuma etapa cabe nesse intervalo.' : 'Tudo planejado: nenhuma etapa aguardando.'}</td></tr>}</tbody></table></div>
  </section>
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
      : groups.map(([state, title]) => { const list = rows.filter((row) => row.state === state); return list.length > 0 && <div key={state} className={`planning-snapshot-group planning-snapshot-group--${state}`}><h3>{title} ({list.length} de {rows.length})</h3><ul>{list.map((row) => <li key={row.resource.id}>
        <strong>{row.resource.name}</strong>
        {state === 'busy' && <span>{row.block.orderCode} · {row.block.stageName} · até {clockTime(blockEnd(row.block))}</span>}
        {state === 'idle' && <span>Livre {row.freeFrom ? `das ${clockTime(Math.max(row.freeFrom, from))}` : 'desde 00:00'} {row.freeUntil && row.freeUntil < from + DAY_MS ? `às ${clockTime(row.freeUntil)}` : 'até o fim do dia'}{' '}<button type="button" className="planning-link" onClick={() => { const start = Math.max(Math.ceil(Math.max(at, now) / SLOT_MS) * SLOT_MS, row.freeFrom || 0), end = Math.min(row.freeUntil || from + DAY_MS, from + DAY_MS); onFit({ resourceKey: resourceKey(row.resource.type, row.resource.id), name: row.resource.name, start, minutes: Math.max(0, (end - start) / 60000) }) }}>ver o que cabe</button></span>}
        {state === 'unavailable' && <span>{row.resource.maintenance.reason}</span>}
        {past && <small className={row.real.length ? 'planning-real' : 'planning-real planning-real--none'}>{row.real.length ? `Real: ${row.real.map((item) => `${item.employeeName} · ${item.orderCode}`).join(', ')}` : 'Real: parada'}</small>}
      </li>)}</ul></div> })}
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

// Plans a stage of an OS on a machine or service, or changes / removes a block.
function PlanModal({ data, initial, date, onClose, onSaved }) {
  const block = initial.block
  const options = useMemo(() => {
    const rows = [...data.backlog]
    if (block && !rows.some((row) => row.orderCode === block.orderCode && row.stageCode === block.stageCode)) rows.unshift({ orderCode: block.orderCode, stageCode: block.stageCode, stageName: block.stageName, service: block.service, toPlanMinutes: null, suggested: null, deadline: block.deadline })
    if (initial.item && !rows.some((row) => row.orderCode === initial.item.orderCode && row.stageCode === initial.item.stageCode)) rows.unshift(initial.item)
    return rows
  }, [data, block, initial.item])
  const firstItem = block ? options.find((row) => row.orderCode === block.orderCode && row.stageCode === block.stageCode) : initial.item ? options.find((row) => row.orderCode === initial.item.orderCode && row.stageCode === initial.item.stageCode) : options[0]
  const suggestedKey = (row) => row?.suggested ? resourceKey(row.suggested.type, row.suggested.id) : ''
  const startMs = block ? blockStart(block) : initial.start ?? Math.max(dayStart(date), Math.ceil(Date.now() / SLOT_MS) * SLOT_MS)
  const [choice, setChoice] = useState(firstItem ? `${firstItem.orderCode}|${firstItem.stageCode}` : '')
  const [resource, setResource] = useState(block ? resourceKey(block.resourceType, block.resourceId) : initial.resourceKey || suggestedKey(firstItem) || resourceKey('machine', data.resources.find((item) => item.type === 'machine')?.id ?? ''))
  const [day, setDay] = useState(localDay(startMs))
  const [time, setTime] = useState(clockTime(startMs))
  const initialMinutes = block?.minutes ?? (firstItem?.toPlanMinutes || 60)
  const [hours, setHours] = useState(String(Math.floor(initialMinutes / 60)))
  const [minutes, setMinutes] = useState(String(initialMinutes % 60))
  const [quantity, setQuantity] = useState(block?.quantity ? String(block.quantity) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = options.find((row) => `${row.orderCode}|${row.stageCode}` === choice)
  const total = Math.max(0, Math.floor(Number(hours) || 0)) * 60 + Math.max(0, Math.floor(Number(minutes) || 0))
  const start = Date.parse(`${day}T${time}:00-03:00`), end = start + total * 60000
  const chosenResource = data.resources.find((item) => resourceKey(item.type, item.id) === resource)
  function pick(value) {
    setChoice(value)
    const row = options.find((item) => `${item.orderCode}|${item.stageCode}` === value)
    if (!block && row?.toPlanMinutes) { setHours(String(Math.floor(row.toPlanMinutes / 60))); setMinutes(String(row.toPlanMinutes % 60)) }
    if (!block && !initial.resourceKey && suggestedKey(row)) setResource(suggestedKey(row))
  }
  async function submit(event) {
    event.preventDefault()
    if (!selected) return setError('Escolha a OS e a etapa.')
    if (!total) return setError('Informe a duração.')
    const [type, ...rest] = resource.split(':')
    setBusy(true); setError('')
    try {
      const body = { orderCode: selected.orderCode, stageCode: selected.stageCode, resourceType: type, resourceId: rest.join(':'), start: new Date(start).toISOString(), minutes: total, quantity: quantity ? Number(quantity) : null }
      await payableRequest(block ? `/planning/blocks/${block.id}` : '/planning/blocks', block ? 'PUT' : 'POST', body)
      onSaved()
    } catch (caught) { setError(caught.message); setBusy(false) }
  }
  async function remove() {
    if (!window.confirm(`Tirar ${block.orderCode} · ${block.stageName} do planejamento?`)) return
    setBusy(true)
    try { await payableRequest(`/planning/blocks/${block.id}`, 'DELETE'); onSaved() } catch (caught) { setError(caught.message); setBusy(false) }
  }
  const machines = data.resources.filter((item) => item.type === 'machine'), services = data.resources.filter((item) => item.type === 'labor-service')
  return <PayableModal title={block ? 'Bloco do planejamento' : 'Planejar serviço'} className="planning-modal" busy={busy} onClose={onClose} footer={<>
    {block && <button className="admin-tool-button planning-remove" type="button" disabled={busy} onClick={remove}><Trash2 size={16} aria-hidden="true" />Tirar do plano</button>}
    <button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button>
    <button className="admin-tool-button admin-tool-button--primary" type="submit" form="planning-form" disabled={busy || !options.length}><CalendarClock size={16} aria-hidden="true" />{busy ? 'Salvando...' : block ? 'Salvar bloco' : 'Planejar'}</button></>}>
    <form id="planning-form" className="planning-form" onSubmit={submit}><fieldset disabled={busy}>
      {!options.length ? <p className="planning-muted">Nenhuma etapa aguardando planejamento.</p> : <>
        <label>OS e etapa<select value={choice} disabled={Boolean(block)} onChange={(event) => pick(event.target.value)}>{options.map((row) => <option key={`${row.orderCode}|${row.stageCode}`} value={`${row.orderCode}|${row.stageCode}`}>{row.orderCode} · {row.service} · {row.stageName}{row.toPlanMinutes ? ` (${duration(row.toPlanMinutes)} a planejar)` : ''}</option>)}</select></label>
        <label>Máquina ou serviço<select value={resource} onChange={(event) => setResource(event.target.value)}>
          <optgroup label="Máquinas">{machines.map((item) => <option key={item.id} value={resourceKey(item.type, item.id)}>{item.name}{item.maintenance ? ' (em manutenção)' : ''}{suggestedKey(selected) === resourceKey(item.type, item.id) ? ' · sugerida' : ''}</option>)}</optgroup>
          {services.length > 0 && <optgroup label="Serviços (hora homem)">{services.map((item) => <option key={item.id} value={resourceKey(item.type, item.id)}>{item.name}{suggestedKey(selected) === resourceKey(item.type, item.id) ? ' · sugerido' : ''}</option>)}</optgroup>}
        </select></label>
        <div className="planning-form-row"><label>Dia<input type="date" value={day} onChange={(event) => event.target.value && setDay(event.target.value)} required /></label><label>Início<select value={time} onChange={(event) => setTime(event.target.value)}>{slots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</select></label></div>
        <div className="planning-form-row"><label>Duração (horas)<input type="number" min="0" step="1" inputMode="numeric" value={hours} onChange={(event) => setHours(event.target.value)} /></label><label>Minutos<input type="number" min="0" max="59" step="1" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label><label>Peças (opcional)<input type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label></div>
        <p className="planning-form-summary">{total ? <>Termina às <strong>{clockTime(end)}</strong>{localDay(end) !== day ? ` de ${shortDate(localDay(end))}` : ''} · {duration(total)}</> : 'Informe a duração.'}{selected?.toPlanMinutes != null && !block && <> · faltam {duration(selected.toPlanMinutes)} desta etapa para planejar</>}</p>
        {chosenResource?.maintenance && <p className="planning-warning" role="status"><Wrench size={14} aria-hidden="true" /> {chosenResource.name} está em manutenção: {chosenResource.maintenance.reason}</p>}
        {selected?.deadline && total > 0 && localDay(end) > selected.deadline && <p className="planning-warning" role="status"><AlertTriangle size={14} aria-hidden="true" /> Termina depois do prazo da OS ({shortDate(selected.deadline)}/{selected.deadline.slice(0, 4)}).</p>}
      </>}
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}
