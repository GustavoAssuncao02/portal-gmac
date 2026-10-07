import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { materialRequests, pendingInventoryRequests, purchaseMaterialRequests } from '../src/offerResources.js'

test('manual refusal is authenticated, persistent, idempotent and never deletes data or creates an OS', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  const route = `/offers/${offer.id}`
  const resources = { materials: [{ id: 'material', name: 'Titanio', quantity: 5, stockStatus: 'unknown', purchaseQuantity: 5 }], laborEntries: [], stages: ['painting'], kind: 'service' }
  const savedResources = (await fixture.request(`${route}/resources`, 'PUT', resources)).data.item.resources
  assert.equal((await fixture.request(`${route}/reject`, 'POST')).status, 401)
  assert.equal((await fixture.request(`${route}/reject`, 'POST', {}, { Authorization: `Bearer ${fixture.operatorToken}` })).status, 401)
  const headers = { Authorization: `Bearer ${fixture.adminToken}` }
  const rejected = await fixture.request(`${route}/reject`, 'POST', {}, headers)
  assert.equal(rejected.status, 200)
  assert.equal(rejected.data.item.status, 'rejected')
  assert.equal(rejected.data.item.rejectedBy, 0)
  assert.ok(Number.isFinite(Date.parse(rejected.data.item.rejectedAt)))
  assert.deepEqual(rejected.data.item.resources.materials, savedResources.materials)
  assert.deepEqual((await fixture.request(`${route}/reject`, 'POST', {}, headers)).data.item, rejected.data.item)
  assert.equal((await fixture.request(`${route}/resources`, 'PUT', resources)).status, 404)
  assert.equal((await fixture.request(`${route}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A' } })).status, 404)
  assert.equal((await fixture.request(`${route}/accept`, 'POST')).status, 409)
  const upload = await fetch(`${fixture.url}/api${route}/attachments?name=teste.txt`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'test' })
  assert.equal(upload.status, 404)
  assert.equal((await fixture.request('/material-requests/' + offer.id + '-material/approve', 'POST', {}, headers)).status, 404)
  const offers = (await fixture.request('/offers')).data.items
  assert.equal(offers.length, 1)
  assert.equal(offers[0].status, 'rejected')
  assert.deepEqual((await fixture.request('/orders')).data.items, [])
  assert.deepEqual(materialRequests(offers, []), [])
  assert.deepEqual(pendingInventoryRequests(offers, [], []), [])
  assert.deepEqual(purchaseMaterialRequests(offers, [], [{ id: offer.id + '-material', status: 'purchase-requested' }]), [])
})

test('refusal rejects online, proposed and accepted offers, including stale review screens', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const headers = { Authorization: `Bearer ${fixture.adminToken}` }
  assert.equal((await fixture.request('/offers/missing/reject', 'POST', {}, headers)).status, 404)
  const online = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  await fixture.mutateStore((store) => { store.offers.find((row) => row.id === online.id).origin = 'Portal do cliente' })
  assert.equal((await fixture.request(`/offers/${online.id}/reject`, 'POST', {}, headers)).status, 409)
  const proposed = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  await fixture.request(`/offers/${proposed.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['painting'], kind: 'service' })
  await fixture.request(`/offers/${proposed.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offerDraft.deadline } })
  assert.equal((await fixture.request(`/offers/${proposed.id}/reject`, 'POST', {}, headers)).status, 409)
  const accepted = await fixture.request(`/offers/${proposed.id}/accept`, 'POST')
  assert.equal(accepted.status, 201)
  assert.equal((await fixture.request(`/offers/${proposed.id}/reject`, 'POST', {}, headers)).status, 409)
  assert.equal((await fixture.request('/orders')).data.items.length, 1)
})

test('concurrent proposal generation cannot revive a rejected offer', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['painting'], kind: 'service' })
  const [generated, rejected] = await Promise.all([
    fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offer.deadline } }),
    fixture.request(`/offers/${offer.id}/reject`, 'POST', {}, { Authorization: `Bearer ${fixture.adminToken}` }),
  ])
  const item = (await fixture.request('/offers')).data.items[0]
  if (rejected.status === 200) { assert.equal(item.status, 'rejected'); assert.equal(generated.status, 404) }
  else { assert.equal(rejected.status, 409); assert.equal(generated.status, 200); assert.equal(item.status, 'proposed') }
})
