import { localDate, reportRange, workIntervals } from './reportData.js'

// Machine use over a period and the full day of one machine, built from the work sessions of the OS (operation events)
// and the maintenance periods kept on each machine. Times in milliseconds; days and hours in Bahia time (UTC-3).
const DAY = 86400000, HOUR = 3600000, OFFSET = 3 * HOUR

// Overlapping intervals count once: two sessions on the same machine at the same time are one period of use.
export function mergeIntervals(intervals) {
  const merged = []
  for (const { start, end } of [...intervals].filter((item) => item.end > item.start).sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1)
    if (last && start <= last.end) last.end = Math.max(last.end, end)
    else merged.push({ start, end })
  }
  return merged
}
const total = (intervals) => intervals.reduce((sum, item) => sum + item.end - item.start, 0)
// The parts of `intervals` outside every interval of `cut` (both already merged).
function subtract(intervals, cut) {
  const result = []
  for (const interval of intervals) {
    let cursor = interval.start
    for (const piece of cut) {
      if (piece.end <= cursor || piece.start >= interval.end) continue
      if (piece.start > cursor) result.push({ start: cursor, end: piece.start })
      cursor = Math.max(cursor, piece.end)
    }
    if (cursor < interval.end) result.push({ start: cursor, end: interval.end })
  }
  return result
}
const clip = (interval, range) => ({ ...interval, start: Math.max(interval.start, range.start), end: Math.min(interval.end, range.end) })
// Splits an interval at the local midnights (size DAY) or at the full hours (size HOUR).
function slices({ start, end }, size) {
  const parts = []
  for (let cursor = start; cursor < end;) {
    const boundary = Math.floor((cursor - OFFSET) / size) * size + OFFSET + size
    const finish = Math.min(end, boundary)
    parts.push({ start: cursor, end: finish })
    cursor = finish
  }
  return parts
}
const localHour = (time) => new Date(time - OFFSET).getUTCHours()
const iso = (time) => new Date(time).toISOString()

// Every maintenance period of a machine, the closed ones and the current one, with who started and ended it.
export function maintenancePeriods(machine, now = Date.now()) {
  const rows = [...(machine.maintenanceHistory || []), ...(machine.maintenance ? [{ ...machine.maintenance, until: null }] : [])]
  return rows.map((row) => ({ start: Date.parse(row.since), end: row.until ? Date.parse(row.until) : now, active: !row.until, reason: row.reason || '', startedBy: row.startedBy || '', endedBy: row.endedBy || '' }))
    .filter((row) => Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start)
}

const operationEvents = (orders) => orders.flatMap((order) => (order.operationEvents || []).map((event) => ({ ...event, orderCode: order.code, service: order.service || '', target: Number(order.quantity) || null })))
const pieceCount = (events) => events.filter((event) => event.type === 'stage_progress').reduce((sum, event) => sum + Math.max(0, Number(event.quantity) || 0), 0)

