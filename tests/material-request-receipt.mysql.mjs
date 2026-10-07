import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'
import { offerDraft } from './workflowFixture.js'

const options = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '' }
const database = `gmac_test_receipt_${randomUUID().replaceAll('-', '')}`
assert.match(database, /^gmac_test_receipt_[a-f0-9]{32}$/)
const directory = await mkdtemp(path.resolve('test-results/receipt-api-'))
assert.ok(directory.startsWith(path.resolve('test-results') + path.sep))
const admin = await mysql.createConnection(options)
let pool, child, logs = ''
try {
  await admin.query(`CREATE DATABASE \`${database}\``)
  pool = mysql.createPool({ ...options, database, multipleStatements: true })
  const schema = await readFile('database/schema.sql', 'utf8')
  await pool.query(schema.slice(schema.indexOf('CREATE TABLE')))
  await pool.execute('INSERT INTO users (name,birth_date,cpf,email,password_hash,role) VALUES (?,?,?,?,?,?)', ['Teste', '1990-01-01', '12345678901', 'teste@example.invalid', await bcrypt.hash('teste123', 4), 'admin'])
  for (const file of await readdir('server')) if (file.endsWith('.js')) await copyFile(path.join('server', file), path.join(directory, file))
  const listener = net.createServer().listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const port = listener.address().port
  await new Promise((resolve) => listener.close(resolve))
  const url = `http://127.0.0.1:${port}/api`
  child = spawn(process.execPath, [path.join(directory, 'index.js')], { windowsHide: true, env: { ...process.env, DB_NAME: database, API_HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => { logs += chunk })
  child.stderr.on('data', (chunk) => { logs += chunk })
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(`${url}/health`)).ok } catch {}
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(ready, logs)
  let token
  async function request(route, body) {
    const response = await fetch(`${url}${route}`, { method: body == null ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body == null ? undefined : JSON.stringify(body) })
    return { status: response.status, data: await response.json() }
  }
  token = (await request('/auth/login', { cpf: '12345678901', password: 'teste123' })).data.token
  assert.ok(token)
  const existing = (await request('/inventory', { name: 'Inox', quantity: 0, minimum: 0, unitPrice: 20 })).data.id
  const offer = (await request('/offers', offerDraft)).data.item
  const materials = [{ id: 'inox', name: 'Inox', inventoryId: existing, quantity: 10, purchaseQuantity: 10 }, { id: 'new', name: 'Titanio', quantity: 5, purchaseQuantity: 5 }]
  const resources = await fetch(`${url}/offers/${offer.id}/resources`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ materials, laborEntries: [], stages: ['painting'], kind: 'service' }) })
  assert.equal(resources.status, 200)
  assert.equal((await request(`/offers/${offer.id}/proposal`, { layout: 'classic', proposal: { key: 'A', serviceValue: 500, deadline: offer.deadline } })).status, 200)
  const order = (await request(`/offers/${offer.id}/accept`, {})).data.item
  assert.ok(order.code)
  const entry = { type: 'entry', quantityKg: 10, unitPrice: 30, materialRequestId: `${offer.id}-inox`, materialReceiptId: randomUUID() }
  const entries = await Promise.all([request(`/inventory/${existing}/movements`, entry), request(`/inventory/${existing}/movements`, entry)])
  assert.deepEqual(entries.map((result) => result.status), [201, 201])
  assert.equal(entries.filter((result) => result.data.alreadyReceived).length, 1)
  let [[balance]] = await pool.execute('SELECT quantity_kg FROM inventory_materials WHERE id=?', [existing])
  assert.equal(Number(balance.quantity_kg), 0, 'The received material must leave stock for this OS')
  const [[count]] = await pool.execute("SELECT COUNT(*) AS total FROM inventory_movements WHERE material_id=? AND movement_type='entry'", [existing])
  assert.equal(count.total, 1)
  const [history] = await pool.execute("SELECT movement_type,quantity_kg,order_code FROM inventory_movements WHERE material_id=? AND order_code=? ORDER BY id", [existing, order.code])
  assert.deepEqual(history.map((movement) => movement.movement_type), ['entry', 'exit'])
  assert.deepEqual(history.map((movement) => Number(movement.quantity_kg)), [10, 10])
  const newBody = { name: 'Titanio recebido', quantity: 5, minimum: 0, unitPrice: 50, materialRequestId: `${offer.id}-new`, materialReceiptId: randomUUID() }
  await pool.query("CREATE TRIGGER fail_receipt BEFORE INSERT ON inventory_movements FOR EACH ROW BEGIN IF NEW.movement_type='exit' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Receipt rollback test'; END IF; END")
  assert.equal((await request('/inventory', newBody)).status, 500)
  assert.equal((await request('/offers')).data.items[0].resources.materials[1].requestReceipt, undefined)
  const [[failed]] = await pool.execute('SELECT COUNT(*) AS total FROM inventory_materials WHERE name=?', [newBody.name])
  assert.equal(failed.total, 0)
  await pool.query('DROP TRIGGER fail_receipt')
  const created = await request('/inventory', newBody)
  assert.equal(created.status, 201)
  assert.equal((await request('/inventory', newBody)).data.id, created.data.id)
  const received = (await request('/offers')).data.items[0].resources.materials
  assert.deepEqual(received.map((material) => material.requestReceipt.quantity), [10, 5])
  assert.deepEqual(received.map((material) => material.purchaseQuantity), [0, 0])
  assert.deepEqual(received.map((material) => material.inventoryConsumedQuantity), [10, 5])
  const [[newBalance]] = await pool.execute('SELECT quantity_kg FROM inventory_materials WHERE id=?', [created.data.id])
  assert.equal(Number(newBalance.quantity_kg), 0)
  const [newHistory] = await pool.execute('SELECT movement_type,order_code FROM inventory_movements WHERE material_id=? ORDER BY id', [created.data.id])
  assert.deepEqual(newHistory.map((movement) => movement.movement_type), ['creation', 'exit'])
  assert.ok(newHistory.every((movement) => movement.order_code === order.code))

  const partialOffer = (await request('/offers', offerDraft)).data.item
  assert.equal((await fetch(`${url}/offers/${partialOffer.id}/resources`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ materials: [materials[0]], laborEntries: [], stages: ['painting'], kind: 'service' }) })).status, 200)
  await request(`/offers/${partialOffer.id}/proposal`, { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: partialOffer.deadline } })
  const partialOrder = (await request(`/offers/${partialOffer.id}/accept`, {})).data.item
  const partialEntry = { ...entry, materialRequestId: `${partialOffer.id}-inox`, materialReceiptId: randomUUID(), quantityKg: 3 }
  assert.equal((await request(`/inventory/${existing}/movements`, partialEntry)).data.allocatedQuantity, 3)
  let pendingOrder = (await request('/orders')).data.items.find((item) => item.code === partialOrder.code)
  assert.equal(pendingOrder.resources.materials[0].purchaseQuantity, 7)
  const completion = await request(`/inventory/${existing}/movements`, { ...partialEntry, materialReceiptId: randomUUID(), quantityKg: 10 })
  assert.equal(completion.data.allocatedQuantity, 7)
  assert.equal(completion.data.balance, 3, 'Only an actual surplus remains in stock')
  assert.equal((await request(`/inventory/${existing}/movements`, partialEntry)).data.alreadyReceived, true)
  pendingOrder = (await request('/orders')).data.items.find((item) => item.code === partialOrder.code)
  assert.equal(pendingOrder.resources.materials[0].purchaseQuantity, 0)
  const manual = await request('/material-requests', { name: 'Ignored client name', inventoryId: existing, quantity: 4 })
  assert.equal(manual.status, 201)
  assert.equal(manual.data.item.name, 'Inox', 'Existing stock requests use the actual catalog name')
  const manualEntry = await request(`/inventory/${existing}/movements`, { ...entry, quantityKg: 4, materialRequestId: manual.data.item.id, materialReceiptId: randomUUID() })
  assert.equal(manualEntry.data.allocatedQuantity, 0)
  assert.equal(manualEntry.data.balance, 7, 'A manual request without OS only adds stock')
  const manualHistory = (await request(`/material-requests/${manual.data.item.id}/history`)).data.items
  assert.deepEqual(manualHistory.map((event) => event.userName), ['Teste', 'Teste'])
  assert.equal(manualHistory[1].orderCode, null)
  assert.equal((await request('/material-requests', { name: 'Missing material', inventoryId: 999999, quantity: 1 })).status, 404)
  const rejectedManual = (await request('/material-requests', { name: 'Ferro novo', quantity: 5 })).data.item
  assert.equal((await request(`/material-requests/${rejectedManual.id}/reject`, {})).status, 200)
  const manualRequests = (await request('/material-requests')).data.manualRequests
  assert.equal(manualRequests.find((item) => item.id === rejectedManual.id).requestRejection.rejectedByName, 'Teste')
  console.log('Actual API + isolated MySQL: entry then exit for the correct OS, cleared shortages, partial receipts, surplus, idempotent retries and rollback if exit fails passed.')
} finally {
  if (child && child.exitCode == null) { const exited = once(child, 'exit'); child.kill(); await exited }
  await pool?.end()
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await admin.end()
  await rm(directory, { recursive: true, force: true })
}
