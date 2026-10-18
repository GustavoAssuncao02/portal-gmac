// Correction of the time of an operation already recorded, e.g. an employee who forgot to press "pause".
// The original time is kept in the event, and every value derived from it is recalculated.

const sessionStarts = ['started', 'resumed']
const sessionEnds = ['paused', 'completed', 'session_ended', 'admin_interrupted']
const resourceChanges = ['machine_changed', 'labor_service_changed', 'resource_changed']
export const timeEditableEvents = [...sessionStarts, ...sessionEnds, ...resourceChanges, 'stage_progress']

const fail = (status, message) => { const error = new Error(message); error.status = status; throw error }
const moment = (ms) => new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
const chronological = (events) => [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

// Period worked by each session; `end` stays open while the employee is still working.
function sessionSpans(events, openIds) {
  const spans = new Map()
  const span = (id) => spans.get(id) || spans.set(id, { start: null, end: null }).get(id)
  for (const event of events) if (event.sessionId && sessionStarts.includes(event.type)) span(event.sessionId).start = Date.parse(event.at)
  for (const event of events) {
    if (!event.sessionId || !sessionEnds.includes(event.type)) continue
    const current = span(event.sessionId)
    current.end = Date.parse(event.at)
    // Records older than the start event only carry the duration of the session.
    if (current.start == null && Number.isFinite(Number(event.durationMs))) current.start = current.end - Number(event.durationMs)
  }
  return [...spans].map(([id, { start, end }]) => ({ start, end: end ?? (openIds.has(id) ? Infinity : null) })).filter((item) => Number.isFinite(item.start) && item.end != null && item.end > item.start)
}

// Project time: periods with someone working count once, even with several employees together.
function projectTime(spans) {
  let closedMs = 0, openSince = null, start = null, end = null
  const close = () => { if (start == null) return; if (end === Infinity) openSince = start; else closedMs += end - start }
  for (const item of [...spans].sort((a, b) => a.start - b.start)) {
    if (start != null && item.start <= end) { end = Math.max(end, item.end); continue }
    close()
    start = item.start
    end = item.end
  }
  close()
  return { closedMs, openSince }
}

// Durations stored in the events of one session, from the times currently recorded.
function refreshDurations(events, sessionId, implicitStart) {
  const changed = []
  let sessionStart = implicitStart, resourceStart = implicitStart
  for (const event of chronological(events.filter((item) => item.sessionId === sessionId))) {
    const at = Date.parse(event.at)
    if (sessionStarts.includes(event.type)) { sessionStart = at; resourceStart = at; continue }
    const from = resourceChanges.includes(event.type) ? resourceStart : sessionEnds.includes(event.type) ? sessionStart : null
    if (resourceChanges.includes(event.type)) resourceStart = at
    if (from == null || event.durationMs == null) continue
    const durationMs = Math.max(0, at - from)
    if (durationMs !== event.durationMs) { event.durationMs = durationMs; changed.push(event) }
  }
  return changed
}

// Closed time of one session in each stage, from its events: the stage chosen at the start, each change of stage and the
// end of the session. The open part of a session still running is counted live elsewhere (from `stageSince`).
export function sessionStageTimes(events, sessionId) {
  const times = {}
  let stage = null, since = null
  for (const event of chronological(events.filter((item) => item.sessionId === sessionId))) {
    const at = Date.parse(event.at)
    if (sessionStarts.includes(event.type)) { stage = event.workStageKey || null; since = at; continue }
    if (event.type !== 'stage_changed' && !sessionEnds.includes(event.type)) continue
    if (stage && since != null && at > since) times[stage] = (times[stage] || 0) + at - since
    if (event.type === 'stage_changed') { stage = event.workStageKey || null; since = at } else { stage = null; since = null }
  }
  return times
}

export function editEventTime(state, events, eventId, at, editor = {}, now = Date.now()) {
  const event = events.find((item) => item.id === eventId)
  if (!event) fail(404, 'Operação não encontrada no histórico desta OS.')
  if (!timeEditableEvents.includes(event.type) || !event.sessionId) fail(409, 'O horário desta operação não pode ser editado.')
  const time = typeof at === 'string' ? Date.parse(at) : NaN
  if (!Number.isFinite(time)) fail(400, 'Informe uma data e hora válidas.')
  const previous = Date.parse(event.at)
  if (time === previous) fail(409, 'Informe um horário diferente do atual.')
  if (time > now) fail(400, 'O horário não pode estar no futuro.')

  // The employee's operations in this OS keep their sequence: a pause cannot come before its start,
  // nor a start before the end of the same employee's previous session.
  const owners = new Map(events.filter((item) => item.sessionId && sessionStarts.includes(item.type)).map((item) => [item.sessionId, item.employeeId]))
  const owner = owners.get(event.sessionId)
  const sameEmployee = (item) => item.sessionId === event.sessionId || owner != null && item.sessionId && String(owners.get(item.sessionId)) === String(owner)
  const sequence = chronological(events.filter(sameEmployee))
  const index = sequence.indexOf(event)
  const before = sequence[index - 1], after = sequence[index + 1]
  if (before && time <= Date.parse(before.at)) fail(409, `O horário precisa ser posterior à operação anterior do funcionário (${moment(Date.parse(before.at))}).`)
  if (after && time >= Date.parse(after.at)) fail(409, `O horário precisa ser anterior à operação seguinte do funcionário (${moment(Date.parse(after.at))}).`)

  const openIds = new Set((state.activeSessions || []).map((session) => session.id))
  const timeBefore = projectTime(sessionSpans(events, openIds))
  const implicitStart = sessionSpans(events.filter((item) => item.sessionId === event.sessionId), new Set())[0]?.start ?? null
  const from = event.at, to = new Date(time).toISOString()
  const stageBefore = sessionStageTimes(events, event.sessionId)
  event.originalAt ??= from
  event.timeEdits = [...(event.timeEdits || []), { from, to, editedAt: new Date(now).toISOString(), adminId: editor.id ?? null, adminName: editor.name || 'Administrador' }]
  event.at = to

  const changed = new Set([event, ...refreshDurations(events, event.sessionId, implicitStart)])
  const session = (state.activeSessions || []).find((item) => item.id === event.sessionId)
  if (session && sessionStarts.includes(event.type)) session.startedAt = to
  if (session) for (const field of ['resourceStartedAt', 'machineStartedAt']) if (session[field] === from) session[field] = to
  if (sessionStarts.includes(event.type) && state.startedAt) state.startedAt = chronological(events.filter((item) => sessionStarts.includes(item.type)))[0].at
  if (event.type === 'completed' && state.completedAt === from) state.completedAt = to
  // The time of each stage follows the corrected time, by the difference it made in this session.
  const stageAfter = sessionStageTimes(events, event.sessionId)
  for (const stage of new Set([...Object.keys(stageBefore), ...Object.keys(stageAfter)])) {
    const delta = (stageAfter[stage] || 0) - (stageBefore[stage] || 0)
    if (delta) { state.stageTimeMs ||= {}; state.stageTimeMs[stage] = Math.max(0, Number(state.stageTimeMs[stage] || 0) + delta) }
  }
  if (session && session.stageSince === from) session.stageSince = to
  const timeAfter = projectTime(sessionSpans(events, openIds))
  state.accumulatedMs = Math.max(0, Number(state.accumulatedMs || 0) + timeAfter.closedMs - timeBefore.closedMs)
  if (openIds.size && timeAfter.openSince != null && timeAfter.openSince !== timeBefore.openSince) state.activeSince = new Date(timeAfter.openSince).toISOString()
  return { event, changed: [...changed] }
}
