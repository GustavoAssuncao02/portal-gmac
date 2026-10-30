import assert from 'node:assert/strict'
import test from 'node:test'
import { addManualEvent } from '../server/operationManualEvents.js'
import { operationElapsed } from '../server/operationSessions.js'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const hour = 3600000
const at = (time) => `2026-10-01T${time}.000Z`
const now = Date.parse('2026-10-02T12:00:00.000Z')
const admin = { id: 7, name: 'Gilson' }
const ana = { id: 1, name: 'Ana' }, bia = { id: 2, name: 'Bia' }
const order = { quantity: 20, resources: {} }
const stages = [{ key: 'stage-1', name: 'Plaina' }, { key: 'stage-2', name: 'Pintura' }]
const waiting = () => ({ status: 'waiting', stages, stageCounts: { 'stage-1': 0, 'stage-2': 0 }, accumulatedMs: 0, startedAt: null, activeSessions: [], activeSince: null })
// Adds the event to the list, as the API does after the checks.
const add = (state, events, input) => { const result = addManualEvent(state, events, order, input, admin, now); events.push(result.event); return result }
const rejects = (state, events, input, pattern) => assert.throws(() => addManualEvent(state, events, order, input, admin, now), pattern)

test('notes of an external service: start, pieces and pause become the usual records and count time', () => {
  const state = waiting(), events = []
  const start = add(state, events, { type: 'start', at: at('08:00:00'), employee: ana, stageKey: 'stage-1', machine: { id: 'm1', name: 'Plaina' } }).event
  assert.deepEqual([start.type, start.employeeName, start.machineName, start.workStageName, start.manual], ['started', 'Ana', 'Plaina', 'Plaina', { adminId: 7, adminName: 'Gilson', recordedAt: new Date(now).toISOString() }])
  assert.deepEqual([state.status, state.startedAt, state.accumulatedMs], ['paused', at('08:00:00'), 0], 'a start without its pause counts no time yet')
  const pieces = add(state, events, { type: 'pieces', at: at('09:00:00'), employee: ana, stageKey: 'stage-1', quantity: 3 }).event
  assert.deepEqual([pieces.type, pieces.sessionId, pieces.stageName, pieces.quantity, pieces.stageTotal, pieces.machineName], ['stage_progress', start.sessionId, 'Plaina', 3, 3, 'Plaina'])
  assert.equal(state.stageCounts['stage-1'], 3)
  const pause = add(state, events, { type: 'pause', at: at('10:00:00'), employee: ana, reason: 'Descanso' }).event
  assert.deepEqual([pause.type, pause.sessionId, pause.reason, pause.durationMs], ['paused', start.sessionId, 'Descanso', 2 * hour])
  assert.deepEqual([state.accumulatedMs, state.stageTimeMs['stage-1'], state.status, state.lastPauseReason], [2 * hour, 2 * hour, 'paused', 'Descanso'])
  // A second period of the same day follows the same order.
  add(state, events, { type: 'start', at: at('11:00:00'), employee: ana, stageKey: 'stage-1' })
  add(state, events, { type: 'pause', at: at('11:30:00'), employee: ana, reason: 'Horário de almoço' })
  assert.equal(events.at(-2).type, 'resumed')
  assert.equal(state.accumulatedMs, 2.5 * hour)
})

