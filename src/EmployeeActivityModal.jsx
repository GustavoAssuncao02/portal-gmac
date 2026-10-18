import { useEffect, useRef, useState } from 'react'
import './employeeActivity.css'

const periods = [['today', 'Hoje'], ['yesterday', 'Ontem'], ['7days', 'Últimos 7 dias'], ['30days', 'Últimos 30 dias'], ['all', 'Desde sempre'], ['date', 'Data específica']]
const labels = { started: 'Trabalho iniciado', resumed: 'Trabalho retomado', paused: 'Trabalho pausado', machine_changed: 'Troca de máquina', labor_service_changed: 'Troca de serviço de hora homem', resource_changed: 'Troca entre máquina e serviço', session_ended: 'Sessão encerrada na conclusão da OS', stage_progress: 'Peças registradas', completed: 'OS concluída', admin_interrupted: 'Interrupção administrativa' }
const formatMoment = (at) => new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })

function details(event) {
  const parts = []
  if (event.stageName) parts.push(`${event.stageName}: +${event.quantity} peças (${event.stageTotal}${event.targetQuantity ? `/${event.targetQuantity}` : ''} no total)`)
  if (event.reason) parts.push(event.reason)
  if (event.durationMs != null) {
    const seconds = Math.max(0, Math.floor(Number(event.durationMs) / 1000))
    const duration = [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map((value) => String(value).padStart(2, '0')).join(':')
    parts.push(`${event.type === 'machine_changed' ? 'Tempo na máquina anterior' : ['labor_service_changed', 'resource_changed'].includes(event.type) ? 'Tempo no recurso anterior' : 'Tempo da sessão'}: ${duration}`)
  }
  if (event.type === 'admin_interrupted') parts.push('Encerrada pelo administrador')
  if (event.details) parts.push(Array.isArray(event.details) ? event.details.join(', ') : String(event.details))
  return parts.join(' · ') || '—'
}

export default function EmployeeActivityModal({ employee, onClose }) {
  const dialog = useRef(null)
  const [period, setPeriod] = useState('today')
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus({ preventScroll: true }) }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    setItems([])
    if (period === 'date' && !date) { setLoading(false); return () => controller.abort() }
    setLoading(true)
    const query = new URLSearchParams({ period, ...(period === 'date' ? { date } : {}) })
    fetch(`/api/employees/${encodeURIComponent(employee.id)}/activities?${query}`, { signal: controller.signal, headers: { Authorization: `Bearer ${window.sessionStorage.getItem('gmac-admin-token') || ''}` } })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Não foi possível carregar o histórico.')
        if (!controller.signal.aborted) setItems(data.items)
      })
      .catch((caught) => { if (!controller.signal.aborted) setError(caught.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [employee.id, period, date, retry])

  return <dialog ref={dialog} className="employee-activity-modal" aria-labelledby="employee-activity-title" onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => {
    if (event.target !== event.currentTarget) return
    const box = event.currentTarget.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose()
  }}>
    <header className="employee-activity-heading"><div><span>Histórico de atividades</span><h2 id="employee-activity-title">{employee.name}</h2><p>Código {employee.identification}</p></div><button className="employee-activity-close" type="button" onClick={onClose} aria-label="Fechar histórico" title="Fechar histórico">{'×'}</button></header>
    <div className="employee-activity-filters"><label>Período<select aria-label="Período" value={period} onChange={(event) => setPeriod(event.target.value)}>{periods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{period === 'date' && <label>Data específica<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>}<span role="status">{loading ? 'Carregando...' : `${items.length} ${items.length === 1 ? 'atividade' : 'atividades'}`}</span></div>
    <div className="employee-activity-content" aria-busy={loading}>
      {error ? <div className="employee-activity-error"><p role="alert">{error}</p><button type="button" onClick={() => setRetry((current) => current + 1)}>Tentar novamente</button></div> : <div className="employee-activity-table-scroll"><table><thead><tr><th>Data e hora</th><th>OS / Projeto</th><th>Atividade</th><th>Detalhes</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={4} className="employee-activity-empty">Carregando atividades...</td></tr> : items.length ? items.map((event) => <tr key={event.id}><td className="employee-activity-date">{formatMoment(event.at)}{event.originalAt && <small>Horário editado · original: {formatMoment(event.originalAt)}</small>}</td><td><strong>{event.orderCode}</strong>{event.service && <span>{event.service}</span>}{event.company && <small>{event.company}</small>}</td><td><span className={`employee-activity-type employee-activity-type--${event.type}`}>{labels[event.type] || event.type}</span></td><td>{details(event)}</td></tr>) : <tr><td colSpan={4} className="employee-activity-empty">{period === 'date' && !date ? 'Selecione uma data.' : 'Nenhuma atividade registrada neste período.'}</td></tr>}
      </tbody></table></div>}
    </div>
  </dialog>
}
