import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { hourReport, reportRange, workIntervals, localDate } from '../server/reportData.js'
import { activeSessions, operationElapsed } from '../server/operationSessions.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Teste' }

async function setup(fixture, stages = ['turning', 'painting'], quantity) {
  const admin = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data
  const headers = { Authorization: `Bearer ${admin.token}` }
  const machine = (await fixture.adminRequest('/machines', 'POST', { name: 'Torno', type: 'Torno', sector: 'Usinagem', hourlyRate: 100 }, headers)).data.item
  const service = (await fixture.adminRequest('/labor-services')).data.items[0]
  const employees = []
  for (const [index, name] of ['Ana', 'Bruno', 'Carla'].entries()) {
    employees.push((await fixture.adminRequest('/employees', 'POST', { name, birthDate: '1990-01-01', cpf: `0000000000${index + 1}`, email: `${name.toLowerCase()}@example.invalid`, identification: `00${index + 1}` }, fixture.admin)).data.item)
  }
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, ...(quantity ? { quantity } : {}) })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  return { headers, machine, service, employees, order, route: `/operations/orders/${order.code}`, auth: { Authorization: `Bearer ${fixture.operatorToken}` } }
}

test('several employees work on the same OS, each with a machine or a labor service, and stage records name who completed them', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const { machine, service, employees: [ana, bruno, carla], route, auth, headers } = await setup(fixture)
    const start = (employee, resources) => fixture.request(`${route}/start`, 'POST', { employeeId: employee.id, ...resources }, auth)

    const both = await start(ana, { machineId: machine.id, laborServiceId: service.id })
    assert.equal(both.status, 400)
    assert.match(both.data.message, /não os dois/)

    const first = await start(ana, { machineId: machine.id })
    assert.equal(first.status, 200)
    assert.equal(first.data.session.employeeId, ana.id)
    assert.equal(first.data.session.machineId, machine.id)
    assert.equal(first.data.session.laborServiceId, null)
    const anaCredentials = { sessionId: first.data.session.id, sessionToken: first.data.sessionToken }

    assert.equal((await start(ana, { laborServiceId: service.id })).status, 409, 'the same employee cannot have two sessions in one OS')
    const second = await start(bruno, { laborServiceId: service.id })
    assert.equal(second.status, 200)
    assert.equal(second.data.event.type, 'resumed')
    const brunoCredentials = { sessionId: second.data.session.id, sessionToken: second.data.sessionToken }
    assert.deepEqual(second.data.operation.activeSessions.map((session) => session.employeeName), ['Ana', 'Bruno'])
    assert.equal(second.data.operation.status, 'running')
    assert.ok(!JSON.stringify(second.data).includes('tokenHash'))

    const unnamed = await fixture.request(`${route}/stages/stage-1`, 'POST', { ...anaCredentials, quantity: 2 }, auth)
    assert.equal(unnamed.status, 409)
    assert.equal(unnamed.data.code, 'COMPLETED_BY_REQUIRED')
    assert.equal((await fixture.request(`${route}/stages/stage-1`, 'POST', { ...anaCredentials, quantity: 2, completedBySessionId: 'missing' }, auth)).status, 409)
    const credited = await fixture.request(`${route}/stages/stage-1`, 'POST', { ...anaCredentials, quantity: 2, completedBySessionId: brunoCredentials.sessionId }, auth)
    assert.equal(credited.status, 200)
    assert.equal(credited.data.event.employeeName, 'Bruno')
    assert.equal(credited.data.event.laborServiceId, service.id)
    assert.equal(credited.data.event.registeredByEmployeeName, 'Ana')
    const brunoHistory = (await fixture.adminRequest(`/employees/${bruno.id}/activities?period=all`)).data.items
    assert.ok(brunoHistory.some((event) => event.type === 'stage_progress' && event.quantity === 2))

    // Moving from a machine to a labor service (and back) keeps a single resource per session.
    assert.equal((await fixture.request(`${route}/resource`, 'POST', { ...anaCredentials, resourceType: 'machine', resourceId: machine.id }, auth)).status, 409)
    assert.equal((await fixture.request(`${route}/resource`, 'POST', { ...anaCredentials, resourceType: 'machine', resourceId: '' }, auth)).status, 400)
    assert.equal((await fixture.request(`${route}/resource`, 'POST', { ...brunoCredentials, sessionToken: 'foreign', resourceType: 'machine', resourceId: machine.id }, auth)).status, 403)
    const toService = await fixture.request(`${route}/resource`, 'POST', { ...anaCredentials, resourceType: 'labor-service', resourceId: service.id }, auth)
    assert.equal(toService.status, 200)
    assert.equal(toService.data.event.type, 'resource_changed')
    const ana1 = toService.data.operation.activeSessions.find((session) => session.id === anaCredentials.sessionId)
    assert.deepEqual([ana1.machineId, ana1.laborServiceId], [null, service.id])
    const toMachine = await fixture.request(`${route}/resource`, 'POST', { ...anaCredentials, resourceType: 'machine', resourceId: machine.id }, auth)
    const ana2 = toMachine.data.operation.activeSessions.find((session) => session.id === anaCredentials.sessionId)
    assert.deepEqual([ana2.machineId, ana2.laborServiceId], [machine.id, null])
    assert.equal(ana2.startedAt, first.data.session.startedAt)

    // Pausing one employee keeps the OS running for the others.
    const paused = await fixture.request(`${route}/pause`, 'POST', { ...brunoCredentials, reason: 'Descanso' }, auth)
    assert.equal(paused.status, 200)
    assert.equal(paused.data.operation.status, 'running')
    assert.deepEqual(paused.data.operation.activeSessions.map((session) => session.employeeName), ['Ana'])
    assert.equal(paused.data.operation.accumulatedMs, 0, 'project time keeps counting while someone is working')
    assert.equal((await fixture.request(`${route}/pause`, 'POST', { ...brunoCredentials, reason: 'Descanso' }, auth)).status, 403)

    // With a single employee the stage is credited to that employee without asking.
    const alone = await fixture.request(`${route}/stages/stage-1`, 'POST', { ...anaCredentials, quantity: 1 }, auth)
    assert.equal(alone.status, 200)
    assert.equal(alone.data.event.employeeName, 'Ana')

    // The administrator chooses whose session is closed when several are active.
    const third = await start(carla, { laborServiceId: service.id })
    assert.equal((await fixture.request(`${route}/interrupt`, 'POST', { reason: 'Teste' }, headers)).status, 400)
    const interrupted = await fixture.request(`${route}/interrupt`, 'POST', { reason: 'Teste', sessionId: third.data.session.id }, headers)
    assert.equal(interrupted.status, 200)
    assert.equal(interrupted.data.event.affectedEmployeeName, 'Carla')
    assert.deepEqual(interrupted.data.operation.activeSessions.map((session) => session.employeeName), ['Ana'])

    const last = await fixture.request(`${route}/pause`, 'POST', { ...anaCredentials, reason: 'Descanso' }, auth)
    assert.equal(last.data.operation.status, 'paused')
    assert.equal(last.data.operation.activeSession, null)
    assert.ok(last.data.operation.accumulatedMs >= 0)
    assert.equal(last.data.operation.activeSince, null)
  } finally { await fixture.close() }
})

