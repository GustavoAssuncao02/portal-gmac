// Operations typed in by an administrator from an employee's notes, e.g. a service done outside the company without
// access to the portal. They are the same records the operator screen makes: a start opens a period of work, pieces are
// registered inside it and a pause closes it. Project time, time per stage and pieces per stage are recalculated as in
// a time correction (operationEventTime.js); a start still waiting for its pause counts no time.
import { randomUUID } from 'node:crypto'
import { chronological, projectTime, resourceChanges, sessionEnds, sessionSpans, sessionStageTimes, sessionStarts } from './operationEventTime.js'
import { serviceDetails } from './serviceStages.js'

export const manualEventTypes = ['start', 'pieces', 'pause']

const fail = (status, message) => { const error = new Error(message); error.status = status; throw error }
const moment = (ms) => new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
const sessionFields = (event) => ({ employeeId: event.employeeId, employeeName: event.employeeName, sessionId: event.sessionId, machineId: event.machineId ?? null, machineName: event.machineName ?? null, laborServiceId: event.laborServiceId ?? null, laborServiceName: event.laborServiceName ?? null })

// The employee's work sessions in this OS. `end` is Infinity while the employee is still working in the portal and null
// for a manual start waiting for its pause.
function employeeSessions(events, employeeId, openIds) {
  return events.filter((event) => event.sessionId && sessionStarts.includes(event.type) && String(event.employeeId) === String(employeeId)).map((start) => {
    const own = events.filter((event) => event.sessionId === start.sessionId)
    const end = own.find((event) => sessionEnds.includes(event.type))
    const last = Math.max(...own.map((event) => Date.parse(event.at)))
    return { id: start.sessionId, start, from: Date.parse(start.at), last, end: end ? Date.parse(end.at) : openIds.has(start.sessionId) ? Infinity : start.manual ? null : last }
  })
}

// Stage and machine or labor service of a session at a given moment, following its changes up to then.
function sessionAt(events, session, time) {
  let stageKey = session.start.workStageKey ?? null, stageName = session.start.workStageName ?? null
  const fields = sessionFields(session.start)
  for (const event of chronological(events.filter((item) => item.sessionId === session.id))) {
    if (Date.parse(event.at) > time) break
    if (event.type === 'stage_changed') { stageKey = event.workStageKey; stageName = event.workStageName }
    if (resourceChanges.includes(event.type)) Object.assign(fields, { machineId: event.nextMachineId ?? null, machineName: event.nextMachineName ?? null, laborServiceId: event.nextLaborServiceId ?? null, laborServiceName: event.nextLaborServiceName ?? null })
  }
  return { stageKey, stageName, fields }
}

