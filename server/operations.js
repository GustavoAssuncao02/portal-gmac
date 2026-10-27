import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import express from 'express'
import { mutateStore, readStore } from './offers.js'
import { requireOperator } from './operatorAuth.js'
import { requireAdminOrOperator } from './access.js'
import { activityDateRange, employeeActivityQuery } from './employeeActivity.js'
import { operationStates, ordersWithOperations } from './reportData.js'
import { productionStages, stageLabel, serviceDetails } from './serviceStages.js'
import { machineRows, sectorLabel } from './machines.js'
import { laborServiceRows } from './laborServices.js'
import { requireAdmin, adminIdentity, revokeAccountSessions } from './accounts.js'
import { orderHistory } from './orderHistory.js'
import { pieceCatalog, pieceKey, pieceSuggestion, pieceLeadTime } from './pieces.js'
import { accessFields, employeeRecords, employeesWithActivity, publicEmployee, staffAccountId } from './employeeAccess.js'
import { editOrder } from './orderEditing.js'
import { pendingOrderMaterials } from './pendingMaterials.js'
import { addNotification, completedServiceNotice } from './notificationEvents.js'
import { activeSessions, activeSince } from './operationSessions.js'
import { editEventTime } from './operationEventTime.js'
import { addManualEvent, manualEventTypes } from './operationManualEvents.js'
import { removeOrderReceivables } from './receivables.js'
import { pauseReasonNames, sectorRows, SWITCH_PAUSE_REASON } from './registries.js'
import { formatQuantity } from './materialUnits.js'

// The reasons to pause come from the registry (Cadastros > Razões de pausas). SWITCH_PAUSE_REASON is not chosen by the
// operator: it is recorded when starting another OS pauses the current one.
// The pause reason was registered with the wrong name; stored pauses are corrected once, at startup (it is safe to repeat).
const LEGACY_PAUSE_REASON = 'Gilson mandou parar', PAUSE_REASON = 'Jossenilson mandou parar'
export async function renameLegacyPauseReason(pool) {
  const legacy = JSON.stringify(LEGACY_PAUSE_REASON), current = JSON.stringify(PAUSE_REASON)
  // Done once: a mark in the store avoids scanning every recorded event at each start of the server.
  if ((await readStore()).migrations?.pauseReasonRenamed) return
  if (pool) for (const table of ['order_operations', 'order_operation_events']) await pool.execute(`UPDATE ${table} SET data = REPLACE(data, ?, ?) WHERE data LIKE ?`, [legacy, current, `%${LEGACY_PAUSE_REASON}%`])
  await mutateStore((draft) => {
    for (const order of draft.orders || []) {
      if (order.operation?.lastPauseReason === LEGACY_PAUSE_REASON) order.operation.lastPauseReason = PAUSE_REASON
      for (const event of order.operationEvents || []) if (event.reason === LEGACY_PAUSE_REASON) event.reason = PAUSE_REASON
    }
    draft.migrations = { ...draft.migrations, pauseReasonRenamed: new Date().toISOString() }
    return draft
  })
}
const json = (value) => typeof value === 'string' ? JSON.parse(value) : value
const clean = (value, max = 160) => String(value ?? '').trim().slice(0, max)

class OperationError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

function defaultOperation(order) {
  const stages = [...new Set(order.proposal?.stages || [])].map((key, index) => ({ key: `stage-${index + 1}`, name: stageLabel(key) }))
  return { status: 'waiting', stages, stageCounts: Object.fromEntries(stages.map((stage) => [stage.key, 0])), accumulatedMs: 0, startedAt: null, activeSessions: [], activeSince: null, completedAt: null, lastPauseReason: null }
}

// Converts the former single `activeSession` into the list used for simultaneous employees.
function normalizeSessions(state) {
  if (!Array.isArray(state.activeSessions)) {
    state.activeSessions = activeSessions(state)
    state.activeSince = activeSince(state)
  }
  if (!state.activeSessions.length) state.activeSince = null
  delete state.activeSession
  return state
}

function liveOperation(order, stored) {
  const operation = stored || defaultOperation(order)
  return { ...operation, targetQuantity: Number(order.quantity), progress: operation.stages.length ? Math.round(100 * operation.stages.reduce((sum, stage) => sum + Number(operation.stageCounts[stage.key] || 0), 0) / (operation.stages.length * Number(order.quantity))) : 0 }
}

function eventFor(type, session, fields = {}) {
  return { id: randomUUID(), type, at: new Date().toISOString(), employeeId: session?.employeeId ?? null, employeeName: session?.employeeName ?? null, sessionId: session?.id ?? null, machineId: session?.machineId ?? null, machineName: session?.machineName ?? null, laborServiceId: session?.laborServiceId ?? null, laborServiceName: session?.laborServiceName ?? null, ...fields }
}

function assertSession(state, sessionId, sessionToken) {
  if (!state.activeSessions.length) throw new OperationError(409, 'Nenhuma sessão de trabalho está em andamento.')
  const session = state.activeSessions.find((item) => item.id === sessionId)
  const suppliedHash = createHash('sha256').update(String(sessionToken || '')).digest()
  // The original key, plus the keys handed to other devices when the same operator identified there with their code.
  const matches = (hex) => { const storedHash = Buffer.from(hex || '', 'hex'); return storedHash.length === suppliedHash.length && timingSafeEqual(suppliedHash, storedHash) }
  if (!session || ![session.tokenHash, ...(session.deviceTokenHashes || [])].some(matches)) {
    throw new OperationError(403, 'Esta atividade pertence a outra sessão. Identifique-se para continuar.')
  }
  return session
}

// Reason recorded when a stage reaches every piece and the people on it stop, to choose the next stage.
const STAGE_DONE_REASON = 'Etapa concluída'
const allStagesDone = (state, order) => state.stages.length > 0 && state.stages.every((stage) => Number(state.stageCounts[stage.key] || 0) === Number(order.quantity))

// Time in each stage is the time of the people working on it, added up: every session is on one stage at a time.
function closeStageSegment(state, session, at) {
  if (!session.stageKey) return 0
  const duration = Math.max(0, Date.parse(at) - Date.parse(session.stageSince || session.startedAt))
  state.stageTimeMs ||= {}
  state.stageTimeMs[session.stageKey] = Number(state.stageTimeMs[session.stageKey] || 0) + duration
  session.stageSince = at
  return duration
}
// The stage chosen by the operator; without a choice, the first stage that is not finished.
function workStage(state, order, stageKey) {
  if (stageKey != null && stageKey !== '') {
    const stage = state.stages.find((item) => item.key === stageKey)
    if (!stage) throw new OperationError(400, 'Selecione uma etapa desta OS.')
    return stage
  }
  return state.stages.find((item) => Number(state.stageCounts[item.key] || 0) < Number(order.quantity)) || state.stages[0]
}

// Removes one employee from the OS; project time stops only when nobody else is working.
function endSession(state, session, at) {
  closeStageSegment(state, session, at)
  state.activeSessions = state.activeSessions.filter((item) => item.id !== session.id)
  if (state.activeSessions.length) return
  state.accumulatedMs = Number(state.accumulatedMs || 0) + Math.max(0, Date.parse(at) - Date.parse(state.activeSince || session.startedAt))
  state.activeSince = null
}

const sessionDuration = (session, at = new Date().toISOString()) => Math.max(0, Date.parse(at) - Date.parse(session.startedAt))
const resourceLabel = (machineName, laborServiceName) => machineName ? `Máquina ${machineName}` : laborServiceName ? `Serviço ${laborServiceName}` : 'Sem máquina ou serviço'

