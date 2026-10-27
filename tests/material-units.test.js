import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { orderMaterialPlan } from '../server/orderMaterials.js'
import { pendingOrderMaterials } from '../server/pendingMaterials.js'
import { formatQuantity } from '../server/materialUnits.js'
import { materialsStock, findInventoryMaterial } from '../src/offerResources.js'

test('stock by unit: whole quantities, unit kept while there is balance, kilos unchanged', async () => {
  const fixture = await createWorkflowFixture()
  try {
    const create = (body) => fixture.adminRequest('/inventory', 'POST', { detail: '', minimum: 0, unitPrice: 2, ...body })
    assert.equal((await create({ name: 'Parafuso M8', unit: 'un', quantity: 2.5 })).status, 400, 'units are whole')
    assert.equal((await create({ name: 'Parafuso M8', unit: 'caixa', quantity: 2 })).status, 400)
    const screw = (await create({ name: 'Parafuso M8', unit: 'un', quantity: 100, minimum: 20 })).data
    const steel = (await create({ name: 'Aço 1020', quantity: 12.5 })).data
    let items = (await fixture.adminRequest('/inventory')).data.items
    assert.deepEqual(items.map((item) => [item.name, item.unit, Number(item.quantity)]), [['Aço 1020', 'kg', 12.5], ['Parafuso M8', 'un', 100]])
    assert.equal((await fixture.adminRequest(`/inventory/${screw.id}/movements`, 'POST', { type: 'entry', quantityKg: 1.5, unitPrice: 2 })).status, 400)
    assert.equal((await fixture.adminRequest(`/inventory/${screw.id}/movements`, 'POST', { type: 'entry', quantityKg: 10, unitPrice: 2 })).status, 201)
    assert.equal((await fixture.adminRequest(`/inventory/${steel.id}/movements`, 'POST', { type: 'exit', quantityKg: 0.25 })).status, 201, 'kilos keep decimals')
    assert.equal((await fixture.adminRequest(`/inventory/${screw.id}`, 'PATCH', { name: 'Parafuso M8', unit: 'kg', minimum: 20, unitPrice: 2 })).status, 409, 'the unit does not change with balance')
    assert.equal((await fixture.adminRequest(`/inventory/${steel.id}/movements`, 'POST', { type: 'exit', quantityKg: 12.25 })).status, 201)
    assert.equal((await fixture.adminRequest(`/inventory/${steel.id}`, 'PATCH', { name: 'Aço 1020', unit: 'un', minimum: 0, unitPrice: 2 })).status, 200, 'with the balance at zero it can be corrected')
    items = (await fixture.adminRequest('/inventory')).data.items
    assert.deepEqual(items.map((item) => [item.unit, Number(item.quantity)]), [['un', 0], ['un', 110]])
  } finally { await fixture.close() }
})

test('offers and manual requests carry the unit; units are whole', async () => {
  const fixture = await createWorkflowFixture()
  try {
    const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
    const route = `/offers/${offer.id}/resources`
    const base = { laborEntries: [], kind: 'service', stages: ['turning'] }
    assert.equal((await fixture.adminRequest(route, 'PUT', { ...base, materials: [{ id: 'a', name: 'Rolamento', unit: 'un', quantity: 2.5, unitPrice: 30 }] })).status, 400)
    assert.equal((await fixture.adminRequest(route, 'PUT', { ...base, materials: [{ id: 'a', name: 'Rolamento', unit: 'pacote', quantity: 2, unitPrice: 30 }] })).status, 400)
    const saved = (await fixture.adminRequest(route, 'PUT', { ...base, materials: [{ id: 'a', name: 'Rolamento', unit: 'un', quantity: 4, unitPrice: 30 }, { id: 'b', name: 'Chapa', quantity: 2.5, unitPrice: 10 }] })).data.item
    assert.deepEqual(saved.resources.materials.map((row) => [row.name, row.unit ?? 'kg', row.quantity]), [['Rolamento', 'un', 4], ['Chapa', 'kg', 2.5]])
    assert.equal((await fixture.adminRequest('/material-requests', 'POST', { name: 'Arruela', unit: 'un', quantity: 1.5 })).status, 400)
    const manual = (await fixture.adminRequest('/material-requests', 'POST', { name: 'Arruela', unit: 'un', quantity: 50 })).data.item
    assert.deepEqual([manual.unit, manual.quantity], ['un', 50])
    assert.equal((await fixture.adminRequest('/material-requests', 'POST', { name: 'Barra', quantity: 1.5 })).data.item.unit, 'kg', 'without a unit the request is in kilos, as before')
  } finally { await fixture.close() }
})

