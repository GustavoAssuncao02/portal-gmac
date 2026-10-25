import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { defaultStageLayout } from '../server/serviceStages.js'
import { operationVersion } from '../server/orderEditing.js'

const options = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '' }
const database = `gmac_test_os_${randomUUID().replaceAll('-', '')}`
assert.match(database, /^gmac_test_os_[a-f0-9]{32}$/)
const admin = await mysql.createConnection(options)
let pool, fixture
try {
  await admin.query(`CREATE DATABASE \`${database}\``)
  pool = mysql.createPool({ ...options, database, multipleStatements: true })
  // Accounts receivable need the administrators table, as in the portal.
  const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8')
  await pool.query(schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS users'), schema.indexOf('CREATE TABLE IF NOT EXISTS inventory_materials')))
  await pool.query(await readFile(new URL('../database/migrations/003_operator_workflow.sql', import.meta.url), 'utf8'))
  const [inserted] = await pool.execute("INSERT INTO users (name, birth_date, cpf, email, password_hash, role) VALUES ('Gestor Teste', '1980-01-01', '11122233344', 'gestor@example.invalid', 'x', 'admin')")
  fixture = await createWorkflowFixture({ pool })
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['turning', 'painting'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste SQL', deadline: '2026-12-20', serviceValue: 300, materials: 0, labor: 0, margin: 15, discount: 0 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const operation = { status: 'completed', stages: [{ key: 'stage-1', name: 'Tornearia' }, { key: 'stage-2', name: 'Pintura' }], stageCounts: { 'stage-1': 10, 'stage-2': 10 }, activeSession: null, accumulatedMs: 60000, startedAt: '2026-10-03T10:00:00Z', completedAt: '2026-10-03T10:01:00Z', completionAcknowledgedAt: '2026-10-03T10:02:00Z' }
  await pool.execute('INSERT INTO order_operations (order_code, data) VALUES (?, ?)', [order.code, JSON.stringify(operation)])
  const draft = { order: { ...order, service: 'OS SQL revisada', quantity: 12, attachmentIds: [], resources: { ...order.resources, stageLayout: defaultStageLayout(), strictProcess: true } }, expectedUpdatedAt: order.createdAt, expectedOperation: operationVersion(operation), stageCounts: { turning: 10, painting: 10 }, confirmCompleted: true }
  const headers = { Authorization: `Bearer ${fixture.adminToken}` }
  const updated = await fixture.request(`/operations/orders/${order.code}`, 'PUT', draft, headers)
  assert.equal(updated.status, 200, JSON.stringify(updated.data))
  assert.equal((await fixture.request('/orders', 'GET', undefined, fixture.admin)).data.items[0].quantity, 12)
  const reopened = await fixture.request(`/operations/orders/${order.code}/reopen`, 'POST', {}, headers)
  assert.equal(reopened.status, 200, JSON.stringify(reopened.data))
  const [[state]] = await pool.execute('SELECT data FROM order_operations WHERE order_code = ?', [order.code])
  const stored = typeof state.data === 'string' ? JSON.parse(state.data) : state.data
  assert.equal(stored.status, 'paused')
  assert.equal(stored.accumulatedMs, 60000)
  assert.equal(stored.completionAcknowledgedAt, null)
  assert.deepEqual(stored.stageCounts, { 'stage-1': 10, 'stage-2': 10 })
  assert.deepEqual((await fixture.adminRequest(`/operations/orders/${order.code}/events`)).data.items.map((event) => event.type), ['order_edited', 'order_reopened'])
  assert.equal((await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items[0].service, 'OS SQL revisada')
  // Finished again, with an account receivable: reopening can take it along, in the same transaction as the operation.
  await pool.execute('UPDATE order_operations SET data = ? WHERE order_code = ?', [JSON.stringify({ ...stored, status: 'completed', completedAt: '2026-10-04T10:00:00Z', completionAcknowledgedAt: '2026-10-04T10:01:00Z' }), order.code])
  const { issueAdminToken } = await import(pathToFileURL(path.join(fixture.directory, 'accounts.js')).href)
  const manager = { Authorization: `Bearer ${await issueAdminToken({ id: inserted.insertId, name: 'Gestor Teste' })}` }
  const account = await fixture.request('/receivables', 'POST', { orderCode: order.code, value: '300', dueDate: '2099-01-10' }, manager)
  assert.equal(account.status, 201, JSON.stringify(account.data))
  const blocked = await fixture.request(`/operations/orders/${order.code}/reopen`, 'POST', { receivables: 'maybe' }, manager)
  assert.equal(blocked.status, 400)
  const deleted = await fixture.request(`/operations/orders/${order.code}/reopen`, 'POST', { receivables: 'delete' }, manager)
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data))
  assert.deepEqual(deleted.data.event.removedReceivables, [account.data.item.id])
  assert.deepEqual((await fixture.request(`/receivables/order/${order.code}`, 'GET', undefined, manager)).data.items, [])
  const [[after]] = await pool.execute('SELECT data FROM order_operations WHERE order_code = ?', [order.code])
  assert.equal((typeof after.data === 'string' ? JSON.parse(after.data) : after.data).status, 'paused')
  console.log('MySQL edit/reopen passed in isolated database; production data untouched.')
} finally {
  await fixture?.close()
  await pool?.end()
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await admin.end()
}
