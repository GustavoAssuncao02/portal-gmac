import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { payableRequest } from './payablesApi.js'
import { pollWhileVisible } from './polling.js'
import { elapsedLabel, factoryStations, sessionStart } from './factoryMapData.js'
import { MachineArt, MachinePart, Worker, paletteFor, workScripts } from './FactoryMapArt.jsx'
import FactoryScene, { HEIGHT, WIDTH, floorMark } from './FactoryMapScene.jsx'
import './factoryMap.css'
import { upper } from './displayCase.js'

// Mapa da fábrica no Planejamento: mostra a situação de agora, seja qual for a data da agenda. Só lê as OS e as máquinas;
// não grava nada. Posto parado em preto e branco; posto com alguém trabalhando em cores, com o funcionário em movimento.
const OPEN_KEY = 'gmac-factory-map-open'

// O nome de cada posto, logo abaixo da marcação no piso.
function labelAt(station) {
  const scale = station.scale || 1
  if (station.side === 'bottom') return { x: station.x, y: station.y + 50 * scale, textAnchor: 'middle' }
  if (station.side === 'right') return { x: station.x + 32 * scale, y: station.y + 32 * scale, textAnchor: 'middle' }
  if (station.art === 'booth') return { x: station.x, y: station.y + 26, textAnchor: 'middle' }
  return { x: station.x, y: station.y + 32 * scale, textAnchor: 'middle' }
}
function statusOf(station) {
  if (station.work.length) return 'working'
  if (station.maintenance) return 'maintenance'
  return station.registered ? 'idle' : 'unregistered'
}
const statusText = { idle: 'Parado agora', maintenance: 'Em manutenção', unregistered: 'Ainda não cadastrada como máquina' }

function Station({ station, active, onFocus, onLeave, onToggle }) {
  const status = statusOf(station), working = status === 'working'
  const palette = paletteFor(working, station.tone)
  // Um desencontro entre os postos, para cada um trabalhar no seu ritmo.
  const delay = [...station.key].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 1500
  const behind = workScripts[station.script].behind
  const label = working ? `${station.machineName}: ${station.work.map((session) => session.employeeName).join(', ')} trabalhando. Ver detalhes.` : `${station.machineName}: ${station.service ? 'bancada de serviços livre' : statusText[status]}. Ver detalhes.`
  return <g className={`factory-station factory-station--${status}${active ? ' factory-station--active' : ''}`} data-station={station.key} transform={`translate(${station.x} ${station.y}) scale(${station.scale || 1})`} role="button" tabIndex={0} aria-label={label} aria-pressed={active}
    onMouseEnter={() => onFocus(station.key)} onMouseLeave={onLeave} onFocus={() => onFocus(station.key)} onBlur={onLeave}
    onClick={(event) => { event.stopPropagation(); onToggle(station.key) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(station.key) } }}>
    {station.art !== 'booth' && <rect className="factory-floor-mark" {...floorMark(station)} rx={3} style={{ stroke: palette.floor }} />}
    {working && behind && <Worker script={station.script} palette={palette} layer="back" delay={delay} />}
    <MachineArt type={station.art} palette={palette} />
    {!working && <MachinePart script={station.script} palette={palette} />}
    {working && <Worker script={station.script} palette={palette} layer={behind ? 'front' : undefined} delay={delay} />}
    <rect className="factory-hit" x={station.side === 'left' ? -130 : -92} y={-112} width={station.side === 'left' || station.side === 'right' ? 230 : 184} height={station.art === 'booth' ? 145 : 166} />
  </g>
}

function Details({ station, now }) {
  const status = statusOf(station)
  // A caixa fica sempre dentro do mapa: abre para o lado e para cima ou para baixo conforme o posto.
  const left = Math.min(84, Math.max(16, station.x / WIDTH * 100)), below = station.y < 500
  const top = (station.y + (below ? 90 : -125)) / HEIGHT * 100
  return <div className={`factory-details${below ? '' : ' factory-details--above'}`} style={{ left: `${left}%`, top: `${top}%` }} role="status">
    {status === 'working' ? station.work.map((session) => <div key={session.id || session.employeeName}>
      <strong>{session.employeeName || 'Operador não identificado'}</strong>
      <span>{upper(station.machineName)}</span>
      <em>Trabalhando há {elapsedLabel(now - sessionStart(session))}</em>
      {session.orderCode && <small>{session.orderCode}{session.workStageName || session.stageName ? ` · ${session.workStageName || session.stageName}` : ''}{session.orderService ? ` · ${session.orderService}` : ''}</small>}
    </div>) : <div><strong>{upper(station.machineName)}</strong><span>{station.service ? 'Bancada de serviços livre' : statusText[status]}</span>{status === 'maintenance' && station.maintenance.reason && <small>{station.maintenance.reason}</small>}{station.art === 'booth' && <small>Os postos são preenchidos pela ordem de quem está no serviço de pintura.</small>}</div>}
  </div>
}