// A session uses either one machine or one labor service at a time.
function changeSessionResource(state, request, machine, service) {
  const session = assertSession(state, request.body?.sessionId, request.body?.sessionToken)
  const machineChanged = String(session.machineId ?? '') !== String(machine?.id ?? '')
  const serviceChanged = String(session.laborServiceId ?? '') !== String(service?.id ?? '')
  if (!machineChanged && !serviceChanged) throw new OperationError(409, 'Selecione um recurso diferente do atual.')
  const event = eventFor(machineChanged && serviceChanged ? 'resource_changed' : machineChanged ? 'machine_changed' : 'labor_service_changed', session, {
    nextMachineId: machine?.id ?? null, nextMachineName: machine?.name ?? null,
    nextLaborServiceId: service?.id ?? null, nextLaborServiceName: service?.name ?? null,
    durationMs: Math.max(0, Date.now() - Date.parse(session.resourceStartedAt || session.machineStartedAt || session.startedAt)),
    details: `${resourceLabel(session.machineName, session.laborServiceName)} → ${resourceLabel(machine?.name, service?.name)}`,
  })
  Object.assign(session, { machineId: machine?.id ?? null, machineName: machine?.name ?? null, laborServiceId: service?.id ?? null, laborServiceName: service?.name ?? null, resourceStartedAt: event.at })
  if (machineChanged) session.machineStartedAt = event.at
  return event
}

// The machine or labor service planned in the offer for a stage, while it is still registered: the stage then decides
// the resource and the operator cannot use another one. Without a plan the operator chooses.
function stagePlan(order, stage, catalog) {
  const code = productionStages.find(([, label]) => label === stage?.name)?.[0]
  const plan = code && order?.resources?.stageResources?.[code]
  const item = plan && catalog[plan.type]?.find((entry) => String(entry.id) === String(plan.id))
  return item ? { type: plan.type, name: item.name, machine: plan.type === 'machine' ? item : null, laborService: plan.type === 'labor-service' ? item : null } : null
}
function assertFreeChoice(state, order, session, catalog) {
  const plan = stagePlan(order, state.stages.find((stage) => stage.key === session.stageKey), catalog)
  if (plan) throw new OperationError(409, `A etapa ${session.stageName} é feita em ${plan.name}. Para usar outro recurso, selecione outra etapa.`)
}

function publicOperation(order, stored) {
  const operation = liveOperation(order, stored)
  const sessions = activeSessions(operation).map(({ tokenHash, deviceTokenHashes, ...session }) => session)
  const { activeSession: _legacy, ...rest } = operation
  // `activeSession` is kept as the first employee for older screens and integrations.
  return { ...rest, activeSessions: sessions, activeSince: activeSince(operation), activeSession: sessions[0] || null }
}

function operatorOrder(order, operation) {
  return {
    code: order.code, offerId: order.offerId, service: order.service, description: order.description,
    company: order.company, cnpj: order.cnpj, labelNumber: order.labelNumber, quantity: order.quantity,
    requestedAt: order.requestedAt, createdAt: order.createdAt, deadline: order.deadline,
    deliveryDeadline: order.proposal?.deadline || order.deadline,
    kind: order.resources?.kind || order.proposal?.kind || 'service',
    estimatedMachineTime: order.proposal?.machine,
    estimatedServiceTime: order.proposal?.serviceTime,
    attachments: order.attachments || [],
    resources: {
      ...serviceDetails(order.resources),
      materials: (order.resources?.materials || []).map(({ id, inventoryId, name, detail, quantity, stockStatus, stockAvailable, purchaseQuantity, inventoryConsumedQuantity }) => ({ id, inventoryId, name, detail, quantity, stockStatus, stockAvailable, purchaseQuantity, inventoryConsumedQuantity })),
      laborEntries: (order.resources?.laborEntries || []).map(({ id, type, resource, machineId, laborServiceId, hours }) => ({ id, type, resource, machineId, laborServiceId, hours })),
      stageTimes: order.resources?.stageTimes || {},
      stageResources: order.resources?.stageResources || {},
    },
    operation,
  }
}

