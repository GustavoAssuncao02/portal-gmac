import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { pollWhileVisible } from './polling.js'
import { endings } from './MachineHistoryModal.jsx'
import './machineUsage.css'

// BI of the machines below "Funcionários ociosos": use over a period (the current month by default, any month or a custom
// range) and, further down, everything that happened to one machine on one day. Data from /api/machines/usage and
// /api/machines/:id/day; the green is the same "em uso" of the machine list, maintenance keeps its amber plus stripes.
const zone = 'America/Bahia'
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const shiftDay = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const hours = (ms) => { const minutes = Math.round(Math.max(0, ms) / 60000); return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}min` }
const percent = (share) => `${(share * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const clock = (value) => new Date(value).toLocaleTimeString('pt-BR', { timeZone: zone, hour: '2-digit', minute: '2-digit' })
const moment = (value) => new Date(value).toLocaleString('pt-BR', { timeZone: zone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const dateLabel = (date) => date.split('-').reverse().join('/')
const weekday = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')
const plural = (count, one, many) => `${count.toLocaleString('pt-BR')} ${count === 1 ? one : many}`
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1)

function monthOptions(today) {
  const [year, month] = today.split('-').map(Number)
  return Array.from({ length: 24 }, (_, index) => {
    const first = new Date(Date.UTC(year, month - 1 - index, 1))
    return [first.toISOString().slice(0, 7), capitalize(first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }))]
  })
}
const monthBounds = (value) => { const [year, month] = value.split('-').map(Number); return [`${value}-01`, `${value}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`] }
// A clean top for the hour axis: 1, 2, 2.5, 5 or 10 times a power of ten.
function niceTop(ms) {
  const value = ms / 3600000
  if (value <= 0) return 3600000
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return [1, 2, 2.5, 5, 10].find((factor) => value <= factor * magnitude) * magnitude * 3600000
}
const axisHours = (ms) => `${(ms / 3600000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`

// One hover/focus tooltip per chart, placed over the pointer (or over the focused mark), inside the chart box.
function useTip() {
  const [tip, setTip] = useState(null)
  const show = (event, lines) => {
    const box = event.currentTarget.closest('.usage-chart').getBoundingClientRect()
    const mark = event.currentTarget.getBoundingClientRect()
    const x = event.clientX ? event.clientX : mark.left + mark.width / 2, y = event.clientY ? event.clientY : mark.top
    setTip({ x: Math.min(Math.max(x - box.left, 110), box.width - 110), y: y - box.top, lines })
  }
  return [tip, show, () => setTip(null)]
}
const Tip = ({ tip }) => tip && <div className="usage-tip" role="status" style={{ left: tip.x, top: tip.y }}>{tip.lines.filter(Boolean).map((line, index) => index ? <span key={index}>{line}</span> : <strong key={index}>{line}</strong>)}</div>
const tipHandlers = (show, hide, lines) => ({ onPointerMove: (event) => show(event, lines), onPointerLeave: hide, onFocus: (event) => show(event, lines), onBlur: hide })

const Tile = ({ label, value, note }) => <div className="usage-tile"><span>{label}</span><strong title={typeof value === 'string' ? value : undefined}>{value}</strong>{note && <small>{note}</small>}</div>

function Legend({ items }) {
  return <ul className="usage-legend">{items.map(([kind, label]) => <li key={kind}><i className={`usage-swatch usage-part--${kind}`} aria-hidden="true" />{label}</li>)}</ul>
}

// Most used to least used: each bar is the whole period of the machine, split into use, maintenance and idle time.
function Ranking({ rows, availableMs, onPick, selectedId }) {
  const [tip, show, hide] = useTip()
  if (!rows.length) return <p className="usage-empty">Nenhuma máquina cadastrada.</p>
  const width = (ms) => `${availableMs ? ms / availableMs * 100 : 0}%`
  return <div className="usage-chart usage-ranking">
    <Legend items={[['use', 'Em uso'], ['maintenance', 'Manutenção'], ['idle', 'Ociosa']]} />
    <ol>{rows.map((row, index) => {
      const lines = [row.name, `Em uso: ${hours(row.usedMs)} (${percent(row.utilization)})`, row.maintenanceMs ? `Manutenção: ${hours(row.maintenanceMs)}` : '', `Ociosa: ${hours(row.idleMs)}`, `${plural(row.sessions, 'sessão', 'sessões')} · ${plural(row.pieces, 'peça', 'peças')}`, row.removed ? 'Máquina removida do cadastro' : 'Clique para ver o dia desta máquina']
      return <li key={row.id}><button type="button" className={`usage-ranking-row${String(selectedId) === String(row.id) ? ' usage-ranking-row--selected' : ''}`} disabled={row.removed} onClick={() => onPick(row.id)} aria-label={lines.filter(Boolean).join('. ')} {...tipHandlers(show, hide, lines)}>
        <span className="usage-ranking-position">{index + 1}</span>
        <span className="usage-ranking-name"><strong>{row.name}</strong><small>{row.sector || row.type}</small></span>
        <span className="usage-bar">{row.usedMs > 0 && <i className="usage-part--use" style={{ width: width(row.usedMs) }} />}{row.maintenanceMs > 0 && <i className="usage-part--maintenance" style={{ width: width(row.maintenanceMs) }} />}<i className="usage-part--idle" /></span>
        <span className="usage-ranking-value"><strong>{hours(row.usedMs)}</strong><small>{percent(row.utilization)}</small></span>
      </button></li>
    })}</ol>
    <Tip tip={tip} />
  </div>
}

// Columns of machine time (all machines together) per day or per hour of the day.
function Columns({ items, labelOf, tipOf, everyLabel = 1, onPick, selected, ariaLabel }) {
  const [tip, show, hide] = useTip()
  const top = niceTop(Math.max(0, ...items.map((item) => item.usedMs)))
  const peak = items.reduce((best, item) => item.usedMs > (best?.usedMs ?? 0) ? item : best, null)
  return <div className="usage-chart usage-columns" role="group" aria-label={ariaLabel}>
    <div className="usage-columns-plot">
      {[1, 0.5, 0].map((share) => <div key={share} className="usage-gridline" style={{ bottom: `${share * 100}%` }}><span>{axisHours(top * share)}</span></div>)}
      <div className="usage-columns-bars" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item, index) => {
          const lines = tipOf(item)
          return <button key={index} type="button" className={`usage-column${selected === index ? ' usage-column--selected' : ''}`} disabled={!onPick} onClick={() => onPick?.(item)} aria-label={lines.join('. ')} {...tipHandlers(show, hide, lines)}>
            {item.usedMs > 0 && <i style={{ height: `${item.usedMs / top * 100}%` }} />}
            {item === peak && item.usedMs > 0 && <b style={{ bottom: `${item.usedMs / top * 100}%` }}>{axisHours(item.usedMs)}</b>}
          </button>
        })}
      </div>
    </div>
    <div className="usage-columns-axis" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>{items.map((item, index) => <span key={index} className={selected === index ? 'usage-axis--selected' : ''}>{index % everyLabel === 0 ? labelOf(item) : ''}</span>)}</div>
    <Tip tip={tip} />
  </div>
}

