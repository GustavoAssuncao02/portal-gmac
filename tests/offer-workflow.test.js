import assert from 'node:assert/strict'
import test from 'node:test'
import { materialRequests, materialStock, materialsStock, normalizeSearch, pendingInventoryRequests, purchaseMaterialRequests } from '../src/offerResources.js'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

test('material search ignores accents and stock shortages preserve requested kg', () => {
  const inventory = [{ id: 1, name: 'Alum\u00ednio', quantity: 8 }]
  assert.ok(normalizeSearch(inventory[0].name).includes(normalizeSearch('Alu')))
  assert.equal(materialStock({ name: 'Aluminio', quantity: 10 }, inventory).purchaseQuantity, 2)
  assert.equal(materialStock({ name: 'Aluminio', quantity: 5 }, inventory).stockStatus, 'available')
  assert.equal(materialStock({ name: 'Titanio', quantity: 12.5 }, inventory).stockStatus, 'unknown')
  assert.equal(materialStock({ name: 'Titanio', quantity: 12.5 }, inventory).purchaseQuantity, 12.5)
})

test('material requests keep the OS link, avoid duplicate offer/order rows, and support older materials', () => {
  const resources = { materials: [{ id: 'a', name: 'Titanio', quantity: 12.5, stockStatus: 'unknown' }, { id: 'b', name: 'Aluminio', quantity: 10, stockAvailable: 8, stockStatus: 'partial' }, { id: 'c', name: 'Aco', quantity: 5, stockStatus: 'available' }] }
  const offer = { id: 'offer', code: 'OF-TEST', orderCode: 'OS-TEST', resources }
  const order = { offerId: offer.id, code: offer.orderCode, resources }
  const requests = materialRequests([offer], [order])
  assert.equal(requests.length, 2)
  assert.deepEqual(requests.map((request) => request.quantity), [12.5, 2])
  assert.equal(requests[0].orderCode, 'OS-TEST')
  assert.equal(materialRequests([], [order])[0].orderCode, 'OS-TEST')
  assert.equal(materialRequests([{ ...offer, resources: { materials: [] } }], []).length, 0)
})

test('repeated materials share available stock without changing the inventory balance', () => {
  const inventory = [{ id: 1, name: 'Aco Inox 304', quantity: 24 }, { id: 2, name: 'Aco Inox 304', quantity: 10 }]
  const original = structuredClone(inventory)
  const materials = [
    { id: 'first', inventoryId: 1, name: 'Aco Inox 304', quantity: 20 },
    { id: 'second', name: 'Aço Inox 304', quantity: 5 },
    { id: 'other', inventoryId: 2, name: 'Aco Inox 304', quantity: 5 },
  ]
  const checked = materialsStock(materials, inventory)
  assert.deepEqual(checked.map((row) => row.stockAvailable), [24, 4, 10])
  assert.deepEqual(checked.map((row) => row.purchaseQuantity), [0, 1, 0])
  assert.deepEqual(checked.map((row) => row.groupPurchaseQuantity), [1, 1, 0])
  assert.deepEqual(checked.map((row) => row.groupStockStatus), ['partial', 'partial', 'available'])
  const requests = purchaseMaterialRequests([{ id: 'offer', resources: { materials: checked } }], [])
  assert.equal(requests.length, 1)
  assert.equal(requests[0].quantity, 1)
  assert.equal(requests[0].id, 'offer-second')
  const removed = materialsStock([checked[0], checked[2]], inventory)
  assert.deepEqual(removed.map((row) => row.groupStockStatus), ['available', 'available'])
  assert.deepEqual(removed.map((row) => row.purchaseQuantity), [0, 0])
  assert.deepEqual(inventory, original)
  assert.equal(materials[0].purchaseQuantity, undefined)
})

