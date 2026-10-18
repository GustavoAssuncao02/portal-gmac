import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const options = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '' }
const database = `gmac_test_time_${randomUUID().replaceAll('-', '')}`
assert.match(database, /^gmac_test_time_[a-f0-9]{32}$/)
const admin = await mysql.createConnection(options)
const hour = 3600000
const parse = (value) => typeof value === 'string' ? JSON.parse(value) : value
let pool, fixture
try {
  await admin.query(`CREATE DATABASE \`${database}\``)
  pool = mysql.createPool({ ...options, database, multipleStatements: true })
  await pool.query(await readFile(new URL('../database/migrations/003_operator_workflow.sql', import.meta.url), 'utf8'))
  fixture = await createWorkflowFixture({ pool })
  const auth = { Authorization: `Bearer ${fixture.adminToken}` }
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  const request = (path, method, body) => fixture.request(path, method, body, auth)
  const employee = (await request('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001', birthDate: '1990-01-01', email: 'ana@example.invalid', identification: '001' })).data.item
  const offer = (await request('/offers', 'POST', offerDraft)).data.item
  await request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['painting'] })
  await request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offer.deadline } })
  const order = (await request(`/offers/${offer.id}/accept`, 'POST')).data.item
  const route = `/operations/orders/${order.code}`
  const started = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id }, operator)
  assert.equal(started.status, 200)
  assert.equal((await fixture.request(`${route}/pause`, 'POST', { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken, reason: 'Descanso' }, operator)).status, 200)
  // The employee started at 20:00 and only pressed "pause" at 23:42 (Bahia time).
  const [rows] = await pool.execute('SELECT id, data FROM order_operation_events WHERE order_code = ? ORDER BY seq', [order.code])
  const [start, pause] = rows.map((row) => parse(row.data))
  Object.assign(start, { at: '2026-10-01T23:00:00.000Z' })
  Object.assign(pause, { at: '2026-10-02T02:42:00.000Z', durationMs: 3.7 * hour })
  for (const event of [start, pause]) await pool.execute('UPDATE order_operation_events SET data = ?, occurred_at = ? WHERE id = ?', [JSON.stringify(event), new Date(event.at), event.id])
  const [[raw]] = await pool.execute('SELECT data FROM order_operations WHERE order_code = ?', [order.code])
  await pool.execute('UPDATE order_operations SET data = ? WHERE order_code = ?', [JSON.stringify({ ...parse(raw.data), startedAt: start.at, accumulatedMs: 3.7 * hour }), order.code])

  const rejected = await request(`${route}/events/${pause.id}/time`, 'PUT', { at: '2026-10-01T22:00:00.000Z' })
  assert.equal(rejected.status, 409, JSON.stringify(rejected.data))
  const [[untouched]] = await pool.execute('SELECT data FROM order_operation_events WHERE id = ?', [pause.id])
  assert.equal(parse(untouched.data).at, pause.at, 'a refused correction changes nothing')
  const edited = await request(`${route}/events/${pause.id}/time`, 'PUT', { at: '2026-10-02T01:00:00.000Z' })
  assert.equal(edited.status, 200, JSON.stringify(edited.data))
  assert.equal(edited.data.operation.accumulatedMs, 2 * hour)
  const [[stored]] = await pool.execute('SELECT data, occurred_at FROM order_operation_events WHERE id = ?', [pause.id])
  const saved = parse(stored.data)
  assert.equal(saved.at, '2026-10-02T01:00:00.000Z')
  assert.equal(saved.originalAt, pause.at)
  assert.equal(saved.durationMs, 2 * hour)
  assert.equal(saved.timeEdits.length, 1)
  assert.equal(new Date(stored.occurred_at).toISOString(), saved.at, 'the indexed date follows the corrected time')
  const [[state]] = await pool.execute('SELECT data FROM order_operations WHERE order_code = ?', [order.code])
  assert.equal(parse(state.data).accumulatedMs, 2 * hour)
  assert.deepEqual((await request(`${route}/events`)).data.items.map((event) => [event.type, event.at, event.originalAt]), [['started', start.at, undefined], ['paused', saved.at, pause.at]])
  // The activity filter by date uses the corrected time.
  const day = (await request(`/employees/${employee.id}/activities?period=date&date=2026-10-01`)).data.items
  assert.deepEqual(day.map((event) => event.type), ['paused', 'started'])
  assert.equal(day[0].originalAt, pause.at)
  console.log('Isolated MySQL operation time edition passed: validation without changes, event and indexed date updated, original time kept, session and project time recalculated, activity filter by the corrected date.')
} finally {
  await fixture?.close()
  await pool?.end()
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await admin.end()
}