test('completing the OS closes the sessions of every employee still working and keeps their hours', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const { machine, service, employees: [ana, bruno], route, auth, order } = await setup(fixture, ['turning'])
    const first = (await fixture.request(`${route}/start`, 'POST', { employeeId: ana.id, machineId: machine.id }, auth)).data
    const second = (await fixture.request(`${route}/start`, 'POST', { employeeId: bruno.id, laborServiceId: service.id }, auth)).data
    const anaCredentials = { sessionId: first.session.id, sessionToken: first.sessionToken }
    assert.equal((await fixture.request(`${route}/stages/stage-1`, 'POST', { ...anaCredentials, quantity: Number(order.quantity), completedBySessionId: first.session.id }, auth)).status, 200)
    const completed = await fixture.request(`${route}/complete`, 'POST', anaCredentials, auth)
    assert.equal(completed.status, 200)
    assert.equal(completed.data.operation.status, 'completed')
    assert.deepEqual(completed.data.operation.activeSessions, [])
    assert.deepEqual(completed.data.events.map((event) => [event.type, event.employeeName]), [['session_ended', 'Bruno'], ['completed', 'Ana']])
    const orders = (await fixture.mutateStore((store) => store.orders))
    const intervals = workIntervals(orders, Date.now() + 1000)
    assert.deepEqual(intervals.map((interval) => interval.employeeName).sort(), ['Ana', 'Bruno'])
    assert.ok(intervals.every((interval) => !interval.active))
    const notices = await fixture.mutateStore((store) => store.operationalNotifications || [])
    assert.equal(notices.filter((notice) => notice.type === 'service-completed').length, 1)
  } finally { await fixture.close() }
})