// Use of every machine in the period. The available time runs from the start of the period to its end or to now,
// whichever comes first; idle is what is left of it without use or maintenance (there is no work schedule to discount).
export function machineUsageReport(machines, orders, range, now = Date.now()) {
  const window = { start: range.start, end: Math.max(range.start, Math.min(range.end, now)) }
  const availableMs = window.end - window.start
  const intervals = workIntervals(orders, now).filter((item) => item.machineId != null).map((item) => clip(item, window)).filter((item) => item.end > item.start)
  const events = operationEvents(orders).filter((event) => event.machineId != null && Date.parse(event.at) >= window.start && Date.parse(event.at) < window.end)
  const registry = new Map(machines.map((machine) => [String(machine.id), machine]))
  // A machine removed from the registry still shows the use it had, with the name the sessions recorded.
  for (const interval of intervals) if (!registry.has(String(interval.machineId))) registry.set(String(interval.machineId), { id: interval.machineId, name: interval.machineName || 'Máquina removida', removed: true })

  const daily = new Map()
  for (let cursor = window.start; cursor < window.end; cursor += DAY) daily.set(localDate(cursor), { date: localDate(cursor), usedMs: 0, machines: new Set() })
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, usedMs: 0 }))
  const people = new Map(), reasons = new Map()

  const rows = [...registry.values()].map((machine) => {
    const id = String(machine.id)
    const own = intervals.filter((item) => String(item.machineId) === id)
    const used = mergeIntervals(own)
    const maintenance = subtract(mergeIntervals(maintenancePeriods(machine, now).map((period) => clip(period, window))), used)
    const usedMs = total(used), maintenanceMs = total(maintenance)
    for (const part of used.flatMap((item) => slices(item, DAY))) {
      const day = daily.get(localDate(part.start))
      if (day) { day.usedMs += part.end - part.start; day.machines.add(id) }
    }
    for (const part of used.flatMap((item) => slices(item, HOUR))) hourly[localHour(part.start)].usedMs += part.end - part.start
    const ownEvents = events.filter((event) => String(event.machineId) === id)
    const byPerson = new Map()
    for (const item of own) {
      const name = item.employeeName || 'Operador não identificado'
      byPerson.set(name, (byPerson.get(name) || 0) + item.end - item.start)
    }
    const top = [...byPerson].sort((left, right) => right[1] - left[1])[0]
    const durations = own.map((item) => item.end - item.start)
    return {
      id: machine.id, name: machine.name, type: machine.type || '', sector: machine.sector || '', removed: Boolean(machine.removed),
      usedMs, maintenanceMs, idleMs: Math.max(0, availableMs - usedMs - maintenanceMs), availableMs,
      utilization: availableMs ? usedMs / availableMs : 0,
      sessions: own.length, operators: byPerson.size, orders: new Set(own.map((item) => item.orderCode)).size,
      pieces: pieceCount(ownEvents), pauses: ownEvents.filter((event) => event.type === 'paused').length,
      avgSessionMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
      longestSessionMs: durations.length ? Math.max(...durations) : 0,
      lastUsedAt: own.length ? iso(Math.max(...own.map((item) => item.end))) : null,
      inUse: own.some((item) => item.active && item.end >= window.end),
      topOperator: top ? { name: top[0], ms: top[1] } : null,
    }
  }).sort((left, right) => right.usedMs - left.usedMs || left.name.localeCompare(right.name, 'pt-BR'))

  for (const item of intervals) {
    const key = String(item.employeeId ?? item.employeeName ?? 'unknown')
    if (!people.has(key)) people.set(key, { name: item.employeeName || 'Operador não identificado', ms: 0, sessions: 0, machines: new Set(), pieces: 0 })
    const person = people.get(key)
    person.ms += item.end - item.start
    person.sessions += 1
    person.machines.add(String(item.machineId))
  }
  for (const event of events) {
    if (event.type === 'stage_progress') {
      const person = people.get(String(event.employeeId ?? event.employeeName ?? 'unknown'))
      if (person) person.pieces += Math.max(0, Number(event.quantity) || 0)
    }
    if (event.type === 'paused') {
      const reason = event.reason || 'Sem motivo informado'
      reasons.set(reason, (reasons.get(reason) || 0) + 1)
    }
  }

  const days = [...daily.values()].map((day) => ({ date: day.date, usedMs: day.usedMs, machines: day.machines.size }))
  const busiest = [...days].sort((left, right) => right.usedMs - left.usedMs)[0]
  const peak = [...hourly].sort((left, right) => right.usedMs - left.usedMs)[0]
  const used = rows.filter((row) => row.usedMs > 0)
  const durations = intervals.map((item) => item.end - item.start)
  const usedMs = rows.reduce((sum, row) => sum + row.usedMs, 0)
  return {
    range: { start: iso(range.start), end: iso(range.end), until: iso(window.end) },
    availableMs,
    summary: {
      usedMs, maintenanceMs: rows.reduce((sum, row) => sum + row.maintenanceMs, 0), idleMs: rows.reduce((sum, row) => sum + row.idleMs, 0),
      machines: rows.length, machinesUsed: used.length,
      utilization: rows.length && availableMs ? usedMs / (rows.length * availableMs) : 0,
      mostUsed: used[0] ? { id: used[0].id, name: used[0].name, ms: used[0].usedMs, utilization: used[0].utilization } : null,
      mostIdle: rows.length ? (({ id, name, idleMs, availableMs: available }) => ({ id, name, ms: idleMs, share: available ? idleMs / available : 0 }))([...rows].sort((left, right) => right.idleMs - left.idleMs || left.name.localeCompare(right.name, 'pt-BR'))[0]) : null,
      sessions: intervals.length, avgSessionMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
      pieces: pieceCount(events), pauses: events.filter((event) => event.type === 'paused').length, operators: people.size,
      busiestDay: busiest?.usedMs ? busiest : null, peakHour: peak?.usedMs ? peak.hour : null,
    },
    machines: rows,
    daily: days,
    hourly,
    operators: [...people.values()].map((person) => ({ ...person, machines: person.machines.size })).sort((left, right) => right.ms - left.ms),
    pauseReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason, 'pt-BR')),
  }
}

