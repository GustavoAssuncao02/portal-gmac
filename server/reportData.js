import { activeSessions } from './operationSessions.js'

export const duration = (ms) => {
  const seconds = Math.floor(Math.max(0, Number(ms) || 0) / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map((part) => String(part).padStart(2, '0')).join(':')
}
export const localDate = (timestamp) => new Date(Number(timestamp) - 3 * 3600000).toISOString().slice(0, 10)
export async function ordersWithOperations(orders, pool) {
  if (!pool) return orders
  const [states] = await pool.execute('SELECT order_code, data FROM order_operations')
  const [events] = await pool.execute('SELECT order_code, data FROM order_operation_events ORDER BY seq')
  const parse = (value) => typeof value === 'string' ? JSON.parse(value) : value
  const operations = new Map(states.map((row) => [row.order_code, parse(row.data)]))
  const history = new Map()
  for (const event of events) {
    if (!history.has(event.order_code)) history.set(event.order_code, [])
    history.get(event.order_code).push(parse(event.data))
  }
  return orders.map((order) => ({ ...order, operation: operations.get(order.code), operationEvents: history.get(order.code) || [] }))
}

export function reportRange(start, end) {
  const parse = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Informe as datas de início e fim.')
    const time = Date.parse(`${value}T03:00:00Z`)
    if (!Number.isFinite(time) || localDate(time) !== value) throw new Error('Data inválida.')
    return time
  }
  const range = { start: parse(start), end: parse(end) + 86400000 }
  if (range.start >= range.end) throw new Error('A data de início não pode ser posterior à data final.')
  return range
}

const resourceChanges = ['machine_changed', 'labor_service_changed', 'resource_changed']

