import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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
  await pool.query(await readFile(new URL('../database/migrations/003_operator_workflow.sql', import.meta.url), 'utf8'))
  fixture = await createWorkflowFixture({ pool })
  const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['turning', 'painting'], kind: 'service' })
  await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste SQL', deadline: '2026-12-20', serviceValue: 300, materials: 0, labor: 0, margin: 15, discount: 0 } })
  const order = (await fixture.request(`/offers/${offer.id}/accept`, 'POST')).data.item
  const operation = { status: 'completed', stages: [{ key: 'stage-1', name: 'Tornearia' }, { key: 'stage-2', name: 'Pintura' }], stageCounts: { 'stage-1': 10, 'stage-2': 10 }, activeSession: null, accumulatedMs: 60000, startedAt: '2026-10-03T10:00:00Z', completedAt: '2026-10-03T10:01:00Z', completionAcknowledgedAt: '2026-10-03T10:02:00Z' }
  await pool.execute('INSERT INTO order_operations (order_code, data) VALUES (?, ?)', [order.code, JSON.stringify(operation)])
  const draft = { order: { ...order, service: 'OS SQL revisada', quantity: 12, attachmentIds: [], resources: { ...order.resources, stageLayout: defaultStageLayout(), strictProcess: true } }, expectedUpdatedAt: order.createdAt, expectedOperation: operationVersion(operation), stageCounts: { turning: 10, painting: 10 }, confirmCompleted: true }
  const headers = { Authorization: `Bearer ${fixture.adminToken}` }
  const updated = await fixture.request(`/operations/orders/${order.code}`, 'PUT', draft, headers)
  assert.equal(updated.status, 200, JSON.stringify(updated.data))
  assert.equal((await fixture.request('/orders')).data.items[0].quantity, 12)
  const reopened = await fixture.request(`/operations/orders/${order.code}/reopen`, 'POST', {}, headers)
  assert.equal(reopened.status, 200, JSON.stringify(reopened.data))
  const [[state]] = await pool.execute('SELECT data FROM order_operations WHERE order_code = ?', [order.code])
  const stored = typeof state.data === 'string' ? JSON.parse(state.data) : state.data
  assert.equal(stored.status, 'paused')
  assert.equal(stored.accumulatedMs, 60000)
  assert.equal(stored.completionAcknowledgedAt, null)
  assert.deepEqual(stored.stageCounts, { 'stage-1': 10, 'stage-2': 10 })
  assert.deepEqual((await fixture.request(`/operations/orders/${order.code}/events`)).data.items.map((event) => event.type), ['order_edited', 'order_reopened'])
  assert.equal((await fixture.request('/offers')).data.items[0].service, 'OS SQL revisada')
  console.log('MySQL edit/reopen passed in isolated database; production data untouched.')
} finally {
  await fixture?.close()
  await pool?.end()
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await admin.end()
}