// Everything that happened to one machine on one day: the periods in use, under maintenance and idle (the bar from
// 00:00 to 24:00), each operation event recorded on it, the maintenance starts and ends, and the totals of the day.
export function machineDay(machine, orders, date, now = Date.now()) {
  const range = reportRange(date, date)
  const until = Math.max(range.start, Math.min(range.end, now))
  const id = String(machine.id)
  const sessions = workIntervals(orders, now).filter((item) => String(item.machineId) === id && item.start < range.end && item.end > range.start)
    .map((item) => ({ ...clip(item, range), startedAt: iso(item.start), endedAt: item.active ? null : iso(item.end) }))
    .sort((left, right) => left.start - right.start)
  const used = mergeIntervals(sessions)
  const periods = maintenancePeriods(machine, now).filter((period) => period.start < range.end && period.end > range.start)
  const maintenance = subtract(mergeIntervals(periods.map((period) => clip(period, { start: range.start, end: until }))), used)
  const idle = subtract([{ start: range.start, end: until }], mergeIntervals([...used, ...maintenance]))
  const sessionsIn = ({ start, end }) => sessions.filter((item) => item.start < end && item.end > start)
  const segments = [
    ...used.map((part) => ({ kind: 'use', ...part, people: [...new Set(sessionsIn(part).map((item) => item.employeeName || 'Operador não identificado'))], orders: [...new Set(sessionsIn(part).map((item) => item.orderCode))] })),
    ...maintenance.map((part) => ({ kind: 'maintenance', ...part, reason: periods.find((period) => period.start < part.end && period.end > part.start)?.reason || '' })),
    ...idle.map((part) => ({ kind: 'idle', ...part })),
    ...(until < range.end ? [{ kind: 'future', start: until, end: range.end }] : []),
  ].sort((left, right) => left.start - right.start).map((part) => ({ ...part, start: iso(part.start), end: iso(part.end), durationMs: part.end - part.start }))

  const dayEvents = operationEvents(orders).filter((event) => {
    const at = Date.parse(event.at)
    return at >= range.start && at < range.end && (String(event.machineId) === id || (event.nextMachineId != null && String(event.nextMachineId) === id))
  })
  const events = [
    ...dayEvents.map((event) => {
      const arrived = event.machineId == null || String(event.machineId) !== id
      return {
        id: event.id || `${event.orderCode}|${event.at}|${event.type}`, at: event.at,
        type: ['machine_changed', 'resource_changed'].includes(event.type) && arrived ? 'machine_arrived' : event.type,
        employeeName: event.affectedEmployeeName || event.employeeName || '', orderCode: event.orderCode, service: event.service,
        stageName: event.workStageName || event.stageName || '', reason: event.reason || '', quantity: event.quantity ?? null, stageTotal: event.stageTotal ?? null, target: event.target,
        durationMs: event.durationMs ?? null, details: Array.isArray(event.details) ? event.details.join(', ') : event.details || '',
        otherResource: arrived ? event.machineName || event.laborServiceName || '' : event.nextMachineName || event.nextLaborServiceName || '',
        registeredBy: event.registeredByEmployeeName || '',
      }
    }),
    ...periods.flatMap((period) => [
      ...(period.start >= range.start ? [{ id: `maintenance|${period.start}`, at: iso(period.start), type: 'maintenance_started', employeeName: period.startedBy, reason: period.reason }] : []),
      ...(!period.active && period.end < range.end ? [{ id: `maintenance-end|${period.end}`, at: iso(period.end), type: 'maintenance_ended', employeeName: period.endedBy, reason: period.reason, durationMs: period.end - period.start }] : []),
    ]),
  ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at))

  const usedMs = total(used)
  return {
    machine: { id: machine.id, name: machine.name, type: machine.type || '', sector: machine.sector || '' },
    date, start: iso(range.start), end: iso(range.end), until: iso(until),
    summary: {
      usedMs, maintenanceMs: total(maintenance), idleMs: total(idle), elapsedMs: until - range.start,
      utilization: until > range.start ? usedMs / (until - range.start) : 0,
      firstStartAt: used.length ? iso(used[0].start) : null,
      lastEndAt: used.length ? (sessions.some((item) => item.active && item.end >= until) ? null : iso(used.at(-1).end)) : null,
      inUse: sessions.some((item) => item.active && item.end >= until),
      sessions: sessions.length, operators: [...new Set(sessions.map((item) => item.employeeName || 'Operador não identificado'))],
      orders: [...new Set(sessions.map((item) => item.orderCode))], pieces: pieceCount(dayEvents.filter((event) => String(event.machineId) === id)),
      pauses: dayEvents.filter((event) => event.type === 'paused' && String(event.machineId) === id).length,
    },
    segments,
    sessions: sessions.map((item) => ({ startedAt: item.startedAt, endedAt: item.endedAt, active: item.active, durationMs: item.end - item.start, employeeName: item.employeeName || 'Operador não identificado', orderCode: item.orderCode, service: orders.find((order) => order.code === item.orderCode)?.service || '', stageName: item.stageName || '', endedBy: item.endedBy, reason: item.reason })),
    events,
  }
}