export default function createOperationsRouter(pool) {
  const router = express.Router()
  renameLegacyPauseReason(pool).catch((error) => console.error('Falha ao corrigir o motivo de pausa antigo:', error.message))

  const employeeRows = () => employeeRecords(pool)

  async function orderByCode(code) {
    const order = (await readStore()).orders.find((item) => item.code === code)
    if (!order) throw new OperationError(404, 'OS não encontrada.')
    return order
  }

  async function storedOperation(code, order) {
    if (!pool) return order.operation || null
    const [rows] = await pool.execute('SELECT data FROM order_operations WHERE order_code = ?', [code])
    return rows.length ? json(rows[0].data) : null
  }

  async function changeOperation(code, change, persistOrder = false) {
    let order = await orderByCode(code)
    // A change may return one event or several, such as closing other employees' sessions on completion.
    const eventList = (result) => [].concat(result || [])
    const saveEvents = async (connection, events) => {
      for (const event of events) await connection.execute('INSERT INTO order_operation_events (id, order_code, data, occurred_at) VALUES (?, ?, ?, ?)', [event.id, code, JSON.stringify(event), new Date(event.at)])
    }
    const result = (current, state, events) => ({ order: current, operation: publicOperation(current, state), event: events.at(-1) || null, events })
    if (!pool) return mutateStore((store) => {
      const current = store.orders.find((item) => item.code === code)
      const state = normalizeSessions(current.operation || defaultOperation(current))
      const events = eventList(change(state, current, store))
      current.operation = state
      current.operationEvents ||= []
      current.operationEvents.push(...events)
      return result(current, state, events)
    })

    const connection = await pool.getConnection()
    try {
      if (persistOrder) return await mutateStore(async (store) => {
        const current = store.orders.find((item) => item.code === code)
        if (!current) throw new OperationError(404, 'OS não encontrada.')
        await connection.beginTransaction()
        await connection.execute('INSERT IGNORE INTO order_operations (order_code, data) VALUES (?, ?)', [code, JSON.stringify(defaultOperation(current))])
        const [rows] = await connection.execute('SELECT data FROM order_operations WHERE order_code = ? FOR UPDATE', [code])
        const state = normalizeSessions(json(rows[0].data))
        const events = eventList(change(state, current, store))
        await connection.execute('UPDATE order_operations SET data = ? WHERE order_code = ?', [JSON.stringify(state), code])
        await saveEvents(connection, events)
        return result(current, state, events)
      }, { commit: () => connection.commit(), rollback: () => connection.rollback() })
      await connection.beginTransaction()
      await connection.execute('INSERT IGNORE INTO order_operations (order_code, data) VALUES (?, ?)', [code, JSON.stringify(defaultOperation(order))])
      const [rows] = await connection.execute('SELECT data FROM order_operations WHERE order_code = ? FOR UPDATE', [code])
      const state = normalizeSessions(json(rows[0].data))
      order = await orderByCode(code)
      const events = eventList(change(state, order))
      await connection.execute('UPDATE order_operations SET data = ? WHERE order_code = ?', [JSON.stringify(state), code])
      await saveEvents(connection, events)
      await connection.commit()
      const completed = events.find((event) => event.type === 'completed')
      if (completed) {
        try { await mutateStore((store) => addNotification(store, completedServiceNotice(order, completed))) } catch (error) { console.error('Falha ao registrar aviso de conclusao:', error) }
      }
      return result(order, state, events)
    } catch (error) {
      if (!persistOrder) await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  // Changes the recorded operations themselves: a corrected time, or an operation typed in from an employee's notes.
  // `apply(state, events, order)` returns the event, the recorded events it adjusted and, for a new one, `added`.
  async function rewriteEvents(code, apply) {
    const order = await orderByCode(code)
    const result = (current, state, event) => ({ order: current, operation: publicOperation(current, state), event })
    if (!pool) return mutateStore((store) => {
      const current = store.orders.find((item) => item.code === code)
      const state = normalizeSessions(current.operation || defaultOperation(current))
      current.operationEvents ||= []
      const { event, added } = apply(state, current.operationEvents, current)
      if (added) current.operationEvents.push(added)
      current.operation = state
      return result(current, state, event)
    })

    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      await connection.execute('INSERT IGNORE INTO order_operations (order_code, data) VALUES (?, ?)', [code, JSON.stringify(defaultOperation(order))])
      const [rows] = await connection.execute('SELECT data FROM order_operations WHERE order_code = ? FOR UPDATE', [code])
      const state = normalizeSessions(json(rows[0].data))
      const [eventRows] = await connection.execute('SELECT data FROM order_operation_events WHERE order_code = ? ORDER BY seq', [code])
      const { event, changed, added } = apply(state, eventRows.map((row) => json(row.data)), order)
      await connection.execute('UPDATE order_operations SET data = ? WHERE order_code = ?', [JSON.stringify(state), code])
      if (added) await connection.execute('INSERT INTO order_operation_events (id, order_code, data, occurred_at) VALUES (?, ?, ?, ?)', [added.id, code, JSON.stringify(added), new Date(added.at)])
      for (const item of changed) await connection.execute('UPDATE order_operation_events SET data = ?, occurred_at = ? WHERE id = ? AND order_code = ?', [JSON.stringify(item), new Date(item.at), item.id, code])
      await connection.commit()
      return result(await orderByCode(code), state, event)
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  function sendError(response, error) {
    if (!error.status) console.error('Falha na operação da OS:', error)
    response.status(error.status || 500).json({ message: error.status ? error.message : 'Não foi possível registrar a operação.', ...(error.code === 'PENDING_MATERIALS' ? { code: error.code, pendingMaterials: error.pendingMaterials } : {}), ...(error.code === 'COMPLETED_BY_REQUIRED' ? { code: error.code } : {}), ...(error.code === 'WORKING_ELSEWHERE' ? { code: error.code, busyOrder: error.busyOrder } : {}), ...(['MACHINE_BUSY', 'MACHINE_MAINTENANCE'].includes(error.code) ? { code: error.code } : {}) })
  }

  // The registration of employees (CPF, e-mail, birth date and operator codes) is for the administrative portal only.
  // `hasActivity`: the employee already worked or authored a record, so the registration can only be deactivated.
  router.get('/employees', requireAdmin, async (_request, response) => {
    try {
      const [employees, active, sectors] = await Promise.all([employeeRows(), employeesWithActivity(pool), sectorRows()])
      const sectorName = new Map(sectors.map((sector) => [sector.id, sector.name]))
      const names = (item) => item.sectorIds.map((id) => sectorName.get(id)).filter(Boolean)
      response.json({ items: employees.map((item) => ({ ...publicEmployee(item, { withCode: true }), sectorNames: names(item), sectorName: sectorLabel(names(item)) || null, hasActivity: active.has(String(item.id)) })), sectors })
    } catch (error) { sendError(response, error) }
  })

  router.get('/employees/:id/activities', requireAdmin, async (request, response) => {
    try {
      const range = activityDateRange(request.query.period ?? 'today', request.query.date)
      const employee = (await employeeRows()).find((item) => String(item.id) === request.params.id)
      if (!employee) throw new OperationError(404, 'Funcionário não encontrado.')
      const { orders } = await readStore()
      let events
      if (pool) {
        const { sql, params } = employeeActivityQuery(request.params.id, range)
        const [rows] = await pool.execute(sql, params)
        events = rows.map((row) => ({ ...json(row.data), orderCode: row.orderCode }))
      } else {
        const allEvents = orders.flatMap((order) => (order.operationEvents || []).map((event) => ({ ...event, orderCode: order.code })))
        const sessions = new Set(allEvents.filter((event) => String(event.employeeId) === request.params.id && event.sessionId).map((event) => event.sessionId))
        events = allEvents.reverse()
          .filter((event) => (String(event.employeeId) === request.params.id || event.type === 'admin_interrupted' && sessions.has(event.sessionId)) && (!range || Date.parse(event.at) >= range.start && Date.parse(event.at) < range.end))
          .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
      }
      const orderMap = new Map(orders.map((order) => [order.code, order]))
      response.json({ items: events.map((event) => {
        const order = orderMap.get(event.orderCode)
        return { ...event, service: order?.service || null, company: order?.company || null, labelNumber: order?.labelNumber || null, targetQuantity: order?.quantity || null }
      }) })
    } catch (error) { sendError(response, error instanceof RangeError ? new OperationError(400, error.message) : error) }
  })

  // The old 3-digit identification is no longer asked for; registrations that have one keep it.
  // Birth date and e-mail are optional: the payroll list has neither.
  // The sectors are optional, one or more of the registered ones (Cadastros > Setores); `sectorId` keeps the first.
  async function employeeFields(body, current) {
    const { name, birthDate, cpf, email, identification } = body || {}
    const requested = Array.isArray(body?.sectorIds) ? body.sectorIds : body?.sectorId ? [body.sectorId] : []
    const sectorIds = [...new Set(requested.map((id) => clean(id, 64)).filter(Boolean))].slice(0, 20)
    const registered = await sectorRows()
    if (sectorIds.some((id) => !registered.some((sector) => sector.id === id))) throw new OperationError(400, 'Selecione um setor cadastrado.')
    const normalized = { name: clean(name), birthDate: clean(birthDate, 10) || null, cpf: clean(cpf, 20).replace(/\D/g, ''), email: clean(email, 160) || null, identification: clean(identification, 3) || current?.identification || null, sectorId: sectorIds[0] || null, sectorIds }
    if (!normalized.name || normalized.birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalized.birthDate) || !/^\d{11}$/.test(normalized.cpf) || normalized.email && !normalized.email.includes('@')) throw new OperationError(400, 'Preencha os dados do funcionário.')
    if (normalized.identification && !/^\d{3}$/.test(normalized.identification)) throw new OperationError(400, 'A identificação deve ter 3 dígitos.')
    return normalized
  }
  const duplicateEmployee = (store, current, fields) => {
    if (store.employees.some((item) => item !== current && (item.cpf === fields.cpf || fields.email && item.email === fields.email || fields.identification && item.identification === fields.identification))) throw new OperationError(409, 'CPF, e-mail ou identificação já cadastrados.')
    if (fields.accessCode && store.employees.some((item) => item !== current && item.accessCode === fields.accessCode)) throw new OperationError(409, 'Este código já está em uso por outro operador.')
  }
  const duplicateEntry = (error) => error.code === 'ER_DUP_ENTRY' ? new OperationError(409, /access_code/.test(error.message) ? 'Este código já está em uso por outro operador.' : 'CPF, e-mail ou identificação já cadastrados.') : error

  router.post('/employees', requireAdmin, async (request, response) => {
    try {
      const access = await accessFields(request.body, null, await employeeRows())
      const fields = { ...await employeeFields(request.body), ...access, active: true }
      let employee
      if (pool) {
        const [result] = await pool.execute('INSERT INTO employees (name, birth_date, cpf, email, i_identificacao, employee_type, access_code, password_hash, sector_id, sector_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [fields.name, fields.birthDate, fields.cpf, fields.email, fields.identification, fields.type, fields.accessCode, fields.passwordHash, fields.sectorId, JSON.stringify(fields.sectorIds)])
        employee = { id: result.insertId, ...fields }
      } else {
        employee = await mutateStore((store) => {
          store.employees ||= []
          duplicateEmployee(store, null, fields)
          const created = { id: randomUUID(), ...fields }
          store.employees.push(created)
          return created
        })
      }
      response.status(201).json({ item: publicEmployee(employee, { withCode: true }) })
    } catch (error) { sendError(response, duplicateEntry(error)) }
  })

  router.put('/employees/:id', requireAdmin, async (request, response) => {
    try {
      const employees = await employeeRows()
      const previous = employees.find((item) => String(item.id) === request.params.id)
      if (!previous) throw new OperationError(404, 'Funcionário não encontrado.')
      const access = await accessFields(request.body, previous, employees)
      const fields = { ...await employeeFields(request.body, previous), ...access }
      let employee
      if (pool) {
        const [result] = await pool.execute('UPDATE employees SET name = ?, birth_date = ?, cpf = ?, email = ?, i_identificacao = ?, employee_type = ?, access_code = ?, password_hash = ?, sector_id = ?, sector_ids = ? WHERE id = ?', [fields.name, fields.birthDate, fields.cpf, fields.email, fields.identification, fields.type, fields.accessCode, fields.passwordHash, fields.sectorId, JSON.stringify(fields.sectorIds), request.params.id])
        if (!result.affectedRows) throw new OperationError(404, 'Funcionário não encontrado.')
        employee = { id: Number(request.params.id), ...fields, active: previous.active }
      } else {
        employee = await mutateStore((store) => {
          store.employees ||= []
          const current = store.employees.find((item) => String(item.id) === request.params.id)
          if (!current) throw new OperationError(404, 'Funcionário não encontrado.')
          duplicateEmployee(store, current, fields)
          Object.assign(current, fields)
          return current
        })
      }
      // A new password or a change of type ends the administrative sessions already open.
      if (fields.type !== previous.type || fields.passwordHash !== previous.passwordHash) await revokeAccountSessions(staffAccountId(previous.id))
      response.json({ item: publicEmployee(employee, { withCode: true }) })
    } catch (error) { sendError(response, duplicateEntry(error)) }
  })

  router.delete('/employees/:id', requireAdmin, async (request, response) => {
    try {
      if (request.adminId === staffAccountId(request.params.id)) throw new OperationError(409, 'Você não pode excluir sua própria conta.')
      if ((await employeesWithActivity(pool)).has(String(request.params.id))) throw new OperationError(409, 'Este funcionário já tem registros no sistema. Desative o cadastro em vez de excluir.')
      if (pool) {
        const [result] = await pool.execute('DELETE FROM employees WHERE id = ?', [request.params.id])
        if (!result.affectedRows) throw new OperationError(404, 'Funcionário não encontrado.')
      } else await mutateStore((store) => {
        store.employees ||= []
        const index = store.employees.findIndex((item) => String(item.id) === request.params.id)
        if (index < 0) throw new OperationError(404, 'Funcionário não encontrado.')
        store.employees.splice(index, 1)
      })
      await revokeAccountSessions(staffAccountId(request.params.id))
      response.status(204).end()
    } catch (error) { sendError(response, error) }
  })

  // A deactivated employee keeps the history but cannot identify as operator nor sign in as administrative employee.
  router.patch('/employees/:id/active', requireAdmin, async (request, response) => {
    try {
      if (typeof request.body?.active !== 'boolean') throw new OperationError(400, 'Informe se o funcionário fica ativo.')
      const active = request.body.active
      if (!active && request.adminId === staffAccountId(request.params.id)) throw new OperationError(409, 'Você não pode desativar sua própria conta.')
      const previous = (await employeeRows()).find((item) => String(item.id) === request.params.id)
      if (!previous) throw new OperationError(404, 'Funcionário não encontrado.')
      if (!active && (await operationOrders()).some((order) => activeSessions(order.operation).some((session) => String(session.employeeId) === String(previous.id)))) throw new OperationError(409, `${previous.name} está trabalhando em uma OS agora. Pause ou conclua o trabalho antes de desativar.`)
      if (pool) await pool.execute('UPDATE employees SET active = ? WHERE id = ?', [active ? 1 : 0, request.params.id])
      else await mutateStore((store) => { Object.assign(store.employees.find((item) => String(item.id) === request.params.id), { active }) })
      if (!active) await revokeAccountSessions(staffAccountId(previous.id))
      response.json({ item: publicEmployee({ ...previous, active }, { withCode: true }) })
    } catch (error) { sendError(response, error) }
  })

  async function operationOrders() {
    const orders = (await readStore()).orders
    if (!orders.length) return []
    let stored = new Map()
    if (pool) {
      const rows = await operationStates(orders, pool)
      stored = new Map(rows.map((row) => [row.order_code, json(row.data)]))
    }
    return orders.map((order) => ({ ...order, operation: publicOperation(order, pool ? stored.get(order.code) : order.operation) }))
  }

  // Who worked on each OS (the start and resume records), for the filter by employee of the completed services.
  async function orderCollaborators(orders) {
    const byOrder = new Map()
    const add = (code, id, name) => {
      if (id == null || id === 'null' || id === '') return
      if (!byOrder.has(code)) byOrder.set(code, new Map())
      byOrder.get(code).set(String(id), name && name !== 'null' ? name : 'Funcionário')
    }
    if (pool) {
      const [rows] = await pool.execute("SELECT DISTINCT order_code AS code, JSON_UNQUOTE(JSON_EXTRACT(data, '$.employeeId')) AS id, JSON_UNQUOTE(JSON_EXTRACT(data, '$.employeeName')) AS name FROM order_operation_events WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.type')) IN ('started', 'resumed')")
      for (const row of rows) add(row.code, row.id, row.name)
    } else for (const order of orders) for (const event of order.operationEvents || []) if (['started', 'resumed'].includes(event.type)) add(order.code, event.employeeId, event.employeeName)
    return byOrder
  }

  router.get('/operations/orders', requireAdmin, async (_request, response) => {
    try {
      const orders = await operationOrders()
      const collaborators = await orderCollaborators(orders)
      response.json({ items: orders.map((order) => ({ ...order, collaborators: [...(collaborators.get(order.code) || new Map())].map(([id, name]) => ({ id, name })) })) })
    } catch (error) { sendError(response, error) }
  })

  // Operators without work open in any OS right now, with when and why they stopped today (Máquinas screen).
  router.get('/operations/idle-employees', requireAdmin, async (_request, response) => {
    try {
      const orders = await operationOrders()
      const busy = new Set(orders.flatMap((order) => activeSessions(order.operation).map((session) => String(session.employeeId))))
      const today = activityDateRange('today')
      const events = pool ? (await pool.execute('SELECT order_code AS orderCode, data FROM order_operation_events WHERE occurred_at >= ?', [new Date(today.start)]))[0].map((row) => ({ ...json(row.data), orderCode: row.orderCode })) : orders.flatMap((order) => (order.operationEvents || []).map((event) => ({ ...event, orderCode: order.code })))
      const lastStop = new Map()
      for (const event of events) {
        const at = Date.parse(event.at)
        if (!['paused', 'stage_completed', 'completed', 'session_ended', 'admin_interrupted'].includes(event.type) || event.employeeId == null || !(at >= today.start)) continue
        const id = String(event.employeeId)
        if (!lastStop.has(id) || at > Date.parse(lastStop.get(id).at)) lastStop.set(id, event)
      }
      const items = (await employeeRows()).filter((employee) => employee.type === 'operator' && employee.active && !busy.has(String(employee.id))).map((employee) => {
        const stop = lastStop.get(String(employee.id))
        return { id: employee.id, name: employee.name, idleSince: stop?.at || null, reason: stop ? stop.reason || (stop.type === 'completed' || stop.type === 'session_ended' ? 'OS concluída' : stop.type === 'admin_interrupted' ? 'Encerrado pelo admin' : null) : null, orderCode: stop?.orderCode || null }
      })
      // Whoever has been stopped the longest comes first; those without work today, by name, before them.
      items.sort((left, right) => (left.idleSince ? Date.parse(left.idleSince) : -Infinity) - (right.idleSince ? Date.parse(right.idleSince) : -Infinity) || left.name.localeCompare(right.name, 'pt-BR'))
      response.set('Cache-Control', 'no-store').json({ items, working: busy.size })
    } catch (error) { sendError(response, error) }
  })

  router.get('/operations/operator/orders', requireOperator, async (_request, response) => {
    try {
      response.set('Cache-Control', 'no-store')
      response.json({ items: (await operationOrders()).map((order) => operatorOrder(order, order.operation)) })
    } catch (error) { sendError(response, error) }
  })

  // On the shared operator account, each operator identifies with a personal 4-digit code.
  router.post('/operations/operator/identify', requireOperator, async (request, response) => {
    try {
      const code = String(request.body?.code ?? '')
      if (!/^\d{4}$/.test(code)) throw new OperationError(400, 'Digite o seu código de 4 dígitos.')
      const employee = (await employeeRows()).find((item) => item.type === 'operator' && item.accessCode === code)
      if (!employee) throw new OperationError(404, 'Código não encontrado. Confira os 4 dígitos.')
      if (!employee.active) throw new OperationError(403, 'Este cadastro está desativado. Procure o administrador.')
      // The operator is who they say (their own code): this device receives a key to each work session they have open,
      // so a session started on another device or in a closed tab can be continued here. Existing keys keep working.
      const sessions = []
      for (const order of await operationOrders()) {
        if (!activeSessions(order.operation).some((session) => String(session.employeeId) === String(employee.id))) continue
        await changeOperation(order.code, (state) => {
          for (const session of state.activeSessions.filter((item) => String(item.employeeId) === String(employee.id))) {
            const sessionToken = randomUUID()
            session.deviceTokenHashes = [...(session.deviceTokenHashes || []), createHash('sha256').update(sessionToken).digest('hex')].slice(-5)
            sessions.push({ orderCode: order.code, sessionId: session.id, sessionToken })
          }
          return []
        })
      }
      response.json({ employee: { id: employee.id, name: employee.name, identification: employee.identification }, sessions })
    } catch (error) { sendError(response, error) }
  })

  router.get('/operations/orders/:code/events', requireAdminOrOperator, async (request, response) => {
    try {
      const store = await readStore()
      const order = store.orders.find((item) => item.code === request.params.code)
      if (!order) throw new OperationError(404, 'OS não encontrada.')
      // Chronological, so an operation whose time was corrected appears in its real position.
      const history = (items) => orderHistory(store, order, items, Boolean(adminIdentity(request))).sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
      if (!pool) return response.json({ items: history(order.operationEvents || []) })
      const [rows] = await pool.execute('SELECT data FROM order_operation_events WHERE order_code = ? ORDER BY seq', [request.params.code])
      response.json({ items: history(rows.map((row) => json(row.data))) })
    } catch (error) { sendError(response, error) }
  })

  router.put('/operations/orders/:code/events/:eventId/time', requireAdmin, async (request, response) => {
    try {
      const result = await rewriteEvents(request.params.code, (state, events) => editEventTime(state, events, request.params.eventId, request.body?.at, { id: request.adminId, name: request.adminName }))
      response.json({ item: result.event, operation: result.operation })
    } catch (error) { sendError(response, error) }
  })

  // The lists of the "Adicionar operação" form: only registered employees, stages, resources and pause reasons are used.
  router.get('/operations/orders/:code/manual-options', requireAdmin, async (request, response) => {
    try {
      const order = (await operationOrders()).find((item) => item.code === request.params.code)
      if (!order) throw new OperationError(404, 'OS não encontrada.')
      const [employees, pauseReasons, catalog] = await Promise.all([employeeRows(), pauseReasonNames(), resourceCatalog()])
      const option = (item) => ({ id: item.id, name: item.name })
      const byName = (left, right) => left.name.localeCompare(right.name, 'pt-BR')
      response.set('Cache-Control', 'no-store').json({
        employees: employees.filter((item) => item.type === 'operator' && item.active).map(option).sort(byName),
        pauseReasons,
        machines: catalog.machine.map(option).sort(byName),
        laborServices: catalog['labor-service'].map(option).sort(byName),
        quantity: Number(order.quantity),
        stages: order.operation.stages.map((stage) => {
          const plan = stagePlan(order, stage, catalog)
          return { key: stage.key, name: stage.name, count: Number(order.operation.stageCounts?.[stage.key] || 0), plan: plan ? { type: plan.type, id: (plan.machine || plan.laborService).id, name: plan.name } : null }
        }),
      })
    } catch (error) { sendError(response, error) }
  })

  // An operation typed in from an employee's notes (Histórico de operações > Adicionar operação).
  router.post('/operations/orders/:code/events', requireAdmin, async (request, response) => {
    try {
      const body = request.body || {}
      if (!manualEventTypes.includes(body.type)) throw new OperationError(400, 'Selecione a operação.')
      const employee = (await employeeRows()).find((item) => item.type === 'operator' && String(item.id) === String(body.employeeId))
      if (!employee) throw new OperationError(400, 'Selecione o funcionário responsável.')
      const input = { type: body.type, at: body.at, employee: { id: employee.id, name: employee.name }, stageKey: body.stageKey, quantity: body.quantity }
      if (body.type === 'pause') {
        if (!(await pauseReasonNames()).includes(body.reason)) throw new OperationError(400, 'Selecione o motivo da pausa.')
        input.reason = body.reason
      }
      if (body.type === 'start') {
        input.machine = await selectedResource('machine', body.machineId)
        input.laborService = await selectedResource('labor-service', body.laborServiceId)
        if (input.machine && input.laborService) throw new OperationError(400, 'Selecione a máquina ou o serviço de hora homem, não os dois.')
      }
      const catalog = await resourceCatalog()
      const result = await rewriteEvents(request.params.code, (state, events, order) => {
        // As on the operator screen, a stage planned in the offer decides the resource.
        const stage = body.type === 'start' && state.stages.find((item) => item.key === body.stageKey)
        const plan = stage && stagePlan(order, stage, catalog)
        if (plan && String((plan.machine ? input.machine : input.laborService)?.id ?? '') !== String((plan.machine || plan.laborService).id)) throw new OperationError(409, `A etapa ${stage.name} é feita em ${plan.name}.`)
        const { event, changed } = addManualEvent(state, events, order, input, { id: request.adminId, name: request.adminName })
        return { event, changed, added: event }
      })
      response.status(201).json({ item: result.event, operation: result.operation })
    } catch (error) { sendError(response, error) }
  })

  router.put('/operations/orders/:code', requireAdmin, async (request, response) => {
    try {
      const result = await changeOperation(request.params.code, (state, order, store) => {
        const previousMaterialIds = new Set((order.resources?.materials || []).map((material) => material.id))
        const changes = editOrder(order, state, { ...request.body, actorName: request.adminName }, { machines: store.machines, laborServices: store.laborServices })
        for (const material of order.resources.materials) if (!previousMaterialIds.has(material.id)) Object.assign(material, { requestedBy: request.adminId, requestedByName: request.adminName || null, requestedAt: new Date().toISOString(), requestedQuantity: material.purchaseQuantity ?? material.quantity })
        const offer = store.offers.find((item) => item.id === order.offerId)
        if (!offer) throw new OperationError(409, 'A oferta vinculada à OS não foi encontrada.')
        for (const key of Object.keys(changes.after).filter((key) => !['stages', 'stageCounts'].includes(key))) offer[key] = structuredClone(order[key])
        offer.updatedAt = order.updatedAt
        const labels = { company: 'Cliente', cnpj: 'CNPJ/CPF', service: 'Serviço', description: 'Descrição', labelNumber: 'Etiqueta', quantity: 'Quantidade da OS', deadline: 'Prazo solicitado', requestedAt: 'Data da solicitação', resources: 'Materiais e processo', proposal: 'Proposta', attachments: 'Anexos', stages: 'Etapas', stageCounts: 'Peças por etapa' }
        return eventFor('order_edited', null, { employeeName: request.adminName || 'Administrador', adminId: request.adminId, changes, details: `Campos atualizados: ${changes.changed.map((key) => labels[key] || key).join(', ') || 'nenhuma alteração'}.${order.deadlineChange && changes.changed.includes('deadline') ? ` Justificativa do novo prazo: ${order.deadlineChange.reason}` : ''}` })
      }, true)
      response.json({ item: { ...result.order, operation: result.operation }, event: result.event })
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/reopen', requireAdmin, async (request, response) => {
    // What to do with the accounts receivable posted for the OS (scheduled or already received in Tesouraria): the user chooses.
    const receivables = request.body?.receivables ?? 'keep'
    if (!['keep', 'delete'].includes(receivables)) return response.status(400).json({ message: 'Informe se o contas a receber vinculado deve ser mantido ou excluído.' })
    try {
      const result = await changeOperation(request.params.code, (state, order, store) => {
        if (state.status !== 'completed') throw new OperationError(409, 'Somente uma OS finalizada pode ser reaberta.')
        // Validated and removed before the state changes, so a blocked deletion leaves the OS completed.
        const removedReceivables = receivables === 'delete' ? removeOrderReceivables(store, { id: request.adminId, name: request.adminName || 'Administrador' }, order.code) : []
        const previousCompletedAt = state.completedAt
        state.status = state.startedAt ? 'paused' : 'waiting'
        state.completedAt = null
        state.completionAcknowledgedAt = null
        state.lastPauseReason = null
        state.reopenedAt = new Date().toISOString()
        order.status = 'Em andamento'
        order.updatedAt = state.reopenedAt
        return eventFor('order_reopened', null, { employeeName: request.adminName || 'Administrador', adminId: request.adminId, previousCompletedAt, removedReceivables, details: `OS reaberta com as quantidades produzidas e o histórico preservados.${removedReceivables.length ? ` Contas a receber excluídas: ${removedReceivables.join(', ')}.` : ''}` })
      }, true)
      response.json({ item: { ...result.order, operation: result.operation }, event: result.event })
    } catch (error) { sendError(response, error) }
  })

  router.put('/operations/orders/:code/stages', requireAdmin, async (request, response) => {
    const names = request.body?.stages
    if (!Array.isArray(names) || !names.length || names.length > 32 || names.some((name) => !clean(name, 80))) return response.status(400).json({ message: 'Informe de 1 a 32 etapas.' })
    try {
      const result = await changeOperation(request.params.code, (state) => {
        if (state.status !== 'waiting' || Object.values(state.stageCounts).some(Number)) throw new OperationError(409, 'As etapas só podem ser alteradas antes do trabalho começar.')
        state.stages = names.map((name, index) => ({ key: `stage-${index + 1}`, name: clean(name, 80) }))
        state.stageCounts = Object.fromEntries(state.stages.map((stage) => [stage.key, 0]))
        return eventFor('stages_configured', null, { details: state.stages.map((stage) => stage.name) })
      })
      response.json(result)
    } catch (error) { sendError(response, error) }
  })

  // A machine is used by one person at a time, in any OS; labor services can be shared. `mine` tells which open
  // sessions do not count (the session itself, or the employee leaving another OS). Here only the other OS are checked;
  // the OS being changed is checked inside its own update, after the work session is authenticated (machineTakenIn).
  async function assertMachineFree(machine, mine, currentCode) {
    if (!machine) return
    if (machine.maintenance) throw Object.assign(new OperationError(409, `A máquina ${machine.name} está em manutenção.`), { code: 'MACHINE_MAINTENANCE' })
    const orders = (await readStore()).orders.filter((order) => order.code !== currentCode)
    if (!orders.length) return
    const stored = pool ? new Map((await operationStates(orders, pool)).map((row) => [row.order_code, json(row.data)])) : null
    for (const order of orders) {
      const busy = activeSessions(publicOperation(order, pool ? stored.get(order.code) : order.operation)).find((session) => String(session.machineId) === String(machine.id) && !mine(session))
      if (busy) {
        const error = new OperationError(409, `A máquina ${machine.name} está sendo usada por ${busy.employeeName || 'outro funcionário'} na ${order.code}.`)
        error.code = 'MACHINE_BUSY'
        throw error
      }
    }
  }
  const machineTakenIn = (state, machine, mine) => machine && state.activeSessions.find((session) => String(session.machineId) === String(machine.id) && !mine(session))

  const resourceCatalog = async () => {
    const [machines, laborServices] = await Promise.all([machineRows(), laborServiceRows()])
    return { machine: machines, 'labor-service': laborServices }
  }

  async function selectedResource(type, id) {
    if (id == null || id === '') return null
    const rows = type === 'machine' ? await machineRows() : await laborServiceRows()
    const found = rows.find((item) => String(item.id) === String(id))
    if (!found) throw new OperationError(400, type === 'machine' ? 'Selecione uma máquina cadastrada.' : 'Selecione um serviço cadastrado.')
    return found
  }

  // An operator works on one OS at a time. Starting another one asks first; once confirmed (`switchFrom`), the work in the
  // other OS is paused with "Troca de serviço" at the moment the new one starts.
  async function workElsewhere(employee, code, switchFrom) {
    const busy = (await operationOrders()).filter((order) => order.code !== code && activeSessions(order.operation).some((session) => String(session.employeeId) === String(employee.id)))
    if (busy.length && !busy.some((order) => order.code === switchFrom)) {
      const error = new OperationError(409, `${employee.name} já está trabalhando na OS ${busy[0].code}. Deseja alterar para esta?`)
      error.code = 'WORKING_ELSEWHERE'
      error.busyOrder = { code: busy[0].code, service: busy[0].service }
      throw error
    }
    return busy
  }
  async function pauseElsewhere(employee, orders, at) {
    const switched = []
    for (const order of orders) {
      await changeOperation(order.code, (state) => state.activeSessions.filter((item) => String(item.employeeId) === String(employee.id)).map((session) => {
        const event = { ...eventFor('paused', session, { reason: SWITCH_PAUSE_REASON, durationMs: sessionDuration(session, at) }), at }
        endSession(state, session, at)
        if (!state.activeSessions.length) Object.assign(state, { status: 'paused', lastPauseReason: SWITCH_PAUSE_REASON })
        switched.push({ orderCode: order.code, sessionId: session.id })
        return event
      }))
    }
    return switched
  }

  router.post('/operations/orders/:code/start', requireOperator, async (request, response) => {
    try {
      const employee = (await employeeRows()).find((item) => item.type === 'operator' && String(item.id) === String(request.body?.employeeId))
      if (!employee) throw new OperationError(400, 'Selecione um funcionário cadastrado.')
      if (!employee.active) throw new OperationError(403, 'Este cadastro está desativado. Procure o administrador.')
      const machine = await selectedResource('machine', request.body?.machineId)
      const laborService = await selectedResource('labor-service', request.body?.laborServiceId)
      if (machine && laborService) throw new OperationError(400, 'Selecione a máquina ou o serviço de hora homem, não os dois.')
      const elsewhere = await workElsewhere(employee, request.params.code, request.body?.switchFrom)
      const ownSession = (session) => String(session.employeeId) === String(employee.id)
      await assertMachineFree(machine, ownSession, request.params.code)
      const catalog = await resourceCatalog()
      const sessionToken = randomUUID()
      let session
      const result = await changeOperation(request.params.code, (state, order) => {
        if (!state.stages.length) throw new OperationError(409, 'Defina as etapas da OS antes de iniciar.')
        if (state.status === 'completed') throw new OperationError(409, 'Esta OS já foi concluída.')
        if (state.activeSessions.some((item) => String(item.employeeId) === String(employee.id))) throw new OperationError(409, `${employee.name} já está trabalhando nesta OS.`)
        const stage = workStage(state, order, request.body?.stageKey)
        // The stage decides the resource when the offer planned one for it.
        const plan = stagePlan(order, stage, catalog)
        if (plan && String((plan.machine ? machine : laborService)?.id ?? '') !== String((plan.machine || plan.laborService).id)) throw new OperationError(409, `A etapa ${stage.name} é feita em ${plan.name}. Selecione a etapa novamente.`)
        const taken = machineTakenIn(state, machine, ownSession)
        if (taken) throw Object.assign(new OperationError(409, `A máquina ${machine.name} está sendo usada por ${taken.employeeName || 'outro funcionário'} na ${order.code}.`), { code: 'MACHINE_BUSY' })
        const pending = pendingOrderMaterials(order)
        if (pending.length && JSON.stringify(request.body?.pendingMaterialsConfirmation) !== JSON.stringify(pending.map((material) => [material.key, material.quantity]))) {
          const error = new OperationError(409, 'Material pendente. Deseja começar o serviço mesmo assim?')
          error.code = 'PENDING_MATERIALS'
          error.pendingMaterials = pending
          throw error
        }
        const now = new Date().toISOString()
        const firstStart = !state.startedAt
        state.startedAt ||= now
        if (!state.activeSessions.length) state.activeSince = now
        session = { id: randomUUID(), tokenHash: createHash('sha256').update(sessionToken).digest('hex'), employeeId: employee.id, employeeName: employee.name, machineId: machine?.id ?? null, machineName: machine?.name ?? null, laborServiceId: laborService?.id ?? null, laborServiceName: laborService?.name ?? null, startedAt: now, stageKey: stage.key, stageName: stage.name, stageSince: now }
        state.activeSessions.push(session)
        state.status = allStagesDone(state, order) ? 'finalizing' : 'running'
        state.lastPauseReason = null
        return eventFor(firstStart ? 'started' : 'resumed', session, { workStageKey: stage.key, workStageName: stage.name, ...(pending.length ? { pendingMaterialsAccepted: true, pendingMaterials: pending, details: pending.map((material) => `Material pendente autorizado: ${material.name}, ${formatQuantity(material.quantity, material.unit)}`) } : {}) })
      })
      // The new work is already open: only now the other OS is paused, so a refused start leaves it running.
      const switched = elsewhere.length ? await pauseElsewhere(employee, elsewhere, session.startedAt) : []
      const { tokenHash, deviceTokenHashes, ...publicSession } = session
      response.json({ ...result, order: operatorOrder(result.order, result.operation), session: publicSession, sessionToken, switched })
    } catch (error) { sendError(response, error) }
  })

  // Moves the employee between a machine and a labor service, or to another resource of the same kind.
  router.post('/operations/orders/:code/resource', requireOperator, async (request, response) => {
    try {
      const type = request.body?.resourceType
      if (!['machine', 'labor-service'].includes(type)) throw new OperationError(400, 'Selecione se vai usar uma máquina ou um serviço de hora homem.')
      if (request.body?.resourceId == null || request.body.resourceId === '') throw new OperationError(400, type === 'machine' ? 'Selecione a máquina.' : 'Selecione o serviço de hora homem.')
      const resource = await selectedResource(type, request.body.resourceId)
      const sameSession = (session) => session.id === request.body?.sessionId
      if (type === 'machine') await assertMachineFree(resource, sameSession, request.params.code)
      const catalog = await resourceCatalog()
      const result = await changeOperation(request.params.code, (state, order) => {
        assertFreeChoice(state, order, assertSession(state, request.body?.sessionId, request.body?.sessionToken), catalog)
        const taken = type === 'machine' && machineTakenIn(state, resource, sameSession)
        if (taken) throw Object.assign(new OperationError(409, `A máquina ${resource.name} está sendo usada por ${taken.employeeName || 'outro funcionário'} na ${order.code}.`), { code: 'MACHINE_BUSY' })
        return changeSessionResource(state, request, type === 'machine' ? resource : null, type === 'labor-service' ? resource : null)
      })
      response.json({ ...result, order: operatorOrder(result.order, result.operation) })
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/machine', requireOperator, async (request, response) => {
    try {
      const machineId = request.body?.machineId
      if (machineId === undefined) throw new OperationError(400, 'Selecione a máquina ou o trabalho manual.')
      const machine = await selectedResource('machine', machineId)
      const sameSession = (session) => session.id === request.body?.sessionId
      await assertMachineFree(machine, sameSession, request.params.code)
      const catalog = await resourceCatalog()
      const result = await changeOperation(request.params.code, (state, order) => {
        assertFreeChoice(state, order, assertSession(state, request.body?.sessionId, request.body?.sessionToken), catalog)
        const taken = machineTakenIn(state, machine, sameSession)
        if (taken) throw Object.assign(new OperationError(409, `A máquina ${machine.name} está sendo usada por ${taken.employeeName || 'outro funcionário'} na ${order.code}.`), { code: 'MACHINE_BUSY' })
        const current = state.activeSessions.find((item) => item.id === request.body?.sessionId)
        const service = machine || current?.laborServiceId == null ? null : { id: current.laborServiceId, name: current.laborServiceName }
        return changeSessionResource(state, request, machine, service)
      })
      response.json({ ...result, order: operatorOrder(result.order, result.operation) })
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/labor-service', requireOperator, async (request, response) => {
    try {
      const laborServiceId = request.body?.laborServiceId
      if (laborServiceId === undefined) throw new OperationError(400, 'Selecione o serviço ou a opção sem serviço de hora homem.')
      const service = await selectedResource('labor-service', laborServiceId)
      const catalog = await resourceCatalog()
      const result = await changeOperation(request.params.code, (state, order) => {
        assertFreeChoice(state, order, assertSession(state, request.body?.sessionId, request.body?.sessionToken), catalog)
        const current = state.activeSessions.find((item) => item.id === request.body?.sessionId)
        const machine = service || current?.machineId == null ? null : { id: current.machineId, name: current.machineName }
        return changeSessionResource(state, request, machine, service)
      })
      response.json({ ...result, order: operatorOrder(result.order, result.operation) })
    } catch (error) { sendError(response, error) }
  })

  // The operator moves to another stage without closing the work session; the time so far stays with the previous stage.
  // A stage with a planned resource moves the session to it (a planned machine must be free); without a plan the
  // session keeps its resource and the operator may choose another one.
  router.post('/operations/orders/:code/work-stage', requireOperator, async (request, response) => {
    try {
      const catalog = await resourceCatalog()
      const sameSession = (session) => session.id === request.body?.sessionId
      const current = (await operationOrders()).find((order) => order.code === request.params.code)
      await assertMachineFree(stagePlan(current, current?.operation.stages.find((stage) => stage.key === request.body?.stageKey), catalog)?.machine, sameSession, request.params.code)
      const result = await changeOperation(request.params.code, (state, order) => {
        const session = assertSession(state, request.body?.sessionId, request.body?.sessionToken)
        const stage = workStage(state, order, request.body?.stageKey)
        if (stage.key === session.stageKey) throw new OperationError(409, 'Selecione uma etapa diferente da atual.')
        const plan = stagePlan(order, stage, catalog)
        const taken = machineTakenIn(state, plan?.machine, sameSession)
        if (taken) throw Object.assign(new OperationError(409, `A máquina ${plan.name} está sendo usada por ${taken.employeeName || 'outro funcionário'} na ${order.code}.`), { code: 'MACHINE_BUSY' })
        const at = new Date().toISOString(), previous = session.stageName || 'Sem etapa'
        const durationMs = closeStageSegment(state, session, at)
        Object.assign(session, { stageKey: stage.key, stageName: stage.name, stageSince: at })
        const event = { ...eventFor('stage_changed', session, { workStageKey: stage.key, workStageName: stage.name, durationMs, details: `${previous} → ${stage.name}` }), at }
        const moves = plan && (String(session.machineId ?? '') !== String(plan.machine?.id ?? '') || String(session.laborServiceId ?? '') !== String(plan.laborService?.id ?? ''))
        return moves ? [event, changeSessionResource(state, request, plan.machine, plan.laborService)] : event
      })
      response.json({ ...result, order: operatorOrder(result.order, result.operation) })
    } catch (error) { sendError(response, error) }
  })

  // Pieces already made, for the suggestions in the offer, and the data of the last time with the averages per piece.
  router.get('/pieces', requireAdmin, async (_request, response) => {
    try {
      const store = await readStore()
      response.json({ items: pieceCatalog(store.offers || [], store.orders || []) })
    } catch (error) { sendError(response, error) }
  })
  router.get('/pieces/lead-time', requireAdmin, async (request, response) => {
    try { response.set('Cache-Control', 'no-store').json({ item: pieceLeadTime(await operationOrders(), request.query.name, request.query.offerId) }) } catch (error) { sendError(response, error) }
  })
  router.get('/pieces/suggestion', requireAdmin, async (request, response) => {
    try {
      const store = await readStore()
      const prices = new Map()
      if (pool) {
        try { const [rows] = await pool.execute('SELECT id, unit_price AS unitPrice FROM inventory_materials'); for (const row of rows) prices.set(String(row.id), Number(row.unitPrice || 0)) } catch { /* sem estoque: mantém o preço da última vez */ }
      }
      // The operation events of the OS of this piece tell which machine or service each stage was made on.
      const history = await ordersWithOperations((store.orders || []).filter((order) => pieceKey(order.service) === pieceKey(request.query.name)), pool)
      const item = pieceSuggestion({ offers: store.offers || [], orders: await operationOrders(), name: request.query.name, quantity: request.query.quantity, prices, excludeOfferId: request.query.offerId, catalog: await resourceCatalog(), history })
      response.set('Cache-Control', 'no-store').json({ item })
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/pause', requireOperator, async (request, response) => {
    try {
      if (!(await pauseReasonNames()).includes(request.body?.reason)) throw new OperationError(400, 'Selecione uma justificativa para a pausa.')
      const result = await changeOperation(request.params.code, (state) => {
        const session = assertSession(state, request.body?.sessionId, request.body?.sessionToken)
        const event = eventFor('paused', session, { reason: request.body.reason, durationMs: sessionDuration(session) })
        endSession(state, session, event.at)
        if (!state.activeSessions.length) {
          state.status = 'paused'
          state.lastPauseReason = request.body.reason
        }
        return event
      })
      response.json({ ...result, order: operatorOrder(result.order, result.operation) })
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/stages/:stageKey', requireOperator, async (request, response) => {
    try {
      const quantity = Number(request.body?.quantity)
      if (!Number.isInteger(quantity) || quantity < 1) throw new OperationError(400, 'Informe uma quantidade inteira de peças.')
      const result = await changeOperation(request.params.code, (state, order) => {
        const session = assertSession(state, request.body?.sessionId, request.body?.sessionToken)
        const index = state.stages.findIndex((stage) => stage.key === request.params.stageKey)
        if (index < 0) throw new OperationError(404, 'Etapa não encontrada.')
        const stage = state.stages[index]
        // Pieces are registered by who works on the stage: an employee on another stage selects this one first.
        const onStage = state.activeSessions.filter((item) => item.stageKey === stage.key)
        if (!onStage.length) throw new OperationError(409, `Ninguém está trabalhando na etapa ${stage.name}. Selecione esta etapa antes de registrar.`)
        const completedBy = request.body?.completedBySessionId
        if (onStage.length > 1 && !completedBy) {
          const error = new OperationError(409, 'Há mais de um funcionário trabalhando nesta etapa. Informe quem concluiu as peças.')
          error.code = 'COMPLETED_BY_REQUIRED'
          throw error
        }
        const worker = completedBy ? onStage.find((item) => item.id === completedBy) : onStage[0]
        if (!worker) throw new OperationError(409, 'O funcionário selecionado não está mais trabalhando nesta etapa.')
        const next = Number(state.stageCounts[stage.key] || 0) + quantity
        if (next > Number(order.quantity)) throw new OperationError(409, 'A quantidade não pode ultrapassar o total da OS.')
        if (serviceDetails(order.resources).strictProcess && index > 0 && next > Number(state.stageCounts[state.stages[index - 1].key] || 0)) throw new OperationError(409, 'As peças precisam passar pela etapa anterior antes desta etapa.')
        state.stageCounts[stage.key] = next
        // Stages this work session has produced in; screens show them as in production while the session is open.
        if (!(worker.workedStages || []).includes(stage.key)) worker.workedStages = [...(worker.workedStages || []), stage.key]
        const event = eventFor('stage_progress', worker, { stageKey: stage.key, stageName: stage.name, quantity, stageTotal: next, ...(worker !== session ? { registeredBySessionId: session.id, registeredByEmployeeName: session.employeeName } : {}) })
        if (allStagesDone(state, order)) {
          // The last stage keeps the work open until the service is completed.
          state.status = 'finalizing'
          return event
        }
        if (next < Number(order.quantity)) return event
        // A finished stage ends the work of everyone on it: they become idle and select the next stage to start again.
        const ended = onStage.map((item) => {
          const done = { ...eventFor('stage_completed', item, { reason: STAGE_DONE_REASON, workStageKey: stage.key, workStageName: stage.name, durationMs: sessionDuration(item, event.at) }), at: event.at }
          endSession(state, item, event.at)
          return done
        })
        if (!state.activeSessions.length) Object.assign(state, { status: 'stage_done', lastPauseReason: STAGE_DONE_REASON })
        return [event, ...ended]
      })
      response.json({ ...result, order: operatorOrder(result.order, result.operation) })
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/complete', requireOperator, async (request, response) => {
    try {
      const result = await changeOperation(request.params.code, (state, order) => {
        const session = assertSession(state, request.body?.sessionId, request.body?.sessionToken)
        if (!allStagesDone(state, order)) throw new OperationError(409, 'Todas as peças precisam passar por todas as etapas antes da conclusão.')
        // Other employees still working on this OS have their sessions closed with the completion.
        const events = state.activeSessions.filter((item) => item !== session).map((item) => eventFor('session_ended', item, { reason: 'OS concluída', durationMs: sessionDuration(item), details: `Sessão encerrada na conclusão registrada por ${session.employeeName}.` }))
        const event = eventFor('completed', session, { durationMs: sessionDuration(session) })
        for (const item of [...state.activeSessions]) endSession(state, item, event.at)
        state.status = 'completed'
        state.completedAt = event.at
        return [...events, event]
      })
      response.json({ ...result, order: operatorOrder(result.order, result.operation) })
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/interrupt', requireAdmin, async (request, response) => {
    try {
      const reason = clean(request.body?.reason, 250)
      if (!reason) throw new OperationError(400, 'Informe a justificativa da interrupção.')
      const result = await changeOperation(request.params.code, (state) => {
        if (!state.activeSessions.length) throw new OperationError(409, 'Nenhuma sessão está em andamento.')
        const sessionId = request.body?.sessionId
        if (!sessionId && state.activeSessions.length > 1) throw new OperationError(400, 'Selecione o funcionário cuja sessão será encerrada.')
        const session = sessionId ? state.activeSessions.find((item) => item.id === sessionId) : state.activeSessions[0]
        if (!session) throw new OperationError(409, 'Esta sessão já foi encerrada.')
        const event = eventFor('admin_interrupted', session, { employeeId: null, employeeName: 'Administrador', affectedEmployeeName: session.employeeName, reason, durationMs: sessionDuration(session) })
        endSession(state, session, event.at)
        if (!state.activeSessions.length) {
          state.status = 'paused'
          state.lastPauseReason = reason
        }
        return event
      })
      response.json(result)
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/acknowledge-completion', requireAdmin, async (request, response) => {
    try {
      const result = await changeOperation(request.params.code, (state) => {
        if (state.status !== 'completed') throw new OperationError(409, 'Esta OS ainda não foi concluída.')
        if (state.completionAcknowledgedAt) return null
        const event = eventFor('completion_acknowledged', null, { employeeName: 'Administrador' })
        state.completionAcknowledgedAt = event.at
        return event
      })
      response.json(result)
    } catch (error) { sendError(response, error) }
  })

  return router
}
