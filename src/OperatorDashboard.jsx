import { useEffect, useRef, useState } from 'react'
import OperatorProjectInformation from './OperatorProjectInformation.jsx'
import PendingMaterialsModal from './PendingMaterialsModal.jsx'
import { pollWhileVisible } from './polling.js'
import { pendingOrderMaterials } from '../server/pendingMaterials.js'
import { activeEmployeeNames, activeSessions, activeSince, operationElapsed } from '../server/operationSessions.js'
import StageGroupHeading from './OperatorStageGroup.jsx'
import PieceTrack, { workingStageKeys, stageCode, stageElapsedMs, minutesLabel } from './PieceTrack.jsx'
import { currentPieceProgress, groupProjectStages, stageGroupTone, isEmergency, emergenciesFirst } from './serviceProgress.js'
import ServicePanelRow from './ServicePanelRow.jsx'
import { servicePanelOrders } from './servicePanels.js'
import './operator.css'

// Every stage comes with its machine or service from the offer; an OS from before that rule may still lack one.
const UNPLANNED_STAGE = 'Esta etapa não tem máquina ou serviço definido. Peça ao administrador para definir na edição da OS.'
const statusLabels = { waiting: 'Aguardando', running: 'Em execução', paused: 'Pausado', stage_done: 'Etapa concluída', finalizing: 'Finalizando', completed: 'Concluído' }
const eventLabels = { started: 'Iniciou o trabalho', resumed: 'Retomou o trabalho', paused: 'Pausou o trabalho', stage_completed: 'Concluiu a etapa', machine_changed: 'Trocou de máquina', labor_service_changed: 'Trocou de serviço de hora homem', resource_changed: 'Trocou entre máquina e serviço', session_ended: 'Sessão encerrada na conclusão', stage_progress: 'Registrou peças', completed: 'Concluiu a OS', completion_acknowledged: 'Conclusão confirmada no painel', admin_interrupted: 'Sessão encerrada pelo admin', stages_configured: 'Etapas configuradas', order_edited: 'OS editada pelo admin', order_reopened: 'OS reaberta pelo admin' }

