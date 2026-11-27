import assert from 'node:assert/strict'
import test from 'node:test'
import { addManualEvent, addManualPeriod } from '../server/operationManualEvents.js'
import { editEventTime } from '../server/operationEventTime.js'
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
  rejects(state, events, { type: 'start', at: at('11:00:00'), employee: ana, stageKey: 'stage-1' }, /^Error: Ana já tem um período em 01\/10 das 05:00:00 às 09:00:00 \(Plaina, lançado por Gilson\)\.$/)
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
  // A start is typed in with its pause: without the end or the reason nothing is saved.
  const period = { type: 'start', at: '2026-10-01T11:00:00.000Z', endAt: '2026-10-01T13:00:00.000Z', reason: 'Descanso', employeeId: employee.id, stageKey }
  assert.equal((await fixture.adminRequest(`${route}/events`, 'POST', { ...period, endAt: undefined })).data.message, 'Informe a data e a hora da pausa.')
  assert.equal((await fixture.adminRequest(`${route}/events`, 'POST', { ...period, reason: undefined })).data.message, 'Selecione o motivo da pausa.')
  assert.equal((await fixture.adminRequest(`${route}/events`)).data.items.filter((event) => event.manual).length, 0)
  const started = await fixture.adminRequest(`${route}/events`, 'POST', period)
  assert.equal(started.status, 201)
  assert.deepEqual(started.data.items.map((event) => event.type), ['started', 'paused'])
  assert.deepEqual([started.data.operation.status, started.data.operation.accumulatedMs], ['paused', 2 * hour])
  const paused = { data: { item: started.data.items[1] } }
  // Pieces go inside the closed period.
  const counted = await fixture.adminRequest(`${route}/events`, 'POST', { type: 'pieces', at: '2026-10-01T12:00:00.000Z', employeeId: employee.id, stageKey, quantity: 1 })
  assert.equal(counted.status, 201)
  assert.deepEqual([counted.data.operation.accumulatedMs, counted.data.operation.stageCounts[stageKey]], [2 * hour, 1])
  // A period touching it is refused naming the record, and nothing is saved.
  const overlap = await fixture.adminRequest(`${route}/events`, 'POST', { ...period, at: '2026-10-01T10:59:42.000Z', endAt: '2026-10-01T11:30:00.000Z' })
  assert.deepEqual([overlap.status, overlap.data.message], [409, `Aloisio já tem um período em 01/10 das 08:00:00 às 10:00:00 (${options.stages[0].name}, lançado por ${started.data.items[0].manual.adminName}).`])
  const history = (await fixture.adminRequest(`${route}/events`)).data.items.filter((event) => event.manual)
  assert.deepEqual(history.map((event) => [event.type, event.employeeName]), [['started', 'Aloisio'], ['stage_progress', 'Aloisio'], ['paused', 'Aloisio']])
  // The pieces typed in count as the ones registered on the operator screen.
  assert.equal((await fixture.adminRequest(`${route}/manual-options`)).data.stages[0].count, 1)
  // A manual record can have its time corrected like any other.
  assert.equal((await fixture.adminRequest(`${route}/events/${paused.data.item.id}/time`, 'PUT', { at: '2026-10-01T14:00:00.000Z' })).data.operation.accumulatedMs, 3 * hour)
})

