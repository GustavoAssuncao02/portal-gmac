import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import OperatorProjectInformation from './OperatorProjectInformation.jsx'
import { currentPieceProgress, groupProjectStages } from './serviceProgress.js'
import './operator.css'

const pauseReasons = ['Descanso', 'Horário de almoço', 'Gilson mandou parar', 'Troca de atividade']
const statusLabels = { waiting: 'Aguardando', running: 'Em execução', paused: 'Pausado', finalizing: 'Finalizando', completed: 'Concluído' }
const eventLabels = { started: 'Iniciou o trabalho', resumed: 'Retomou o trabalho', paused: 'Pausou o trabalho', machine_changed: 'Trocou de máquina', stage_progress: 'Registrou peças', completed: 'Concluiu a OS', completion_acknowledged: 'Conclusão confirmada no painel', admin_interrupted: 'Sessão encerrada pelo admin', stages_configured: 'Etapas configuradas', order_edited: 'OS editada pelo admin', order_reopened: 'OS reaberta pelo admin' }

async function request(url, options = {}) {
  const response = await fetch(url, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || 'Não foi possível concluir a operação.')
    error.status = response.status
    throw error
  }
  return data
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((value) => String(value).padStart(2, '0')).join(':')
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'
}

function formatMoment(value) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—'
}

function elapsed(operation, now) {
  return Number(operation.accumulatedMs || 0) + (operation.activeSession ? Math.max(0, now - Date.parse(operation.activeSession.startedAt)) : 0)
}

function currentStage(order) {
  return order.operation.stages.find((stage) => Number(order.operation.stageCounts[stage.key] || 0) < Number(order.quantity))?.name || (order.operation.stages.length ? 'Todas as etapas concluídas' : 'Etapas não definidas')
}

