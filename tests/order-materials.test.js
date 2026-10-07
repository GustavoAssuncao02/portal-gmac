import assert from 'node:assert/strict'
import test from 'node:test'
import { orderMaterialPlan, consumeOrderMaterials } from '../server/orderMaterials.js'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

test('inventory deduction aggregates repeated rows and preserves partial shortages', async () => {
  const materials = [{ inventoryId: 1, name: 'Inox', quantity: 20 }, { name: 'Inox', quantity: 5 }, { inventoryId: 2, name: 'Inox', quantity: .3 }, { name: 'Titanio', quantity: 2 }]
  const inventory = [{ id: 1, name: 'Inox', quantity: 24, unitPrice: 38.4 }, { id: 2, name: 'Inox', quantity: .3, unitPrice: 10 }]
  const plan = orderMaterialPlan(materials, inventory)
  assert.deepEqual(plan.map((row) => [row.inventoryId, row.quantity, row.consumedQuantity, row.purchaseQuantity, row.balance]), [[1, 25, 24, 1, 0], [2, .3, .3, 0, 0], [null, 2, 0, 2, 0]])
  const writes = []
  const connection = { async execute(sql, args) { if (sql.startsWith('SELECT')) return [inventory]; writes.push({ sql, args }); return [{}] } }
  const order = { code: 'OS-TEST', resources: { materials } }
  await consumeOrderMaterials(connection, order, { allowPartial: true })
  assert.deepEqual(order.resources.materials.map((row) => row.purchaseQuantity), [0, 1, 0, 2])
  assert.deepEqual(order.resources.materials.map((row) => row.inventoryConsumedQuantity), [20, 4, .3, 0])
  assert.equal(writes.filter((row) => row.sql.startsWith('INSERT')).length, 2)
  assert.deepEqual(writes.filter((row) => row.sql.startsWith('UPDATE')).map((row) => row.args), [[0, 1], [0, 2]])
  assert.equal(inventory[0].quantity, 24)
})

test('invalid quantities and strict shortages do not write inventory', async () => {
  for (const quantity of [NaN, Infinity, 0, -1]) assert.throws(() => orderMaterialPlan([{ name: 'Inox', quantity }], []), { status: 400 })
  const connection = { async execute(sql) { assert.ok(sql.startsWith('SELECT')); return [[{ id: 1, name: 'Inox', quantity: 0 }]] } }
  await assert.rejects(consumeOrderMaterials(connection, { resources: { materials: [{ name: 'Inox', quantity: 1 }] } }), { status: 409 })
})

test('registered materials cannot generate an OS without the inventory database', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ inventoryId: 1, name: 'Inox', quantity: 1 }], laborEntries: [], stages: ['painting'], kind: 'service' })
  await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', serviceValue: 100, deadline: offer.deadline } })
  assert.equal((await fixture.request(`/offers/${offer.id}/accept`, 'POST')).status, 503)
  assert.deepEqual((await fixture.request('/orders')).data.items, [])
})
