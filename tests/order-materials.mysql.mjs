import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { purchaseMaterialRequests } from '../src/offerResources.js'

const options = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '' }
const database = `gmac_test_stock_${randomUUID().replaceAll('-', '')}`
assert.match(database, /^gmac_test_stock_[a-f0-9]{32}$/)
const admin = await mysql.createConnection(options)
let pool, fixture
try {
  await admin.query(`CREATE DATABASE \`${database}\``)
  pool = mysql.createPool({ ...options, database, multipleStatements: true })
  const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8')
  await pool.query(schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS inventory_materials')))
  await pool.execute('INSERT INTO inventory_materials (name, quantity_kg, unit_price) VALUES (?, ?, ?)', ['Inox', 24, 38.4])
  fixture = await createWorkflowFixture({ inventoryPool: pool })
  async function proposed(materials) {
    const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
    assert.equal((await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials, laborEntries: [], stages: ['painting'], kind: 'service' })).status, 200)
    assert.equal((await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste SQL', serviceValue: 960, materials: 960, labor: 0, deadline: offer.deadline } })).status, 200)
    return offer
  }
  async function balance() { const [[row]] = await pool.execute('SELECT quantity_kg FROM inventory_materials WHERE id=1'); return Number(row.quantity_kg) }
  const offer = await proposed([{ id: 'first', inventoryId: 1, name: 'Inox', quantity: 20 }, { id: 'second', inventoryId: 1, name: 'Inox', quantity: 5 }])
  assert.equal(await balance(), 24, 'Saving resources or generating PDFs must not deduct stock')
  const results = await Promise.all([fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST'), fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')])
  assert.deepEqual(results.map((row) => row.status), [201, 201])
  const order = results[0].data.item
  assert.equal(results[1].data.item.code, order.code)
  assert.equal(await balance(), 0)
  const [movements] = await pool.execute('SELECT * FROM inventory_movements WHERE order_code=?', [order.code])
  assert.equal(movements.length, 1)
  assert.equal(Number(movements[0].quantity_kg), 24)
  assert.equal(Number(movements[0].balance_after_kg), 0)
  assert.deepEqual(order.resources.materials.map((row) => row.purchaseQuantity), [0, 1])
  assert.equal(purchaseMaterialRequests([], [order])[0].quantity, 1)
  assert.equal((await fixture.request('/orders', 'GET', undefined, fixture.admin)).data.items.length, 1)

  // Force an insertion failure after updating the balance, then verify both stores roll back.
  await pool.execute('UPDATE inventory_materials SET quantity_kg=10 WHERE id=1')
  const failed = await proposed([{ id: 'retry', inventoryId: 1, name: 'Inox', quantity: 3 }])
  await pool.query("CREATE TRIGGER reject_stock_exit BEFORE INSERT ON inventory_movements FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Isolated rollback test'")
  assert.equal((await fixture.adminRequest(`/offers/${failed.id}/accept`, 'POST')).status, 500)
  assert.equal(await balance(), 10)
  assert.equal((await fixture.request('/orders', 'GET', undefined, fixture.admin)).data.items.length, 1)
  await pool.query('DROP TRIGGER reject_stock_exit')
  const retry = await fixture.adminRequest(`/offers/${failed.id}/accept`, 'POST')
  assert.equal(retry.status, 201)
  assert.equal(await balance(), 7)

  // Repair an existing OS once without changing its code or operation history.
  await fixture.mutateStore((store) => { delete store.orders.find((row) => row.code === retry.data.item.code).inventoryConsumption })
  assert.equal((await fixture.adminRequest(`/offers/${failed.id}/accept`, 'POST')).status, 409, 'Existing exits must never be deducted twice')
  assert.equal(await balance(), 7)
  await pool.execute('DELETE FROM inventory_movements WHERE order_code=?', [retry.data.item.code])
  await pool.execute('UPDATE inventory_materials SET quantity_kg=10 WHERE id=1')
  assert.equal((await fixture.adminRequest(`/offers/${failed.id}/accept`, 'POST')).data.item.code, retry.data.item.code)
  assert.equal(await balance(), 7)
  assert.equal((await fixture.request('/orders', 'GET', undefined, fixture.admin)).data.items.length, 2)
  console.log('Isolated MySQL stock tests passed: deduction only on acceptance, 24/25 kg shortage, concurrent retries, rollback, repair and duplicate-exit protection.')
} finally {
  await fixture?.close()
  await pool?.end()
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await admin.end()
}
