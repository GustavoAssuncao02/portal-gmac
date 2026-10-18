import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { pendingOrderMaterials } from '../server/pendingMaterials.js'
import { notificationDefaults } from '../server/notificationRules.js'
import { inventorySignal, recordWorkflowNotifications, workflowSnapshot } from '../server/notificationEvents.js'

const notificationTestEnv = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }

test('all four administrator notices are shared, deduplicated, individually read and configurable', async (t) => {
  let inventory = [{ id: 1, name: 'Inox', quantity: 20, minimum: 5 }]
  const fixture = await createWorkflowFixture({ accountsEnv: notificationTestEnv, notificationInventory: async () => inventory })
  t.after(() => fixture.close())
  const auth = { Authorization: `Bearer ${fixture.adminToken}` }
  const request = (route, method, body) => fixture.request(route, method, body, auth)
  const alerts = async () => (await request('/notifications')).data.items
  assert.equal((await fixture.request('/notifications')).status, 401)
  assert.equal((await fixture.request('/notifications/read-all', 'POST', {}, { Authorization: `Bearer ${fixture.operatorToken}` })).status, 401)
  assert.deepEqual((await request('/account/notifications')).data.settings, { payableReminderDays: 3, receivableReminderDays: 3, ...notificationDefaults })
  assert.deepEqual(await alerts(), [])
  const second = (await request('/admins', 'POST', { name: 'Segundo Admin', birthDate: '1990-01-01', cpf: '00000000002', email: 'segundo@example.invalid', password: 'teste123' })).data.item
  const secondAuth = { Authorization: `Bearer ${(await fixture.request('/auth/login', 'POST', { cpf: second.cpf, password: 'teste123' })).data.token}` }

  const offer = (await request('/offers', 'POST', offerDraft)).data.item
  const resources = { materials: [{ id: 'titanio', name: 'Titanio', quantity: 10, unitPrice: 20, purchaseQuantity: 10, stockStatus: 'unknown' }], laborEntries: [], stages: ['painting'], kind: 'service' }
  assert.equal((await request(`/offers/${offer.id}/resources`, 'PUT', resources)).status, 200)
  assert.equal((await alerts()).length, 1)
  assert.equal((await alerts())[0].type, 'material-request')
  await request(`/offers/${offer.id}/resources`, 'PUT', resources)
  assert.equal((await alerts()).length, 1, 'Autosaving the same material does not duplicate the request alert')
  await request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offer.deadline, serviceValue: 100 } })
  const accepted = await request(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(accepted.status, 201)
  const order = accepted.data.item
  assert.equal((await alerts()).filter((item) => item.type === 'service-added').length, 1)
  await request(`/offers/${offer.id}/accept`, 'POST')
  assert.equal((await alerts()).length, 2)

  const employee = (await request('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001', birthDate: '1990-01-01', email: 'ana@example.invalid', identification: '001' })).data.item
  const operatorAuth = { Authorization: `Bearer ${fixture.operatorToken}` }
  const route = `/operations/orders/${order.code}`
  const started = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id, pendingMaterialsConfirmation: pendingOrderMaterials(order).map((row) => [row.key, row.quantity]) }, operatorAuth)
  assert.equal(started.status, 200)
  const session = { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken }
  assert.equal((await fixture.request(`${route}/stages/${started.data.operation.stages[0].key}`, 'POST', { ...session, quantity: order.quantity }, operatorAuth)).status, 200)
  assert.equal((await fixture.request(`${route}/complete`, 'POST', session, operatorAuth)).status, 200)
  assert.equal((await alerts()).find((item) => item.type === 'service-completed').employeeName, employee.name)
  await fixture.request(`${route}/complete`, 'POST', session, operatorAuth)
  assert.equal((await alerts()).filter((item) => item.type === 'service-completed').length, 1)

  inventory = [{ ...inventory[0], quantity: 4 }]
  assert.equal((await alerts()).filter((item) => item.type === 'low-stock').length, 1)
  await Promise.all([alerts(), alerts(), alerts()])
  assert.equal((await alerts()).length, 4)
  const read = await request('/notifications/read-all', 'POST', { userId: second.id })
  assert.ok(read.data.items.every((item) => item.readAt))
  assert.ok((await fixture.request('/notifications', 'GET', undefined, secondAuth)).data.items.every((item) => !item.readAt))

  for (const key of Object.keys(notificationDefaults)) {
    assert.equal((await request('/account/notifications', 'PATCH', { [key]: 'false' })).status, 400)
  }
  await request('/account/notifications', 'PATCH', { materialRequests: false, serviceCompleted: false, lowStock: false, serviceAdded: false, userId: second.id })
  assert.deepEqual(await alerts(), [])
  assert.equal((await fixture.request('/notifications', 'GET', undefined, secondAuth)).data.items.length, 4)
  await request('/account/notifications', 'PATCH', { payableReminderDays: 7 })
  assert.equal((await request('/account/notifications')).data.settings.lowStock, false)
  const token = (await fixture.request('/auth/login', 'POST', { cpf: notificationTestEnv.DEMO_ADMIN_CPF, password: notificationTestEnv.DEMO_ADMIN_PASSWORD })).data.token
  assert.equal((await fixture.request('/account/notifications', 'GET', undefined, { Authorization: `Bearer ${token}` })).data.settings.materialRequests, false)
  await request('/account/notifications', 'PATCH', { ...notificationDefaults })
  assert.ok((await alerts()).every((item) => item.readAt))
  inventory = [{ ...inventory[0], quantity: 20 }]
  await alerts()
  inventory = [{ ...inventory[0], quantity: 3 }]
  const final = await alerts()
  assert.equal(final.filter((item) => item.type === 'low-stock').length, 2)
  assert.equal(final.filter((item) => !item.readAt).length, 1, 'Restocking then crossing the minimum creates a new unread alert')
  assert.equal(final.find((item) => !item.readAt).quantity, 3)
  await request(`/material-requests/${offer.id}-titanio/reject`, 'POST')
  assert.equal((await alerts()).filter((item) => item.type === 'material-request').length, 1)
})

