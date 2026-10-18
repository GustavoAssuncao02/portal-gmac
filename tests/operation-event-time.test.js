import assert from 'node:assert/strict'
import test from 'node:test'
import { editEventTime } from '../server/operationEventTime.js'
import { workIntervals } from '../server/reportData.js'
import { operationElapsed } from '../server/operationSessions.js'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const hour = 3600000
const at = (time) => `2026-10-01T${time}.000Z`
const session = (id, employeeId, startedAt) => ({ id, employeeId, employeeName: `Funcionario ${employeeId}`, machineId: 'm1', machineName: 'Torno', startedAt })
const event = (id, type, time, current, fields = {}) => ({ id, type, at: at(time), sessionId: current.id, employeeId: current.employeeId, employeeName: current.employeeName, machineId: current.machineId, machineName: current.machineName, ...fields })
const now = Date.parse('2026-10-02T12:00:00.000Z')
const admin = { id: 7, name: 'Gilson' }

test('a forgotten pause is corrected, keeping the original time and recalculating the worked time', () => {
  const ana = session('s1', 1, at('10:00:00'))
  const events = [event('e1', 'started', '10:00:00', ana), event('e2', 'stage_progress', '11:00:00', ana), event('e3', 'paused', '13:42:00', ana, { reason: 'Descanso', durationMs: 3.7 * hour })]
  const state = { status: 'paused', startedAt: at('10:00:00'), accumulatedMs: 3.7 * hour, activeSessions: [], activeSince: null }
  const result = editEventTime(state, events, 'e3', at('12:00:00'), admin, now)
  assert.equal(result.event, events[2])
  assert.deepEqual(result.changed, [events[2]])
  assert.equal(events[2].at, at('12:00:00'))
  assert.equal(events[2].originalAt, at('13:42:00'))
  assert.equal(events[2].durationMs, 2 * hour)
  assert.deepEqual(events[2].timeEdits, [{ from: at('13:42:00'), to: at('12:00:00'), editedAt: new Date(now).toISOString(), adminId: 7, adminName: 'Gilson' }])
  assert.equal(state.accumulatedMs, 2 * hour)
  assert.equal(state.activeSince, null)
  // Machine and employee hours come from the same events.
  assert.deepEqual(workIntervals([{ code: 'OS-1', operation: state, operationEvents: events }], now).map((row) => [row.start, row.end, row.machineId]), [[Date.parse(at('10:00:00')), Date.parse(at('12:00:00')), 'm1']])

  editEventTime(state, events, 'e3', at('12:30:00'), admin, now + 1000)
  assert.equal(events[2].originalAt, at('13:42:00'))
  assert.equal(events[2].timeEdits.length, 2)
  assert.equal(events[2].durationMs, 2.5 * hour)
  assert.equal(state.accumulatedMs, 2.5 * hour)
})

test('editing the start of someone still working updates the active session and the project time', () => {
  const ana = session('s1', 1, at('10:00:00')), bia = session('s2', 2, at('12:30:00'))
  const events = [event('e1', 'started', '10:00:00', ana), event('e2', 'paused', '12:00:00', ana, { durationMs: 2 * hour }), event('e3', 'resumed', '12:30:00', bia)]
  const state = { status: 'running', startedAt: at('10:00:00'), accumulatedMs: 2 * hour, activeSessions: [bia], activeSince: at('12:30:00') }
  const moment = Date.parse(at('15:00:00'))
  assert.equal(operationElapsed(state, moment), 4.5 * hour)
  // Bia actually started while Ana was still working: the periods overlap and count once.
  editEventTime(state, events, 'e3', at('11:00:00'), admin, now)
  assert.equal(bia.startedAt, at('11:00:00'))
  assert.equal(state.activeSince, at('10:00:00'))
  assert.equal(state.accumulatedMs, 0)
  assert.equal(operationElapsed(state, moment), 5 * hour)
  assert.equal(state.startedAt, at('10:00:00'))
  editEventTime(state, events, 'e1', at('09:00:00'), admin, now)
  assert.equal(state.startedAt, at('09:00:00'))
  assert.equal(events[1].durationMs, 3 * hour)
  assert.equal(operationElapsed(state, moment), 6 * hour)
})