// A thin bar per row, relative to the largest value of the list (people and pause reasons).
function BarList({ rows, valueOf, labelOf, detailOf, kind = 'use', empty }) {
  if (!rows.length) return <p className="usage-empty">{empty}</p>
  const max = Math.max(...rows.map(valueOf))
  return <ul className="usage-bar-list">{rows.map((row, index) => <li key={index}>
    <span className="usage-bar-list-name"><strong>{labelOf(row)}</strong><small>{detailOf(row)}</small></span>
    <span className="usage-bar-list-track"><i className={`usage-part--${kind}`} style={{ width: `${max ? valueOf(row) / max * 100 : 0}%` }} /></span>
  </li>)}</ul>
}

const eventLabels = { started: 'Início do trabalho', resumed: 'Trabalho retomado', paused: 'Pausa', stage_progress: 'Peças registradas', stage_completed: 'Etapa concluída', stage_changed: 'Troca de etapa', completed: 'OS concluída', session_ended: 'Sessão encerrada', admin_interrupted: 'Interrompido pelo administrador', machine_changed: 'Trabalho levado para outra máquina', labor_service_changed: 'Troca de serviço', resource_changed: 'Trabalho levado para outro recurso', machine_arrived: 'Trabalho trazido de outro recurso', maintenance_started: 'Início da manutenção', maintenance_ended: 'Fim da manutenção', idle: 'Máquina ociosa' }
const eventGroup = { started: 'use', resumed: 'use', machine_arrived: 'use', stage_progress: 'piece', maintenance_started: 'maintenance', maintenance_ended: 'maintenance', idle: 'idle' }
function eventText(event) {
  const order = [event.orderCode, event.service].filter(Boolean).join(' · ')
  const stage = event.stageName ? `etapa ${event.stageName}` : ''
  const worked = event.durationMs ? `${hours(event.durationMs)} de trabalho na sessão` : ''
  switch (event.type) {
    case 'started': case 'resumed': return [event.employeeName, order, stage]
    case 'paused': return [event.employeeName, event.reason && `motivo: ${event.reason}`, order, worked]
    case 'stage_progress': return [`${plural(Number(event.quantity) || 0, 'peça', 'peças')} na ${stage || 'etapa'}`, event.stageTotal != null && `total ${event.stageTotal}${event.target ? ` de ${event.target}` : ''}`, event.employeeName, event.registeredBy && `registrado por ${event.registeredBy}`, event.orderCode]
    case 'stage_completed': return [event.employeeName, stage && `${stage} concluída`, order]
    case 'stage_changed': return [event.employeeName, event.details, event.orderCode]
    case 'machine_changed': case 'resource_changed': case 'labor_service_changed': return [event.employeeName, event.otherResource && `para ${event.otherResource}`, order, worked]
    case 'machine_arrived': return [event.employeeName, event.otherResource && `veio de ${event.otherResource}`, order]
    case 'admin_interrupted': return [event.employeeName, event.reason && `motivo: ${event.reason}`, order]
    case 'completed': case 'session_ended': return [event.employeeName, order]
    case 'maintenance_started': return [event.employeeName && `por ${event.employeeName}`, event.reason && `motivo: ${event.reason}`]
    case 'maintenance_ended': return [event.employeeName && `por ${event.employeeName}`, event.durationMs && `durou ${hours(event.durationMs)}`, event.reason]
    case 'idle': return [`por ${hours(event.durationMs)}, até ${clock(event.until)}`]
    default: return [event.employeeName, order, event.details]
  }
}

