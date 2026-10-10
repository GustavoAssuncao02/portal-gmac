import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import OperatorProjectInformation from './OperatorProjectInformation.jsx'
import PendingMaterialsModal from './PendingMaterialsModal.jsx'
import { pollWhileVisible } from './polling.js'
import { pendingOrderMaterials } from '../server/pendingMaterials.js'
import { activeEmployeeNames, activeSessions, activeSince, operationElapsed } from '../server/operationSessions.js'
import { currentPieceProgress, groupProjectStages } from './serviceProgress.js'
import './operator.css'

const pauseReasons = ['Descanso', 'Horário de almoço', 'Gilson mandou parar', 'Troca de atividade']
const statusLabels = { waiting: 'Aguardando', running: 'Em execução', paused: 'Pausado', finalizing: 'Finalizando', completed: 'Concluído' }
const eventLabels = { started: 'Iniciou o trabalho', resumed: 'Retomou o trabalho', paused: 'Pausou o trabalho', machine_changed: 'Trocou de máquina', labor_service_changed: 'Trocou de serviço de hora homem', resource_changed: 'Trocou entre máquina e serviço', session_ended: 'Sessão encerrada na conclusão', stage_progress: 'Registrou peças', completed: 'Concluiu a OS', completion_acknowledged: 'Conclusão confirmada no painel', admin_interrupted: 'Sessão encerrada pelo admin', stages_configured: 'Etapas configuradas', order_edited: 'OS editada pelo admin', order_reopened: 'OS reaberta pelo admin' }
const resourceTypes = [['machine', 'Máquina'], ['labor-service', 'Serviço de hora homem']]

