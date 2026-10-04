import test from 'node:test'
import assert from 'node:assert/strict'
import { machineUsageHistory } from '../server/machines.js'
import { createWorkflowFixture } from './workflowFixture.js'

const at = (hour) => `2026-10-03T${String(hour).padStart(2, '0')}:00:00-03:00`
const historyOrders = () => [{ code: 'OS-1', service: 'Conjunto mecanico', operation: { activeSession: null }, operationEvents: [
  { type: 'started', sessionId: 'a', employeeId: 1, employeeName: 'Ana', machineId: 'torno', at: at(8) },
  { type: 'machine_changed', sessionId: 'a', employeeId: 1, employeeName: 'Ana', machineId: 'torno', nextMachineId: 'fresa', at: at(9) },
  { type: 'paused', sessionId: 'a', employeeId: 1, employeeName: 'Ana', machineId: 'fresa', reason: 'Descanso', at: at(10) },
] }, { code: 'OS-2', operation: { activeSession: { id: 'b', employeeId: 2, employeeName: 'Bruno', machineId: 'torno', startedAt: at(11), tokenHash: 'secret' } }, operationEvents: [{ type: 'started', sessionId: 'b', employeeId: 2, employeeName: 'Bruno', machineId: 'torno', at: at(11) }] }, { code: 'OS-3', operationEvents: [{ type: 'admin_interrupted', sessionId: 'legacy', employeeId: null, employeeName: 'Administrador', affectedEmployeeName: 'Carla', machineId: 'torno', durationMs: 600000, reason: 'Manutencao', at: at(7) }] }]

test('machine usage history identifies operators, separate machine segments, active use and legacy interruptions without exposing credentials', () => {
  const orders = historyOrders()
  const now = Date.parse(at(12))
  const rows = machineUsageHistory('torno', orders, null, now)
  assert.deepEqual(rows.map((row) => row.employeeName), ['Bruno', 'Ana', 'Carla'])
  assert.equal(rows[0].active, true)
  assert.equal(rows[0].endedAt, null)
  assert.equal(rows[0].durationMs, 3600000)
  assert.equal(rows[1].endedBy, 'machine_changed')
  assert.equal(rows[1].durationMs, 3600000)
  assert.equal(rows[2].reason, 'Manutencao')
  assert.equal(rows[2].durationMs, 600000)
  assert.ok(!JSON.stringify(rows).includes('secret'))
  const other = machineUsageHistory('fresa', orders, null, now)
  assert.equal(other.length, 1)
  assert.equal(other[0].employeeName, 'Ana')
  assert.equal(other[0].reason, 'Descanso')
  const range = { start: Date.parse('2026-10-03T08:30:00-03:00'), end: Date.parse('2026-10-03T11:30:00-03:00') }
  const filtered = machineUsageHistory('torno', orders, range, now)
  assert.deepEqual(filtered.map((row) => row.durationMs), [1800000, 1800000])
  assert.equal(filtered[1].startedAt, new Date(at(8)).toISOString())
  assert.equal(machineUsageHistory('unused', orders, null, now).length, 0)
})

test('machine history API is authenticated, machine-specific, date-filtered and rejects invalid filters', async (t) => {
  const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123' } })
  t.after(() => fixture.close())
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno' }, { id: 'fresa', name: 'Fresa' }]; store.orders = historyOrders() })
  assert.equal((await fixture.request('/machines/torno/history')).status, 401)
  const login = await fixture.request('/auth/login', 'POST', { cpf: '12345678901', password: 'teste123' })
  const headers = { Authorization: `Bearer ${login.data.token}` }
  const get = (route) => fixture.request(route, 'GET', undefined, headers)
  assert.equal((await get('/machines/missing/history')).status, 404)
  assert.equal((await get('/machines/torno/history?period=bad')).status, 400)
  assert.equal((await get('/machines/torno/history?period=date&date=2026-02-30')).status, 400)
  const all = await get('/machines/torno/history')
  assert.equal(all.status, 200)
  assert.equal(all.data.items.length, 3)
  assert.equal((await get('/machines/fresa/history')).data.items[0].employeeName, 'Ana')
  assert.equal((await get('/machines/torno/history?period=date&date=2026-10-02')).data.items.length, 0)
})
