import assert from 'node:assert/strict'
import test from 'node:test'
import { pendingOrderMaterials } from '../server/pendingMaterials.js'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

test('pending quantities honor the OS snapshot, sum duplicate rows once and retain partial kg', () => {
  const order = { resources: { materials: [
    { inventoryId: 7, name: 'Inox', quantity: 20, purchaseQuantity: 0, groupPurchaseQuantity: 1 },
    { inventoryId: 7, name: 'Inox', quantity: 5, purchaseQuantity: 1, groupPurchaseQuantity: 1 },
    { inventoryId: 8, name: 'Aluminio', quantity: 1, stockAvailable: .6, stockStatus: 'partial' },
    { inventoryId: 8, name: 'Aluminio', quantity: .2, purchaseQuantity: .2 },
    { name: 'Ferro', quantity: 10, stockStatus: 'available' },
    { name: 'Cobre', quantity: 8, purchaseQuantity: 0, stockStatus: 'missing' },
    { name: 'Latao', quantity: 10, inventoryConsumedQuantity: 9.5 },
    { name: 'Invalid', quantity: Infinity },
  ] } }
  const before = structuredClone(order)
  assert.deepEqual(pendingOrderMaterials(order).map(({ name, quantity }) => [name, quantity]), [['Inox', 1], ['Aluminio', .6], ['Latao', .5]])
  assert.deepEqual(order, before)
  assert.deepEqual(pendingOrderMaterials(null), [])
})

test('start and resume require acknowledgement of current pending quantities and audit the operator consent', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cut-bend'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offer.deadline } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  await fixture.mutateStore((store) => { store.orders[0].resources.materials = [{ id: 'inox', inventoryId: 7, name: 'Inox 304', quantity: 10, purchaseQuantity: 10 }] })
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001', birthDate: '1990-01-01', email: 'ana@example.invalid', identification: '001' }, fixture.admin)).data.item
  const headers = { Authorization: `Bearer ${fixture.operatorToken}` }
  const route = `/operations/orders/${order.code}`
  const rejected = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id }, headers)
  assert.equal(rejected.status, 409)
  assert.equal(rejected.data.code, 'PENDING_MATERIALS')
  assert.equal(rejected.data.pendingMaterials[0].quantity, 10)
  assert.equal((await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0].operation.activeSession, null)
  assert.deepEqual((await fixture.request(`${route}/events`, 'GET', undefined, { Authorization: `Bearer ${fixture.operatorToken}` })).data.items, [])
  const stale = rejected.data.pendingMaterials.map((row) => [row.key, row.quantity])
  await fixture.mutateStore((store) => { store.orders[0].resources.materials[0].purchaseQuantity = 12 })
  const changed = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id, pendingMaterialsConfirmation: stale }, headers)
  assert.equal(changed.status, 409)
  assert.equal(changed.data.pendingMaterials[0].quantity, 12)
  const confirmation = changed.data.pendingMaterials.map((row) => [row.key, row.quantity])
  const started = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id, pendingMaterialsConfirmation: confirmation }, headers)
  assert.equal(started.status, 200)
  assert.equal(started.data.operation.status, 'running')
  assert.equal(started.data.event.pendingMaterialsAccepted, true)
  assert.equal(started.data.event.pendingMaterials[0].quantity, 12)
  assert.equal(started.data.event.employeeName, employee.name)
  assert.equal(started.data.order.resources.materials[0].purchaseQuantity, 12)
  await fixture.request(`${route}/pause`, 'POST', { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken, reason: 'Descanso' }, headers)
  assert.equal((await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id }, headers)).status, 409)
  assert.equal((await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id, pendingMaterialsConfirmation: confirmation }, headers)).status, 200)
})