async function request(url, options = {}) {
  const response = await fetch(url, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || 'Não foi possível concluir a operação.')
    error.status = response.status
    error.code = data.code
    error.pendingMaterials = data.pendingMaterials
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

function currentStage(order) {
  return order.operation.stages.find((stage) => Number(order.operation.stageCounts[stage.key] || 0) < Number(order.quantity))?.name || (order.operation.stages.length ? 'Todas as etapas concluídas' : 'Etapas não definidas')
}

function resourceDescription(session) {
  return session?.machineName ? `Máquina: ${session.machineName}` : session?.laborServiceName ? `Serviço: ${session.laborServiceName}` : 'Sem máquina ou serviço informado'
}

// Credentials of the work sessions started in this browser, by OS: { [sessionId]: token }.
const sessionsKey = (code) => `gmac-operator-sessions-${code}`
const legacySessionKey = (code) => `gmac-operator-session-${code}`

function savedSessions(code) {
  let saved = {}
  try { saved = JSON.parse(window.sessionStorage.getItem(sessionsKey(code)) || '{}') || {} } catch { /* credenciais ilegíveis */ }
  try {
    const legacy = JSON.parse(window.sessionStorage.getItem(legacySessionKey(code)) || 'null')
    if (legacy?.id && legacy.token) saved = { ...saved, [legacy.id]: legacy.token }
  } catch { /* sessão antiga sem credencial */ }
  return saved
}

function writeSessions(code, sessions) {
  try {
    window.sessionStorage.removeItem(legacySessionKey(code))
    if (Object.keys(sessions).length) window.sessionStorage.setItem(sessionsKey(code), JSON.stringify(sessions))
    else window.sessionStorage.removeItem(sessionsKey(code))
  } catch { /* armazenamento indisponível */ }
}

function rememberSession(code, id, token) { writeSessions(code, { ...savedSessions(code), [id]: token }) }

function forgetSessions(code, ids) {
  const sessions = savedSessions(code)
  for (const id of ids) delete sessions[id]
  writeSessions(code, sessions)
}

export default function OperatorDashboard({ token, onLogout }) {
  const [orders, setOrders] = useState([])
  const [employees, setEmployees] = useState([])
  const [machines, setMachines] = useState([])
  const [laborServices, setLaborServices] = useState([])
  const [resourceType, setResourceType] = useState('')
  const [resourceId, setResourceId] = useState('')
  const [selectedCode, setSelectedCode] = useState(null)
  const [selectedWorker, setSelectedWorker] = useState(null)
  const [dialogSessionId, setDialogSessionId] = useState(null)
  const [pendingStage, setPendingStage] = useState(null)
  const [completedBy, setCompletedBy] = useState('')
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const detailHeading = useRef(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState(null)
  const [pendingStart, setPendingStart] = useState(null)
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
    request('/api/labor-services', { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setLaborServices(data.items) }).catch((caught) => { if (!controller.signal.aborted) setError(caught.message) })
    update()
    const stopPolling = pollWhileVisible(update, 10000)
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      controller.abort()
      stopPolling()
      window.clearInterval(clock)
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [token])

  useEffect(() => {
    refreshEvents(selectedCode)
    return pollWhileVisible(() => refreshEvents(selectedCode), 10000)
  }, [selectedCode])

  const selected = orders.find((order) => order.code === selectedCode)
  const listCollapsed = projectsCollapsed && Boolean(selected)
  useEffect(() => {
    if (listCollapsed) detailHeading.current?.focus({ preventScroll: true })
  }, [listCollapsed, selectedCode])
  const operation = selected?.operation
  const stageGroups = groupProjectStages(operation?.stages)
  const sessions = activeSessions(operation)
  const credentials = selected ? savedSessions(selected.code) : {}
  const ownedSessions = sessions.filter((session) => credentials[session.id])
  const credentialFor = (session) => ({ sessionId: session.id, sessionToken: credentials[session.id] })
  const dialogSession = sessions.find((session) => session.id === dialogSessionId)
  const workingEmployeeIds = new Set(sessions.map((session) => String(session.employeeId)))
  const currentSessionStart = activeSince(operation)
  const visible = orders.filter((order) => {
    const query = search.trim().toLocaleLowerCase()
    return (filter === 'all' ? order.operation.status !== 'completed' : order.operation.status === filter) && (!query || [order.service, order.company, order.code, order.labelNumber].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
  })
  const activeCount = orders.filter((order) => order.operation.status !== 'completed').length
  const runningCount = orders.filter((order) => order.operation.status === 'running' || order.operation.status === 'finalizing').length
  const totalMs = orders.reduce((sum, order) => sum + operationElapsed(order.operation, now), 0)
  const soonCount = orders.filter((order) => { const days = (Date.parse(`${order.deadline}T23:59:59-03:00`) - now) / 86400000; return order.operation.status !== 'completed' && days >= 0 && days <= 3 }).length

  // Collapses the worker actions once that employee is no longer working on the selected OS.
  // While an action is saving, the list may not include a session that has just started.
  useEffect(() => {
    if (!busy && selectedWorker && !sessions.some((session) => session.id === selectedWorker)) setSelectedWorker(null)
  }, [busy, selectedWorker, sessions.map((session) => session.id).join()])

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
      else if (caught.code === 'PENDING_MATERIALS') {
        setPendingStart({ code: selectedCode, materials: caught.pendingMaterials })
        setDialog('pending-materials')
        setError('')
      }
      else if (caught.code === 'COMPLETED_BY_REQUIRED') {
        // Another employee joined after the screen was loaded: ask who completed the stage.
        await refresh()
        setCompletedBy('')
        setDialog('completed-by')
        setError('')
      }
      else setError(caught.message)
    }
    finally { setBusy(false) }
  }

  async function loadResources() {
    try {
      const [machineResult, serviceResult] = await Promise.all([request('/api/machines', { cache: 'no-store' }), request('/api/labor-services', { cache: 'no-store' })])
      setMachines(machineResult.items)
      setLaborServices(serviceResult.items)
    } catch (caught) { setError(caught.message) }
  }

  function begin(confirmed) {
    if (!selected || !employeeId) return setError('Selecione o seu nome para iniciar o trabalho.')
    if (!resourceType || !resourceId) return setError(resourceType === 'labor-service' ? 'Selecione o serviço de hora homem.' : resourceType === 'machine' ? 'Selecione a máquina.' : 'Selecione se vai usar uma máquina ou um serviço de hora homem.')
    if (confirmed?.code && confirmed.code !== selected.code) {
      setDialog(null)
      return setError('O projeto selecionado mudou. Selecione novamente a OS para iniciar o trabalho.')
    }
    const pending = pendingOrderMaterials(selected)
    if (pending.length && confirmed?.code !== selected.code) {
      setPendingStart({ code: selected.code, materials: pending })
      setError('')
      return setDialog('pending-materials')
    }
    const code = selected.code
    action(`/api/operations/orders/${encodeURIComponent(code)}/start`, { employeeId, machineId: resourceType === 'machine' ? resourceId : null, laborServiceId: resourceType === 'labor-service' ? resourceId : null, ...(confirmed?.code === code ? { pendingMaterialsConfirmation: confirmed.materials.map((material) => [material.key, material.quantity]) } : {}) }, (result) => {
      rememberSession(code, result.session.id, result.sessionToken)
      setSelectedWorker(result.session.id)
      setEmployeeId('')
      setResourceType('')
      setResourceId('')
    })
  }

  function openPause(session) {
    setDialogSessionId(session.id)
    setPauseReason('')
    setError('')
    setDialog('pause')
  }

  function pause() {
    if (!selected || !dialogSession) return
    if (!pauseReason) return setError('Selecione a justificativa da pausa.')
    const code = selected.code, sessionId = dialogSession.id
    action(`/api/operations/orders/${encodeURIComponent(code)}/pause`, { reason: pauseReason, ...credentialFor(dialogSession) }, () => {
      forgetSessions(code, [sessionId])
      setPauseReason('')
    })
  }

  function registerStage(stage, worker) {
    if (!selected || !ownedSessions.length) return
    const quantity = Number(stageQuantity[stage.key] || 1)
    if (!worker && sessions.length > 1) {
      setPendingStage({ stage, quantity })
      setCompletedBy('')
      setError('')
      return setDialog('completed-by')
    }
    // Any session started in this browser authorizes the record; the event is credited to the selected employee.
    const credential = credentialFor(worker && credentials[worker.id] ? worker : ownedSessions[0])
    setPendingStage({ stage, quantity })
    action(`/api/operations/orders/${encodeURIComponent(selected.code)}/stages/${stage.key}`, { quantity, ...credential, ...(worker ? { completedBySessionId: worker.id } : {}) }, () => {
      setStageQuantity((current) => ({ ...current, [stage.key]: 1 }))
      setPendingStage(null)
    })
  }

  function confirmCompletedBy() {
    const worker = sessions.find((session) => session.id === completedBy)
    if (!pendingStage) return setDialog(null)
    if (!worker) return setError('Selecione quem concluiu esta etapa.')
    registerStage(pendingStage.stage, worker)
  }

  // One dialog for both kinds: it opens on what the employee is using now and lets them move to the other kind.
  async function openResourceChange(session) {
    const type = session.machineId != null ? 'machine' : session.laborServiceId != null ? 'labor-service' : ''
    setDialogSessionId(session.id)
    setResourceType(type)
    setResourceId(String((type === 'machine' ? session.machineId : type === 'labor-service' ? session.laborServiceId : '') ?? ''))
    setError('')
    setDialog('resource')
    await loadResources()
  }

  function changeResource() {
    if (!selected || !dialogSession || !credentials[dialogSession.id]) return
    if (!resourceType || !resourceId) return setError(resourceType === 'labor-service' ? 'Selecione o serviço de hora homem.' : 'Selecione a máquina.')
    action(`/api/operations/orders/${encodeURIComponent(selected.code)}/resource`, { resourceType, resourceId, ...credentialFor(dialogSession) }, () => { setResourceType(''); setResourceId('') })
  }

  async function openStart() {
    setError('')
    setEmployeeId('')
    const suggested = selected?.resources?.laborEntries?.filter((row) => row.type === 'person' && row.laborServiceId) || []
    setResourceType(suggested.length === 1 ? 'labor-service' : '')
    setResourceId(suggested.length === 1 ? String(suggested[0].laborServiceId) : '')
    setDialog('start')
    await loadResources()
  }

  function complete() {
    if (!selected || !ownedSessions.length) return
    const code = selected.code
    action(`/api/operations/orders/${encodeURIComponent(code)}/complete`, credentialFor(ownedSessions[0]), () => forgetSessions(code, sessions.map((session) => session.id)))
  }

  function logout() {
    const hasActiveWork = orders.some((order) => {
      const saved = savedSessions(order.code)
      return activeSessions(order.operation).some((session) => saved[session.id])
    })
    if (hasActiveWork) return setError('Pause o trabalho antes de sair da conta do operador.')
    onLogout()
  }

  const resourceFields = (prefix) => {
    const options = resourceType === 'machine' ? machines : laborServices
    const label = resourceType === 'machine' ? `${prefix === 'new' ? 'Nova máquina' : 'Máquina'}` : `${prefix === 'new' ? 'Novo serviço' : 'Serviço de hora homem'}`
    return <>
      <fieldset className="operator-resource-type" disabled={busy}><legend>{prefix === 'new' ? 'Trocar para' : 'Recurso utilizado'}</legend>
        {resourceTypes.map(([key, text]) => <label key={key}><input type="radio" name={`operator-resource-${prefix}`} value={key} checked={resourceType === key} onChange={() => { setResourceType(key); setResourceId(prefix === 'new' ? String((key === 'machine' ? dialogSession?.machineId : dialogSession?.laborServiceId) ?? '') : ''); setError('') }} />{text}</label>)}
      </fieldset>
      {resourceType && <label>{label}<select aria-label={label} value={resourceId} onChange={(event) => { setResourceId(event.target.value); setError('') }}><option value="">{resourceType === 'machine' ? 'Selecione a máquina' : 'Selecione o serviço'}</option>{options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    </>
  }

  const sameResource = dialogSession && String((resourceType === 'machine' ? dialogSession.machineId : dialogSession.laborServiceId) ?? '') === resourceId && (resourceType === 'machine' ? dialogSession.laborServiceId == null : dialogSession.machineId == null)

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
          {visible.length ? visible.map((order) => <button className={`operator-project ${selectedCode === order.code ? 'operator-project--selected' : ''}`} type="button" key={order.code} onClick={() => { setSelectedCode(order.code); setSelectedWorker(null); setProjectsCollapsed(true) }}><div className="operator-project-visual">⚙</div><div className="operator-project-content"><div className="operator-project-top"><strong>{order.service}</strong><span className={`operator-status operator-status--${order.operation.status}`}>{statusLabels[order.operation.status]}</span></div><span>{order.company}</span><small>{order.code} · Etiqueta {order.labelNumber}</small><div className="operator-project-bottom"><div><span>Etapa atual</span><strong>{currentStage(order)}</strong></div><div><span>Prazo</span><strong>{formatDate(order.deadline)}</strong></div><div><span>Produzido/total</span><strong>{currentPieceProgress(order.operation, order.quantity).completedPieces}/{order.quantity}</strong></div><div><span>Progresso</span><strong>{order.operation.progress}%</strong><i><b style={{ width: `${order.operation.progress}%` }} /></i></div></div></div></button>) : <div className="operator-empty">Nenhuma OS encontrada para este filtro.</div>}
        </section>
          </div>
        </div>
        <section className="operator-detail" aria-label="Detalhes do projeto">
          {selected ? <>
            <div className="operator-detail-heading"><div><h2 ref={detailHeading} tabIndex={-1}>{selected.service}</h2><p><strong>{selected.code}</strong> · {selected.company}</p></div><span className={`operator-status operator-status--${operation.status}`}>{statusLabels[operation.status]}</span></div>
            <div className="operator-detail-facts"><div><span>▱ Material</span><strong>{selected.resources?.materials?.map((item) => item.name).join(', ') || 'Não informado'}</strong></div><div><span>♙ {sessions.length > 1 ? 'Responsáveis' : 'Responsável'}</span><strong>{activeEmployeeNames(operation) || 'Aguardando identificação'}</strong></div><div><span>▣ Previsão de entrega</span><strong>{formatDate(selected.deadline)}</strong></div><div><span>⚑ Etapa atual</span><strong>{currentStage(selected)}</strong></div><div><span>◷ Tempo do projeto</span><strong>{formatDuration(operationElapsed(operation, now))}</strong></div><div><span>◷ Sessão atual</span><strong>{currentSessionStart ? formatDuration(now - Date.parse(currentSessionStart)) : '00:00:00'}</strong></div><div><span>◇ Quantidade</span><strong>{selected.quantity} peças</strong></div><div><span>▤ OS vinculada</span><strong>{selected.code}</strong></div><div><span>▥ Cliente</span><strong>{selected.company}</strong></div></div>
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
                  {ownedSessions.length > 0 && operation.status !== 'completed' && <div className="operator-stage-action"><input type="number" min="1" max={available} step="1" value={stageQuantity[stage.key] || 1} onChange={(event) => setStageQuantity((current) => ({ ...current, [stage.key]: event.target.value }))} aria-label={`Quantidade concluída em ${stage.name}`} /><button type="button" disabled={busy || available < 1} onClick={() => registerStage(stage)}>Registrar</button></div>}
                </div>
              })}</div>
            </section>)}</div> : <p className="operator-empty">Esta OS ainda não tem etapas definidas. Peça ao administrador para selecioná-las nos detalhes da oferta ou configurá-las na OS.</p>}
            <div className="operator-time-banner"><span>◷</span><div><small>Tempo em andamento do projeto</small><strong>{formatDuration(operationElapsed(operation, now))}</strong></div><div><small>Sessão atual</small><strong>{currentSessionStart ? formatDuration(now - Date.parse(currentSessionStart)) : '00:00:00'}</strong><em>{sessions.length === 1 ? `Iniciada por ${sessions[0].employeeName} em ${formatMoment(sessions[0].startedAt)}` : sessions.length > 1 ? `${sessions.length} funcionários trabalhando desde ${formatMoment(currentSessionStart)}` : operation.lastPauseReason ? `Última pausa: ${operation.lastPauseReason}` : 'Aguardando início'}</em></div></div>
            <div className="operator-actions"><button className="operator-outline" type="button" onClick={() => setDialog('info')}>Visualizar informações do projeto</button>{operation.status !== 'completed' && <button className="operator-primary" type="button" disabled={busy || !operation.stages.length} onClick={openStart}>Trabalhar neste projeto</button>}<button className="operator-outline operator-finish" type="button" disabled={!ownedSessions.length || operation.progress < 100 || busy} onClick={() => setDialog('complete')}>Concluir serviço</button></div>
            <section className="operator-workers" aria-labelledby="operator-workers-title">
              <div className="operator-workers-heading"><h3 id="operator-workers-title">Funcionários trabalhando neste serviço</h3><span>{sessions.length} {sessions.length === 1 ? 'funcionário' : 'funcionários'}</span></div>
              {sessions.length ? <ul className="operator-worker-list">{sessions.map((session) => {
                const open = selectedWorker === session.id
                const owned = Boolean(credentials[session.id])
                return <li key={session.id} className={`operator-worker${open ? ' operator-worker--open' : ''}`}>
                  <button className="operator-worker-toggle" type="button" aria-expanded={open} aria-controls={`operator-worker-actions-${session.id}`} onClick={() => setSelectedWorker(open ? null : session.id)}>
                    <span className="operator-worker-name"><strong>{session.employeeName}</strong><small>{resourceDescription(session)}</small></span>
                    <span className="operator-worker-time"><strong>{formatDuration(now - Date.parse(session.startedAt))}</strong><small>Desde {formatMoment(session.startedAt)}</small></span>
                    <ChevronDown size={18} aria-hidden="true" />
                  </button>
                  {open && <div className="operator-worker-actions" id={`operator-worker-actions-${session.id}`}>
                    <button className="operator-primary" type="button" disabled={busy || !owned} onClick={() => openPause(session)}>Pausar trabalho</button>
                    <button className="operator-outline operator-machine-change" type="button" disabled={busy || !owned} onClick={() => openResourceChange(session)}><ArrowLeftRight size={15} aria-hidden="true" />Troca de máquina ou serviço</button>
                    {!owned && <p className="operator-session-note">Este trabalho foi iniciado em outro dispositivo. Pause ou troque o recurso no dispositivo em que {session.employeeName} iniciou a sessão.</p>}
                  </div>}
                </li>
              })}</ul> : <p className="operator-workers-empty">Nenhum funcionário trabalhando neste serviço no momento.</p>}
            </section>
            <details className="operator-history"><summary>Histórico de atividades ({events.length})</summary>{events.length ? <ol>{[...events].reverse().map((event) => <li key={event.id}><strong>{eventLabels[event.type] || event.type}</strong><span>{event.employeeName || 'Admin'} · {formatMoment(event.at)}{event.stageName ? ` · ${event.stageName}: +${event.quantity} (${event.stageTotal} no total)` : ''}{event.registeredByEmployeeName ? ` · Registrado por ${event.registeredByEmployeeName}` : ''}{event.reason ? ` · ${event.reason}` : ''}{['machine_changed', 'labor_service_changed', 'resource_changed'].includes(event.type) ? ` · ${event.details}` : ''}</span></li>)}</ol> : <p>Nenhuma atividade registrada.</p>}</details>
          </> : <div className="operator-empty">Nenhuma OS aberta. As ordens aceitas pelo admin aparecerão aqui.</div>}
        </section>
      </div>
      <section className="operator-stats"><div><span>▣</span><strong>{activeCount}</strong><small>Projetos ativos</small></div><div><span>▶</span><strong>{runningCount}</strong><small>Em execução agora</small></div><div><span>◷</span><strong>{formatDuration(totalMs)}</strong><small>Tempo ativo registrado</small></div><div><span>▣</span><strong>{soonCount}</strong><small>Com prazo em até 3 dias</small></div></section>
      </>}
    </main>
    {dialog === 'pending-materials' && pendingStart && <PendingMaterialsModal orderCode={pendingStart.code} materials={pendingStart.materials} busy={busy} error={error} onConfirm={() => begin(pendingStart)} onClose={() => setDialog(null)} />}
    {dialog && !['info', 'pending-materials'].includes(dialog) && <div className="operator-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null) }}><section className="operator-dialog" role="dialog" aria-modal="true">
      <button className="operator-dialog-close" type="button" onClick={() => setDialog(null)} aria-label="Fechar">×</button>{error && <p className="operator-error" role="alert">{error}</p>}
      {dialog === 'start' && <><h2>Quem vai trabalhar nesta OS?</h2><p>{selected?.code}</p>
        <label>Funcionário<select aria-label="Funcionário" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Selecione seu nome</option>{employees.map((employee) => <option key={employee.id} value={employee.id} disabled={workingEmployeeIds.has(String(employee.id))}>{employee.identification} · {employee.name}{workingEmployeeIds.has(String(employee.id)) ? ' (já trabalhando)' : ''}</option>)}</select></label>
        {resourceFields('start')}
        {!employees.length && <p>Nenhum funcionário cadastrado. Solicite o cadastro ao administrador.</p>}<button className="operator-primary" type="button" disabled={busy || !employees.length || !employeeId || !resourceId} onClick={() => begin()}>{busy ? 'Iniciando...' : 'Iniciar trabalho'}</button>
      </>}
      {dialog === 'pause' && <><h2>Pausar trabalho</h2><p>{dialogSession ? <>Funcionário: <strong>{dialogSession.employeeName}</strong>. </> : null}Escolha a justificativa. O horário e o responsável ficarão registrados na OS.</p><label>Justificativa<select value={pauseReason} onChange={(event) => setPauseReason(event.target.value)}><option value="">Selecione...</option>{pauseReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}</select></label><button className="operator-primary" type="button" disabled={busy || !dialogSession} onClick={pause}>{busy ? 'Salvando...' : 'Confirmar pausa'}</button></>}
      {dialog === 'resource' && <><h2>Troca de máquina ou serviço</h2><p>{selected?.code}{dialogSession ? ` · ${dialogSession.employeeName}` : ''}</p><p>Recurso atual: <strong>{resourceDescription(dialogSession)}</strong></p>
        {resourceFields('new')}
        <button className="operator-primary" type="button" disabled={busy || !dialogSession || !credentials[dialogSession?.id] || !resourceId || sameResource} onClick={changeResource}>{busy ? 'Salvando...' : 'Confirmar troca'}</button></>}
      {dialog === 'completed-by' && <><h2>Quem concluiu esta etapa?</h2><p>{pendingStage ? `${pendingStage.stage.name}: ${pendingStage.quantity} ${pendingStage.quantity === 1 ? 'peça' : 'peças'}. ` : ''}Mais de um funcionário está trabalhando nesta OS.</p>
        <fieldset className="operator-completed-by" disabled={busy}><legend>Funcionário</legend>{sessions.map((session) => <label key={session.id}><input type="radio" name="operator-completed-by" value={session.id} checked={completedBy === session.id} onChange={() => { setCompletedBy(session.id); setError('') }} /><span>{session.employeeName}<small>{resourceDescription(session)}</small></span></label>)}</fieldset>
        <button className="operator-primary" type="button" disabled={busy || !completedBy || !pendingStage} onClick={confirmCompletedBy}>{busy ? 'Registrando...' : 'Registrar etapa'}</button></>}
      {dialog === 'complete' && <><h2>Concluir serviço</h2><p>Confirme que todas as {selected?.quantity} peças passaram por cada etapa desta OS.</p>{sessions.length > 1 && <p>As sessões de {sessions.map((session) => session.employeeName).join(', ')} serão encerradas com a conclusão.</p>}<button className="operator-primary" type="button" disabled={busy} onClick={complete}>{busy ? 'Concluindo...' : 'Confirmar conclusão'}</button></>}
    </section></div>}
  </div>
}