test('legacy single sessions are read as a list and project time counts simultaneous work once', () => {
  const legacy = { accumulatedMs: 1000, activeSession: { id: 'a', employeeName: 'Ana', startedAt: '2026-10-06T10:00:00Z' } }
  assert.deepEqual(activeSessions(legacy).map((session) => session.id), ['a'])
  assert.equal(operationElapsed(legacy, Date.parse('2026-10-06T10:00:10Z')), 11000)
  const together = { accumulatedMs: 0, activeSince: '2026-10-06T10:00:00Z', activeSessions: [{ id: 'a', startedAt: '2026-10-06T10:00:00Z' }, { id: 'b', startedAt: '2026-10-06T10:00:05Z' }] }
  assert.equal(operationElapsed(together, Date.parse('2026-10-06T10:00:10Z')), 10000)
  assert.equal(operationElapsed({ accumulatedMs: 5 }, Date.now()), 5)
})

test('switching between a machine and a labor service splits the hours between both resources', () => {
  const at = (hour) => `2026-10-02T${String(hour).padStart(2, '0')}:00:00-03:00`
  const events = [
    { type: 'started', at: at(8), sessionId: 's', employeeId: 1, employeeName: 'Ana', machineId: 'torno', machineName: 'Torno', laborServiceId: null },
    { type: 'resource_changed', at: at(10), sessionId: 's', employeeId: 1, machineId: 'torno', laborServiceId: null, nextMachineId: null, nextLaborServiceId: 'solda', nextLaborServiceName: 'Soldagem' },
    { type: 'paused', at: at(11), sessionId: 's', employeeId: 1 },
  ]
  const intervals = workIntervals([{ code: 'OS-1', operation: { activeSessions: [] }, operationEvents: events }], Date.parse(at(12)))
  const range = reportRange(localDate(Date.parse(at(8))), localDate(Date.parse(at(8))))
  assert.equal(hourReport(intervals, [{ id: 'torno', name: 'Torno' }], 'machineId', range).totalMs, 2 * 3600000)
  assert.equal(hourReport(intervals, [{ id: 'solda', name: 'Soldagem' }], 'laborServiceId', range).totalMs, 3600000)
  assert.equal(hourReport(intervals, [{ id: 1, name: 'Ana' }], 'employeeId', range).totalMs, 3 * 3600000)
})

test('an operator who identifies with their code on another device continues their own open work there', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const { machine, employees: [ana, bruno], route, auth, order } = await setup(fixture, ['turning'])
    const started = (await fixture.request(`${route}/start`, 'POST', { employeeId: ana.id, machineId: machine.id }, auth)).data
    // The tab that started the work was closed: its key is lost. A wrong key is still refused.
    assert.equal((await fixture.request(`${route}/stages/stage-1`, 'POST', { sessionId: started.session.id, sessionToken: 'perdida', quantity: 1 }, auth)).status, 403)
    const other = (await fixture.request('/operations/operator/identify', 'POST', { code: bruno.accessCode }, auth)).data
    assert.deepEqual(other.sessions, [], 'another operator receives nothing of Ana')
    const identified = (await fixture.request('/operations/operator/identify', 'POST', { code: ana.accessCode }, auth)).data
    assert.deepEqual(identified.sessions.map((row) => [row.orderCode, row.sessionId]), [[order.code, started.session.id]])
    const key = { sessionId: started.session.id, sessionToken: identified.sessions[0].sessionToken }
    assert.equal((await fixture.request(`${route}/stages/stage-1`, 'POST', { ...key, quantity: 1 }, auth)).status, 200)
    // The original device keeps working too, and no key is ever exposed.
    assert.equal((await fixture.request(`${route}/stages/stage-1`, 'POST', { sessionId: started.session.id, sessionToken: started.sessionToken, quantity: 1 }, auth)).status, 200)
    assert.ok(!JSON.stringify((await fixture.request('/operations/operator/orders', 'GET', undefined, auth)).data).includes('deviceTokenHashes'))
    const listed = (await fixture.request('/operations/operator/orders', 'GET', undefined, auth)).data.items.find((item) => item.code === order.code)
    assert.deepEqual(listed.operation.activeSessions[0].workedStages, ['stage-1'], 'the stage worked in this session is shown as in production')
  } finally { await fixture.close() }
})