export default function FactoryMap() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) !== 'false' } catch { return true } })
  const [data, setData] = useState(null), [failed, setFailed] = useState(false), [now, setNow] = useState(Date.now())
  const [hovered, setHovered] = useState(null), [pinned, setPinned] = useState(null)
  const latest = useRef(0)
  useEffect(() => {
    if (!open) return undefined
    let active = true
    const load = async () => {
      const id = ++latest.current
      try {
        const [orders, machines] = await Promise.all([payableRequest('/operations/orders'), payableRequest('/machines')])
        if (active && id === latest.current) { setData({ orders: orders.items || [], machines: machines.items || [] }); setFailed(false) }
      } catch { if (active && id === latest.current) setFailed(true) }
    }
    load()
    const stop = pollWhileVisible(load, 10000)
    return () => { active = false; stop() }
  }, [open])
  // O relógio de quem está trabalhando só anda enquanto uma caixa de detalhes está aberta.
  const key = pinned || hovered
  useEffect(() => {
    if (!key) return undefined
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [key])
  useEffect(() => {
    if (!pinned) return undefined
    const close = () => setPinned(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [pinned])
  const toggle = () => { const value = !open; setOpen(value); try { localStorage.setItem(OPEN_KEY, String(value)) } catch { /* só não lembra a escolha */ } }

  const { stations, outside, working } = factoryStations(data?.orders, data?.machines)
  const ordered = [...stations].sort((left, right) => left.y - right.y)
  const shown = stations.find((station) => station.key === key)
  return <section className={`factory-map${open ? '' : ' factory-map--closed'}`} aria-label="Mapa da fábrica">
    <header className="factory-map-heading">
      <div><h2>Área de trabalho</h2><p>Situação de agora, independente da data da agenda.</p></div>
      <div className="factory-map-summary">
        {open && data && <span className={working ? 'factory-map-count factory-map-count--on' : 'factory-map-count'} role="status"><i />{working === 0 ? 'Ninguém trabalhando agora' : `${working} ${working === 1 ? 'pessoa trabalhando' : 'pessoas trabalhando'}`}</span>}
        <button className="admin-tool-button" type="button" aria-expanded={open} onClick={toggle}>{open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}{open ? 'Recolher' : 'Mostrar mapa'}</button>
      </div>
    </header>
    {open && <>
      {failed && <p className="factory-map-warning" role="status">Não foi possível atualizar o mapa agora. Ele tenta de novo sozinho.</p>}
      <div className="factory-map-scroll"><div className="factory-map-canvas">
        <FactoryScene />
        <svg className="factory-map-stations" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label="Postos de trabalho da fábrica">
          {ordered.map((station) => <Station key={station.key} station={station} active={key === station.key} onFocus={setHovered} onLeave={() => setHovered(null)} onToggle={(value) => setPinned((current) => current === value ? null : value)} />)}
          {/* Os nomes por cima de tudo: um equipamento alto não cobre o nome do posto de trás. */}
          <g className="factory-labels">{ordered.map((station) => <text key={station.key} className={`factory-station-label factory-station-label--${statusOf(station)}${key === station.key ? ' factory-station-label--active' : ''}`} {...labelAt(station)}>{upper(station.label)}</text>)}</g>
        </svg>
        <div className="factory-map-vignette" />
        {shown && <Details station={shown} now={now} />}
      </div></div>
      {outside.length > 0 && <p className="factory-map-outside" role="status"><strong>Fora da planta agora:</strong> {outside.map((session) => `${session.employeeName || 'Operador não identificado'} (${session.resourceName})`).join(' · ')}</p>}
    </>}
  </section>
}