export default function OperatorDashboard({ token, onLogout }) {
  const [orders, setOrders] = useState([])
  const [employees, setEmployees] = useState([])
  const [machines, setMachines] = useState([])
  const [machineId, setMachineId] = useState('')
  const [selectedCode, setSelectedCode] = useState(null)
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const detailHeading = useRef(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState(null)
  const [employeeId, setEmployeeId] = useState('')
  const [pauseReason, setPauseReason] = useState('')
  const [stageQuantity, setStageQuantity] = useState({})
  const [events, setEvents] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  async function refresh(signal) {
    try {
      const [orderResult, employeeResult] = await Promise.all([request('/api/operations/operator/orders', { signal, cache: 'no-store', headers: { Authorization: `Bearer ${token}` } }), request('/api/employees', { signal, cache: 'no-store' })])
      if (signal?.aborted) return
      setOrders(orderResult.items)
      setEmployees(employeeResult.items)
      setSelectedCode((current) => orderResult.items.some((order) => order.code === current) ? current : orderResult.items[0]?.code || null)
      setError('')
    } catch (caught) {
      if (signal?.aborted) return
      if (caught.status === 401) onLogout()
      else setError(caught.message)
    }
  }

  async function refreshEvents(code) {
    if (!code) return setEvents([])
    try { setEvents((await request(`/api/operations/orders/${encodeURIComponent(code)}/events`)).items) } catch (caught) { setError(caught.message) }
  }

  useEffect(() => {
    const controller = new AbortController()
    let updating = false
    const update = async () => {
      if (updating || controller.signal.aborted) return
      updating = true
      try { await refresh(controller.signal) }
      finally { updating = false }
    }
    const resume = () => { if (document.visibilityState !== 'hidden') update() }
    request('/api/machines', { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setMachines(data.items) }).catch((caught) => { if (!controller.signal.aborted) setError(caught.message) })
    update()
    const polling = window.setInterval(update, 10000)
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      controller.abort()
      window.clearInterval(polling)
      window.clearInterval(clock)
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [token])

  useEffect(() => {
    refreshEvents(selectedCode)
    const polling = window.setInterval(() => refreshEvents(selectedCode), 10000)
    return () => window.clearInterval(polling)
  }, [selectedCode])

  const selected = orders.find((order) => order.code === selectedCode)
  const listCollapsed = projectsCollapsed && Boolean(selected)
  useEffect(() => {
    if (listCollapsed) detailHeading.current?.focus({ preventScroll: true })
  }, [listCollapsed, selectedCode])
  const operation = selected?.operation
  const stageGroups = groupProjectStages(operation?.stages)
  let savedSession = null
  try { savedSession = JSON.parse(selected ? window.sessionStorage.getItem(`gmac-operator-session-${selected.code}`) : 'null') } catch { /* sessão antiga sem credencial */ }
  const ownsSession = Boolean(operation?.activeSession && operation.activeSession.id === savedSession?.id && savedSession?.token)
  const visible = orders.filter((order) => {
    const query = search.trim().toLocaleLowerCase()
    return (filter === 'all' ? order.operation.status !== 'completed' : order.operation.status === filter) && (!query || [order.service, order.company, order.code, order.labelNumber].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
  })
  const activeCount = orders.filter((order) => order.operation.status !== 'completed').length
  const runningCount = orders.filter((order) => order.operation.status === 'running' || order.operation.status === 'finalizing').length
  const totalMs = orders.reduce((sum, order) => sum + elapsed(order.operation, now), 0)
  const soonCount = orders.filter((order) => { const days = (Date.parse(`${order.deadline}T23:59:59-03:00`) - now) / 86400000; return order.operation.status !== 'completed' && days >= 0 && days <= 3 }).length

  async function action(url, body, after) {
    setBusy(true)
    setError('')
    try {
      const result = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
      after?.(result)
      await refresh()
      await refreshEvents(selectedCode)
      setDialog(null)
    } catch (caught) {
      if (caught.status === 401) onLogout()
      else setError(caught.message)
    }
    finally { setBusy(false) }
  }

  function begin() {
    if (!selected || !employeeId) return setError('Selecione o seu nome para iniciar o trabalho.')
    action(`/api/operations/orders/${encodeURIComponent(selected.code)}/start`, { employeeId, machineId: machineId || null }, (result) => {
      window.sessionStorage.setItem(`gmac-operator-session-${selected.code}`, JSON.stringify({ id: result.operation.activeSession.id, token: result.sessionToken }))
      setEmployeeId('')
      setMachineId('')
    })
  }

  function pause() {
    if (!selected || !pauseReason) return setError('Selecione a justificativa da pausa.')
    action(`/api/operations/orders/${encodeURIComponent(selected.code)}/pause`, { reason: pauseReason, sessionId: savedSession?.id, sessionToken: savedSession?.token }, () => {
      window.sessionStorage.removeItem(`gmac-operator-session-${selected.code}`)
      setPauseReason('')
    })
  }

  function registerStage(stage) {
    if (!selected) return
    const quantity = Number(stageQuantity[stage.key] || 1)
    action(`/api/operations/orders/${encodeURIComponent(selected.code)}/stages/${stage.key}`, { quantity, sessionId: savedSession?.id, sessionToken: savedSession?.token }, () => setStageQuantity((current) => ({ ...current, [stage.key]: 1 })))
  }

  function changeMachine() {
    if (!selected || !ownsSession) return
    action(`/api/operations/orders/${encodeURIComponent(selected.code)}/machine`, { machineId: machineId || null, sessionId: savedSession.id, sessionToken: savedSession.token }, () => setMachineId(''))
  }

  async function openMachineChange() {
    setMachineId(String(operation.activeSession.machineId ?? ''))
    setError('')
    setDialog('machine')
    try { setMachines((await request('/api/machines', { cache: 'no-store' })).items) }
    catch (caught) { setError(caught.message) }
  }

  function complete() {
    if (!selected) return
    action(`/api/operations/orders/${encodeURIComponent(selected.code)}/complete`, { sessionId: savedSession?.id, sessionToken: savedSession?.token }, () => window.sessionStorage.removeItem(`gmac-operator-session-${selected.code}`))
  }

  function logout() {
    const hasActiveWork = orders.some((order) => {
      const activeSession = order.operation?.activeSession
      if (!activeSession?.id) return false
      try {
        const session = JSON.parse(window.sessionStorage.getItem(`gmac-operator-session-${order.code}`))
        return Boolean(session?.token && session.id === activeSession.id)
      } catch { return false }
    })
    if (hasActiveWork) return setError('Pause o trabalho antes de sair da conta do operador.')
    onLogout()
  }

  return <div className="operator-app">
    <aside className="operator-sidebar">
      <div className="operator-logo"><img src="/images/gmac-logo-transparent.png" alt="GMAC Metalúrgica" /></div>
      <nav><span className="operator-nav-item operator-nav-item--active">▣ <b>Projetos em andamento</b></span></nav>
      <div className="operator-sidebar-bottom"><span className="operator-avatar">OP</span><div><strong>Operador</strong><small>Conta compartilhada</small></div><button type="button" onClick={logout} title="Sair">↪</button></div>
    </aside>
    <main className="operator-main">
      {dialog === 'info' && selected ? <OperatorProjectInformation order={selected} events={events} now={now} onBack={() => setDialog(null)} statusLabels={statusLabels} eventLabels={eventLabels} formatDuration={formatDuration} /> : <>
      {error && <p className="operator-error" role="alert">{error}</p>}
      <div className={`operator-layout ${listCollapsed ? 'operator-layout--focused' : ''}`}>
        <div className={`operator-projects ${listCollapsed ? 'operator-projects--collapsed' : ''}`}>
          <button className="operator-projects-toggle" type="button" disabled={!selected} aria-label={listCollapsed ? 'Mostrar projetos' : 'Recolher projetos'} title={listCollapsed ? 'Mostrar projetos' : 'Recolher projetos'} aria-expanded={!listCollapsed} aria-controls="operator-projects-panel" onClick={() => setProjectsCollapsed((current) => !current)}>{listCollapsed ? <PanelLeftOpen size={20} aria-hidden="true" /> : <PanelLeftClose size={20} aria-hidden="true" />}{listCollapsed && <span>Projetos</span>}</button>
          {listCollapsed && <span className="operator-projects-count" aria-label={`${activeCount} projetos ativos`} title={`${activeCount} projetos ativos`}>{activeCount}</span>}
          <div id="operator-projects-panel" hidden={listCollapsed}>
          <header className="operator-header"><div><h1>Projetos em andamento</h1><p>Acompanhe os projetos ativos e registre o trabalho realizado.</p></div><label className="operator-search">⌕ <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por projeto, cliente ou código..." /></label></header>
          <div className="operator-filters">{[['all', 'Todos'], ['waiting', 'Aguardando'], ['running', 'Em execução'], ['paused', 'Pausado'], ['finalizing', 'Finalizando']].map(([key, label]) => <button className={filter === key ? 'active' : ''} type="button" key={key} onClick={() => setFilter(key)}><span className={`operator-dot operator-dot--${key}`} />{label}</button>)}</div>
        <section className="operator-project-list" aria-label="Projetos abertos">
          {visible.length ? visible.map((order) => <button className={`operator-project ${selectedCode === order.code ? 'operator-project--selected' : ''}`} type="button" key={order.code} onClick={() => { setSelectedCode(order.code); setProjectsCollapsed(true) }}><div className="operator-project-visual">⚙</div><div className="operator-project-content"><div className="operator-project-top"><strong>{order.service}</strong><span className={`operator-status operator-status--${order.operation.status}`}>{statusLabels[order.operation.status]}</span></div><span>{order.company}</span><small>{order.code} · Etiqueta {order.labelNumber}</small><div className="operator-project-bottom"><div><span>Etapa atual</span><strong>{currentStage(order)}</strong></div><div><span>Prazo</span><strong>{formatDate(order.deadline)}</strong></div><div><span>Produzido/total</span><strong>{currentPieceProgress(order.operation, order.quantity).completedPieces}/{order.quantity}</strong></div><div><span>Progresso</span><strong>{order.operation.progress}%</strong><i><b style={{ width: `${order.operation.progress}%` }} /></i></div></div></div></button>) : <div className="operator-empty">Nenhuma OS encontrada para este filtro.</div>}
        </section>
          </div>
        </div>
        <section className="operator-detail" aria-label="Detalhes do projeto">
          {selected ? <>
            <div className="operator-detail-heading"><div><h2 ref={detailHeading} tabIndex={-1}>{selected.service}</h2><p><strong>{selected.code}</strong> · {selected.company}</p></div><span className={`operator-status operator-status--${operation.status}`}>{statusLabels[operation.status]}</span></div>
            <div className="operator-detail-facts"><div><span>▱ Material</span><strong>{selected.resources?.materials?.map((item) => item.name).join(', ') || 'Não informado'}</strong></div><div><span>♙ Responsável</span><strong>{operation.activeSession?.employeeName || 'Aguardando identificação'}</strong></div><div><span>▣ Previsão de entrega</span><strong>{formatDate(selected.deadline)}</strong></div><div><span>⚑ Etapa atual</span><strong>{currentStage(selected)}</strong></div><div><span>◷ Tempo do projeto</span><strong>{formatDuration(elapsed(operation, now))}</strong></div><div><span>◷ Sessão atual</span><strong>{operation.activeSession ? formatDuration(now - Date.parse(operation.activeSession.startedAt)) : '00:00:00'}</strong></div><div><span>◇ Quantidade</span><strong>{selected.quantity} peças</strong></div><div><span>▤ OS vinculada</span><strong>{selected.code}</strong></div><div><span>▥ Cliente</span><strong>{selected.company}</strong></div></div>
            <div className="operator-stages-heading"><h3>Etapas do projeto</h3><strong>{operation.stages.length ? `${operation.stages.reduce((sum, stage) => sum + Number(operation.stageCounts[stage.key] || 0), 0)}/${operation.stages.length * selected.quantity} passagens` : 'Etapas pendentes'}</strong></div>
            {operation.stages.length ? <div className="operator-stage-groups">{stageGroups.map((group) => <section className="operator-stage-group" key={group.stages[0].stage.key} aria-label={`Etapas de ${group.name}`}>
              <div className="operator-stage-group-heading"><h4>{group.name}</h4><span>{group.stages.reduce((sum, { stage }) => sum + Number(operation.stageCounts[stage.key] || 0), 0)}/{group.stages.length * selected.quantity} passagens</span></div>
              <div className="operator-stages">{group.stages.map(({ stage, index }) => {
                const count = Number(operation.stageCounts[stage.key] || 0)
                const previous = selected.resources?.strictProcess === false || index === 0 ? selected.quantity : Number(operation.stageCounts[operation.stages[index - 1].key] || 0)
                const available = Math.min(selected.quantity - count, previous - count)
                return <div className="operator-stage" key={stage.key}>
                  <span className={`operator-stage-number ${count === selected.quantity ? 'done' : ''}`}>{index + 1}</span>
                  <strong>{stage.name}</strong><small>{count}/{selected.quantity} peças</small>
                  {ownsSession && operation.status !== 'completed' && <div className="operator-stage-action"><input type="number" min="1" max={available} step="1" value={stageQuantity[stage.key] || 1} onChange={(event) => setStageQuantity((current) => ({ ...current, [stage.key]: event.target.value }))} aria-label={`Quantidade concluída em ${stage.name}`} /><button type="button" disabled={busy || available < 1} onClick={() => registerStage(stage)}>Registrar</button></div>}
                </div>
              })}</div>
            </section>)}</div> : <p className="operator-empty">Esta OS ainda não tem etapas definidas. Peça ao administrador para selecioná-las nos detalhes da oferta ou configurá-las na OS.</p>}
            <div className="operator-time-banner"><span>◷</span><div><small>Tempo em andamento do projeto</small><strong>{formatDuration(elapsed(operation, now))}</strong></div><div><small>Sessão atual</small><strong>{operation.activeSession ? formatDuration(now - Date.parse(operation.activeSession.startedAt)) : '00:00:00'}</strong><em>{operation.activeSession ? `Iniciada por ${operation.activeSession.employeeName} em ${formatMoment(operation.activeSession.startedAt)}` : operation.lastPauseReason ? `Última pausa: ${operation.lastPauseReason}` : 'Aguardando início'}</em></div></div>
            <div className="operator-actions"><button className="operator-outline" type="button" onClick={() => setDialog('info')}>Visualizar informações do projeto</button>{operation.status !== 'completed' && (ownsSession ? <><button className="operator-primary" type="button" disabled={busy} onClick={() => setDialog('pause')}>Pausar trabalho</button><button className="operator-outline operator-machine-change" type="button" disabled={busy} onClick={openMachineChange}><ArrowLeftRight size={15} aria-hidden="true" />Trocar máquina</button></> : <button className="operator-primary" type="button" disabled={Boolean(operation.activeSession) || !operation.stages.length} onClick={() => setDialog('start')}>Trabalhar neste projeto</button>)}<button className="operator-outline operator-finish" type="button" disabled={!ownsSession || operation.progress < 100 || busy} onClick={() => setDialog('complete')}>Concluir serviço</button></div>
            {operation.activeSession && !ownsSession && <p className="operator-session-note">Esta OS está em execução por {operation.activeSession.employeeName}. Para trocar de operador, a sessão atual precisa ser pausada.</p>}
            <details className="operator-history"><summary>Histórico de atividades ({events.length})</summary>{events.length ? <ol>{[...events].reverse().map((event) => <li key={event.id}><strong>{eventLabels[event.type] || event.type}</strong><span>{event.employeeName || 'Admin'} · {formatMoment(event.at)}{event.stageName ? ` · ${event.stageName}: +${event.quantity} (${event.stageTotal} no total)` : ''}{event.reason ? ` · ${event.reason}` : ''}{event.type === 'machine_changed' ? ` · ${event.details}` : ''}</span></li>)}</ol> : <p>Nenhuma atividade registrada.</p>}</details>
          </> : <div className="operator-empty">Nenhuma OS aberta. As ordens aceitas pelo admin aparecerão aqui.</div>}
        </section>
      </div>
      <section className="operator-stats"><div><span>▣</span><strong>{activeCount}</strong><small>Projetos ativos</small></div><div><span>▶</span><strong>{runningCount}</strong><small>Em execução agora</small></div><div><span>◷</span><strong>{formatDuration(totalMs)}</strong><small>Tempo ativo registrado</small></div><div><span>▣</span><strong>{soonCount}</strong><small>Com prazo em até 3 dias</small></div></section>
      </>}
    </main>
    {dialog && dialog !== 'info' && <div className="operator-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null) }}><section className="operator-dialog" role="dialog" aria-modal="true">
      <button className="operator-dialog-close" type="button" onClick={() => setDialog(null)} aria-label="Fechar">×</button>{error && <p className="operator-error" role="alert">{error}</p>}
      {dialog === 'start' && <><h2>Quem vai trabalhar nesta OS?</h2><p>{selected?.code}</p>
        <label>Funcionário<select aria-label="Funcionário" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Selecione seu nome</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.identification} · {employee.name}</option>)}</select></label>
        <label>Máquina<select aria-label="Máquina" value={machineId} onChange={(event) => setMachineId(event.target.value)}><option value="">Sem máquina / trabalho manual</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}</select></label>
        {!employees.length && <p>Nenhum funcionário cadastrado. Solicite o cadastro ao administrador.</p>}<button className="operator-primary" type="button" disabled={busy || !employees.length} onClick={begin}>{busy ? 'Iniciando...' : 'Iniciar trabalho'}</button>
      </>}
      {dialog === 'pause' && <><h2>Pausar trabalho</h2><p>Escolha a justificativa. O horário e o responsável ficarão registrados na OS.</p><label>Justificativa<select value={pauseReason} onChange={(event) => setPauseReason(event.target.value)}><option value="">Selecione...</option>{pauseReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}</select></label><button className="operator-primary" type="button" disabled={busy} onClick={pause}>{busy ? 'Salvando...' : 'Confirmar pausa'}</button></>}
      {dialog === 'machine' && <><h2>Trocar máquina</h2><p>{selected?.code}</p><p>Máquina atual: <strong>{operation?.activeSession?.machineName || 'Sem máquina / trabalho manual'}</strong></p><label>Nova máquina<select aria-label="Nova máquina" value={machineId} onChange={(event) => setMachineId(event.target.value)}><option value="">Sem máquina / trabalho manual</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}</select></label><button className="operator-primary" type="button" disabled={busy || !ownsSession || machineId === String(operation?.activeSession?.machineId ?? '')} onClick={changeMachine}>{busy ? 'Salvando...' : 'Confirmar troca'}</button></>}
      {dialog === 'complete' && <><h2>Concluir serviço</h2><p>Confirme que todas as {selected?.quantity} peças passaram por cada etapa desta OS.</p><button className="operator-primary" type="button" disabled={busy} onClick={complete}>{busy ? 'Concluindo...' : 'Confirmar conclusão'}</button></>}
    </section></div>}
  </div>
}