// From 00:00 to 24:00: in use, under maintenance, idle, and the part of today that has not happened yet.
function DayBar({ day }) {
  const [tip, show, hide] = useTip()
  const start = Date.parse(day.start), span = Date.parse(day.end) - start
  const kinds = { use: 'Em uso', maintenance: 'Manutenção', idle: 'Ociosa', future: 'Ainda não aconteceu' }
  return <div className="usage-chart usage-day-bar">
    <Legend items={[['use', 'Em uso'], ['maintenance', 'Manutenção'], ['idle', 'Ociosa'], ...(day.segments.some((part) => part.kind === 'future') ? [['future', 'Ainda não aconteceu']] : [])]} />
    <div className="usage-day-track">{day.segments.map((part) => {
      const lines = [kinds[part.kind], `${clock(part.start)} às ${part.end === day.end ? '24:00' : clock(part.end)} · ${hours(part.durationMs)}`, part.people?.length ? part.people.join(', ') : '', part.orders?.length ? part.orders.join(', ') : '', part.reason ? `Motivo: ${part.reason}` : '']
      return <button key={part.start} type="button" className={`usage-segment usage-part--${part.kind}`} style={{ left: `${(Date.parse(part.start) - start) / span * 100}%`, width: `max(2px, calc(${part.durationMs / span * 100}% - 2px))` }} aria-label={lines.filter(Boolean).join('. ')} {...tipHandlers(show, hide, lines)} />
    })}</div>
    <div className="usage-day-axis">{[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => <span key={hour} style={{ left: `${hour / 24 * 100}%` }}>{hour}h</span>)}</div>
    <Tip tip={tip} />
  </div>
}