test('the records keep their sequence', () => {
  const state = waiting(), events = []
  rejects(state, events, { type: 'pause', at: at('10:00:00'), employee: ana, reason: 'Descanso' }, /Lance o início da operação de Ana antes da pausa/)
  rejects(state, events, { type: 'pieces', at: at('10:00:00'), employee: ana, stageKey: 'stage-1', quantity: 1 }, /Ana não estava trabalhando nesta OS nesse horário/)
  rejects(state, events, { type: 'start', at: '2026-10-03T08:00:00.000Z', employee: ana, stageKey: 'stage-1' }, /futuro/)
  rejects(state, events, { type: 'start', at: at('08:00:00'), employee: ana, stageKey: 'outra' }, /Selecione uma etapa desta OS/)
  add(state, events, { type: 'start', at: at('08:00:00'), employee: ana, stageKey: 'stage-1' })
  rejects(state, events, { type: 'start', at: at('09:00:00'), employee: ana, stageKey: 'stage-1' }, /Lance a pausa do início de .* de Ana antes de um novo início/)
  rejects(state, events, { type: 'pieces', at: at('09:00:00'), employee: ana, stageKey: 'stage-2', quantity: 1 }, /Nesse horário Ana estava na etapa Plaina/)
  rejects(state, events, { type: 'pieces', at: at('09:00:00'), employee: ana, stageKey: 'stage-1', quantity: 21 }, /passa do total da OS: Plaina já tem 0\/20/)
  rejects(state, events, { type: 'pieces', at: at('09:00:00'), employee: ana, stageKey: 'stage-1', quantity: 1.5 }, /quantidade inteira/)
  add(state, events, { type: 'pieces', at: at('09:00:00'), employee: ana, stageKey: 'stage-1', quantity: 2 })
  rejects(state, events, { type: 'pause', at: at('08:30:00'), employee: ana, reason: 'Descanso' }, /posterior à última operação desse período/)
  rejects(state, events, { type: 'pause', at: at('09:30:00'), employee: ana }, /motivo da pausa/)
  // Another employee works independently in the same OS.
  add(state, events, { type: 'start', at: at('08:30:00'), employee: bia, stageKey: 'stage-2' })
  assert.equal(events.at(-1).type, 'resumed')
  add(state, events, { type: 'pause', at: at('12:00:00'), employee: ana, reason: 'Descanso' })
  rejects(state, events, { type: 'start', at: at('11:00:00'), employee: ana, stageKey: 'stage-1' }, /Ana já estava trabalhando nesta OS nesse horário/)
  const strict = waiting(), strictEvents = []
  add(strict, strictEvents, { type: 'start', at: at('08:00:00'), employee: ana, stageKey: 'stage-2' })
  assert.throws(() => addManualEvent(strict, strictEvents, { quantity: 20, resources: { strictProcess: true } }, { type: 'pieces', at: at('09:00:00'), employee: ana, stageKey: 'stage-2', quantity: 1 }, admin, now), /etapa anterior/)
  const done = { ...waiting(), status: 'completed', completedAt: at('15:00:00') }
  rejects(done, [], { type: 'start', at: at('16:00:00'), employee: ana, stageKey: 'stage-1' }, /Lance operações anteriores à conclusão/)
})

test('notes typed in after the portal records: earlier start, running totals and overlap with someone working', () => {
  // Bia started in the portal at 12:00, registered 2 pieces at 13:00 and is still working.
  const live = { id: 's-bia', employeeId: 2, employeeName: 'Bia', startedAt: at('12:00:00'), stageKey: 'stage-1', stageName: 'Plaina', stageSince: at('12:00:00') }
  const state = { ...waiting(), status: 'running', startedAt: at('12:00:00'), stageCounts: { 'stage-1': 2, 'stage-2': 0 }, activeSessions: [live], activeSince: at('12:00:00') }
  const events = [
    { id: 'e1', type: 'started', at: at('12:00:00'), sessionId: 's-bia', employeeId: 2, employeeName: 'Bia', workStageKey: 'stage-1', workStageName: 'Plaina' },
    { id: 'e2', type: 'stage_progress', at: at('13:00:00'), sessionId: 's-bia', employeeId: 2, employeeName: 'Bia', stageKey: 'stage-1', stageName: 'Plaina', quantity: 2, stageTotal: 2 },
  ]
  const result = add(state, events, { type: 'start', at: at('11:00:00'), employee: ana, stageKey: 'stage-1' })
  assert.equal(result.event.type, 'started')
  assert.deepEqual([events[0].type, result.changed], ['resumed', [events[0]]], 'the former first start becomes a resumption')
  assert.equal(state.startedAt, at('11:00:00'))
  const pieces = add(state, events, { type: 'pieces', at: at('11:30:00'), employee: ana, stageKey: 'stage-1', quantity: 1 })
  assert.deepEqual([pieces.event.stageTotal, events[1].stageTotal, pieces.changed, state.stageCounts['stage-1']], [1, 3, [events[1]], 3])
  // Ana worked until 12:30, together with Bia from 12:00: the project time counts the period once and is still running.
  add(state, events, { type: 'pause', at: at('12:30:00'), employee: ana, reason: 'Descanso' })
  assert.deepEqual([state.accumulatedMs, state.activeSince, state.status, state.lastPauseReason], [0, at('11:00:00'), 'running', undefined])
  assert.equal(operationElapsed(state, Date.parse(at('14:00:00'))), 3 * hour)
})

