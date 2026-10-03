import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import express from 'express'
import { mutateStore, readStore } from './offers.js'
import { requireOperator } from './operatorAuth.js'
import { activityDateRange } from './employeeActivity.js'
import { stageLabel, serviceDetails } from './serviceStages.js'
import { machineRows } from './machines.js'

const pauseReasons = ['Descanso', 'Horário de almoço', 'Gilson mandou parar', 'Troca de atividade']
const json = (value) => typeof value === 'string' ? JSON.parse(value) : value
const clean = (value, max = 160) => String(value ?? '').trim().slice(0, max)

class OperationError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

function defaultOperation(order) {
  const stages = [...new Set(order.proposal?.stages || [])].map((key, index) => ({ key: `stage-${index + 1}`, name: stageLabel(key) }))
  return { status: 'waiting', stages, stageCounts: Object.fromEntries(stages.map((stage) => [stage.key, 0])), accumulatedMs: 0, startedAt: null, activeSession: null, completedAt: null, lastPauseReason: null }
}

function liveOperation(order, stored) {
  const operation = stored || defaultOperation(order)
  return { ...operation, targetQuantity: Number(order.quantity), progress: operation.stages.length ? Math.round(100 * operation.stages.reduce((sum, stage) => sum + Number(operation.stageCounts[stage.key] || 0), 0) / (operation.stages.length * Number(order.quantity))) : 0 }
}

function eventFor(type, state, fields = {}) {
  return { id: randomUUID(), type, at: new Date().toISOString(), employeeId: state.activeSession?.employeeId || fields.employeeId || null, employeeName: state.activeSession?.employeeName || fields.employeeName || null, sessionId: state.activeSession?.id || fields.sessionId || null, machineId: state.activeSession?.machineId ?? null, machineName: state.activeSession?.machineName ?? null, ...fields }
}

function assertSession(state, sessionId, sessionToken) {
  if (!state.activeSession) throw new OperationError(409, 'Nenhuma sessão de trabalho está em andamento.')
  const suppliedHash = createHash('sha256').update(String(sessionToken || '')).digest()
  const storedHash = Buffer.from(state.activeSession.tokenHash || '', 'hex')
  if (!sessionId || sessionId !== state.activeSession.id || storedHash.length !== suppliedHash.length || !timingSafeEqual(suppliedHash, storedHash)) {
    throw new OperationError(403, 'Esta atividade pertence a outra sessão. Identifique-se para continuar.')
  }
}