// `input`: { type, at, employee: { id, name }, stageKey, machine, laborService, reason, quantity }. The caller checks
// that the employee, the resource and the pause reason are registered; here the sequence of the records is checked.
// The new event is returned for the caller to store; `changed` lists the recorded events adjusted by it.
export function addManualEvent(state, events, order, input, editor = {}, now = Date.now()) {
  if (!manualEventTypes.includes(input.type)) fail(400, 'Selecione a operação.')
  const time = typeof input.at === 'string' ? Date.parse(input.at) : NaN
  if (!Number.isFinite(time)) fail(400, 'Informe a data e a hora da operação.')
  if (time > now) fail(400, 'O horário não pode estar no futuro.')
  if (!state.stages?.length) fail(409, 'Defina as etapas da OS antes de lançar operações.')
  if (state.status === 'completed' && state.completedAt && time >= Date.parse(state.completedAt)) fail(409, `A OS foi concluída em ${moment(Date.parse(state.completedAt))}. Lance operações anteriores à conclusão.`)
  const { employee } = input
  const openIds = new Set((state.activeSessions || []).map((session) => session.id))
  const sessions = employeeSessions(events, employee.id, openIds)
  const at = new Date(time).toISOString()
  const base = { id: randomUUID(), at, manual: { adminId: editor.id ?? null, adminName: editor.name || 'Administrador', recordedAt: new Date(now).toISOString() } }
  const timeBefore = projectTime(sessionSpans(events, openIds))
  const changed = new Set()
  let event

  if (input.type === 'start') {
    const pending = sessions.find((session) => session.end === null)
    if (pending) fail(409, `Lance a pausa do início de ${moment(pending.from)} de ${employee.name} antes de um novo início.`)
    const busy = sessions.find((session) => session.from <= time && time < session.end)
    if (busy) fail(409, `${employee.name} já estava trabalhando nesta OS nesse horário (início em ${moment(busy.from)}).`)
    const stage = state.stages.find((item) => item.key === input.stageKey)
    if (!stage) fail(400, 'Selecione uma etapa desta OS.')
    // The first start of the OS is "Início"; a start typed before it turns the former first one into a resumption.
    const starts = events.filter((item) => sessionStarts.includes(item.type))
    const first = !starts.some((item) => Date.parse(item.at) <= time)
    if (first) for (const item of starts) if (item.type === 'started') { item.type = 'resumed'; changed.add(item) }
    event = { ...base, type: first ? 'started' : 'resumed', employeeId: employee.id, employeeName: employee.name, sessionId: randomUUID(), machineId: input.machine?.id ?? null, machineName: input.machine?.name ?? null, laborServiceId: input.laborService?.id ?? null, laborServiceName: input.laborService?.name ?? null, workStageKey: stage.key, workStageName: stage.name }
    if (first || !state.startedAt) state.startedAt = at
    if (state.status === 'waiting') state.status = 'paused'
  }

  if (input.type === 'pause') {
    const session = sessions.find((item) => item.end === null)
    if (!session) fail(409, `Lance o início da operação de ${employee.name} antes da pausa.`)
    if (time <= session.last) fail(409, `A pausa precisa ser posterior à última operação desse período (${moment(session.last)}).`)
    const next = sessions.filter((item) => item.from > session.from).sort((left, right) => left.from - right.from)[0]
    if (next && time >= next.from) fail(409, `A pausa precisa ser anterior ao início seguinte de ${employee.name} (${moment(next.from)}).`)
    if (!input.reason) fail(400, 'Selecione o motivo da pausa.')
    const stageBefore = sessionStageTimes(events, session.id)
    event = { ...base, type: 'paused', ...sessionAt(events, session, time).fields, reason: input.reason, durationMs: time - session.from }
    // The time of each stage receives the period now closed.
    const stageAfter = sessionStageTimes([...events, event], session.id)
    for (const stage of Object.keys(stageAfter)) {
      const delta = stageAfter[stage] - (stageBefore[stage] || 0)
      if (delta) { state.stageTimeMs ||= {}; state.stageTimeMs[stage] = Math.max(0, Number(state.stageTimeMs[stage] || 0) + delta) }
    }
    if (!(state.activeSessions || []).length && state.status !== 'completed' && chronological([...events, event]).at(-1) === event) Object.assign(state, { status: 'paused', lastPauseReason: input.reason })
  }

  if (input.type === 'pieces') {
    const session = sessions.find((item) => item.from < time && (item.end === null || time < item.end))
    if (!session) fail(409, `${employee.name} não estava trabalhando nesta OS nesse horário. Lance o início da operação antes das peças.`)
    const index = state.stages.findIndex((item) => item.key === input.stageKey)
    if (index < 0) fail(400, 'Selecione uma etapa desta OS.')
    const stage = state.stages[index], context = sessionAt(events, session, time)
    if (context.stageKey && context.stageKey !== stage.key) fail(409, `Nesse horário ${employee.name} estava na etapa ${context.stageName}.`)
    const quantity = Number(input.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) fail(400, 'Informe uma quantidade inteira de peças.')
    const current = Number(state.stageCounts?.[stage.key] || 0), count = current + quantity
    if (count > Number(order.quantity)) fail(409, `A quantidade passa do total da OS: ${stage.name} já tem ${current}/${Number(order.quantity)} peças.`)
    if (serviceDetails(order.resources).strictProcess && index > 0 && count > Number(state.stageCounts?.[state.stages[index - 1].key] || 0)) fail(409, 'As peças precisam passar pela etapa anterior antes desta etapa.')
    // Registrations made after this moment already had these pieces: their running totals go up.
    const later = events.filter((item) => item.type === 'stage_progress' && item.stageKey === stage.key && Date.parse(item.at) > time)
    for (const item of later) { item.stageTotal = Number(item.stageTotal || 0) + quantity; changed.add(item) }
    event = { ...base, type: 'stage_progress', ...context.fields, stageKey: stage.key, stageName: stage.name, quantity, stageTotal: count - later.reduce((sum, item) => sum + Number(item.quantity || 0), 0) }
    state.stageCounts = { ...state.stageCounts, [stage.key]: count }
    const live = (state.activeSessions || []).find((item) => item.id === session.id)
    if (live && !(live.workedStages || []).includes(stage.key)) live.workedStages = [...(live.workedStages || []), stage.key]
    if (live && state.stages.every((item) => Number(state.stageCounts[item.key] || 0) === Number(order.quantity))) state.status = 'finalizing'
  }

  const timeAfter = projectTime(sessionSpans([...events, event], openIds))
  state.accumulatedMs = Math.max(0, Number(state.accumulatedMs || 0) + timeAfter.closedMs - timeBefore.closedMs)
  if (openIds.size && timeAfter.openSince != null && timeAfter.openSince !== timeBefore.openSince) state.activeSince = new Date(timeAfter.openSince).toISOString()
  return { event, changed: [...changed] }
}
