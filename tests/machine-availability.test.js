import test from 'node:test'
import assert from 'node:assert/strict'
import { machineAvailability } from '../server/machines.js'
import { ordersWithOperations } from '../server/reportData.js'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

test('machine availability follows real sessions, Bahia midnight and machine changes without counting pauses or overlapping use twice', () => {
  const machines = [{ id: 1, name: 'Torno', status: 'idle' }, { id: 2, name: 'Fresa', status: 'working', operator: 'Outdated' }]
  const orders = [{ code: 'OS-1', operation: { activeSession: { id: 'a', machineId: 2, employeeName: 'Ana', startedAt: '2026-10-02T23:00:00-03:00', machineStartedAt: '2026-10-03T01:00:00-03:00' } }, operationEvents: [
    { type: 'started', sessionId: 'a', machineId: 1, at: '2026-10-02T23:00:00-03:00' },
    { type: 'machine_changed', sessionId: 'a', machineId: 1, nextMachineId: 2, at: '2026-10-03T01:00:00-03:00' },
  ] }, { code: 'OS-2', operationEvents: [
    { type: 'started', sessionId: 'b', machineId: 2, at: '2026-10-03T00:30:00-03:00' },
    { type: 'paused', sessionId: 'b', machineId: 2, at: '2026-10-03T01:30:00-03:00' },
  ] }]
  const result = machineAvailability(machines, orders, Date.parse('2026-10-03T02:00:00-03:00'))
  assert.equal(result[0].status, 'idle')
  assert.equal(result[0].operator, '\u2014')
  assert.equal(result[0].started, '\u2014')
  assert.equal(result[0].usage, '1h 00min')
  assert.equal(result[1].status, 'working')
  assert.equal(result[1].operator, 'Ana')
  assert.equal(result[1].started, '01:00')
  assert.equal(result[1].usage, '1h 30min')
  assert.equal(result[0].usageMs, 3600000, 'Torno stopped but keeps the hour it was used today')
  assert.equal(result[0].idle, '1h 00min', 'Two hours since Bahia midnight minus one hour of use')
  assert.equal(result[1].idle, '0h 30min')
  assert.equal(machineAvailability([{ id: 3, name: 'Prensa' }], [], Date.parse('2026-10-09T10:38:00-03:00'))[0].idle, '10h 38min', 'An unused machine is idle since midnight')
  assert.equal(machines[1].operator, 'Outdated')
})

test('shared SQL operation state replaces stale JSON operation data and parses MySQL JSON representations', async () => {
  const state = { activeSession: { id: 'session', machineId: 1 } }
  const event = { type: 'started', sessionId: 'session' }
  const pool = { async execute(sql) { return sql.includes('order_operation_events') ? [[{ order_code: 'OS-1', data: event }]] : [[{ order_code: 'OS-1', data: JSON.stringify(state) }]] } }
  const orders = [{ code: 'OS-1', operation: { status: 'paused' } }, { code: 'OS-2' }]
  const result = await ordersWithOperations(orders, pool)
  assert.deepEqual(result[0].operation, state)
  assert.deepEqual(result[0].operationEvents, [event])
  assert.equal(result[1].operation, undefined)
  assert.equal(orders[0].operation.status, 'paused')
  assert.equal(await ordersWithOperations(orders), orders)
})

test('machine API updates status on start, change and pause without altering its registry', async (t) => {
  const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123' } })
  t.after(() => fixture.close())
  const login = await fixture.request('/auth/login', 'POST', { cpf: '12345678901', password: 'teste123' })
  const headers = { Authorization: `Bearer ${login.data.token}` }
  const machine = (await fixture.adminRequest('/machines', 'POST', { name: 'Torno', type: 'Torno', hourlyRate: 50 }, headers)).data.item
  const second = (await fixture.adminRequest('/machines', 'POST', { name: 'Fresa', type: 'Fresa', hourlyRate: 50 }, headers)).data.item
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana', birthDate: '1990-01-01', cpf: '00000000001', email: 'ana@test.invalid', identification: '001' }, fixture.admin)).data.item
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['turning'], kind: 'service' })).status, 200)
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: '2026-12-20', serviceValue: 100 } })).status, 200)
  const accepted = await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data))
  const order = accepted.data.item
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  const started = (await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: employee.id, machineId: machine.id }, operator)).data
  const session = { sessionId: started.operation.activeSession.id, sessionToken: started.sessionToken }
  let items = (await fixture.adminRequest('/machines')).data.items
  assert.equal(items.find((row) => row.id === machine.id).status, 'working')
  assert.equal(items.find((row) => row.id === machine.id).operator, 'Ana')
  assert.equal((await fixture.request(`/operations/orders/${order.code}/machine`, 'POST', { ...session, machineId: second.id }, operator)).status, 200)
  items = (await fixture.adminRequest('/machines')).data.items
  assert.equal(items.find((row) => row.id === machine.id).status, 'idle')
  assert.equal(items.find((row) => row.id === second.id).status, 'working')
  assert.equal((await fixture.request(`/operations/orders/${order.code}/pause`, 'POST', { ...session, reason: 'Descanso' }, operator)).status, 200)
  items = (await fixture.adminRequest('/machines')).data.items
  assert.ok(items.every((row) => row.status === 'idle' && row.operator === '\u2014'))
})