test('shared stock handles decimal quantities, aliases, empty stock and unregistered materials', () => {
  const inventory = [{ id: 1, name: 'Inox', quantity: .3 }, { id: 2, name: 'Ferro', quantity: 0 }]
  const checked = materialsStock([
    { id: 'a', inventoryId: '1', name: 'Nome antigo', quantity: .1 },
    { id: 'b', inventoryId: 1, name: 'Inox', quantity: .2 },
    { id: 'c', inventoryId: 1, name: 'Inox', quantity: .001 },
    { id: 'd', name: 'Ferro', quantity: 2 },
    { id: 'e', name: 'Titanio', quantity: 5 },
    { id: 'f', name: 'Titânio', quantity: 3 },
  ], inventory)
  assert.deepEqual(checked.map((row) => row.purchaseQuantity), [0, 0, .001, 2, 5, 3])
  assert.deepEqual(checked.map((row) => row.groupPurchaseQuantity), [.001, .001, .001, 2, 8, 8])
  assert.deepEqual(checked.map((row) => row.groupStockStatus), ['partial', 'partial', 'partial', 'missing', 'unknown', 'unknown'])
  assert.equal(materialsStock(checked.slice(0, 2), inventory)[0].groupStockStatus, 'available')
  assert.deepEqual(materialsStock([], inventory), [])
})

test('offer settings, materials and editable machine rate survive proposal PDF and OS acceptance', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const created = await fixture.request('/offers', 'POST', offerDraft)
  assert.equal(created.status, 201)
  const id = created.data.item.id
  const resources = { materials: [{ id: 'material', name: 'Titanio', quantity: 12.5, unitPrice: 20, stockStatus: 'unknown', stockAvailable: 0, purchaseQuantity: 12.5 }], laborEntries: [{ id: 'labor', machineId: 1, type: 'machine', resource: 'Torno de teste', hours: 2, hourlyRate: 175 }], stages: ['welding', 'cutting'], kind: 'product' }
  const saved = await fixture.request(`/offers/${id}/resources`, 'PUT', resources)
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.data.item.resources.stages, ['welding', 'cutting'])
  const proposal = { key: 'A', title: 'Teste', deadline: '2026-12-20', serviceValue: 600, materials: 250, labor: 350, machine: '2 horas', serviceTime: '2 horas', margin: 0, discount: 0, profit: 0, stages: ['painting'], kind: 'service' }
  const generated = await fixture.request(`/offers/${id}/proposal`, 'POST', { proposal, layout: 'classic' })
  assert.equal(generated.status, 200)
  assert.deepEqual(generated.data.item.proposal.stages, ['welding', 'cutting'])
  assert.equal(generated.data.item.proposal.kind, 'product')
  const pdf = await fetch(`${fixture.url}/api/offers/${id}/proposal.pdf`)
  assert.equal(pdf.status, 200)
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF')
  const changed = await fixture.request(`/offers/${id}/resources`, 'PUT', { ...saved.data.item.resources, kind: 'service' })
  assert.equal(changed.data.item.proposal, null)
  await fixture.request(`/offers/${id}/proposal`, 'POST', { proposal, layout: 'classic' })
  const accepted = await fixture.request(`/offers/${id}/accept`, 'POST')
  assert.equal(accepted.status, 201)
  assert.equal(accepted.data.item.resources.laborEntries[0].hourlyRate, 175)
  const offers = (await fixture.request('/offers')).data.items
  const orders = (await fixture.request('/operations/orders')).data.items
  assert.deepEqual(orders[0].operation.stages.map((stage) => stage.name), ['Soldagem', 'Corte'])
  assert.equal(materialRequests(offers, orders)[0].orderCode, accepted.data.item.code)
  assert.equal((await fixture.request(`/offers/${id}/resources`, 'PUT', resources)).status, 404)
})

