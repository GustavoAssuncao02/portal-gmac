import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import './employeeActivity.css'
import './machineHistory.css'

const periods = [['all', 'Desde sempre'], ['today', 'Hoje'], ['yesterday', 'Ontem'], ['7days', 'Últimos 7 dias'], ['30days', 'Últimos 30 dias'], ['date', 'Data específica']]
const endings = { paused: 'Trabalho pausado', completed: 'OS concluída', machine_changed: 'Troca de máquina', labor_service_changed: 'Troca de serviço', resource_changed: 'Troca para serviço de hora homem', session_ended: 'OS concluída', admin_interrupted: 'Interrupção administrativa' }
const moment = (value) => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
const duration = (ms) => {
  const seconds = Math.floor(ms / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map((part) => String(part).padStart(2, '0')).join(':')
}

export default function MachineHistoryModal({ machine, subject = 'machine', loadHistory, onClose }) {
  const dialog = useRef(null)
  const [period, setPeriod] = useState('all')
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const element = dialog.current, previousFocus = document.activeElement, previousOverflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus({ preventScroll: true }) }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    setItems(null)
    setError('')
    if (period === 'date' && !date) { setItems([]); return () => controller.abort() }
    const query = new URLSearchParams({ period, ...(period === 'date' ? { date } : {}) })
    async function refresh() {
      if (pending || controller.signal.aborted) return
      pending = true
      try {
        const data = await loadHistory(machine.id, query, controller.signal)
        if (!controller.signal.aborted) { setItems(data.items); setError('') }
      } catch (failure) { if (!controller.signal.aborted) { setError(failure.message); setItems((current) => current || []) } }
      finally { pending = false }
    }
    refresh()
    const polling = window.setInterval(refresh, 10000)
    return () => { controller.abort(); window.clearInterval(polling) }
  }, [machine.id, period, date, retry, loadHistory])

  return <dialog ref={dialog} className="employee-activity-modal machine-history-modal" aria-labelledby="machine-history-title" onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => {
    if (event.target !== event.currentTarget) return
    const box = event.currentTarget.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose()
  }}>
    <header className="employee-activity-heading"><div><span>{subject === 'service' ? 'Histórico de uso do serviço' : 'Histórico de uso da máquina'}</span><h2 id="machine-history-title">{machine.name}</h2><p>{[machine.type, machine.sector].filter(Boolean).join(' · ')}</p></div><button className="employee-activity-close" type="button" onClick={onClose} title="Fechar histórico" aria-label="Fechar histórico"><X size={18} /></button></header>
    <div className="employee-activity-filters"><label>Período<select aria-label="Período" value={period} onChange={(event) => setPeriod(event.target.value)}>{periods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{period === 'date' && <label>Data específica<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>}<span role="status">{items === null ? 'Carregando...' : `${items.length} ${items.length === 1 ? 'utilização' : 'utilizações'}`}</span></div>
    {error && <div className="employee-activity-error"><p role="alert">{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button></div>}
    <div className="employee-activity-content" aria-busy={items === null}><div className="employee-activity-table-scroll"><table><thead><tr><th>Operador</th><th>OS / Serviço</th><th>Início</th><th>Encerramento</th><th>Tempo no período</th><th>Situação</th></tr></thead><tbody>
      {items === null ? <tr><td colSpan={6} className="employee-activity-empty">Carregando histórico...</td></tr> : items.length ? items.map((item) => <tr key={item.id}>
        <td data-label="Operador"><strong>{item.employeeName}</strong></td><td data-label="OS / Serviço"><strong>{item.orderCode}</strong><span>{item.service}</span></td><td data-label="Início">{moment(item.startedAt)}</td><td data-label="Encerramento">{item.endedAt ? moment(item.endedAt) : 'Em andamento'}</td><td data-label="Tempo no período" className="machine-history-duration">{duration(item.durationMs)}</td><td data-label="Situação"><span className={`machine-history-status ${item.active ? 'machine-history-status--active' : ''}`}>{item.active ? 'Em uso' : endings[item.endedBy] || 'Utilização encerrada'}</span>{item.reason && <small>{item.reason}</small>}</td>
      </tr>) : <tr><td colSpan={6} className="employee-activity-empty">{period === 'date' && !date ? 'Selecione uma data.' : 'Nenhuma utilização registrada neste período.'}</td></tr>}
    </tbody></table></div></div>
  </dialog>
}