function publicOperation(order, stored) {
  const operation = liveOperation(order, stored)
  if (!operation.activeSession) return operation
  const { tokenHash, ...activeSession } = operation.activeSession
  return { ...operation, activeSession }
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
      materials: (order.resources?.materials || []).map(({ id, name, detail, quantity, stockStatus, stockAvailable, purchaseQuantity }) => ({ id, name, detail, quantity, stockStatus, stockAvailable, purchaseQuantity })),
      laborEntries: (order.resources?.laborEntries || []).map(({ id, type, resource, machineId, hours }) => ({ id, type, resource, machineId, hours })),
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

  async function changeOperation(code, change) {
    const order = await orderByCode(code)
    if (!pool) return mutateStore((store) => {
      const current = store.orders.find((item) => item.code === code)
      const state = current.operation || defaultOperation(current)
      const event = change(state, current)
      current.operation = state
      current.operationEvents ||= []
      if (event) current.operationEvents.push(event)
      return { order: current, operation: publicOperation(current, state), event }
    })

    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      await connection.execute('INSERT IGNORE INTO order_operations (order_code, data) VALUES (?, ?)', [code, JSON.stringify(defaultOperation(order))])
      const [rows] = await connection.execute('SELECT data FROM order_operations WHERE order_code = ? FOR UPDATE', [code])
      const state = json(rows[0].data)
      const event = change(state, order)
      await connection.execute('UPDATE order_operations SET data = ? WHERE order_code = ?', [JSON.stringify(state), code])
      if (event) await connection.execute('INSERT INTO order_operation_events (id, order_code, data, occurred_at) VALUES (?, ?, ?, ?)', [event.id, code, JSON.stringify(event), new Date(event.at)])
      await connection.commit()
      return { order, operation: publicOperation(order, state), event }
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  function sendError(response, error) {
    if (!(error instanceof OperationError)) console.error('Falha na operação da OS:', error)
    response.status(error.status || 500).json({ message: error.status ? error.message : 'Não foi possível registrar a operação.' })
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
        const [rows] = await pool.execute(`SELECT order_code AS orderCode, data FROM order_operation_events
          WHERE (JSON_UNQUOTE(JSON_EXTRACT(data, '$.employeeId')) = ? OR
            (JSON_UNQUOTE(JSON_EXTRACT(data, '$.type')) = 'admin_interrupted' AND
              JSON_UNQUOTE(JSON_EXTRACT(data, '$.sessionId')) IN
                (SELECT JSON_UNQUOTE(JSON_EXTRACT(data, '$.sessionId')) FROM order_operation_events
                  WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.employeeId')) = ?)))${range ? ' AND occurred_at >= ? AND occurred_at < ?' : ''}
          ORDER BY occurred_at DESC, seq DESC`, range ? [request.params.id, request.params.id, new Date(range.start), new Date(range.end)] : [request.params.id, request.params.id])
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
      const [rows] = await pool.query('SELECT order_code, data FROM order_operations')
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
      if (!pool) return response.json({ items: order.operationEvents || [] })
      const [rows] = await pool.execute('SELECT data FROM order_operation_events WHERE order_code = ? ORDER BY seq', [request.params.code])
      response.json({ items: rows.map((row) => json(row.data)) })
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
        return eventFor('stages_configured', state, { details: state.stages.map((stage) => stage.name) })
      })
      response.json(result)
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/start', requireOperator, async (request, response) => {
    try {
      const employee = (await employeeRows()).find((item) => String(item.id) === String(request.body?.employeeId))
      if (!employee) throw new OperationError(400, 'Selecione um funcionário cadastrado.')
      const machineId = request.body?.machineId
      const machine = machineId == null || machineId === '' ? null : (await machineRows()).find((item) => String(item.id) === String(machineId))
      if (machineId != null && machineId !== '' && !machine) throw new OperationError(400, 'Selecione uma máquina cadastrada.')
      const sessionToken = randomUUID()
      const result = await changeOperation(request.params.code, (state, order) => {
        if (!state.stages.length) throw new OperationError(409, 'Defina as etapas da OS antes de iniciar.')
        if (state.status === 'completed') throw new OperationError(409, 'Esta OS já foi concluída.')
        if (state.activeSession) throw new OperationError(409, `O trabalho já está em andamento com ${state.activeSession.employeeName}.`)
        const now = new Date().toISOString()
        const firstStart = !state.startedAt
        state.startedAt ||= now
        state.activeSession = { id: randomUUID(), tokenHash: createHash('sha256').update(sessionToken).digest('hex'), employeeId: employee.id, employeeName: employee.name, machineId: machine?.id ?? null, machineName: machine?.name ?? null, startedAt: now }
        state.status = state.stages.every((stage) => Number(state.stageCounts[stage.key] || 0) === Number(order.quantity)) ? 'finalizing' : 'running'
        state.lastPauseReason = null
        return eventFor(firstStart ? 'started' : 'resumed', state)
      })
      response.json({ ...result, order: operatorOrder(result.order, result.operation), sessionToken })
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/machine', requireOperator, async (request, response) => {
    try {
      const machineId = request.body?.machineId
      if (machineId === undefined) throw new OperationError(400, 'Selecione a máquina ou o trabalho manual.')
      const machine = machineId == null || machineId === '' ? null : (await machineRows()).find((item) => String(item.id) === String(machineId))
      if (machineId != null && machineId !== '' && !machine) throw new OperationError(400, 'Selecione uma máquina cadastrada.')
      const result = await changeOperation(request.params.code, (state) => {
        assertSession(state, request.body?.sessionId, request.body?.sessionToken)
        const session = state.activeSession
        if (String(session.machineId ?? '') === String(machine?.id ?? '')) throw new OperationError(409, 'Selecione uma máquina diferente da atual.')
        const event = eventFor('machine_changed', state, {
          nextMachineId: machine?.id ?? null, nextMachineName: machine?.name ?? null,
          durationMs: Math.max(0, Date.now() - Date.parse(session.machineStartedAt || session.startedAt)),
          details: `${session.machineName || 'Trabalho manual'} → ${machine?.name || 'Trabalho manual'}`,
        })
        session.machineId = machine?.id ?? null
        session.machineName = machine?.name ?? null
        session.machineStartedAt = event.at
        return event
      })
      response.json({ ...result, order: operatorOrder(result.order, result.operation) })
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/pause', requireOperator, async (request, response) => {
    try {
      if (!pauseReasons.includes(request.body?.reason)) throw new OperationError(400, 'Selecione uma justificativa para a pausa.')
      const result = await changeOperation(request.params.code, (state) => {
        assertSession(state, request.body?.sessionId, request.body?.sessionToken)
        const durationMs = Math.max(0, Date.now() - Date.parse(state.activeSession.startedAt))
        const event = eventFor('paused', state, { reason: request.body.reason, durationMs })
        state.accumulatedMs += durationMs
        state.activeSession = null
        state.status = 'paused'
        state.lastPauseReason = request.body.reason
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
        assertSession(state, request.body?.sessionId, request.body?.sessionToken)
        const index = state.stages.findIndex((stage) => stage.key === request.params.stageKey)
        if (index < 0) throw new OperationError(404, 'Etapa não encontrada.')
        const stage = state.stages[index]
        const next = Number(state.stageCounts[stage.key] || 0) + quantity
        if (next > Number(order.quantity)) throw new OperationError(409, 'A quantidade não pode ultrapassar o total da OS.')
        if (serviceDetails(order.resources).strictProcess && index > 0 && next > Number(state.stageCounts[state.stages[index - 1].key] || 0)) throw new OperationError(409, 'As peças precisam passar pela etapa anterior antes desta etapa.')
        state.stageCounts[stage.key] = next
        const event = eventFor('stage_progress', state, { stageKey: stage.key, stageName: stage.name, quantity, stageTotal: next })
        if (state.stages.every((item) => Number(state.stageCounts[item.key] || 0) === Number(order.quantity))) state.status = 'finalizing'
        return event
      })
      response.json({ ...result, order: operatorOrder(result.order, result.operation) })
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/complete', requireOperator, async (request, response) => {
    try {
      const result = await changeOperation(request.params.code, (state, order) => {
        assertSession(state, request.body?.sessionId, request.body?.sessionToken)
        if (!state.stages.length || !state.stages.every((stage) => Number(state.stageCounts[stage.key] || 0) === Number(order.quantity))) throw new OperationError(409, 'Todas as peças precisam passar por todas as etapas antes da conclusão.')
        const durationMs = Math.max(0, Date.now() - Date.parse(state.activeSession.startedAt))
        const event = eventFor('completed', state, { durationMs })
        state.accumulatedMs += durationMs
        state.activeSession = null
        state.status = 'completed'
        state.completedAt = event.at
        return event
      })
      response.json({ ...result, order: operatorOrder(result.order, result.operation) })
    } catch (error) { sendError(response, error) }
  })

  router.post('/operations/orders/:code/interrupt', async (request, response) => {
    try {
      const reason = clean(request.body?.reason, 250)
      if (!reason) throw new OperationError(400, 'Informe a justificativa da interrupção.')
      const result = await changeOperation(request.params.code, (state) => {
        if (!state.activeSession) throw new OperationError(409, 'Nenhuma sessão está em andamento.')
        const durationMs = Math.max(0, Date.now() - Date.parse(state.activeSession.startedAt))
        const event = eventFor('admin_interrupted', state, { employeeId: null, employeeName: 'Administrador', affectedEmployeeName: state.activeSession.employeeName, reason, durationMs })
        state.accumulatedMs += durationMs
        state.activeSession = null
        state.status = 'paused'
        state.lastPauseReason = reason
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
        const event = eventFor('completion_acknowledged', state, { employeeName: 'Administrador' })
        state.completionAcknowledgedAt = event.at
        return event
      })
      response.json(result)
    } catch (error) { sendError(response, error) }
  })

  return router
}
