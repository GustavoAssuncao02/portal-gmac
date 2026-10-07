import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { hourReport, reportRange, workIntervals } from '../server/reportData.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Teste' }
async function orderFor(fixture) {
  const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
  await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  return (await fixture.request(`/offers/${offer.id}/accept`, 'POST')).data.item
}

test('machine changes keep the private work session and progress, reject invalid/foreign/repeated changes, and remain usable for pause', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const admin = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data
    const headers = { Authorization: `Bearer ${admin.token}` }
    const machines = []
    for (const name of ['Torno', 'Fresa']) {
      const result = await fixture.request('/machines', 'POST', { name, type: name, sector: 'Usinagem', hourlyRate: 100 }, headers)
      assert.equal(result.status, 201)
      machines.push(result.data.item)
    }
    const employee = (await fixture.request('/employees', 'POST', { name: 'Ana', birthDate: '1990-01-01', cpf: '00000000001', email: 'ana@example.invalid', identification: '001' })).data.item
    const order = await orderFor(fixture)
    const auth = { Authorization: `Bearer ${fixture.operatorToken}` }
    const route = `/operations/orders/${order.code}`
    const started = (await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id, machineId: machines[0].id }, auth)).data
    const credentials = { sessionId: started.operation.activeSession.id, sessionToken: started.sessionToken }
    await fixture.request(`${route}/stages/stage-1`, 'POST', { ...credentials, quantity: 2 }, auth)
    assert.equal((await fixture.request(`${route}/machine`, 'POST', { ...credentials, machineId: machines[1].id })).status, 401)
    assert.equal((await fixture.request(`${route}/machine`, 'POST', { ...credentials, sessionToken: 'foreign', machineId: machines[1].id }, auth)).status, 403)
    assert.equal((await fixture.request(`${route}/machine`, 'POST', { ...credentials, machineId: 'missing' }, auth)).status, 400)
    assert.equal((await fixture.request(`${route}/machine`, 'POST', credentials, auth)).status, 400)
    assert.equal((await fixture.request(`${route}/machine`, 'POST', { ...credentials, machineId: machines[0].id }, auth)).status, 409)
    const changed = await fixture.request(`${route}/machine`, 'POST', { ...credentials, machineId: machines[1].id }, auth)
    assert.equal(changed.status, 200)
    assert.equal(changed.data.operation.activeSession.id, credentials.sessionId)
    assert.equal(changed.data.operation.activeSession.startedAt, started.operation.activeSession.startedAt)
    assert.equal(changed.data.operation.activeSession.employeeId, employee.id)
    assert.equal(changed.data.operation.activeSession.machineId, machines[1].id)
    assert.equal(changed.data.operation.accumulatedMs, 0)
    assert.equal(changed.data.operation.status, 'running')
    assert.equal(changed.data.operation.stageCounts['stage-1'], 2)
    assert.equal(changed.data.event.machineId, machines[0].id)
    assert.equal(changed.data.event.nextMachineId, machines[1].id)
    assert.ok(!JSON.stringify(changed.data).includes('tokenHash'))
    assert.equal((await fixture.request(`${route}/machine`, 'POST', { ...credentials, machineId: machines[1].id }, auth)).status, 409)
    assert.equal((await fixture.request(`${route}/machine`, 'POST', { ...credentials, machineId: null }, auth)).status, 200)
    assert.equal((await fixture.request(`${route}/machine`, 'POST', { ...credentials, machineId: machines[0].id }, auth)).status, 200)
    const events = (await fixture.request(`${route}/events`)).data.items
    assert.equal(events.filter((event) => event.type === 'machine_changed').length, 3)
    const history = (await fixture.request(`/employees/${employee.id}/activities?period=all`)).data.items
    assert.equal(history.filter((event) => event.type === 'machine_changed').length, 3)
    assert.equal((await fixture.request(`${route}/pause`, 'POST', { ...credentials, reason: 'Descanso' }, auth)).status, 200)
    assert.equal((await fixture.request(`${route}/machine`, 'POST', { ...credentials, machineId: machines[1].id }, auth)).status, 409)
  } finally { await fixture.close() }
})