test('API: lists for the form, records in the history and checks', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cut-bend'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const route = `/operations/orders/${order.code}`
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Aloisio', birthDate: '1990-01-01', cpf: '00000000001', email: 'aloisio@example.invalid', identification: '001' })).data.item
  const options = (await fixture.adminRequest(`${route}/manual-options`)).data
  assert.deepEqual(options.employees.map((item) => item.name), ['Aloisio'])
  assert.ok(options.pauseReasons.includes('Descanso'))
  assert.deepEqual([options.quantity, options.stages.map((stage) => [stage.name, stage.count])], [Number(order.quantity), [[options.stages[0].name, 0]]])
  const stageKey = options.stages[0].key
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  assert.equal((await fixture.request(`${route}/events`, 'POST', { type: 'start', at: '2026-10-01T11:00:00.000Z', employeeId: employee.id, stageKey }, operator)).status, 401, 'only administrators type operations in')
  assert.equal((await fixture.adminRequest(`${route}/events`, 'POST', { type: 'start', at: '2026-10-01T11:00:00.000Z', employeeId: 999, stageKey })).status, 400)
  assert.equal((await fixture.adminRequest(`${route}/events`, 'POST', { type: 'pause', at: '2026-10-01T12:00:00.000Z', employeeId: employee.id, reason: 'Inventado' })).data.message, 'Selecione o motivo da pausa.')
  const started = await fixture.adminRequest(`${route}/events`, 'POST', { type: 'start', at: '2026-10-01T11:00:00.000Z', employeeId: employee.id, stageKey })
  assert.equal(started.status, 201)
  assert.equal((await fixture.adminRequest(`${route}/events`, 'POST', { type: 'pieces', at: '2026-10-01T12:00:00.000Z', employeeId: employee.id, stageKey, quantity: 1 })).status, 201)
  const paused = await fixture.adminRequest(`${route}/events`, 'POST', { type: 'pause', at: '2026-10-01T13:00:00.000Z', employeeId: employee.id, reason: 'Descanso' })
  assert.equal(paused.status, 201)
  assert.deepEqual([paused.data.operation.status, paused.data.operation.accumulatedMs, paused.data.operation.stageCounts[stageKey]], ['paused', 2 * hour, 1])
  const history = (await fixture.adminRequest(`${route}/events`)).data.items.filter((event) => event.manual)
  assert.deepEqual(history.map((event) => [event.type, event.employeeName]), [['started', 'Aloisio'], ['stage_progress', 'Aloisio'], ['paused', 'Aloisio']])
  // The pieces typed in count as the ones registered on the operator screen.
  assert.equal((await fixture.adminRequest(`${route}/manual-options`)).data.stages[0].count, 1)
  // A manual record can have its time corrected like any other.
  assert.equal((await fixture.adminRequest(`${route}/events/${paused.data.item.id}/time`, 'PUT', { at: '2026-10-01T14:00:00.000Z' })).data.operation.accumulatedMs, 3 * hour)
})