test('inventory notices include OS consumption, minimum changes and new low-stock materials without startup floods', () => {
  const store = { orders: [], offers: [] }
  inventorySignal(store, { id: 1, name: 'Ferro', quantity: 4, minimum: 5 })
  assert.equal(store.operationalNotifications, undefined)
  store.notificationInventoryInitialized = true
  inventorySignal(store, { id: 2, name: 'Cobre', quantity: 1, minimum: 5 }, false)
  assert.equal(store.operationalNotifications.length, 1)
  inventorySignal(store, { id: 1, name: 'Ferro', quantity: 20, minimum: 5 })
  const before = workflowSnapshot(store)
  store.orders.push({ code: 'OS-TEST', service: 'Teste', inventoryConsumption: { processedAt: '2026-10-04T12:00:00Z', materials: [{ inventoryId: 1, name: 'Ferro', stockAvailable: 20, consumedQuantity: 16, balance: 4, minimum: 5 }] } })
  recordWorkflowNotifications(before, store)
  assert.equal(store.operationalNotifications.filter((item) => item.type === 'low-stock').length, 2)
  recordWorkflowNotifications(workflowSnapshot(store), store)
  assert.equal(store.operationalNotifications.length, 3)
  inventorySignal(store, { id: 1, name: 'Ferro', quantity: 10, minimum: 5 })
  inventorySignal(store, { id: 1, name: 'Ferro', quantity: 10, minimum: 15 })
  assert.equal(store.operationalNotifications.filter((item) => item.type === 'low-stock').length, 3)
})

test('failed workflow commits roll back notifications together with the OS', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  await assert.rejects(fixture.mutateStore((store) => {
    store.orders.push({ code: 'OS-ROLLBACK', service: 'Teste' })
  }, { commit: async () => { throw new Error('Commit failed') }, rollback: async () => {} }), /Commit failed/)
  const response = await fixture.request('/notifications', 'GET', undefined, { Authorization: `Bearer ${fixture.adminToken}` })
  assert.deepEqual(response.data.items, [])
  assert.deepEqual((await fixture.request('/orders', 'GET', undefined, fixture.admin)).data.items, [])
})