test('machine reports divide repeated changes/manual work without duplicating employee time, including active, paused and completed sessions', () => {
  const at = (hour) => `2026-10-03T${String(hour).padStart(2, '0')}:00:00-03:00`
  const events = [
    { type: 'started', at: at(8), sessionId: 's', employeeId: 1, employeeName: 'Ana', machineId: 'a', machineName: 'Torno' },
    { type: 'machine_changed', at: at(9), sessionId: 's', employeeId: 1, machineId: 'a', machineName: 'Torno', nextMachineId: 'b', nextMachineName: 'Fresa' },
    { type: 'machine_changed', at: at(10), sessionId: 's', employeeId: 1, machineId: 'b', nextMachineId: null, nextMachineName: null },
    { type: 'machine_changed', at: at(11), sessionId: 's', employeeId: 1, machineId: null, nextMachineId: 'a', nextMachineName: 'Torno' },
  ]
  const order = { code: 'OS-1', operationEvents: events, operation: { activeSession: { id: 's', employeeId: 1, employeeName: 'Ana', machineId: 'a', machineName: 'Torno', startedAt: at(8), machineStartedAt: at(11) } } }
  const check = (intervals) => {
    const range = reportRange('2026-10-03', '2026-10-03')
    const machines = hourReport(intervals, [{ id: 'a', name: 'Torno' }, { id: 'b', name: 'Fresa' }], 'machineId', range)
    assert.equal(machines.totalMs, 3 * 3600000)
    assert.equal(machines.unidentifiedMs, 3600000)
    assert.deepEqual(machines.totals.map((row) => [row.id, row.ms]).sort(), [['a', 7200000], ['b', 3600000]])
    assert.equal(hourReport(intervals, [{ id: 1, name: 'Ana' }], 'employeeId', range).totalMs, 4 * 3600000)
    assert.equal(hourReport(intervals, [{ id: 'b', name: 'Fresa' }], 'machineId', range, ['b']).totalMs, 3600000)
  }
  check(workIntervals([order], Date.parse(at(12))))
  for (const type of ['paused', 'completed', 'admin_interrupted']) {
    check(workIntervals([{ ...order, operation: { activeSession: null }, operationEvents: [...events, { type, at: at(12), sessionId: 's', employeeId: 1, machineId: 'a', durationMs: 4 * 3600000 }] }], Date.parse(at(13))))
  }
})

test('MySQL machine change locks and commits the session and audit event together; foreign sessions roll back', async () => {
  let state = { status: 'running', stages: [{ key: 'stage-1', name: 'Tornearia' }], stageCounts: { 'stage-1': 2 }, accumulatedMs: 10, activeSession: { id: 'session', tokenHash: createHash('sha256').update('private-token').digest('hex'), employeeId: 1, employeeName: 'Ana', startedAt: '2026-10-03T10:00:00Z', machineId: 'old', machineName: 'Torno' } }
  const events = []
  const calls = []
  let snapshot
  const connection = {
    async beginTransaction() { snapshot = structuredClone(state); calls.push('begin') },
    async execute(sql, params) {
      calls.push(sql)
      if (sql.startsWith('SELECT data')) return [[{ data: JSON.stringify(state) }]]
      if (sql.startsWith('UPDATE order_operations')) state = JSON.parse(params[0])
      if (sql.startsWith('INSERT INTO order_operation_events')) events.push(JSON.parse(params[2]))
      return [{}]
    },
    async commit() { calls.push('commit') },
    async rollback() { state = snapshot; calls.push('rollback') },
    release() { calls.push('release') },
  }
  const fixture = await createWorkflowFixture({ pool: { async getConnection() { return connection } } })
  try {
    await fixture.mutateStore((store) => {
      store.orders = [{ code: 'OS-DB', quantity: 10, service: 'Teste', resources: {}, proposal: {} }]
      store.machines = [{ id: 'new', name: 'Fresa' }]
    })
    const headers = { Authorization: `Bearer ${fixture.operatorToken}` }
    const body = { sessionId: 'session', sessionToken: 'private-token', machineId: 'new' }
    const result = await fixture.request('/operations/orders/OS-DB/machine', 'POST', body, headers)
    assert.equal(result.status, 200)
    // The former single session is migrated to the list of simultaneous sessions.
    assert.equal(state.activeSession, undefined)
    assert.equal(state.activeSessions.length, 1)
    assert.equal(state.activeSessions[0].machineId, 'new')
    assert.equal(state.activeSessions[0].tokenHash, createHash('sha256').update('private-token').digest('hex'))
    assert.equal(state.accumulatedMs, 10)
    assert.equal(events.length, 1)
    assert.equal(events[0].nextMachineId, 'new')
    assert.ok(calls.some((sql) => sql.endsWith('FOR UPDATE')))
    assert.deepEqual(calls.slice(-2), ['commit', 'release'])
    const saved = structuredClone(state)
    const rejected = await fixture.request('/operations/orders/OS-DB/machine', 'POST', { ...body, sessionToken: 'foreign', machineId: null }, headers)
    assert.equal(rejected.status, 403)
    assert.deepEqual(state, saved)
    assert.equal(events.length, 1)
    assert.deepEqual(calls.slice(-2), ['rollback', 'release'])
  } finally { await fixture.close() }
})
