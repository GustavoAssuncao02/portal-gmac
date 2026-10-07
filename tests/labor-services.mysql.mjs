import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { localDate } from '../server/reportData.js'

const options = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '' }
const database = `gmac_test_services_${randomUUID().replaceAll('-', '')}`
assert.match(database, /^gmac_test_services_[a-f0-9]{32}$/)
const admin = await mysql.createConnection(options)
let pool, fixture
try {
  await admin.query(`CREATE DATABASE \`${database}\``)
  pool = mysql.createPool({ ...options, database, multipleStatements: true })
  await pool.query(await readFile(new URL('../database/migrations/003_operator_workflow.sql', import.meta.url), 'utf8'))
  fixture = await createWorkflowFixture({ pool })
  const auth = { Authorization: `Bearer ${fixture.adminToken}` }
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  const request = (path, method, body) => fixture.request(path, method, body, auth)
  const [first, second] = (await request('/labor-services')).data.items
  const employee = (await request('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001', birthDate: '1990-01-01', email: 'ana@example.invalid', identification: '001' })).data.item
  const offer = (await request('/offers', 'POST', offerDraft)).data.item
  await request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['painting'] })
  await request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offer.deadline } })
  const order = (await request(`/offers/${offer.id}/accept`, 'POST')).data.item
  const route = `/operations/orders/${order.code}`
  const started = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id, laborServiceId: first.id }, operator)
  assert.equal(started.status, 200)
  assert.equal((await request(`/labor-services/${first.id}`, 'DELETE')).status, 409, 'SQL sessions also prevent deleting an active service')
  const session = { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken }
  const changed = await fixture.request(`${route}/labor-service`, 'POST', { ...session, laborServiceId: second.id }, operator)
  assert.equal(changed.status, 200)
  const [[raw]] = await pool.execute('SELECT data FROM order_operations WHERE order_code=?', [order.code])
  const state = typeof raw.data === 'string' ? JSON.parse(raw.data) : raw.data
  assert.equal(state.activeSessions[0].laborServiceId, second.id)
  assert.equal(state.activeSessions[0].id, session.sessionId)
  assert.equal((await request(`/labor-services/${first.id}/history`)).data.items[0].employeeName, employee.name)
  assert.equal((await fixture.request(`${route}/pause`, 'POST', { ...session, reason: 'Descanso' }, operator)).status, 200)
  const report = await request('/reports/generate', 'POST', { kind: 'service-hours', start: localDate(Date.now()), end: localDate(Date.now()), ids: [first.id, second.id] })
  assert.equal(report.status, 200)
  assert.equal(report.data.sections[3].rows.length, 2)
  assert.equal((await request(`/labor-services/${first.id}`, 'DELETE')).status, 200)
  console.log('Isolated MySQL services passed: operator selection/change, persistent session and audit, actual usage history, reports and active deletion protection.')
} finally {
  await fixture?.close()
  await pool?.end()
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await admin.end()
}