test('a material is linked by name only to the stock counted in the same unit', () => {
  const inventory = [{ id: 1, name: 'Parafuso', unit: 'kg', quantity: 3 }, { id: 2, name: 'Parafuso', unit: 'un', quantity: 40 }]
  assert.equal(findInventoryMaterial({ name: 'Parafuso', unit: 'un' }, inventory).id, 2)
  assert.equal(findInventoryMaterial({ name: 'Parafuso' }, inventory).id, 1, 'a search without a unit finds the first one')
  const [byUnit, byKilo] = materialsStock([{ id: 'a', name: 'Parafuso', unit: 'un', quantity: 50 }, { id: 'b', name: 'parafuso', unit: 'kg', quantity: 2 }], inventory)
  assert.deepEqual([byUnit.inventoryId, byUnit.purchaseQuantity, byUnit.unit], [2, 10, 'un'])
  assert.deepEqual([byKilo.inventoryId, byKilo.purchaseQuantity, byKilo.unit], [1, 0, 'kg'])
  const plan = orderMaterialPlan([{ name: 'Porca', unit: 'un', quantity: 8 }, { name: 'Porca', quantity: 1 }], [{ id: 9, name: 'Porca', unit: 'kg', quantity: 5 }])
  assert.deepEqual(plan.map((row) => [row.inventoryId, row.unit, row.purchaseQuantity]), [[null, 'un', 8], [9, 'kg', 0]], 'units never consume a stock counted in kilos')
  const pending = pendingOrderMaterials({ resources: { materials: [{ name: 'Porca', unit: 'un', quantity: 8, purchaseQuantity: 8 }, { name: 'Porca', quantity: 1, purchaseQuantity: 1 }] } })
  assert.deepEqual(pending.map((row) => formatQuantity(row.quantity, row.unit)), ['8 un', '1 kg'])
})

test('metres: decimal quantities in stock, offers and requests, kept apart from kilos and units', async () => {
  const fixture = await createWorkflowFixture()
  try {
    const cable = (await fixture.adminRequest('/inventory', 'POST', { name: 'Cabo de aço', detail: '', unit: 'm', quantity: 12.5, minimum: 2.25, unitPrice: 8 })).data
    assert.equal((await fixture.adminRequest(`/inventory/${cable.id}/movements`, 'POST', { type: 'exit', quantityKg: 1.75 })).status, 201, 'metres keep decimals')
    const item = (await fixture.adminRequest('/inventory')).data.items.find((row) => row.id === cable.id)
    assert.deepEqual([item.unit, Number(item.quantity)], ['m', 10.75])
    assert.equal((await fixture.adminRequest(`/inventory/${cable.id}`, 'PATCH', { name: 'Cabo de aço', unit: 'kg', minimum: 2, unitPrice: 8 })).status, 409, 'the unit does not change with balance')
    const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
    const saved = (await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { laborEntries: [], kind: 'service', stages: ['turning'], materials: [{ id: 'a', name: 'Cabo de aço', unit: 'm', quantity: 3.5, unitPrice: 8 }] })).data.item
    assert.deepEqual(saved.resources.materials.map((row) => [row.unit, row.quantity]), [['m', 3.5]])
    assert.equal((await fixture.adminRequest('/material-requests', 'POST', { name: 'Mangueira', unit: 'm', quantity: 4.2 })).data.item.unit, 'm')
  } finally { await fixture.close() }
})

test('a material in metres links only to the stock counted in metres', () => {
  const inventory = [{ id: 1, name: 'Cabo', unit: 'kg', quantity: 3 }, { id: 2, name: 'Cabo', unit: 'm', quantity: 5 }]
  assert.equal(findInventoryMaterial({ name: 'Cabo', unit: 'm' }, inventory).id, 2)
  const plan = orderMaterialPlan([{ name: 'Cabo', unit: 'm', quantity: 7.5 }], inventory)
  assert.deepEqual(plan.map((row) => [row.inventoryId, row.unit, row.consumedQuantity, row.purchaseQuantity]), [[2, 'm', 5, 2.5]])
  const pending = pendingOrderMaterials({ resources: { materials: [{ name: 'Cabo', unit: 'm', quantity: 2.5, purchaseQuantity: 2.5 }, { name: 'Cabo', quantity: 1, purchaseQuantity: 1 }] } })
  assert.deepEqual(pending.map((row) => formatQuantity(row.quantity, row.unit)), ['2,5 m', '1 kg'], 'metres are not added to kilos')
})