test('resource changes and the completion keep their derived values', () => {
  const ana = { ...session('s1', 1, at('10:00:00')), resourceStartedAt: at('11:00:00'), machineStartedAt: at('11:00:00') }
  const events = [event('e1', 'started', '10:00:00', ana), event('e2', 'machine_changed', '11:00:00', ana, { nextMachineId: 'm2', nextMachineName: 'Fresa', durationMs: hour })]
  const state = { status: 'running', startedAt: at('10:00:00'), accumulatedMs: 0, activeSessions: [ana], activeSince: at('10:00:00') }
  editEventTime(state, events, 'e2', at('10:30:00'), admin, now)
  assert.equal(events[1].durationMs, hour / 2)
  assert.equal(ana.resourceStartedAt, at('10:30:00'))
  assert.equal(ana.machineStartedAt, at('10:30:00'))
  assert.equal(ana.startedAt, at('10:00:00'))
  assert.equal(state.activeSince, at('10:00:00'))

  const done = [event('e1', 'started', '10:00:00', ana), event('e2', 'completed', '14:00:00', ana, { durationMs: 4 * hour })]
  const finished = { status: 'completed', startedAt: at('10:00:00'), completedAt: at('14:00:00'), accumulatedMs: 4 * hour, activeSessions: [], activeSince: null }
  editEventTime(finished, done, 'e2', at('13:00:00'), admin, now)
  assert.equal(finished.completedAt, at('13:00:00'))
  assert.equal(finished.accumulatedMs, 3 * hour)
})

test('a correction cannot break the sequence of the employee operations', () => {
  const first = session('s1', 1, at('10:00:00')), second = session('s2', 1, at('14:00:00'))
  const events = [event('e1', 'started', '10:00:00', first), event('e2', 'paused', '12:00:00', first, { durationMs: 2 * hour }), event('e3', 'resumed', '14:00:00', second), event('e4', 'paused', '16:00:00', second, { durationMs: 2 * hour }), { id: 'e5', type: 'order_edited', at: at('17:00:00'), employeeName: 'Administrador', sessionId: null }]
  const state = { status: 'paused', startedAt: at('10:00:00'), accumulatedMs: 4 * hour, activeSessions: [], activeSince: null }
  const snapshot = JSON.stringify({ state, events })
  const attempt = (id, time, moment = now) => () => editEventTime(state, events, id, time, admin, moment)
  assert.throws(attempt('e2', at('09:59:59')), { status: 409, message: /posterior à operação anterior/ })
  assert.throws(attempt('e2', at('14:00:00')), { status: 409, message: /anterior à operação seguinte/ })
  assert.throws(attempt('e3', at('11:00:00')), { status: 409 })
  assert.throws(attempt('e4', at('16:00:00')), { status: 409, message: 'Informe um horário diferente do atual.' })
  assert.throws(attempt('e4', at('18:00:00'), Date.parse(at('17:30:00'))), { status: 400, message: 'O horário não pode estar no futuro.' })
  assert.throws(attempt('e4', 'ontem'), { status: 400 })
  assert.throws(attempt('e5', at('16:30:00')), { status: 409, message: 'O horário desta operação não pode ser editado.' })
  assert.throws(attempt('missing', at('16:30:00')), { status: 404 })
  assert.equal(JSON.stringify({ state, events }), snapshot)
})