// The start of 18/11 08:00:00 typed in without its pause, 18 s before a period already recorded for the same employee,
// locked his operations: a period of work is now typed in at once and compared with every period of the employee.
test('a period of work: start and pause together, refused when it touches another period of the employee', () => {
  const state = waiting(), events = []
  const period = (from, to, extra = {}) => ({ type: 'start', at: at(from), endAt: at(to), reason: 'Descanso', employee: ana, stageKey: 'stage-1', ...extra })
  const addPeriod = (input) => { const result = addManualPeriod(state, events, order, input, admin, now); events.push(...result.events); return result }
  const refuses = (input, pattern) => {
    const before = [structuredClone(state), structuredClone(events)]
    assert.throws(() => addManualPeriod(state, events, order, input, admin, now), pattern)
    assert.deepEqual([state, events], before, 'nothing changes when the period is refused')
  }
  const first = addPeriod(period('11:00:18', '19:45:02'))
  assert.deepEqual(first.events.map((event) => [event.type, event.sessionId === first.events[0].sessionId, event.reason ?? null]), [['started', true, null], ['paused', true, 'Descanso']])
  assert.deepEqual([state.status, state.accumulatedMs, state.stageTimeMs['stage-1'], state.lastPauseReason], ['paused', 8 * hour + 44 * 60000 + 44000, 8 * hour + 44 * 60000 + 44000, 'Descanso'])
  // The case of the locked OS: 18 s before the recorded period, the message names it.
  refuses(period('11:00:00', '20:00:00'), /^Error: Ana já tem um período em 01\/10 das 08:00:18 às 16:45:02 \(Plaina, lançado por Gilson\)\.$/)
  refuses(period('12:00:00', '13:00:00'), /já tem um período em 01\/10 das 08:00:18 às 16:45:02/)
  refuses(period('08:00:00', '11:00:18'), /já tem um período/, 'ending when the next one starts is refused, as the pause alone')
  refuses(period('09:00:00', '08:00:00'), /A pausa precisa ser posterior ao início/)
  refuses(period('09:00:00', '10:00:00', { reason: '' }), /Selecione o motivo da pausa/)
  refuses(period('09:00:00', '10:00:00', { endAt: undefined }), /Informe a data e a hora da pausa/)
  refuses(period('09:00:00', '10:00:00', { endAt: '2026-10-03T08:00:00.000Z' }), /futuro/)
  refuses(period('09:00:00', '10:00:00', { stageKey: 'outra' }), /Selecione uma etapa desta OS/)
  // Right before and right after are fine; the earlier one becomes the first start of the OS.
  addPeriod(period('08:00:00', '11:00:00'))
  assert.deepEqual([events[0].type, events.at(-2).type, state.startedAt], ['resumed', 'started', at('08:00:00')])
  addPeriod(period('19:45:02', '20:30:00'))
  assert.equal(state.accumulatedMs, 3 * hour + 8 * hour + 44 * 60000 + 44000 + 44 * 60000 + 58000)
  // Pieces are typed in afterwards, inside the period.
  add(state, events, { type: 'pieces', at: at('12:00:00'), employee: ana, stageKey: 'stage-1', quantity: 2 })
  assert.equal(state.stageCounts['stage-1'], 2)
  // Another employee in the same hours is independent.
  addPeriod(period('11:00:00', '12:00:00', { employee: bia }))
  // A start typed in before (still waiting for its pause) asks for that pause first.
  const legacy = waiting(), legacyEvents = []
  legacyEvents.push(addManualEvent(legacy, legacyEvents, order, { type: 'start', at: at('08:00:00'), employee: ana, stageKey: 'stage-1' }, admin, now).event)
  assert.throws(() => addManualPeriod(legacy, legacyEvents, order, period('12:00:00', '13:00:00'), admin, now), /Lance a pausa do início de .* de Ana antes de um novo período/)
})

test('a period of work is compared with the periods of the operator screen too', () => {
  // Bia worked in the portal from 08:00 to 10:00 and is working again since 12:00.
  const live = { id: 's-now', employeeId: 2, employeeName: 'Bia', startedAt: at('12:00:00'), stageKey: 'stage-1', stageName: 'Plaina', stageSince: at('12:00:00') }
  const state = { ...waiting(), status: 'running', startedAt: at('08:00:00'), activeSessions: [live], activeSince: at('12:00:00') }
  const events = [
    { id: 'e1', type: 'started', at: at('08:00:00'), sessionId: 's-old', employeeId: 2, employeeName: 'Bia', workStageKey: 'stage-1', workStageName: 'Plaina' },
    { id: 'e2', type: 'paused', at: at('10:00:00'), sessionId: 's-old', employeeId: 2, employeeName: 'Bia', reason: 'Descanso' },
    { id: 'e3', type: 'resumed', at: at('12:00:00'), sessionId: 's-now', employeeId: 2, employeeName: 'Bia', workStageKey: 'stage-2', workStageName: 'Pintura' },
  ]
  const period = (from, to) => ({ type: 'start', at: at(from), endAt: at(to), reason: 'Descanso', employee: bia, stageKey: 'stage-1' })
  assert.throws(() => addManualPeriod(state, events, order, period('09:00:00', '09:30:00'), admin, now), /^Error: Bia já tem um período em 01\/10 das 05:00:00 às 07:00:00 \(Plaina, registrado no tablet\)\.$/)
  assert.throws(() => addManualPeriod(state, events, order, period('11:00:00', '13:00:00'), admin, now), /^Error: Bia está trabalhando nesta OS desde 01\/10 às 09:00:00 \(Pintura, registrado no tablet\)\.$/)
  const result = addManualPeriod(state, events, order, period('10:00:00', '11:00:00'), admin, now)
  assert.deepEqual(result.events.map((event) => event.type), ['resumed', 'paused'])
  assert.equal(state.status, 'running', 'someone still working keeps the OS running')
})