function MachineDay({ request, machines, machineId, onMachine, date, onDate }) {
  const [day, setDay] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const today = todayIso()
  useEffect(() => {
    if (machineId == null) return undefined
    const controller = new AbortController()
    let pending = false
    setDay(null)
    setError('')
    async function refresh() {
      if (pending || controller.signal.aborted) return
      pending = true
      try {
        const data = await request(`/api/machines/${encodeURIComponent(machineId)}/day?date=${date}`, controller.signal)
        if (!controller.signal.aborted) { setDay(data); setError('') }
      } catch (failure) { if (!controller.signal.aborted) setError(failure.message) }
      finally { pending = false }
    }
    refresh()
    // Only today keeps changing.
    const stop = date === today ? pollWhileVisible(refresh, 30000) : () => {}
    return () => { controller.abort(); stop() }
  }, [machineId, date, retry, request, today])
  const entries = useMemo(() => !day ? [] : [...day.events, ...day.segments.filter((part) => part.kind === 'idle' && part.durationMs >= 60000).map((part) => ({ id: `idle|${part.start}`, at: part.start, until: part.end, type: 'idle', durationMs: part.durationMs }))]
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || (left.type === 'idle') - (right.type === 'idle')), [day])
  const summary = day?.summary
  return <section className="machine-summary-card machine-usage-day" id="machine-usage-day" aria-labelledby="machine-usage-day-title">
    <header className="machine-usage-heading"><div><h2 id="machine-usage-day-title">Histórico diário da máquina</h2><p>Tudo o que aconteceu com a máquina no dia: quem iniciou, pausas e motivos, peças, trocas, manutenção e o tempo parada.</p></div>
      <div className="machine-usage-controls">
        <label>Máquina<select aria-label="Máquina do histórico diário" value={machineId ?? ''} onChange={(event) => onMachine(event.target.value)}>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}</select></label>
        <div className="machine-usage-day-picker"><button type="button" onClick={() => onDate(shiftDay(date, -1))} aria-label="Dia anterior" title="Dia anterior"><ChevronLeft size={18} /></button><label>Dia<input aria-label="Dia do histórico" type="date" value={date} max={today} onChange={(event) => event.target.value && onDate(event.target.value)} /></label><button type="button" disabled={date >= today} onClick={() => onDate(shiftDay(date, 1))} aria-label="Dia seguinte" title="Dia seguinte"><ChevronRight size={18} /></button><button type="button" className="machine-usage-today" disabled={date === today} onClick={() => onDate(today)}>Hoje</button></div>
      </div>
    </header>
    {error && <div className="machine-usage-error"><p role="alert">{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button></div>}
    {!machines.length ? <p className="usage-empty">Nenhuma máquina cadastrada.</p> : !day ? !error && <p className="usage-empty" role="status">Carregando o dia...</p> : <>
      <p className="machine-usage-period"><strong>{day.machine.name}</strong>{[day.machine.type, day.machine.sector].filter(Boolean).map((text) => ` · ${text}`)} · {capitalize(weekday(day.date))}, {dateLabel(day.date)}</p>
      <div className="usage-tiles">
        <Tile label="Em uso" value={hours(summary.usedMs)} note={`${percent(summary.utilization)} do dia${day.date === today ? ' até agora' : ''}`} />
        <Tile label="Ociosa" value={hours(summary.idleMs)} note={summary.maintenanceMs ? `Manutenção: ${hours(summary.maintenanceMs)}` : 'Sem manutenção no dia'} />
        <Tile label="Primeiro início" value={summary.firstStartAt ? clock(summary.firstStartAt) : '—'} note={summary.inUse ? 'Em uso agora' : summary.lastEndAt ? `Última parada às ${clock(summary.lastEndAt)}` : 'Não foi usada no dia'} />
        <Tile label="Sessões de trabalho" value={summary.sessions} note={summary.operators.length ? summary.operators.join(', ') : 'Nenhum operador'} />
        <Tile label="Peças registradas" value={summary.pieces} note={summary.orders.length ? summary.orders.join(', ') : 'Nenhuma OS'} />
        <Tile label="Pausas" value={summary.pauses} note={plural(summary.operators.length, 'operador', 'operadores')} />
      </div>
      <DayBar day={day} />
      <div className="machine-usage-day-grid">
        <div><h3>Sessões de trabalho</h3>{day.sessions.length ? <div className="usage-table-scroll"><table className="usage-table"><thead><tr><th>Operador</th><th>OS / serviço</th><th>Etapa</th><th>Início</th><th>Fim</th><th>Tempo no dia</th><th>Como terminou</th></tr></thead><tbody>
          {day.sessions.map((session) => <tr key={`${session.orderCode}|${session.startedAt}`}><td><strong>{session.employeeName}</strong></td><td><strong>{session.orderCode}</strong><small>{session.service}</small></td><td>{session.stageName || '—'}</td><td>{moment(session.startedAt)}</td><td>{session.endedAt ? moment(session.endedAt) : 'Em uso'}</td><td className="usage-number">{hours(session.durationMs)}</td><td>{session.active ? 'Em andamento' : endings[session.endedBy] || 'Encerrada'}{session.reason && <small>{session.reason}</small>}</td></tr>)}
        </tbody></table></div> : <p className="usage-empty">Ninguém usou esta máquina no dia.</p>}</div>
        <div><h3>Linha do tempo</h3>{entries.length ? <ol className="usage-events">{entries.map((entry) => <li key={entry.id} className={`usage-event usage-event--${eventGroup[entry.type] || 'stop'}`}><time dateTime={entry.at}>{clock(entry.at)}</time><i aria-hidden="true" /><div><strong>{eventLabels[entry.type] || entry.type}</strong><p>{eventText(entry).filter(Boolean).join(' · ')}</p></div></li>)}</ol> : <p className="usage-empty">Nenhum acontecimento registrado no dia.</p>}</div>
      </div>
    </>}
  </section>
}

