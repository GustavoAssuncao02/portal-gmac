import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { purchaseMaterialRequests } from '../src/offerResources.js'
import { pendingOrderMaterials } from '../server/pendingMaterials.js'

test('purchase approvals are authenticated, shared, idempotent and preserved when another browser imports its cache', async (t) => {
  const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'test-password', DEMO_ADMIN_NAME: 'Test' } })
  t.after(() => fixture.close())
  await fixture.mutateStore((store) => { store.offers = [{ id: 'offer-a', resources: { materials: [{ id: 'material-a' }, { id: 'material-b' }] } }] })
  const login = await fixture.request('/auth/login', 'POST', { cpf: '12345678901', password: 'test-password' })
  const headers = { Authorization: `Bearer ${login.data.token}` }
  assert.equal((await fixture.request('/material-requests')).status, 401)
  assert.equal((await fixture.request('/material-requests/unknown/approve', 'POST', {}, headers)).status, 404)
  const first = await fixture.request('/material-requests/offer-a-material-a/approve', 'POST', {}, headers)
  assert.equal(first.data.items.length, 1)
  assert.equal(first.data.items[0].approvedBy, 0)
  assert.equal(first.data.items[0].status, 'purchase-requested')
  assert.deepEqual((await fixture.request('/material-requests/offer-a-material-a/approve', 'POST', {}, headers)).data, first.data)
  const otherLogin = await fixture.request('/auth/login', 'POST', { cpf: '12345678901', password: 'test-password' })
  const otherHeaders = { Authorization: `Bearer ${otherLogin.data.token}` }
  assert.deepEqual((await fixture.request('/material-requests', 'GET', undefined, otherHeaders)).data.items, first.data.items)
  assert.deepEqual((await fixture.request('/material-requests/import', 'POST', { items: [] }, otherHeaders)).data, first.data)
  const imported = await fixture.request('/material-requests/import', 'POST', { items: [{ id: 'offer-a-material-a', status: 'purchase-requested' }, { id: 'offer-a-material-b', status: 'purchase-requested' }, { id: 'deleted-material', status: 'purchase-requested' }] }, otherHeaders)
  assert.equal(imported.data.items.length, 2)
  assert.deepEqual(imported.data.items[0], first.data.items[0])
  assert.equal((await fixture.request('/material-requests/import', 'POST', { items: [{ id: 'wrong', status: 'pending' }] }, headers)).status, 400)
})

test('material request refusal is authenticated, persistent, idempotent and preserves the OS shortage and quantities', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  const materials = [{ id: 'first', name: 'Inox', quantity: 10, purchaseQuantity: 10, unitPrice: 20, stockStatus: 'unknown' }, { id: 'second', name: 'Ferro', quantity: 5, purchaseQuantity: 5, stockStatus: 'unknown' }]
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials, laborEntries: [], stages: ['painting'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 200, deadline: offer.deadline } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const before = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0]
  const route = `/material-requests/${offer.id}-first/reject`
  const headers = { Authorization: `Bearer ${fixture.adminToken}` }
  assert.equal((await fixture.request(route, 'POST')).status, 401)
  assert.equal((await fixture.request(route, 'POST', {}, { Authorization: `Bearer ${fixture.operatorToken}` })).status, 401)
  assert.equal((await fixture.request('/material-requests/invalid/reject', 'POST', {}, headers)).status, 404)
  const rejected = await fixture.request(route, 'POST', {}, headers)
  assert.equal(rejected.status, 200)
  assert.equal(rejected.data.item.status, 'rejected')
  assert.equal(rejected.data.item.rejectedBy, 0)
  assert.ok(Number.isFinite(Date.parse(rejected.data.item.rejectedAt)))
  assert.deepEqual((await fixture.request(route, 'POST', {}, headers)).data, rejected.data)
  const offers = (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items
  const orders = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items
  assert.deepEqual(purchaseMaterialRequests(offers, orders).map((request) => request.name), ['Inox', 'Ferro'])
  assert.ok(purchaseMaterialRequests(offers, orders)[0].rejection)
  assert.deepEqual(pendingOrderMaterials(orders[0]), pendingOrderMaterials(order))
  assert.deepEqual(orders[0].operation, before.operation)
  assert.deepEqual(orders[0].resources.materials.map(({ requestRejection, ...material }) => material), order.resources.materials)
  assert.deepEqual(offers[0].resources.materials[0].requestRejection, orders[0].resources.materials[0].requestRejection)
  assert.equal((await fixture.request('/material-requests', 'GET', undefined, headers)).data.items[0].status, 'rejected')
  await fixture.mutateStore((store) => { store.offers = [] })
  assert.deepEqual(purchaseMaterialRequests([], (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items).map((request) => request.name), ['Inox', 'Ferro'])
  assert.deepEqual((await fixture.request(route, 'POST', {}, headers)).data, rejected.data)
})

test('materials without shortage cannot be refused and rejection metadata survives old approval imports', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  await fixture.mutateStore((store) => { store.offers = [{ id: 'offer', resources: { materials: [{ id: 'available', name: 'Ferro', quantity: 5, stockStatus: 'available' }, { id: 'pending', name: 'Inox', quantity: 2 }] } }] })
  const headers = { Authorization: `Bearer ${fixture.adminToken}` }
  assert.equal((await fixture.request('/material-requests/offer-available/reject', 'POST', {}, headers)).status, 409)
  const rejected = await fixture.request('/material-requests/offer-pending/reject', 'POST', {}, headers)
  const imported = await fixture.request('/material-requests/import', 'POST', { items: [{ id: 'offer-pending', status: 'purchase-requested' }] }, headers)
  assert.deepEqual(imported.data.items[0], rejected.data.item)
  assert.equal(purchaseMaterialRequests((await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items, [])[0].rejection.rejectedBy, 0)
})
