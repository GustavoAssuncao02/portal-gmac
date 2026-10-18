import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture } from './workflowFixture.js'
import { purchaseMaterialRequests } from '../src/offerResources.js'
import { pendingOrderMaterials } from '../server/pendingMaterials.js'

test('receipt is shared, idempotent, preserves the request and OS quantities and disallows refusal', async () => {
  const fixture = await createWorkflowFixture()
  try {
    const material = { id: 'material', name: 'Inox', quantity: 25, purchaseQuantity: 1, inventoryConsumedQuantity: 24 }
    await fixture.mutateStore((store) => {
      store.offers = [{ id: 'offer', orderCode: 'OS-TEST', resources: { materials: [structuredClone(material)] } }]
      store.orders = [{ code: 'OS-TEST', offerId: 'offer', resources: { materials: [structuredClone(material)] } }]
    })
    const route = '/material-requests/offer-material/receive-local'
    const body = { materialId: 7, quantity: 1 }
    const auth = { Authorization: `Bearer ${fixture.adminToken}` }
    assert.equal((await fixture.request(route, 'POST', body)).status, 401)
    assert.equal((await fixture.request(route, 'POST', { ...body, quantity: 0 }, auth)).status, 400)
    const results = await Promise.all([fixture.request(route, 'POST', body, auth), fixture.request(route, 'POST', body, auth)])
    assert.deepEqual(results.map((result) => result.status), [200, 200])
    assert.equal(results[1].data.item.alreadyReceived, true)
    const offers = (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items
    const orders = (await fixture.request('/orders', 'GET', undefined, fixture.admin)).data.items
    const receipt = offers[0].resources.materials[0].requestReceipt
    assert.equal(receipt.quantity, 1)
    assert.equal(receipt.inventoryId, 7)
    assert.equal(receipt.receivedBy, 0)
    assert.deepEqual(receipt, orders[0].resources.materials[0].requestReceipt)
    assert.equal(orders[0].resources.materials[0].quantity, 25)
    assert.equal(orders[0].resources.materials[0].purchaseQuantity, 0)
    assert.equal(orders[0].resources.materials[0].inventoryConsumedQuantity, 25)
    assert.deepEqual(pendingOrderMaterials(orders[0]), [])
    const rows = purchaseMaterialRequests(offers, orders)
    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0].receipt, receipt)
    assert.equal((await fixture.request('/material-requests/offer-material/reject', 'POST', {}, auth)).status, 409)
    assert.equal((await fixture.request('/material-requests')).status, 401)
    assert.equal((await fixture.request('/material-requests', 'GET', undefined, auth)).data.items[0].status, 'received')
  } finally { await fixture.close() }
})

test('partial receipts keep the remainder pending and repeated receipt IDs never allocate twice', async () => {
  const fixture = await createWorkflowFixture()
  try {
    await fixture.mutateStore((store) => {
      store.offers = [{ id: 'offer', orderCode: 'OS-TEST', resources: { materials: [{ id: 'material', name: 'Inox', quantity: 10, purchaseQuantity: 10 }] } }]
      store.orders = [{ code: 'OS-TEST', offerId: 'offer', resources: { materials: [{ id: 'material', name: 'Inox', quantity: 10, purchaseQuantity: 10 }] } }]
    })
    const auth = { Authorization: `Bearer ${fixture.adminToken}` }
    const route = '/material-requests/offer-material/receive-local'
    const first = { materialId: 7, quantity: 4, receiptId: 'first' }
    assert.equal((await fixture.request(route, 'POST', first, auth)).data.item.allocatedQuantity, 4)
    assert.equal((await fixture.request(route, 'POST', first, auth)).data.item.alreadyReceived, true)
    let order = (await fixture.request('/orders', 'GET', undefined, fixture.admin)).data.items[0]
    assert.equal(pendingOrderMaterials(order)[0].quantity, 6)
    assert.equal(order.resources.materials[0].inventoryConsumedQuantity, 4)
    const second = await fixture.request(route, 'POST', { materialId: 7, quantity: 8, receiptId: 'second' }, auth)
    assert.equal(second.data.item.allocatedQuantity, 6, 'Only the pending amount goes to the OS')
    assert.equal((await fixture.request(route, 'POST', first, auth)).data.item.alreadyReceived, true, 'Older retries remain idempotent after later receipts')
    order = (await fixture.request('/orders', 'GET', undefined, fixture.admin)).data.items[0]
    assert.deepEqual(pendingOrderMaterials(order), [])
    assert.equal(order.resources.materials[0].inventoryConsumedQuantity, 10)
    assert.equal(order.resources.materials[0].requestReceipts.length, 2)
  } finally { await fixture.close() }
})

test('receipt and stock callbacks roll back together and concurrent retries save stock only once', async () => {
  const fixture = await createWorkflowFixture()
  try {
    await fixture.mutateStore((store) => { store.offers = [{ id: 'offer', resources: { materials: [{ id: 'material', quantity: 10, purchaseQuantity: 10 }] } }] })
    let writes = 0, rollbacks = 0
    const save = async () => { writes++; return { materialId: 2, receivedQuantity: 10 } }
    await assert.rejects(fixture.saveRequestedMaterial('offer-material', 1, save, { commit: async () => { throw Error('SQL failure') }, rollback: async () => { rollbacks++ } }), /SQL failure/)
    assert.equal(rollbacks, 1)
    assert.equal((await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items[0].resources.materials[0].requestReceipt, undefined)
    const results = await Promise.all([fixture.saveRequestedMaterial('offer-material', 1, save), fixture.saveRequestedMaterial('offer-material', 2, save)])
    assert.equal(writes, 2, 'One failed attempt plus exactly one successful stock write')
    assert.equal(results[1].alreadyReceived, true)
    await assert.rejects(fixture.saveRequestedMaterial('unknown-material', 1, save), { status: 404 })
    await assert.rejects(fixture.saveRequestedMaterial({}, 1, save), { status: 400 })
    assert.equal(writes, 2)
  } finally { await fixture.close() }
})