export default function MachineUsageBI({ request, machines }) {
  const today = todayIso()
  const months = useMemo(() => monthOptions(today), [today])
  const [period, setPeriod] = useState(() => months[0][0])
  const [custom, setCustom] = useState(() => ({ start: `${today.slice(0, 7)}-01`, end: today }))
  const [report, setReport] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [dayMachine, setDayMachine] = useState(null), [dayDate, setDayDate] = useState(today)
  const dayPanel = useRef(null)
  const [start, end] = period === 'custom' ? [custom.start, custom.end] : monthBounds(period)
  const invalid = period === 'custom' && (!start || !end || start > end)
  useEffect(() => {
    if (invalid) return undefined
    const controller = new AbortController()
    let pending = false
    setReport(null)
    setError('')
    async function refresh() {
      if (pending || controller.signal.aborted) return
      pending = true
      try {
        const data = await request(`/api/machines/usage?start=${start}&end=${end}`, controller.signal)
        if (!controller.signal.aborted) { setReport(data); setError('') }
      } catch (failure) { if (!controller.signal.aborted) setError(failure.message) }
      finally { pending = false }
    }
    refresh()
    const stop = end >= today ? pollWhileVisible(refresh, 60000) : () => {}
    return () => { controller.abort(); stop() }
  }, [start, end, invalid, retry, request, today])
  // The day panel starts on a machine running now, else the most used of the period, else the first one of the list.
  const preferred = report?.machines.find((row) => row.inUse && !row.removed)?.id ?? report?.summary.mostUsed?.id
  const dayMachineId = dayMachine ?? (machines.some((machine) => String(machine.id) === String(preferred)) ? preferred : machines[0]?.id) ?? null
  const openDay = (id, date) => {
    if (id != null) setDayMachine(String(id))
    if (date) setDayDate(date)
    window.requestAnimationFrame(() => dayPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const summary = report?.summary
  const until = report && report.range.until < report.range.end ? moment(report.range.until) : null
  const registered = machines.filter((machine) => machine.id != null)
  return <>
    <section className="machine-summary-card machine-usage" aria-labelledby="machine-usage-title">
      <header className="machine-usage-heading"><div><h2 id="machine-usage-title">Uso das máquinas por período</h2><p>Tempo em uso, parada e em manutenção de cada máquina, a partir das sessões registradas pelos operadores.</p></div>
        <div className="machine-usage-controls">
          <label>Período<select aria-label="Período" value={period} onChange={(event) => setPeriod(event.target.value)}>{months.map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="custom">Período personalizado</option></select></label>
          {period === 'custom' && <><label>Início<input aria-label="Início do período" type="date" value={custom.start} max={custom.end || today} onChange={(event) => setCustom((current) => ({ ...current, start: event.target.value }))} /></label><label>Fim<input aria-label="Fim do período" type="date" value={custom.end} min={custom.start} onChange={(event) => setCustom((current) => ({ ...current, end: event.target.value }))} /></label></>}
        </div>
      </header>
      {invalid && <p className="machine-usage-error" role="alert">Informe uma data de início anterior ou igual à data final.</p>}
      {error && <div className="machine-usage-error"><p role="alert">{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button></div>}
      {!invalid && !report ? !error && <p className="usage-empty" role="status">Carregando o uso das máquinas...</p> : report && <>
        <p className="machine-usage-period">{dateLabel(start)} a {dateLabel(end)}{until && ` · contado até agora (${until})`} · {plural(summary.machines, 'máquina', 'máquinas')}, {summary.machinesUsed} {summary.machinesUsed === 1 ? 'usada' : 'usadas'} no período</p>
        <div className="usage-tiles">
          <Tile label="Tempo total em uso" value={hours(summary.usedMs)} note={`Utilização média de ${percent(summary.utilization)}`} />
          <Tile label="Máquina mais usada" value={summary.mostUsed?.name || '—'} note={summary.mostUsed ? `${hours(summary.mostUsed.ms)} · ${percent(summary.mostUsed.utilization)} do período` : 'Nenhum uso no período'} />
          <Tile label="Máquina mais ociosa" value={summary.mostIdle?.name || '—'} note={summary.mostIdle ? `${hours(summary.mostIdle.ms)} parada · ${percent(summary.mostIdle.share)} do período` : ''} />
          <Tile label="Sessões de trabalho" value={summary.sessions.toLocaleString('pt-BR')} note={summary.sessions ? `Média de ${hours(summary.avgSessionMs)} por sessão` : 'Nenhuma sessão'} />
          <Tile label="Peças registradas" value={summary.pieces.toLocaleString('pt-BR')} note={`${plural(summary.operators, 'operador', 'operadores')} nas máquinas`} />
          <Tile label="Dia de maior uso" value={summary.busiestDay ? dateLabel(summary.busiestDay.date) : '—'} note={summary.busiestDay ? `${hours(summary.busiestDay.usedMs)} em ${plural(summary.busiestDay.machines, 'máquina', 'máquinas')}` : ''} />
          <Tile label="Horário de pico" value={summary.peakHour == null ? '—' : `${String(summary.peakHour).padStart(2, '0')}:00 às ${String(summary.peakHour + 1).padStart(2, '0')}:00`} note="Hora do dia com mais máquinas rodando" />
          <Tile label="Em manutenção" value={hours(summary.maintenanceMs)} note={`${plural(summary.pauses, 'pausa registrada', 'pausas registradas')} nas máquinas`} />
        </div>
        <div className="machine-usage-block"><h3>Ranking de uso: da mais usada para a menos usada</h3><p>Cada barra é o período inteiro da máquina. Clique em uma máquina para ver o dia dela abaixo.</p>
          <Ranking rows={report.machines} availableMs={report.availableMs} onPick={(id) => openDay(id)} selectedId={dayMachineId} /></div>
        <div className="machine-usage-pair">
          <div className="machine-usage-block"><h3>Uso por dia</h3><p>Horas de máquina somando todas as máquinas. Clique em um dia para abrir o histórico dele.</p>
            <Columns items={report.daily} ariaLabel="Uso das máquinas por dia" labelOf={(day) => Number(day.date.slice(8))} everyLabel={report.daily.length > 16 ? Math.ceil(report.daily.length / 16) : 1} tipOf={(day) => [`${capitalize(weekday(day.date))}, ${dateLabel(day.date)}`, `${hours(day.usedMs)} de máquina`, plural(day.machines, 'máquina usada', 'máquinas usadas')]} onPick={(day) => openDay(null, day.date)} selected={report.daily.findIndex((day) => day.date === dayDate)} /></div>
          <div className="machine-usage-block"><h3>Horários de maior uso</h3><p>Horas de máquina em cada hora do dia, somando o período.</p>
            <Columns items={report.hourly} ariaLabel="Uso das máquinas por hora do dia" labelOf={(row) => `${String(row.hour).padStart(2, '0')}:00`} everyLabel={3} tipOf={(row) => [`Das ${String(row.hour).padStart(2, '0')}:00 às ${String(row.hour + 1).padStart(2, '0')}:00`, `${hours(row.usedMs)} de máquina no período`]} /></div>
        </div>
        <div className="machine-usage-pair">
          <div className="machine-usage-block"><h3>Quem mais usou as máquinas</h3><p>Tempo de cada operador nas máquinas no período.</p>
            <BarList rows={report.operators} valueOf={(person) => person.ms} labelOf={(person) => person.name} detailOf={(person) => `${hours(person.ms)} · ${plural(person.sessions, 'sessão', 'sessões')} · ${plural(person.machines, 'máquina', 'máquinas')} · ${plural(person.pieces, 'peça', 'peças')}`} empty="Nenhum operador usou máquinas no período." /></div>
          <div className="machine-usage-block"><h3>Motivos de pausa nas máquinas</h3><p>Quantas vezes cada motivo parou o trabalho em uma máquina.</p>
            <BarList rows={report.pauseReasons} kind="neutral" valueOf={(row) => row.count} labelOf={(row) => row.reason} detailOf={(row) => plural(row.count, 'pausa', 'pausas')} empty="Nenhuma pausa registrada nas máquinas no período." /></div>
        </div>
        <div className="machine-usage-block"><h3>Detalhes por máquina</h3>
          <div className="usage-table-scroll"><table className="usage-table"><thead><tr><th>Máquina</th><th>Em uso</th><th>Ociosa</th><th>Manutenção</th><th>Utilização</th><th>Sessões</th><th>Operadores</th><th>OS</th><th>Peças</th><th>Pausas</th><th>Média por sessão</th><th>Maior sessão</th><th>Quem mais usou</th><th>Último uso</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>
            {report.machines.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.removed ? 'Removida do cadastro' : row.sector || row.type}</small></td><td className="usage-number">{hours(row.usedMs)}</td><td className="usage-number">{hours(row.idleMs)}</td><td className="usage-number">{row.maintenanceMs ? hours(row.maintenanceMs) : '—'}</td><td className="usage-number">{percent(row.utilization)}</td><td className="usage-number">{row.sessions}</td><td className="usage-number">{row.operators}</td><td className="usage-number">{row.orders}</td><td className="usage-number">{row.pieces}</td><td className="usage-number">{row.pauses}</td><td className="usage-number">{row.sessions ? hours(row.avgSessionMs) : '—'}</td><td className="usage-number">{row.sessions ? hours(row.longestSessionMs) : '—'}</td><td>{row.topOperator?.name || '—'}</td><td>{row.inUse ? 'Em uso agora' : row.lastUsedAt ? moment(row.lastUsedAt) : '—'}</td><td>{!row.removed && <button type="button" className="machine-usage-link" onClick={() => openDay(row.id)}>Ver dia</button>}</td></tr>)}
          </tbody></table></div>
          <p className="machine-usage-note">Ociosa é o tempo do período sem uso e sem manutenção, contando as 24 horas de cada dia (o sistema ainda não tem horário de expediente cadastrado).</p>
        </div>
      </>}
    </section>
    <div ref={dayPanel} className="machine-usage-day-anchor"><MachineDay request={request} machines={registered} machineId={dayMachineId} onMachine={(id) => setDayMachine(id)} date={dayDate} onDate={setDayDate} /></div>
  </>
}
