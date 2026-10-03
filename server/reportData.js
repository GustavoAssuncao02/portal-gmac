export const duration = (ms) => {
  const seconds = Math.floor(Math.max(0, Number(ms) || 0) / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map((part) => String(part).padStart(2, '0')).join(':')
}
export const localDate = (timestamp) => new Date(Number(timestamp) - 3 * 3600000).toISOString().slice(0, 10)
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

export function workIntervals(orders, now = Date.now()) {
  const intervals = []
  for (const order of orders) {
    const starts = new Map()
    const closed = new Set()
    for (const event of [...(order.operationEvents || [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
      if (['started', 'resumed'].includes(event.type) && event.sessionId) starts.set(event.sessionId, event)
      if (!['paused', 'completed', 'admin_interrupted'].includes(event.type) || closed.has(event.sessionId)) continue
      const initial = starts.get(event.sessionId)
      const end = Math.min(now, Date.parse(event.at))
      const start = initial ? Date.parse(initial.at) : Number.isFinite(Number(event.durationMs)) ? Date.parse(event.at) - Number(event.durationMs) : NaN
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) intervals.push({ start, end, employeeId: initial?.employeeId ?? event.employeeId, employeeName: initial?.employeeName || event.affectedEmployeeName || event.employeeName, machineId: initial?.machineId ?? event.machineId, machineName: initial?.machineName || event.machineName, orderCode: order.code })
      if (event.sessionId) closed.add(event.sessionId)
    }
    const active = order.operation?.activeSession
    if (active && !closed.has(active.id)) {
      const start = Date.parse(active.startedAt)
      if (Number.isFinite(start) && now > start) intervals.push({ start, end: now, employeeId: active.employeeId, employeeName: active.employeeName, machineId: active.machineId, machineName: active.machineName, orderCode: order.code })
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

export function hourReport(intervals, entities, field, range, ids = []) {
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
    if (!names.has(String(id))) names.set(String(id), interval[field === 'employeeId' ? 'employeeName' : 'machineName'] || 'Cadastro removido')
    for (let cursor = start; cursor < end;) {
      const date = localDate(cursor)
      const finish = Math.min(end, Date.parse(`${date}T03:00:00Z`) + 86400000)
      const key = `${id}|${date}`
      if (!daily.has(key)) daily.set(key, { id: String(id), date, intervals: [], orders: new Set() })
      const row = daily.get(key)
      row.intervals.push({ start: cursor, end: finish })
      row.orders.add(interval.orderCode)
      cursor = finish
    }
  }
  const details = [...daily.values()].map((row) => ({ id: row.id, name: names.get(row.id), date: row.date, ms: mergedTime(row.intervals), orders: [...row.orders].sort().join(', ') })).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'pt-BR'))
  const totals = [...names].filter(([id]) => !selected.size || selected.has(id)).map(([id, name]) => ({ id, name, ms: details.filter((row) => row.id === id).reduce((sum, row) => sum + row.ms, 0) })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  return { totals, details, totalMs: totals.reduce((sum, row) => sum + row.ms, 0), unidentifiedMs }
}