test('invalid or missing process settings cannot generate a proposal', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const { data } = await fixture.request('/offers', 'POST', offerDraft)
  const route = `/offers/${data.item.id}`
  assert.equal((await fixture.request(`${route}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['invalid'], kind: 'service' })).status, 400)
  assert.equal((await fixture.request(`${route}/resources`, 'PUT', { materials: [], laborEntries: [], stages: [], kind: 'invalid' })).status, 400)
  assert.equal((await fixture.request(`${route}/proposal`, 'POST', { proposal: { stages: ['cutting'] }, layout: 'classic' })).status, 400)
})

test('inventory pending requests follow offers until the material is registered, retaining purchase status and OS links', () => {
  const materials = [{ id: 'new', name: 'Titanio', detail: 'Chapa de teste', quantity: 12.5, unitPrice: 20, stockStatus: 'unknown' }, { id: 'existing', name: 'Aluminio', quantity: 10, stockAvailable: 8, stockStatus: 'partial' }]
  const offer = { id: 'offer', code: 'OF-TEST', resources: { materials } }
  const inventory = [{ id: 1, name: 'Alum\u00ednio', quantity: 8 }]
  const before = pendingInventoryRequests([offer], [], inventory)
  assert.equal(before.length, 1)
  assert.equal(before[0].name, 'Titanio')
  assert.equal(before[0].quantity, 12.5)
  assert.equal(before[0].detail, 'Chapa de teste')
  assert.equal(before[0].unitPrice, 20)
  assert.equal(before[0].os, 'OF-TEST')
  const saved = [{ id: before[0].id, status: 'purchase-requested' }]
  const accepted = { ...offer, orderCode: 'OS-TEST' }
  const after = pendingInventoryRequests([accepted], [{ offerId: offer.id, code: 'OS-TEST', resources: offer.resources }], inventory, saved)
  assert.equal(after.length, 1)
  assert.equal(after[0].os, 'OS-TEST')
  assert.equal(after[0].status, 'purchase-requested')
  assert.equal(pendingInventoryRequests([accepted], [], [...inventory, { id: 2, name: 'Tit\u00e2nio', quantity: 0 }], saved).length, 0)
  assert.equal(pendingInventoryRequests([{ ...offer, resources: { materials: [] } }], [], inventory, saved).length, 0)
})

test('new materials enter purchase orders directly without pre-registration approval', () => {
  const offer = { id: 'offer', code: 'OF-TEST', resources: { materials: [
    { id: 'new', name: 'Titanio', quantity: 12.5, stockStatus: 'unknown' },
    { id: 'legacy', name: 'Material antigo', quantity: 7 },
    { id: 'partial', name: 'Aluminio', quantity: 10, stockAvailable: 8, stockStatus: 'partial' },
    { id: 'missing', name: 'Aco', quantity: 5, stockStatus: 'missing' },
    { id: 'linked', inventoryId: 3, name: 'Cobre', quantity: 3 },
  ] } }
  assert.deepEqual(purchaseMaterialRequests([offer], []).map((request) => request.name), ['Titanio', 'Material antigo', 'Aluminio', 'Aco', 'Cobre'])
  assert.equal(pendingInventoryRequests([offer], [], [{ name: 'Aluminio' }, { name: 'Aco' }, { name: 'Cobre' }]).length, 2)
  const pending = [{ id: 'offer-new', status: 'pending' }]
  assert.ok(purchaseMaterialRequests([offer], [], pending).some((request) => request.name === 'Titanio'))
  const approved = [{ id: 'offer-new', status: 'purchase-requested' }, { id: 'deleted-material', status: 'purchase-requested' }]
  const requests = purchaseMaterialRequests([offer], [], approved)
  assert.equal(requests.length, 5)
  assert.equal(requests[0].name, 'Titanio')
  assert.equal(requests[0].quantity, 12.5)
  const accepted = { ...offer, orderCode: 'OS-TEST' }
  const order = { offerId: offer.id, code: 'OS-TEST', resources: offer.resources }
  assert.equal(purchaseMaterialRequests([accepted], [order], approved).filter((request) => request.name === 'Titanio').length, 1)
  assert.equal(purchaseMaterialRequests([], [order], approved)[0].orderCode, 'OS-TEST')
  assert.ok(purchaseMaterialRequests([accepted], [order]).some((request) => request.name === 'Titanio'))
  assert.equal(purchaseMaterialRequests([{ ...offer, resources: { materials: [] } }], [], approved).length, 0)
})
