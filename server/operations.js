import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import express from 'express'
import { mutateStore, readStore } from './offers.js'
import { requireOperator } from './operatorAuth.js'
import { activityDateRange, employeeActivityQuery } from './employeeActivity.js'
import { operationStates } from './reportData.js'
import { stageLabel, serviceDetails } from './serviceStages.js'
import { machineRows } from './machines.js'
import { laborServiceRows } from './laborServices.js'
import { requireAdmin, adminIdentity } from './accounts.js'
import { editOrder } from './orderEditing.js'
import { pendingOrderMaterials } from './pendingMaterials.js'
import { addNotification, completedServiceNotice } from './notificationEvents.js'
import { activeSessions, activeSince } from './operationSessions.js'

const pauseReasons = ['Descanso', 'Horário de almoço', 'Gilson mandou parar', 'Troca de atividade']
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
  const storedHash = Buffer.from(session?.tokenHash || '', 'hex')
  if (!session || storedHash.length !== suppliedHash.length || !timingSafeEqual(suppliedHash, storedHash)) {
    throw new OperationError(403, 'Esta atividade pertence a outra sessão. Identifique-se para continuar.')
  }
  return session
}

const allStagesDone = (state, order) => state.stages.length > 0 && state.stages.every((stage) => Number(state.stageCounts[stage.key] || 0) === Number(order.quantity))

// Removes one employee from the OS; project time stops only when nobody else is working.
function endSession(state, session, at) {
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

function publicOperation(order, stored) {
  const operation = liveOperation(order, stored)
  const sessions = activeSessions(operation).map(({ tokenHash, ...session }) => session)
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
    },
    operation,
  }
}

