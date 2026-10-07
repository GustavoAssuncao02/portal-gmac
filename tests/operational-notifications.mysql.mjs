import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const options = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '' }
const database = `gmac_test_notices_${randomUUID().replaceAll('-', '')}`
assert.match(database, /^gmac_test_notices_[a-f0-9]{32}$/)
const admin = await mysql.createConnection(options)
let pool, fixture
try {
  await admin.query(`CREATE DATABASE \`${database}\``)
  pool = mysql.createPool({ ...options, database, multipleStatements: true })
  const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8')
  await pool.query(schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS inventory_materials')))
  await pool.query(await readFile(new URL('../database/migrations/003_operator_workflow.sql', import.meta.url), 'utf8'))
  await pool.execute('INSERT INTO inventory_materials (name, quantity_kg, minimum_kg, unit_price) VALUES (?, ?, ?, ?)', ['Inox', 24, 5, 38.4])
  fixture = await createWorkflowFixture({ pool, notificationInventory: async () => (await pool.execute('SELECT id, name, quantity_kg AS quantity, minimum_kg AS minimum FROM inventory_materials'))[0] })
  const auth = { Authorization: `Bearer ${fixture.adminToken}` }
  const notices = async () => (await fixture.request('/notifications', 'GET', undefined, auth)).data.items
  assert.deepEqual(await notices(), [])
  const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'inox', inventoryId: 1, name: 'Inox', quantity: 25, stockAvailable: 24, purchaseQuantity: 1, stockStatus: 'partial' }], laborEntries: [], stages: ['painting'], kind: 'service' })
  await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offer.deadline, serviceValue: 100 } })
  const accepted = await fixture.request(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(accepted.status, 201)
  const order = accepted.data.item
  const created = await notices()
  assert.deepEqual(created.map((item) => item.type).sort(), ['low-stock', 'material-request', 'service-added'])
  assert.equal(created.find((item) => item.type === 'low-stock').quantity, 0)
  assert.equal(created.find((item) => item.type === 'material-request').quantity, 1)
  await fixture.request(`/offers/${offer.id}/accept`, 'POST')
  assert.equal((await notices()).length, 3)
  const employee = (await fixture.request('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001', birthDate: '1990-01-01', email: 'ana@example.invalid', identification: '001' })).data.item
  const operatorAuth = { Authorization: `Bearer ${fixture.operatorToken}` }
  const route = `/operations/orders/${order.code}`
  const pending = (await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id }, operatorAuth)).data.pendingMaterials
  const started = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id, pendingMaterialsConfirmation: pending.map((row) => [row.key, row.quantity]) }, operatorAuth)
  assert.equal(started.status, 200)
  const session = { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken }
  await fixture.request(`${route}/stages/${started.data.operation.stages[0].key}`, 'POST', { ...session, quantity: order.quantity }, operatorAuth)
  assert.equal((await fixture.request(`${route}/complete`, 'POST', session, operatorAuth)).status, 200)
  assert.equal((await notices()).length, 4)
  assert.equal((await notices()).find((item) => item.type === 'service-completed').employeeName, employee.name)
  await fixture.request(`${route}/complete`, 'POST', session, operatorAuth)
  assert.equal((await notices()).length, 4)
  console.log('Isolated MySQL notifications passed: OS acceptance, partial shortage, stock threshold, operator completion and duplicate protection.')
} finally {
  await fixture?.close()
  await pool?.end()
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await admin.end()
}