test('a refusal keeps, for the system logs, the records it involved', () => {
  const live = { id: 's-now', employeeId: 2, employeeName: 'Bia', startedAt: at('12:00:00'), stageKey: 'stage-1', stageName: 'Plaina', stageSince: at('12:00:00') }
  const state = { ...waiting(), status: 'running', startedAt: at('08:00:00'), activeSessions: [live], activeSince: at('12:00:00') }
  const events = [
    { id: 'e1', type: 'started', at: at('08:00:00'), sessionId: 's-old', employeeId: 2, employeeName: 'Bia', workStageKey: 'stage-1', workStageName: 'Plaina' },
    { id: 'e2', type: 'paused', at: at('10:00:00'), sessionId: 's-old', employeeId: 2, employeeName: 'Bia', reason: 'Descanso' },
    { id: 'e3', type: 'resumed', at: at('12:00:00'), sessionId: 's-now', employeeId: 2, employeeName: 'Bia', workStageKey: 'stage-2', workStageName: 'Pintura', manual: { adminId: 7, adminName: 'Gilson', recordedAt: at('12:05:00') } },
  ]
  const caught = (run) => { try { run() } catch (error) { return error.logDetails } }
  const period = (from, to) => ({ type: 'start', at: at(from), endAt: at(to), reason: 'Descanso', employee: bia, stageKey: 'stage-1' })
  // The period it touched: ids, times, stage and where it came from.
  assert.deepEqual(caught(() => addManualPeriod(state, events, order, period('09:00:00', '09:30:00'), admin, now)), { conflito: {
    motivo: 'período sobreposto', tentativa: { tipo: 'period', inicio: at('09:00:00'), fim: at('09:30:00'), funcionarioId: 2, etapa: 'stage-1' },
    registro: { sessao: 's-old', evento: 'e1', inicio: at('08:00:00'), fim: at('10:00:00'), etapa: 'stage-1', origem: 'tablet', lancadoPor: null, lancadoEm: null },
  } })
  assert.deepEqual(caught(() => addManualPeriod(state, events, order, period('11:00:00', '13:00:00'), admin, now)).conflito.registro, { sessao: 's-now', evento: 'e3', inicio: at('12:00:00'), fim: 'em andamento', etapa: 'stage-2', origem: 'lançamento manual', lancadoPor: 'Gilson', lancadoEm: at('12:05:00') })
  // Pieces beyond the total of the OS: the counts.
  assert.deepEqual(caught(() => addManualEvent(state, events, order, { type: 'pieces', at: at('09:00:00'), employee: bia, stageKey: 'stage-1', quantity: 21 }, admin, now)).conflito, { motivo: 'passa do total da OS', tentativa: { tipo: 'pieces', em: at('09:00:00'), funcionarioId: 2, etapa: 'stage-1' }, quantidade: 21, pecasNaEtapa: 0, totalDaOS: 20 })
  // A time correction out of the sequence: the event and its neighbour.
  assert.deepEqual(caught(() => editEventTime(state, events, 'e2', at('07:00:00'), admin, now)).conflito, {
    motivo: 'antes da operação anterior', tentativa: { evento: 'e2', de: at('10:00:00'), para: at('07:00:00') },
    registro: { evento: 'e2', tipo: 'paused', em: at('10:00:00'), sessao: 's-old', etapa: null, lancadoPor: null },
    anterior: { evento: 'e1', tipo: 'started', em: at('08:00:00'), sessao: 's-old', etapa: 'stage-1', lancadoPor: null },
  })
  // Nothing of it reaches the message on the screen.
  assert.throws(() => addManualPeriod(state, events, order, period('09:00:00', '09:30:00'), admin, now), /^Error: Bia já tem um período em 01\/10 das 05:00:00 às 07:00:00 \(Plaina, registrado no tablet\)\.$/)
})