export default function createOperationsRouter(pool) {
  const router = express.Router()

  async function employeeRows() {
    if (!pool) return (await readStore()).employees || []
    const [rows] = await pool.execute("SELECT id, name, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birthDate, cpf, email, i_identificacao AS identification FROM employees ORDER BY name")
    return rows
  }

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

  function sendError(response, error) {
    if (!error.status) console.error('Falha na operação da OS:', error)
    response.status(error.status || 500).json({ message: error.status ? error.message : 'Não foi possível registrar a operação.', ...(error.code === 'PENDING_MATERIALS' ? { code: error.code, pendingMaterials: error.pendingMaterials } : {}), ...(error.code === 'COMPLETED_BY_REQUIRED' ? { code: error.code } : {}) })
  }

  router.get('/employees', async (_request, response) => {
    try { response.json({ items: await employeeRows() }) } catch (error) { sendError(response, error) }
  })

  router.get('/employees/:id/activities', async (request, response) => {
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

  router.post('/employees', async (request, response) => {
    const { name, birthDate, cpf, email, identification } = request.body || {}
    const normalized = { name: clean(name), birthDate: clean(birthDate, 10), cpf: clean(cpf, 20).replace(/\D/g, ''), email: clean(email, 160), identification: clean(identification, 3) }
    if (!normalized.name || !/^\d{4}-\d{2}-\d{2}$/.test(normalized.birthDate) || !/^\d{11}$/.test(normalized.cpf) || !normalized.email.includes('@') || !/^\d{3}$/.test(normalized.identification)) return response.status(400).json({ message: 'Preencha os dados do funcionário e a identificação de 3 dígitos.' })
    try {
      let employee
      if (pool) {
        const [result] = await pool.execute('INSERT INTO employees (name, birth_date, cpf, email, i_identificacao) VALUES (?, ?, ?, ?, ?)', [normalized.name, normalized.birthDate, normalized.cpf, normalized.email, normalized.identification])
        employee = { id: result.insertId, ...normalized }
      } else {
        employee = await mutateStore((store) => {
          store.employees ||= []
          if (store.employees.some((item) => item.cpf === normalized.cpf || item.email === normalized.email || item.identification === normalized.identification)) throw new OperationError(409, 'CPF, e-mail ou identificação já cadastrados.')
          const created = { id: randomUUID(), ...normalized }
          store.employees.push(created)
          return created
        })
      }
      response.status(201).json({ item: employee })
    } catch (error) { sendError(response, error.code === 'ER_DUP_ENTRY' ? new OperationError(409, 'CPF, e-mail ou identificação já cadastrados.') : error) }
  })

  router.put('/employees/:id', async (request, response) => {
    const { name, birthDate, cpf, email, identification } = request.body || {}
    const normalized = { name: clean(name), birthDate: clean(birthDate, 10), cpf: clean(cpf, 20).replace(/\D/g, ''), email: clean(email, 160), identification: clean(identification, 3) }
    if (!normalized.name || !/^\d{4}-\d{2}-\d{2}$/.test(normalized.birthDate) || !/^\d{11}$/.test(normalized.cpf) || !normalized.email.includes('@') || !/^\d{3}$/.test(normalized.identification)) return response.status(400).json({ message: 'Preencha os dados do funcionário e a identificação de 3 dígitos.' })
    try {
      let employee
      if (pool) {
        const [result] = await pool.execute('UPDATE employees SET name = ?, birth_date = ?, cpf = ?, email = ?, i_identificacao = ? WHERE id = ?', [normalized.name, normalized.birthDate, normalized.cpf, normalized.email, normalized.identification, request.params.id])
        if (!result.affectedRows) throw new OperationError(404, 'Funcionário não encontrado.')
        employee = { id: Number(request.params.id), ...normalized }
      } else {
        employee = await mutateStore((store) => {
          store.employees ||= []
          const current = store.employees.find((item) => String(item.id) === request.params.id)
          if (!current) throw new OperationError(404, 'Funcionário não encontrado.')
          if (store.employees.some((item) => item !== current && (item.cpf === normalized.cpf || item.email === normalized.email || item.identification === normalized.identification))) throw new OperationError(409, 'CPF, e-mail ou identificação já cadastrados.')
          Object.assign(current, normalized)
          return current
        })
      }
      response.json({ item: employee })
    } catch (error) { sendError(response, error.code === 'ER_DUP_ENTRY' ? new OperationError(409, 'CPF, e-mail ou identificação já cadastrados.') : error) }
  })

  router.delete('/employees/:id', async (request, response) => {
    try {
      if (pool) {
        const [result] = await pool.execute('DELETE FROM employees WHERE id = ?', [request.params.id])
        if (!result.affectedRows) throw new OperationError(404, 'Funcionário não encontrado.')
      } else await mutateStore((store) => {
        store.employees ||= []
        const index = store.employees.findIndex((item) => String(item.id) === request.params.id)
        if (index < 0) throw new OperationError(404, 'Funcionário não encontrado.')
        store.employees.splice(index, 1)
      })
      response.status(204).end()
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

  router.get('/operations/orders', async (_request, response) => {
    try {
      response.json({ items: await operationOrders() })
    } catch (error) { sendError(response, error) }
  })

  router.get('/operations/operator/orders', requireOperator, async (_request, response) => {
    try {
      response.set('Cache-Control', 'no-store')
      response.json({ items: (await operationOrders()).map((order) => operatorOrder(order, order.operation)) })
    } catch (error) { sendError(response, error) }
  })

  router.get('/operations/orders/:code/events', async (request, response) => {
    try {
      const order = await orderByCode(request.params.code)
      const history = (items) => items.map((event) => {
        if (adminIdentity(request)) return event
        const { changes, ...publicEvent } = event
        return publicEvent
      })
      if (!pool) return response.json({ items: history(order.operationEvents || []) })
      const [rows] = await pool.execute('SELECT data FROM order_operation_events WHERE order_code = ? ORDER BY seq', [request.params.code])
      response.json({ items: history(rows.map((row) => json(row.data))) })
    } catch (error) { sendError(response, error) }
  })

  router.put('/operations/orders/:code', requireAdmin, async (request, response) => {
    try {
      const result = await changeOperation(request.params.code, (state, order, store) => {
        const previousMaterialIds = new Set((order.resources?.materials || []).map((material) => material.id))
        const changes = editOrder(order, state, request.body || {})
        for (const material of order.resources.materials) if (!previousMaterialIds.has(material.id)) Object.assign(material, { requestedBy: request.adminId, requestedByName: request.adminName || null, requestedAt: new Date().toISOString(), requestedQuantity: material.purchaseQuantity ?? material.quantity })
        const offer = store.offers.find((item) => item.id === order.offerId)
        if (!offer) throw new OperationError(409, 'A oferta vinculada à OS não foi encontrada.')
        for (const key of Object.keys(changes.after).filter((key) => !['stages', 'stageCounts'].includes(key))) offer[key] = structuredClone(order[key])
        offer.updatedAt = order.updatedAt
        const labels = { company: 'Cliente', cnpj: 'CNPJ', service: 'Serviço', description: 'Descrição', labelNumber: 'Etiqueta', quantity: 'Quantidade da OS', deadline: 'Prazo solicitado', requestedAt: 'Data da solicitação', resources: 'Materiais e processo', proposal: 'Proposta', attachments: 'Anexos', stages: 'Etapas', stageCounts: 'Peças por etapa' }
        return eventFor('order_edited', null, { employeeName: request.adminName || 'Administrador', adminId: request.adminId, changes, details: `Campos atualizados: ${changes.changed.map((key) => labels[key] || key).join(', ') || 'nenhuma alteração'}.` })
      }, true)
      response.json({ item: { ...result.order, operation: result.operation }, event: result.event })
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/reopen', requireAdmin, async (request, response) => {
    try {
      const result = await changeOperation(request.params.code, (state, order) => {
        if (state.status !== 'completed') throw new OperationError(409, 'Somente uma OS finalizada pode ser reaberta.')
        const previousCompletedAt = state.completedAt
        state.status = state.startedAt ? 'paused' : 'waiting'
        state.completedAt = null
        state.completionAcknowledgedAt = null
        state.lastPauseReason = null
        state.reopenedAt = new Date().toISOString()
        order.status = 'Em andamento'
        order.updatedAt = state.reopenedAt
        return eventFor('order_reopened', null, { employeeName: request.adminName || 'Administrador', adminId: request.adminId, previousCompletedAt, details: 'OS reaberta com as quantidades produzidas e o histórico preservados.' })
      }, true)
      response.json({ item: { ...result.order, operation: result.operation }, event: result.event })
    } catch (error) { sendError(response, error) }
  })

  router.put('/operations/orders/:code/stages', async (request, response) => {
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

  async function selectedResource(type, id) {
    if (id == null || id === '') return null
    const rows = type === 'machine' ? await machineRows() : await laborServiceRows()
    const found = rows.find((item) => String(item.id) === String(id))
    if (!found) throw new OperationError(400, type === 'machine' ? 'Selecione uma máquina cadastrada.' : 'Selecione um serviço cadastrado.')
    return found
  }

  router.post('/operations/orders/:code/start', requireOperator, async (request, response) => {
    try {
      const employee = (await employeeRows()).find((item) => String(item.id) === String(request.body?.employeeId))
      if (!employee) throw new OperationError(400, 'Selecione um funcionário cadastrado.')
      const machine = await selectedResource('machine', request.body?.machineId)
      const laborService = await selectedResource('labor-service', request.body?.laborServiceId)
      if (machine && laborService) throw new OperationError(400, 'Selecione a máquina ou o serviço de hora homem, não os dois.')
      const sessionToken = randomUUID()
      let session
      const result = await changeOperation(request.params.code, (state, order) => {
        if (!state.stages.length) throw new OperationError(409, 'Defina as etapas da OS antes de iniciar.')
        if (state.status === 'completed') throw new OperationError(409, 'Esta OS já foi concluída.')
        if (state.activeSessions.some((item) => String(item.employeeId) === String(employee.id))) throw new OperationError(409, `${employee.name} já está trabalhando nesta OS.`)
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
        session = { id: randomUUID(), tokenHash: createHash('sha256').update(sessionToken).digest('hex'), employeeId: employee.id, employeeName: employee.name, machineId: machine?.id ?? null, machineName: machine?.name ?? null, laborServiceId: laborService?.id ?? null, laborServiceName: laborService?.name ?? null, startedAt: now }
        state.activeSessions.push(session)
        state.status = allStagesDone(state, order) ? 'finalizing' : 'running'
        state.lastPauseReason = null
        return eventFor(firstStart ? 'started' : 'resumed', session, pending.length ? { pendingMaterialsAccepted: true, pendingMaterials: pending, details: pending.map((material) => `Material pendente autorizado: ${material.name}, ${material.quantity.toLocaleString('pt-BR')} kg`) } : {})
      })
      const { tokenHash, ...publicSession } = session
      response.json({ ...result, order: operatorOrder(result.order, result.operation), session: publicSession, sessionToken })
    } catch (error) { sendError(response, error) }
  })

  // Moves the employee between a machine and a labor service, or to another resource of the same kind.
  router.post('/operations/orders/:code/resource', requireOperator, async (request, response) => {
    try {
      const type = request.body?.resourceType
      if (!['machine', 'labor-service'].includes(type)) throw new OperationError(400, 'Selecione se vai usar uma máquina ou um serviço de hora homem.')
      if (request.body?.resourceId == null || request.body.resourceId === '') throw new OperationError(400, type === 'machine' ? 'Selecione a máquina.' : 'Selecione o serviço de hora homem.')
      const resource = await selectedResource(type, request.body.resourceId)
      const result = await changeOperation(request.params.code, (state) => changeSessionResource(state, request, type === 'machine' ? resource : null, type === 'labor-service' ? resource : null))
      response.json({ ...result, order: operatorOrder(result.order, result.operation) })
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/machine', requireOperator, async (request, response) => {
    try {
      const machineId = request.body?.machineId
      if (machineId === undefined) throw new OperationError(400, 'Selecione a máquina ou o trabalho manual.')
      const machine = await selectedResource('machine', machineId)
      const result = await changeOperation(request.params.code, (state) => {
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
      const result = await changeOperation(request.params.code, (state) => {
        const current = state.activeSessions.find((item) => item.id === request.body?.sessionId)
        const machine = service || current?.machineId == null ? null : { id: current.machineId, name: current.machineName }
        return changeSessionResource(state, request, machine, service)
      })
      response.json({ ...result, order: operatorOrder(result.order, result.operation) })
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/pause', requireOperator, async (request, response) => {
    try {
      if (!pauseReasons.includes(request.body?.reason)) throw new OperationError(400, 'Selecione uma justificativa para a pausa.')
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
        const completedBy = request.body?.completedBySessionId
        if (state.activeSessions.length > 1 && !completedBy) {
          const error = new OperationError(409, 'Há mais de um funcionário trabalhando nesta OS. Informe quem concluiu esta etapa.')
          error.code = 'COMPLETED_BY_REQUIRED'
          throw error
        }
        const worker = completedBy ? state.activeSessions.find((item) => item.id === completedBy) : session
        if (!worker) throw new OperationError(409, 'O funcionário selecionado não está mais trabalhando nesta OS.')
        const index = state.stages.findIndex((stage) => stage.key === request.params.stageKey)
        if (index < 0) throw new OperationError(404, 'Etapa não encontrada.')
        const stage = state.stages[index]
        const next = Number(state.stageCounts[stage.key] || 0) + quantity
        if (next > Number(order.quantity)) throw new OperationError(409, 'A quantidade não pode ultrapassar o total da OS.')
        if (serviceDetails(order.resources).strictProcess && index > 0 && next > Number(state.stageCounts[state.stages[index - 1].key] || 0)) throw new OperationError(409, 'As peças precisam passar pela etapa anterior antes desta etapa.')
        state.stageCounts[stage.key] = next
        const event = eventFor('stage_progress', worker, { stageKey: stage.key, stageName: stage.name, quantity, stageTotal: next, ...(worker !== session ? { registeredBySessionId: session.id, registeredByEmployeeName: session.employeeName } : {}) })
        if (allStagesDone(state, order)) state.status = 'finalizing'
        return event
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

  router.post('/operations/orders/:code/interrupt', async (request, response) => {
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

  router.post('/operations/orders/:code/acknowledge-completion', async (request, response) => {
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