test('the administrator edits the time of an operation through the API and the history shows the edition', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cutting'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const route = `/operations/orders/${order.code}`
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Funcionario de teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'teste@example.invalid', identification: '001' }, fixture.admin)).data.item
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }, administrator = { Authorization: `Bearer ${fixture.adminToken}` }
  const started = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id }, operator)
  await fixture.request(`${route}/pause`, 'POST', { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken, reason: 'Descanso' }, operator)
  // The employee started at 20:00 and only pressed "pause" at 23:42 (Bahia time).
  await fixture.mutateStore((store) => {
    const current = store.orders.find((item) => item.code === order.code)
    const [start, pause] = current.operationEvents
    start.at = '2026-10-01T23:00:00.000Z'
    Object.assign(pause, { at: '2026-10-02T02:42:00.000Z', durationMs: 3.7 * hour })
    Object.assign(current.operation, { startedAt: start.at, accumulatedMs: 3.7 * hour })
  })
  const [start, pause] = (await fixture.request(`${route}/events`, 'GET', undefined, { Authorization: `Bearer ${fixture.operatorToken}` })).data.items
  const body = { at: '2026-10-02T01:00:00.000Z' }
  assert.equal((await fixture.request(`${route}/events/${pause.id}/time`, 'PUT', body)).status, 401)
  assert.equal((await fixture.request(`${route}/events/${pause.id}/time`, 'PUT', body, operator)).status, 401)
  assert.equal((await fixture.request(`/operations/orders/unknown/events/${pause.id}/time`, 'PUT', body, administrator)).status, 404)
  assert.equal((await fixture.request(`${route}/events/unknown/time`, 'PUT', body, administrator)).status, 404)
  const early = await fixture.request(`${route}/events/${pause.id}/time`, 'PUT', { at: '2026-10-01T22:00:00.000Z' }, administrator)
  assert.equal(early.status, 409)
  assert.match(early.data.message, /posterior à operação anterior/)
  assert.equal((await fixture.request(`${route}/events/${pause.id}/time`, 'PUT', { at: new Date(Date.now() + hour).toISOString() }, administrator)).status, 400)
  const edited = await fixture.request(`${route}/events/${pause.id}/time`, 'PUT', body, administrator)
  assert.equal(edited.status, 200)
  assert.equal(edited.data.item.at, body.at)
  assert.equal(edited.data.item.originalAt, pause.at)
  assert.equal(edited.data.item.durationMs, 2 * hour)
  assert.equal(edited.data.operation.accumulatedMs, 2 * hour)
  const history = (await fixture.request(`${route}/events`, 'GET', undefined, { Authorization: `Bearer ${fixture.operatorToken}` })).data.items
  assert.deepEqual(history.map((item) => [item.id, item.at, item.originalAt]), [[start.id, start.at, undefined], [pause.id, body.at, pause.at]])
  assert.equal(history[1].timeEdits[0].adminName, 'Administrador')
  assert.equal((await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0].operation.accumulatedMs, 2 * hour)
  const activities = (await fixture.adminRequest(`/employees/${employee.id}/activities?period=all`)).data.items
  assert.equal(activities.find((item) => item.id === pause.id).originalAt, pause.at)
})

test('correcting a time moves the stage time by the same difference', async () => {
  const { editEventTime, sessionStageTimes } = await import('../server/operationEventTime.js')
  const at = (time) => `2026-10-01T${time}:00.000Z`
  const events = [
    { id: 'start', type: 'started', sessionId: 's1', employeeId: 1, at: at('11:00'), workStageKey: 'stage-1' },
    { id: 'change', type: 'stage_changed', sessionId: 's1', employeeId: 1, at: at('12:00'), workStageKey: 'stage-2', durationMs: 3600000 },
    { id: 'pause', type: 'paused', sessionId: 's1', employeeId: 1, at: at('13:00'), durationMs: 7200000 },
  ]
  assert.deepEqual(sessionStageTimes(events, 's1'), { 'stage-1': 3600000, 'stage-2': 3600000 })
  const state = { status: 'paused', activeSessions: [], accumulatedMs: 7200000, startedAt: at('11:00'), stageTimeMs: { 'stage-1': 3600000, 'stage-2': 3600000 } }
  editEventTime(state, events, 'start', at('10:30'), { id: 1, name: 'Admin' }, Date.parse(at('20:00')))
  assert.deepEqual(state.stageTimeMs, { 'stage-1': 5400000, 'stage-2': 3600000 }, 'the first stage gained the 30 minutes')
  editEventTime(state, events, 'pause', at('12:30'), { id: 1, name: 'Admin' }, Date.parse(at('20:00')))
  assert.deepEqual(state.stageTimeMs, { 'stage-1': 5400000, 'stage-2': 1800000 }, 'the second stage lost the 30 minutes')
  // A session still running: its open part is counted from `stageSince`, which follows a corrected start.
  const open = [{ id: 'start', type: 'started', sessionId: 's2', employeeId: 2, at: at('11:00'), workStageKey: 'stage-1' }]
  const running = { status: 'running', activeSessions: [{ id: 's2', employeeId: 2, startedAt: at('11:00'), stageKey: 'stage-1', stageSince: at('11:00') }], accumulatedMs: 0, startedAt: at('11:00'), activeSince: at('11:00'), stageTimeMs: {} }
  editEventTime(running, open, 'start', at('10:00'), { id: 1, name: 'Admin' }, Date.parse(at('20:00')))
  assert.equal(running.activeSessions[0].stageSince, at('10:00'))
  assert.deepEqual(running.stageTimeMs, {})
})
