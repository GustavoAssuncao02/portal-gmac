import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import createInventoryImportRouter, { importedInventory } from '../server/inventoryImport.js'

test('inventory import preserves valid balances/history and rejects malformed local data', () => {
  const item = { name: ' Aluminio ', detail: 'Chapa', quantity: '7.5', minimum: 2, unitPrice: 20, history: [{ type: 'entry', date: '2026-10-03T10:00:00Z', quantity: 7.5, balance: 7.5, unitPrice: 20 }] }
  const [result] = importedInventory({ items: [item] })
  assert.equal(result.name, 'Aluminio')
  assert.equal(result.quantity, 7.5)
  assert.equal(result.history[0].type, 'entry')
  assert.equal(result.history[0].date.getTime(), Date.parse(item.history[0].date))
  for (const body of [{}, { items: [{}] }, { items: [{ ...item, quantity: -1 }] }, { items: [{ ...item, unitPrice: Infinity }] }, { items: [{ ...item, history: [{ type: 'other', date: 'bad' }] }] }]) assert.throws(() => importedInventory(body))
  assert.equal(item.name, ' Aluminio ')
})

test('authenticated imports are serialized, skip existing materials, and never recreate defaults in a populated stock', async (t) => {
  const calls = []
  const connection = {
    async execute(sql, values) {
      calls.push({ sql, values })
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]]
      if (sql.startsWith('SELECT name')) return [[{ name: 'Aluminio', detail: 'Chapa' }]]
      return [{ insertId: 21 }]
    },
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
  }
  const app = express()
  app.use(express.json())
  app.use(createInventoryImportRouter({ async getConnection() { return connection } }, (req, res, next) => req.headers.authorization === 'Bearer test' ? next() : res.sendStatus(401)))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/inventory/import`
  const send = (body, auth = true) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer test' } : {}) }, body: JSON.stringify(body) })
  const item = { name: 'Aluminio', detail: 'Chapa', quantity: 5, minimum: 1, unitPrice: 10 }
  assert.equal((await send({ items: [item] }, false)).status, 401)
  assert.equal((await send({ items: [{}] })).status, 400)
  assert.deepEqual(await (await send({ items: [item, { ...item, name: 'Ferro' }], onlyIfEmpty: true })).json(), { imported: 0 })
  assert.deepEqual(await (await send({ items: [item, { ...item, name: 'Ferro' }] })).json(), { imported: 1 })
  assert.equal(calls.filter(({ sql }) => sql.startsWith('INSERT INTO inventory_materials')).length, 1)
  assert.equal(calls.filter(({ sql }) => sql.includes('RELEASE_LOCK')).length, 2)
})