export function workIntervals(orders, now = Date.now()) {
  const intervals = []
  for (const order of orders) {
    const starts = new Map()
    const closed = new Set()
    for (const event of [...(order.operationEvents || [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
      if (['started', 'resumed'].includes(event.type) && event.sessionId) starts.set(event.sessionId, event)
      if (!['paused', 'completed', 'session_ended', 'admin_interrupted', ...resourceChanges].includes(event.type) || closed.has(event.sessionId)) continue
      const initial = starts.get(event.sessionId)
      const end = Math.min(now, Date.parse(event.at))
      const start = initial ? Date.parse(initial.at) : Number.isFinite(Number(event.durationMs)) ? Date.parse(event.at) - Number(event.durationMs) : NaN
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) intervals.push({ start, end, employeeId: initial?.employeeId ?? event.employeeId, employeeName: initial?.employeeName || event.affectedEmployeeName || event.employeeName, machineId: initial ? initial.machineId : event.machineId, machineName: initial ? initial.machineName : event.machineName, laborServiceId: initial ? initial.laborServiceId : event.laborServiceId, laborServiceName: initial ? initial.laborServiceName : event.laborServiceName, orderCode: order.code, sessionId: event.sessionId, active: false, endedBy: event.type, reason: event.reason || null })
      if (resourceChanges.includes(event.type)) {
        const next = { ...event }
        if (event.type !== 'labor_service_changed') Object.assign(next, { machineId: event.nextMachineId, machineName: event.nextMachineName })
        if (event.type !== 'machine_changed') Object.assign(next, { laborServiceId: event.nextLaborServiceId, laborServiceName: event.nextLaborServiceName })
        starts.set(event.sessionId, next)
        continue
      }
      if (event.sessionId) closed.add(event.sessionId)
    }
    for (const active of activeSessions(order.operation)) {
      if (closed.has(active.id)) continue
      const start = Date.parse(starts.get(active.id)?.at || active.resourceStartedAt || active.machineStartedAt || active.startedAt)
      if (Number.isFinite(start) && now > start) intervals.push({ start, end: now, employeeId: active.employeeId, employeeName: active.employeeName, machineId: active.machineId, machineName: active.machineName, laborServiceId: active.laborServiceId, laborServiceName: active.laborServiceName, orderCode: order.code, sessionId: active.id, active: true, endedBy: null, reason: null })
    }
  }
  return intervals
}

function mergedTime(intervals) {
  let total = 0, start = null, end = null
  for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
    if (start == null) { start = interval.start; end = interval.end }
    else if (interval.start <= end) end = Math.max(end, interval.end)
    else { total += end - start; start = interval.start; end = interval.end }
  }
  return total + (start == null ? 0 : end - start)
}

export function hourReport(intervals, entities, field, range, ids = [], { parallelField } = {}) {
  const selected = new Set(ids.map(String))
  const names = new Map(entities.map((item) => [String(item.id), item.name]))
  const daily = new Map()
  let unidentifiedMs = 0
  for (const interval of intervals) {
    const start = Math.max(interval.start, range.start)
    const end = Math.min(interval.end, range.end)
    if (end <= start) continue
    const id = interval[field]
    if (id == null) { unidentifiedMs += end - start; continue }
    if (selected.size && !selected.has(String(id))) continue
    if (!names.has(String(id))) names.set(String(id), interval[{ employeeId: 'employeeName', machineId: 'machineName', laborServiceId: 'laborServiceName' }[field]] || 'Cadastro removido')
    for (let cursor = start; cursor < end;) {
      const date = localDate(cursor)
      const finish = Math.min(end, Date.parse(`${date}T03:00:00Z`) + 86400000)
      const key = `${id}|${date}`
      if (!daily.has(key)) daily.set(key, { id: String(id), date, intervals: [], orders: new Set() })
      const row = daily.get(key)
      row.intervals.push({ start: cursor, end: finish, ...(parallelField ? { [parallelField]: interval[parallelField] } : {}) })
      row.orders.add(interval.orderCode)
      cursor = finish
    }
  }
  const measuredTime = (rows) => {
    if (!parallelField) return mergedTime(rows)
    const groups = new Map()
    for (const row of rows) { const key = String(row[parallelField]); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row) }
    return [...groups.values()].reduce((total, group) => total + mergedTime(group), 0)
  }
  const details = [...daily.values()].map((row) => ({ id: row.id, name: names.get(row.id), date: row.date, ms: measuredTime(row.intervals), orders: [...row.orders].sort().join(', ') })).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'pt-BR'))
  const totals = [...names].filter(([id]) => !selected.size || selected.has(id)).map(([id, name]) => ({ id, name, ms: details.filter((row) => row.id === id).reduce((sum, row) => sum + row.ms, 0) })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  return { totals, details, totalMs: totals.reduce((sum, row) => sum + row.ms, 0), unidentifiedMs }
}

export function machineUtilization(result, range, now = Date.now()) {
  const end = Math.min(range.end, now)
  const availableMs = Math.max(0, end - range.start)
  const stats = (ms, available) => {
    const active = Math.min(available, Math.max(0, ms))
    const activePercent = available ? active / available * 100 : 0
    return { ms: active, availableMs: available, idleMs: available - active, activePercent, idlePercent: available ? 100 - activePercent : 0 }
  }
  const totals = result.totals.map((row) => ({ ...row, ...stats(row.ms, availableMs) }))
  const recorded = new Map(result.details.map((row) => [`${row.id}|${row.date}`, row.ms]))
  const details = []
  for (let cursor = range.start; cursor < end; cursor += 86400000) {
    const date = localDate(cursor), available = Math.min(end, cursor + 86400000) - cursor
    for (const row of totals) details.push({ id: row.id, name: row.name, date, ...stats(recorded.get(`${row.id}|${date}`) || 0, available) })
  }
  const totalAvailable = availableMs * totals.length
  const totalActive = totals.reduce((sum, row) => sum + row.ms, 0)
  return { totals, details, ...stats(totalActive, totalAvailable) }
}