async function request(url, options = {}) {
  const response = await fetch(url, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || 'Não foi possível concluir a operação.')
    error.status = response.status
    error.code = data.code
    error.pendingMaterials = data.pendingMaterials
    error.busyOrder = data.busyOrder
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

// In a mandatory sequence (Processo Injessado) a stage waits until the one before it has every piece; returns that stage.
function waitingFor(order, index) {
  const before = order.operation.stages[index - 1]
  return before && order.resources?.strictProcess !== false && Number(order.operation.stageCounts[before.key] || 0) < Number(order.quantity) ? before : null
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

// The operator identified by code on the shared account: { id, name, identification }.
export const operatorEmployeeKey = 'gmac-operator-employee'

function savedEmployee() {
  try { return JSON.parse(window.sessionStorage.getItem(operatorEmployeeKey) || 'null') } catch { return null }
}

function rememberEmployee(employee) {
  try {
    if (employee) window.sessionStorage.setItem(operatorEmployeeKey, JSON.stringify(employee))
    else window.sessionStorage.removeItem(operatorEmployeeKey)
  } catch { /* armazenamento indisponível */ }
}

const initials = (name) => { const words = String(name || '').trim().split(/\s+/); return [words[0], words.length > 1 ? words.at(-1) : ''].map((word) => word?.[0] || '').join('').toUpperCase() || 'OP' }

function forgetSessions(code, ids) {
  const sessions = savedSessions(code)
  for (const id of ids) delete sessions[id]
  writeSessions(code, sessions)
}

export default function OperatorDashboard({ token, onLogout }) {
  const [orders, setOrders] = useState([])
  const [employee, setEmployee] = useState(savedEmployee)
  const [entering, setEntering] = useState(false)
  const [accessCode, setAccessCode] = useState('')
  const [machines, setMachines] = useState([])
  const [laborServices, setLaborServices] = useState([])
  const [resourceType, setResourceType] = useState('')
  const [stageChoice, setStageChoice] = useState('')
  const [resourceId, setResourceId] = useState('')
  const [selectedCode, setSelectedCode] = useState(null)
  const [dialogSessionId, setDialogSessionId] = useState(null)
  const [pendingStage, setPendingStage] = useState(null)
  const [completedBy, setCompletedBy] = useState('')
  // '' on the OS, 'stage' choosing the stage, 'resource' choosing the machine or service of a stage without a plan.
  const [picking, setPicking] = useState('')
  const detailHeading = useRef(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState(null)
  const [pendingStart, setPendingStart] = useState(null)
  const [switchStart, setSwitchStart] = useState(null)
  const [pauseReason, setPauseReason] = useState('')
  // Registered by the administrators (Cadastros > Razões de pausas); read again each time the pause is opened.
  const [pauseReasons, setPauseReasons] = useState([])
  const [stageQuantity, setStageQuantity] = useState({})
  const [events, setEvents] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  async function refresh(signal) {
    try {
      const orderResult = await request('/api/operations/operator/orders', { signal, cache: 'no-store', headers: { Authorization: `Bearer ${token}` } })
      if (signal?.aborted) return
      setOrders(orderResult.items)
      setSelectedCode((current) => orderResult.items.some((order) => order.code === current) ? current : null)
      setError('')
    } catch (caught) {
      if (signal?.aborted) return
      if (caught.status === 401) onLogout()
      else setError(caught.message)
    }
  }

  async function refreshEvents(code) {
    if (!code) return setEvents([])
    try { setEvents((await request(`/api/operations/orders/${encodeURIComponent(code)}/events`, { headers: { Authorization: `Bearer ${token}` } })).items) } catch (caught) { if (caught.status === 401) onLogout(); else setError(caught.message) }
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
    request('/api/machines', { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } }).then((data) => { if (!controller.signal.aborted) setMachines(data.items) }).catch((caught) => { if (!controller.signal.aborted) setError(caught.message) })
    request('/api/labor-services', { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } }).then((data) => { if (!controller.signal.aborted) setLaborServices(data.items) }).catch((caught) => { if (!controller.signal.aborted) setError(caught.message) })
    request('/api/pause-reasons', { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } }).then((data) => { if (!controller.signal.aborted) setPauseReasons(data.items.map((item) => item.name)) }).catch(() => {})
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

  // The plan of the sectors of the identified employee (Planejamento), in its order; read again every 10 seconds.
  const [queue, setQueue] = useState(null)
  useEffect(() => {
    if (!employee?.id) return setQueue(null)
    let active = true
    const load = () => request(`/api/planning/operator-queue?employeeId=${encodeURIComponent(employee.id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).then((data) => { if (active) setQueue(data) }).catch(() => { if (active) setQueue(null) })
    load()
    const stop = pollWhileVisible(load, 10000)
    return () => { active = false; stop() }
  }, [employee?.id, token])

  const selected = orders.find((order) => order.code === selectedCode)
  useEffect(() => {
    if (selected) detailHeading.current?.focus({ preventScroll: true })
  }, [selectedCode, picking])
  const operation = selected?.operation
  const stageGroups = groupProjectStages(operation?.stages)
  const sessions = activeSessions(operation)
  const credentials = selected ? savedSessions(selected.code) : {}
  const ownedSessions = sessions.filter((session) => credentials[session.id])
  const credentialFor = (session) => ({ sessionId: session.id, sessionToken: credentials[session.id] })
  const dialogSession = sessions.find((session) => session.id === dialogSessionId)
  const mySession = employee ? sessions.find((session) => String(session.employeeId) === String(employee.id)) : null
  const myCredential = Boolean(mySession && credentials[mySession.id])
  const chosenResource = (resourceType === 'machine' ? machines : resourceType === 'labor-service' ? laborServices : []).find((item) => String(item.id) === resourceId)
  const currentSessionStart = activeSince(operation)
  // The stage this operator works on: theirs while working; before starting, the one chosen or the first unfinished.
  const firstOpenStage = operation?.stages?.find((stage) => Number(operation.stageCounts[stage.key] || 0) < Number(selected?.quantity))?.key || operation?.stages?.[0]?.key || ''
  const chosenStage = mySession ? mySession.stageKey || '' : stageChoice || firstOpenStage
  const plannedForStage = !mySession && selected ? stagePlan(selected, chosenStage) : null
  const chosenStageName = operation?.stages?.find((stage) => stage.key === chosenStage)?.name
  // The lists of machines and services may arrive after the OS is open: the planned resource is applied then. A stage
  // with a plan always works with it.
  useEffect(() => {
    if (plannedForStage && (resourceType !== plannedForStage.type || resourceId !== plannedForStage.id)) { setResourceType(plannedForStage.type); setResourceId(plannedForStage.id) }
  }, [plannedForStage?.type, plannedForStage?.id])
  const visible = orders.filter((order) => {
    const query = search.trim().toLocaleLowerCase()
    return (filter === 'all' ? order.operation.status !== 'completed' : order.operation.status === filter) && (!query || [order.service, order.company, order.code, order.labelNumber].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
  })
  const isMine = (order) => Boolean(employee) && activeSessions(order.operation).some((session) => String(session.employeeId) === String(employee.id))
  const mine = emergenciesFirst(visible.filter(isMine))
  const others = emergenciesFirst(visible.filter((order) => !isMine(order)))
  const projectCard = (order) => <button className={`operator-project${isMine(order) ? " operator-project--mine" : ""}${isEmergency(order) ? ' operator-project--emergency' : ''}`} type="button" key={order.code} onClick={() => openOrder(order.code)}><div className="operator-project-visual">⚙</div><div className="operator-project-content"><div className="operator-project-top"><strong>{order.service}</strong><span className={`operator-status operator-status--${order.operation.status}`}>{statusLabels[order.operation.status]}</span></div><span>{order.company}</span><small>{order.code}{order.labelNumber ? ` · Etiqueta ${order.labelNumber}` : ''}{isEmergency(order) && <> · <span className="os-emergency-label">Emergencial</span></>}</small><div className="operator-project-bottom"><div><span>Etapa atual</span><strong>{currentStage(order)}</strong></div><div><span>Prazo</span><strong>{formatDate(order.deadline)}</strong></div><div><span>Produzido/total</span><strong>{currentPieceProgress(order.operation, order.quantity).completedPieces}/{order.quantity}</strong></div><div><span>Progresso</span><strong>{order.operation.progress}%</strong><i><b style={{ width: `${order.operation.progress}%` }} /></i></div></div></div></button>
  const activeCount = orders.filter((order) => order.operation.status !== 'completed').length
  const runningCount = orders.filter((order) => order.operation.status === 'running' || order.operation.status === 'finalizing').length
  const totalMs = orders.reduce((sum, order) => sum + operationElapsed(order.operation, now), 0)
  const soonCount = orders.filter((order) => { const days = (Date.parse(`${order.deadline}T23:59:59-03:00`) - now) / 86400000; return order.operation.status !== 'completed' && days >= 0 && days <= 3 }).length


  async function action(url, body, after) {
    setBusy(true)
    setError('')
    try {
      const result = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
      const next = after?.(result)
      await refresh()
      await refreshEvents(selectedCode)
      setDialog(next || null)
    } catch (caught) {
      if (caught.status === 401) onLogout()
      else if (caught.code === 'PENDING_MATERIALS') {
        setPendingStart({ code: selectedCode, materials: caught.pendingMaterials, switchFrom: body?.switchFrom })
        setDialog('pending-materials')
        setError('')
      }
      else if (caught.code === 'WORKING_ELSEWHERE') {
        // The operator started on another OS after this screen was loaded.
        await refresh()
        setSwitchStart({ code: selectedCode, fromCode: caught.busyOrder?.code, fromService: caught.busyOrder?.service })
        setDialog('switch-order')
        setError('')
      }
      else if (caught.code === 'COMPLETED_BY_REQUIRED') {
        // Another employee joined after the screen was loaded: ask who completed the stage.
        await refresh()
        setCompletedBy('')
        setDialog('completed-by')
        setError('')
      }
      else if (caught.code === 'MACHINE_BUSY') {
        // Someone took the machine after the list was loaded: show who, and refresh the list of machines.
        setError(caught.message)
        setResourceType('')
        setResourceId('')
        await loadResources()
      }
      else setError(caught.message)
    }
    finally { setBusy(false) }
  }

  async function loadResources() {
    try {
      const [machineResult, serviceResult] = await Promise.all([request('/api/machines', { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } }), request('/api/labor-services', { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } })])
      setMachines(machineResult.items)
      setLaborServices(serviceResult.items)
    } catch (caught) { setError(caught.message) }
  }

  function pressKey(key) {
    if (busy) return
    setError('')
    if (key === 'back') setAccessCode((current) => current.slice(0, -1))
    else setAccessCode((current) => current.length < 4 ? current + key : current)
  }

  useEffect(() => {
    if (employee || !entering) return undefined
    const typed = (event) => {
      if (/^\d$/.test(event.key)) pressKey(event.key)
      else if (event.key === 'Backspace') pressKey('back')
      else if (event.key === 'Enter' && accessCode.length === 4) identify()
      else if (event.key === 'Escape') { setEntering(false); setAccessCode(''); setError('') }
    }
    window.addEventListener('keydown', typed)
    return () => window.removeEventListener('keydown', typed)
  })

  async function identify(event) {
    event?.preventDefault()
    if (busy || accessCode.length !== 4) return
    setBusy(true)
    setError('')
    try {
      const result = await request('/api/operations/operator/identify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ code: accessCode }) })
      rememberEmployee(result.employee)
      // Work this operator already has open (started on another device or in a closed tab) becomes theirs here too.
      for (const session of result.sessions || []) rememberSession(session.orderCode, session.sessionId, session.sessionToken)
      setEmployee(result.employee)
      setEntering(false)
      setAccessCode('')
    } catch (caught) {
      if (caught.status === 401) onLogout()
      else { setAccessCode(''); setError(caught.message) }
    } finally { setBusy(false) }
  }

  // One exit button, in two steps: with an operator identified it leaves only the operator (back to the code and the
  // shared account stays signed in for the next one); on the code screen it leaves the shared account.
  function switchEmployee() {
    rememberEmployee(null)
    setEmployee(null)
    setDialog(null)
    openOrder(null)
  }

  // `confirmed` carries what the operator already accepted: the switch from another OS and/or the pending materials.
  function begin(confirmed = {}) {
    if (!selected || !employee) return setError('Entre com o seu código para iniciar o trabalho.')
    if (!resourceType || !resourceId) return setError(UNPLANNED_STAGE)
    if (plannedForStage?.maintenance) return setError(`A máquina ${plannedForStage.name} está em manutenção.`)
    if (plannedForStage?.holder) return setError(`A máquina ${plannedForStage.name} está sendo usada por ${plannedForStage.holder.employeeName} na ${plannedForStage.holder.orderCode}.`)
    if (confirmed.code && confirmed.code !== selected.code) {
      setDialog(null)
      return setError('O projeto selecionado mudou. Selecione novamente a OS para iniciar o trabalho.')
    }
    // One OS at a time: working on another one, the operator confirms the change before starting here.
    const elsewhere = orders.find((order) => order.code !== selected.code && activeSessions(order.operation).some((session) => String(session.employeeId) === String(employee.id)))
    if (elsewhere && confirmed.switchFrom !== elsewhere.code) {
      setSwitchStart({ code: selected.code, fromCode: elsewhere.code, fromService: elsewhere.service })
      setError('')
      return setDialog('switch-order')
    }
    const pending = pendingOrderMaterials(selected)
    if (pending.length && !confirmed.materials) {
      setPendingStart({ code: selected.code, materials: pending, switchFrom: confirmed.switchFrom })
      setError('')
      return setDialog('pending-materials')
    }
    const code = selected.code
    action(`/api/operations/orders/${encodeURIComponent(code)}/start`, { employeeId: employee.id, machineId: resourceType === 'machine' ? resourceId : null, laborServiceId: resourceType === 'labor-service' ? resourceId : null, stageKey: chosenStage || undefined, ...(confirmed.materials ? { pendingMaterialsConfirmation: confirmed.materials.map((material) => [material.key, material.quantity]) } : {}), ...(confirmed.switchFrom ? { switchFrom: confirmed.switchFrom } : {}) }, (result) => {
      rememberSession(code, result.session.id, result.sessionToken)
      for (const item of result.switched || []) forgetSessions(item.orderCode, [item.sessionId])
      setResourceType('')
      setResourceId('')
      setSwitchStart(null)
    })
  }

  function openPause(session) {
    setDialogSessionId(session.id)
    setPauseReason('')
    setError('')
    setDialog('pause')
    request('/api/pause-reasons', { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } }).then((data) => setPauseReasons(data.items.map((item) => item.name))).catch(() => {})
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

  // Only who works on the stage registers its pieces; with more than one employee there, the screen asks who made them.
  function registerStage(stage, worker) {
    if (!selected || !ownedSessions.length) return
    const quantity = Number(stageQuantity[stage.key] || 1)
    if (!worker && sessions.filter((session) => session.stageKey === stage.key).length > 1) {
      setPendingStage({ stage, quantity })
      setCompletedBy('')
      setError('')
      return setDialog('completed-by')
    }
    // Any session started in this browser authorizes the record; the event is credited to the selected employee.
    const credential = credentialFor(worker && credentials[worker.id] ? worker : ownedSessions.find((session) => session.stageKey === stage.key) || ownedSessions[0])
    setPendingStage({ stage, quantity })
    action(`/api/operations/orders/${encodeURIComponent(selected.code)}/stages/${stage.key}`, { quantity, ...credential, ...(worker ? { completedBySessionId: worker.id } : {}) }, (result) => {
      setStageQuantity((current) => ({ ...current, [stage.key]: 1 }))
      setPendingStage(null)
      // A finished stage ends the work on it: the sessions of this browser that closed are forgotten, and the next start
      // goes to the next open stage.
      const ended = ownedSessions.filter((session) => !result.operation?.activeSessions?.some((item) => item.id === session.id)).map((session) => session.id)
      if (ended.length) { forgetSessions(selected.code, ended); setStageChoice('') }
      // The last piece of the last stage: offer to complete the service right away.
      if (operation.progress < 100 && result.operation?.progress >= 100) return 'complete'
    })
  }

  function confirmCompletedBy() {
    const worker = sessions.find((session) => session.id === completedBy)
    if (!pendingStage) return setDialog(null)
    if (!worker) return setError('Selecione quem concluiu esta etapa.')
    registerStage(pendingStage.stage, worker)
  }

  // The machine or labor service planned in the offer for a stage, while it is still registered: the stage decides it.
  // `holder` is who uses the planned machine now, in any OS; the stage waits for it (labor services are shared), as it
  // waits for a machine in maintenance.
  function stagePlan(order, stageKey) {
    const stage = order?.operation?.stages?.find((item) => item.key === stageKey)
    const plan = stage && order.resources?.stageResources?.[stageCode(stage)]
    if (!plan) return null
    const item = (plan.type === 'machine' ? machines : plan.type === 'labor-service' ? laborServices : []).find((entry) => String(entry.id) === String(plan.id))
    if (!item) return null
    const holder = plan.type === 'machine' ? item.inUseBy?.find((user) => String(user.employeeId) !== String(employee?.id)) || null : null
    return { type: plan.type, id: String(item.id), name: item.name, holder, maintenance: plan.type === 'machine' && Boolean(item.maintenance) }
  }

  // The OS opens on its first open stage, with the machine or service planned for it.
  function openOrder(code) {
    const order = orders.find((item) => item.code === code)
    const firstOpen = order?.operation?.stages?.find((stage) => Number(order.operation.stageCounts[stage.key] || 0) < Number(order.quantity))?.key || order?.operation?.stages?.[0]?.key
    const planned = stagePlan(order, firstOpen)
    setSelectedCode(code)
    setPicking('')
    setResourceType(planned?.type || '')
    setStageChoice('')
    setResourceId(planned?.id || '')
    setError('')
  }

  // A block of the plan opens its OS with its stage and machine (or service) already chosen: the one the offer planned
  // for the stage, as the server requires (the block's own only for an OS from before every stage had one).
  function openPlanned(block) {
    const order = orders.find((item) => item.code === block.orderCode)
    if (!order) return setError('Esta OS não está mais aberta.')
    openOrder(block.orderCode)
    const stage = order.operation?.stages?.find((item) => item.name === block.stageName)
    if (!stage) return
    const planned = stagePlan(order, stage.key)
    setStageChoice(stage.key)
    setResourceType(planned?.type || block.resourceType)
    setResourceId(String(planned?.id || block.resourceId))
  }

  // The list of machines is read again so the stages show who is using each planned machine now.
  async function openStagePicker() {
    setError('')
    setPicking('stage')
    await loadResources()
  }

  // The operator never chooses the machine or service: the stage brings the one planned for it in the offer. Before
  // starting it only marks where the work begins; while working it moves the session, and the server brings the planned
  // resource along. A stage without a plan (an OS from before it was mandatory) waits for the administrator.
  function chooseStage(stageKey) {
    if (!selected) return
    const planned = stagePlan(selected, stageKey)
    if (!planned) return setError(UNPLANNED_STAGE)
    setError('')
    if (myCredential) {
      if (stageKey === chosenStage) return setPicking('')
      return action(`/api/operations/orders/${encodeURIComponent(selected.code)}/work-stage`, { stageKey, ...credentialFor(mySession) }, () => { setPicking('') })
    }
    setStageChoice(stageKey)
    setResourceType(planned.type)
    setResourceId(planned.id)
    setPicking('')
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


  if (!employee) return <div className="operator-app">
    <aside className="operator-sidebar">
      <div className="operator-logo"><img src="/images/gmac-logo-transparent.png" alt="GMAC Metalúrgica" /></div>
      <nav><span className="operator-nav-item operator-nav-item--active">▣ <b>Entrar</b></span></nav>
      <div className="operator-sidebar-bottom"><span className="operator-avatar">OP</span><div><strong>Operador</strong><small>Conta compartilhada</small></div><button type="button" onClick={logout} title="Sair da conta do operador" aria-label="Sair da conta do operador">↪</button></div>
    </aside>
    <main className="operator-main operator-entry operator-entry--overview">
      {/* Before the code, the tablet follows every open OS as the administrators' panel does, without opening any. */}
      <section className="operator-overview" aria-labelledby="operator-entry-title">
        <header className="operator-overview-header"><h1 id="operator-entry-title">Projetos em andamento</h1><p>Acompanhamento em tempo real de todas as OS abertas.</p></header>
        <div className="admin-os-table-wrap"><table className="admin-os-table"><thead><tr>{['OS / Serviço', 'Cliente', 'Operador', 'Etapa atual', 'Peças concluídas', 'Progresso', 'Tempo ativo', 'Tempo restante', 'Status'].map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{emergenciesFirst(servicePanelOrders(orders)).map((order) => <ServicePanelRow key={order.code} order={order} now={now} />)}</tbody></table>
          {!servicePanelOrders(orders).length && <p className="admin-os-empty">Nenhuma OS em andamento.</p>}</div>
      </section>
      <section className={`operator-entry-card${entering ? ' operator-entry-card--keypad' : ''}`} aria-label="Entrar com o código do funcionário">
        <p>{entering ? 'Digite o seu código de 4 dígitos.' : 'Toque em Entrar e digite o seu código para trabalhar nas OS.'}</p>
        {error && <p className="operator-error" role="alert">{error}</p>}
        {entering ? <form onSubmit={identify} aria-label="Código do operador">
          <div className="operator-code-dots" role="status" aria-label={`${accessCode.length} de 4 dígitos digitados`}>{[0, 1, 2, 3].map((index) => <span key={index} className={index < accessCode.length ? 'filled' : ''} />)}</div>
          <div className="operator-keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((key) => <button key={key} type="button" disabled={busy} onClick={() => pressKey(key)}>{key}</button>)}
            <button type="button" className="operator-keypad-back" disabled={busy || !accessCode} onClick={() => pressKey('back')}>Apagar</button>
            <button type="button" disabled={busy} onClick={() => pressKey('0')}>0</button>
            <button type="submit" className="operator-keypad-ok" disabled={busy || accessCode.length !== 4}>{busy ? '...' : 'OK'}</button>
          </div>
          <button className="operator-entry-cancel" type="button" disabled={busy} onClick={() => { setEntering(false); setAccessCode(''); setError('') }}>Cancelar</button>
        </form> : <button className="operator-primary" type="button" onClick={() => { setEntering(true); setError('') }}>Entrar</button>}
      </section>
    </main>
  </div>

  return <div className="operator-app">
    <aside className="operator-sidebar">
      <div className="operator-logo"><img src="/images/gmac-logo-transparent.png" alt="GMAC Metalúrgica" /></div>
      <nav><span className="operator-nav-item operator-nav-item--active">▣ <b>Projetos em andamento</b></span></nav>
      <div className="operator-sidebar-bottom"><span className="operator-avatar">{initials(employee.name)}</span><div><strong>{employee.name}</strong><small>Conta compartilhada</small></div><button type="button" onClick={switchEmployee} title="Sair do funcionário" aria-label="Sair do funcionário">↪</button></div>
    </aside>
    <main className="operator-main">
      {dialog === 'info' && selected ? <OperatorProjectInformation order={selected} token={token} events={events} now={now} onBack={() => setDialog(null)} statusLabels={statusLabels} eventLabels={eventLabels} formatDuration={formatDuration} /> : <>
      {error && <p className="operator-error" role="alert">{error}</p>}
      {!selected ? <>
        <header className="operator-header"><div><h1>Selecione uma OS</h1><p>Toque na OS em que você vai trabalhar.</p></div><label className="operator-search">⌕ <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por projeto, cliente ou código..." /></label></header>
        {queue && <section className="operator-plan" aria-labelledby="operator-plan-title">
          <h2 id="operator-plan-title">Planejado para você{queue.sectors.length ? <span> · {queue.sectors.join(', ')}</span> : null}</h2>
          {!queue.sectors.length ? <p className="operator-plan-empty">Você ainda não tem setor no cadastro. Peça ao administrador para marcar o seu setor em Funcionários.</p>
            : queue.items.length ? <ol>{queue.items.map((block, index) => <li key={block.id}><button type="button" className={`operator-plan-item${block.now ? ' operator-plan-item--now' : ''}${block.status === 'late' ? ' operator-plan-item--late' : ''}`} onClick={() => openPlanned(block)}>
              <b>{block.now ? 'Agora' : block.status === 'late' ? 'Atrasado' : index === 0 || queue.items[index - 1].now ? 'A seguir' : 'Depois'}</b>
              <span><strong>{block.orderCode} · {block.stageName}</strong><small>{block.service} · {block.resourceName}</small></span>
              <time>{new Date(block.start).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' })}–{new Date(block.end).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' })}</time>
            </button></li>)}</ol>
            : <p className="operator-plan-empty">Nada planejado para o seu setor agora. Escolha uma OS na lista abaixo.</p>}
        </section>}
        <div className="operator-filters">{[['all', 'Todos'], ['waiting', 'Aguardando'], ['running', 'Em execução'], ['paused', 'Pausado'], ['stage_done', 'Etapa concluída'], ['finalizing', 'Finalizando']].map(([key, label]) => <button className={filter === key ? 'active' : ''} type="button" key={key} onClick={() => setFilter(key)}><span className={`operator-dot operator-dot--${key}`} />{label}</button>)}</div>
        <section className="operator-project-list" aria-label="Projetos abertos">
          {mine.length > 0 && <div className="operator-project-group operator-project-group--mine" role="group" aria-label="OS em que você está trabalhando"><h2>Você está trabalhando nesta OS</h2>{mine.map(projectCard)}</div>}
          {others.length ? <div className="operator-project-group">{mine.length > 0 && <h2>Outras OS</h2>}{others.map(projectCard)}</div> : !mine.length && <div className="operator-empty">{orders.length ? 'Nenhuma OS encontrada para este filtro.' : 'Nenhuma OS aberta. As ordens aceitas pelo admin aparecerão aqui.'}</div>}
        </section>
        <section className="operator-stats"><div><span>▣</span><strong>{activeCount}</strong><small>Projetos ativos</small></div><div><span>▶</span><strong>{runningCount}</strong><small>Em execução agora</small></div><div><span>◷</span><strong>{formatDuration(totalMs)}</strong><small>Tempo ativo registrado</small></div><div><span>▣</span><strong>{soonCount}</strong><small>Com prazo em até 3 dias</small></div></section>
      </> : picking === 'stage' ? <section className="operator-picker" aria-labelledby="operator-picker-title">
        <button className="operator-back" type="button" onClick={() => { setPicking(''); setError('') }}>← Voltar para a OS</button>
        <h2 id="operator-picker-title" ref={detailHeading} tabIndex={-1}>Selecione a etapa</h2>
        <p>{selected.code} · {selected.service}</p>
        <section className="operator-picker-group" aria-label="Etapas"><div className="operator-picker-grid">{operation.stages.map((stage, index) => {
          const plan = stagePlan(selected, stage.key)
          const current = chosenStage === stage.key
          const done = Number(operation.stageCounts[stage.key] || 0) >= Number(selected.quantity)
          const waiting = waitingFor(selected, index)
          // A finished stage, one still waiting for the stage before it, one without its machine or service, or one whose
          // machine is in maintenance or in use by someone else, cannot be chosen.
          const blocked = !plan || Boolean(plan.holder || plan.maintenance) || (done || waiting) && !current
          return <button className={['operator-picker-option', current && 'operator-picker-option--current', blocked && 'operator-picker-option--taken'].filter(Boolean).join(' ')} type="button" key={stage.key} disabled={busy || blocked} aria-pressed={current} onClick={() => chooseStage(stage.key)}>{index + 1}. {stage.name}<small className="operator-picker-resource">{plan ? `${plan.type === 'machine' ? 'Máquina' : 'Serviço'}: ${plan.name}` : 'Sem máquina ou serviço definido'}</small>{done ? <small>Etapa concluída</small> : waiting ? <small>Libera ao concluir {waiting.name}</small> : plan?.maintenance ? <small>Máquina em manutenção</small> : plan?.holder && <small>Em uso por {plan.holder.employeeName} · {plan.holder.orderCode}</small>}</button>
        })}</div></section>
      </section> : <section className="operator-detail" aria-label="Detalhes do projeto">
        <div className="operator-detail-top"><button className="operator-back" type="button" onClick={() => openOrder(null)}>← Voltar para as OS</button><button className="operator-outline" type="button" onClick={() => setDialog('info')}>Visualizar informações do projeto</button></div>
        <div className="operator-detail-heading"><div><h2 ref={detailHeading} tabIndex={-1}>{selected.service}</h2><p><strong>{selected.code}</strong> · {selected.company}</p></div><span className={`operator-status operator-status--${operation.status}`}>{statusLabels[operation.status]}</span></div>
        <div className="operator-detail-facts"><div><span>▱ Material</span><strong>{selected.resources?.materials?.map((item) => item.name).join(', ') || 'Não informado'}</strong></div><div><span>♙ {sessions.length > 1 ? 'Responsáveis' : 'Responsável'}</span><strong>{activeEmployeeNames(operation) || 'Aguardando início'}</strong></div><div><span>▣ Previsão de entrega</span><strong>{formatDate(selected.deadline)}</strong></div><div><span>⚑ Etapa atual</span><strong>{currentStage(selected)}</strong></div><div><span>◷ Tempo do projeto</span><strong>{formatDuration(operationElapsed(operation, now))}</strong></div><div><span>◇ Quantidade</span><strong>{selected.quantity} peças</strong></div></div>
        {operation.status !== 'completed' && <div className="operator-steps" aria-label="Passos do trabalho">
          <button className="operator-step operator-step--resource" type="button" disabled={busy || !operation.stages.length || Boolean(mySession && !myCredential)} onClick={openStagePicker}><strong>Selecionar etapa</strong><small>{chosenStageName && `${chosenStageName} · `}<span>{mySession ? resourceDescription(mySession) : chosenResource ? `${resourceType === 'machine' ? 'Máquina' : 'Serviço'}: ${chosenResource.name}` : 'Sem máquina ou serviço definido'}</span></small></button>
          {mySession ? <button className="operator-step operator-step--work operator-step--running" type="button" disabled={busy || !myCredential} onClick={() => openPause(mySession)}><strong>Pausar trabalho</strong><small>{myCredential ? `Trabalhando há ${formatDuration(now - Date.parse(mySession.startedAt))}` : 'Iniciado em outro dispositivo'}</small></button>
            : <button className="operator-step operator-step--work" type="button" disabled={busy || !resourceId || !operation.stages.length || Boolean(plannedForStage?.holder || plannedForStage?.maintenance)} onClick={() => begin()}><strong>Iniciar trabalho</strong><small>{!operation.stages.length ? 'OS sem etapas definidas' : plannedForStage?.maintenance ? `${plannedForStage.name} em manutenção` : plannedForStage?.holder ? `${plannedForStage.name} em uso por ${plannedForStage.holder.employeeName}` : resourceId ? `Começar em ${chosenStageName || 'primeira etapa'}` : 'Etapa sem máquina ou serviço: fale com o administrador'}</small></button>}
          <button className="operator-step operator-step--finish" type="button" disabled={busy || !ownedSessions.length || operation.progress < 100} onClick={() => setDialog('complete')}><strong>Concluir serviço</strong><small>{operation.progress < 100 ? `${operation.progress}% das etapas concluídas` : ownedSessions.length ? 'Todas as peças prontas' : 'Inicie o trabalho para concluir'}</small></button>
        </div>}
        <div className="operator-stages-heading"><h3>Etapas do projeto</h3><strong>{operation.stages.length ? `${operation.stages.reduce((sum, stage) => sum + Number(operation.stageCounts[stage.key] || 0), 0)}/${operation.stages.length * selected.quantity} passagens` : 'Etapas pendentes'}</strong></div>
        {operation.stages.length ? <div className="operator-stage-groups">{stageGroups.map((group) => <section className={`operator-stage-group stage-tone--${stageGroupTone(group.name)}`} key={group.stages[0].stage.key} aria-label={`Etapas de ${group.name}`}>
          <StageGroupHeading className="operator-stage-group-heading" group={group} stageCounts={operation.stageCounts} quantity={selected.quantity} />
          <div className="operator-stages">{group.stages.map(({ stage, index }) => {
            const count = Number(operation.stageCounts[stage.key] || 0)
            const previous = selected.resources?.strictProcess === false || index === 0 ? selected.quantity : Number(operation.stageCounts[operation.stages[index - 1].key] || 0)
            const available = Math.min(selected.quantity - count, previous - count)
            // Target of the stage for the whole OS; at 80% of it the pieces bar turns a discreet red for the operator.
            const target = Number(selected.resources?.stageTimes?.[stageCode(stage)] || 0), elapsed = stageElapsedMs(operation, stage.key, now)
            const alert = target > 0 && count < selected.quantity && elapsed >= target * 60000 * 0.8
            return <div className="operator-stage" key={stage.key}>
              <span className={`operator-stage-number ${count === selected.quantity ? 'done' : ''}`}>{index + 1}</span>
              <strong>{stage.name}</strong><small>{count}/{selected.quantity} peças</small><PieceTrack count={count} quantity={selected.quantity} working={workingStageKeys(operation, selected.quantity).has(stage.key)} alert={alert} label={stage.name} className="operator-stage-pieces" />
              {target > 0 && <small className={`operator-stage-target${alert ? ' operator-stage-target--alert' : ''}`}>Meta {minutesLabel(target)} · {minutesLabel(elapsed / 60000)} feitos</small>}
              {operation.status !== 'completed' && employee && (!mySession || myCredential) && (chosenStage === stage.key ? <span className="operator-stage-here">{mySession ? 'Você está nesta etapa' : 'Etapa escolhida para começar'}</span> : <button type="button" className="operator-stage-pick" disabled={busy || count >= selected.quantity || Boolean(waitingFor(selected, index)) || Boolean(stagePlan(selected, stage.key)?.holder)} title={waitingFor(selected, index) ? `Libera ao concluir ${waitingFor(selected, index).name}` : undefined} onClick={() => chooseStage(stage.key)}>Trabalhar nesta etapa</button>)}
              {ownedSessions.some((session) => session.stageKey === stage.key) && operation.status !== 'completed' && <div className="operator-stage-action"><input type="number" min="1" max={available} step="1" value={stageQuantity[stage.key] || 1} onChange={(event) => setStageQuantity((current) => ({ ...current, [stage.key]: event.target.value }))} aria-label={`Quantidade concluída em ${stage.name}`} /><button type="button" disabled={busy || available < 1} onClick={() => registerStage(stage)}>Registrar</button></div>}
            </div>
          })}</div>
        </section>)}</div> : <p className="operator-empty">Esta OS ainda não tem etapas definidas. Peça ao administrador para selecioná-las nos detalhes da oferta ou configurá-las na OS.</p>}
        <div className="operator-time-banner"><span>◷</span><div><small>Tempo em andamento do projeto</small><strong>{formatDuration(operationElapsed(operation, now))}</strong></div><div><small>Sessão atual</small><strong>{currentSessionStart ? formatDuration(now - Date.parse(currentSessionStart)) : '00:00:00'}</strong><em>{sessions.length === 1 ? `Iniciada por ${sessions[0].employeeName} em ${formatMoment(sessions[0].startedAt)}` : sessions.length > 1 ? `${sessions.length} funcionários trabalhando desde ${formatMoment(currentSessionStart)}` : operation.status === 'stage_done' ? 'Etapa concluída · selecione a próxima etapa para continuar' : operation.lastPauseReason ? `Última pausa: ${operation.lastPauseReason}` : 'Aguardando início'}</em></div></div>
        <section className="operator-workers" aria-labelledby="operator-workers-title">
          <div className="operator-workers-heading"><h3 id="operator-workers-title">Funcionários trabalhando neste serviço</h3><span>{sessions.length} {sessions.length === 1 ? 'funcionário' : 'funcionários'}</span></div>
          {sessions.length ? <ul className="operator-worker-list">{sessions.map((session) => {
            return <li key={session.id} className="operator-worker">
              <div className="operator-worker-row">
                <span className="operator-worker-name"><strong>{session.employeeName}</strong><small>{resourceDescription(session)}</small></span>
                <span className="operator-worker-time"><strong>{formatDuration(now - Date.parse(session.startedAt))}</strong><small>Desde {formatMoment(session.startedAt)}</small></span>
              </div>
            </li>
          })}</ul> : <p className="operator-workers-empty">Nenhum funcionário trabalhando neste serviço no momento.</p>}
        </section>
        <details className="operator-history"><summary>Histórico de atividades ({events.length})</summary>{events.length ? <ol>{[...events].reverse().map((event) => <li key={event.id}><strong>{eventLabels[event.type] || event.type}</strong><span>{event.employeeName || 'Admin'} · {formatMoment(event.at)}{event.stageName ? ` · ${event.stageName}: +${event.quantity} (${event.stageTotal} no total)` : ''}{event.registeredByEmployeeName ? ` · Registrado por ${event.registeredByEmployeeName}` : ''}{event.reason ? ` · ${event.reason}` : ''}{['machine_changed', 'labor_service_changed', 'resource_changed'].includes(event.type) ? ` · ${event.details}` : ''}</span></li>)}</ol> : <p>Nenhuma atividade registrada.</p>}</details>
      </section>}
      </>}
    </main>
    {dialog === 'pending-materials' && pendingStart && <PendingMaterialsModal orderCode={pendingStart.code} materials={pendingStart.materials} busy={busy} error={error} onConfirm={() => begin(pendingStart)} onClose={() => setDialog(null)} />}
    {dialog && !['info', 'pending-materials'].includes(dialog) && <div className="operator-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null) }}><section className="operator-dialog" role="dialog" aria-modal="true">
      <button className="operator-dialog-close" type="button" onClick={() => setDialog(null)} aria-label="Fechar">×</button>{error && <p className="operator-error" role="alert">{error}</p>}
      {dialog === 'pause' && <><h2>Pausar trabalho</h2><p>{dialogSession ? <>Funcionário: <strong>{dialogSession.employeeName}</strong>. </> : null}Escolha a justificativa. O horário e o responsável ficarão registrados na OS.</p><label>Justificativa<select value={pauseReason} onChange={(event) => setPauseReason(event.target.value)}><option value="">Selecione...</option>{pauseReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}</select></label><button className="operator-primary" type="button" disabled={busy || !dialogSession} onClick={pause}>{busy ? 'Salvando...' : 'Confirmar pausa'}</button></>}
      {dialog === 'completed-by' && <><h2>Quem concluiu esta etapa?</h2><p>{pendingStage ? `${pendingStage.stage.name}: ${pendingStage.quantity} ${pendingStage.quantity === 1 ? 'peça' : 'peças'}. ` : ''}Mais de um funcionário está trabalhando nesta OS.</p>
        <fieldset className="operator-completed-by" disabled={busy}><legend>Funcionário</legend>{sessions.filter((session) => session.stageKey === pendingStage?.stage.key).map((session) => <label key={session.id}><input type="radio" name="operator-completed-by" value={session.id} checked={completedBy === session.id} onChange={() => { setCompletedBy(session.id); setError('') }} /><span>{session.employeeName}<small>{resourceDescription(session)}</small></span></label>)}</fieldset>
        <button className="operator-primary" type="button" disabled={busy || !completedBy || !pendingStage} onClick={confirmCompletedBy}>{busy ? 'Registrando...' : 'Registrar etapa'}</button></>}
      {dialog === 'switch-order' && switchStart && <><h2>Trocar de OS?</h2><p>Você já está trabalhando na OS <strong>{switchStart.fromCode}</strong>{switchStart.fromService ? ` (${switchStart.fromService})` : ''}. Deseja alterar para a OS <strong>{switchStart.code}</strong>?</p><p>O trabalho na OS {switchStart.fromCode} será pausado com a justificativa “Troca de serviço”.</p><button className="operator-primary" type="button" disabled={busy} onClick={() => begin({ code: switchStart.code, switchFrom: switchStart.fromCode })}>{busy ? 'Trocando...' : 'Sim, trocar para esta OS'}</button> <button className="operator-outline operator-dialog-later" type="button" disabled={busy} onClick={() => setDialog(null)}>Continuar na OS atual</button></>}
      {dialog === 'complete' && <><h2>Concluir serviço</h2><p>Confirme que todas as {selected?.quantity} peças passaram por cada etapa desta OS.</p>{sessions.length > 1 && <p>As sessões de {sessions.map((session) => session.employeeName).join(', ')} serão encerradas com a conclusão.</p>}<button className="operator-primary" type="button" disabled={busy} onClick={complete}>{busy ? 'Concluindo...' : 'Confirmar conclusão'}</button> <button className="operator-outline operator-dialog-later" type="button" disabled={busy} onClick={() => setDialog(null)}>Agora não</button></>}
    </section></div>}
  </div>
}
