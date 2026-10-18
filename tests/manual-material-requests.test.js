import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
async function login(fixture, cpf = env.DEMO_ADMIN_CPF) {
  const response = await fixture.request('/auth/login', 'POST', { cpf, password: env.DEMO_ADMIN_PASSWORD })
  assert.equal(response.status, 200)
  return { Authorization: `Bearer ${response.data.token}` }
}

test('manual requests are authenticated, do not create OS/stock, notify administrators and keep refusal with actor history', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const gustavo = await login(fixture)
    const marina = (await fixture.request('/admins', 'POST', { name: 'Marina', birthDate: '1990-01-01', cpf: '12345678902', email: 'marina@example.invalid', password: env.DEMO_ADMIN_PASSWORD }, gustavo)).data.item
    assert.ok(marina.id)
    const other = await login(fixture, marina.cpf)
    const body = { name: 'Titanio', detail: 'Chapa 10mm', quantity: 12.5 }
    assert.equal((await fixture.request('/material-requests', 'POST', body)).status, 401)
    for (const invalid of [{ ...body, name: '' }, { ...body, quantity: 0 }, { ...body, inventoryId: -1 }, { ...body, quantity: 'not-a-number' }]) assert.equal((await fixture.request('/material-requests', 'POST', invalid, gustavo)).status, 400)
    const response = await fixture.request('/material-requests', 'POST', body, gustavo)
    assert.equal(response.status, 201)
    const material = response.data.item
    assert.match(material.code, /^PM-\d{4}-\d{4}$/)
    assert.equal(material.requestedByName, 'Gustavo')
    assert.equal(material.purchaseQuantity, 12.5)
    assert.equal((await fixture.request('/orders', 'GET', undefined, fixture.admin)).data.items.length, 0)
    assert.equal((await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items.length, 0)
    const notifications = await fixture.request('/notifications', 'GET', undefined, gustavo)
    assert.ok(notifications.data.items.some((notice) => notice.type === 'material-request' && notice.requestId === material.id))
    assert.equal((await fixture.request(`/material-requests/${material.id}/reject`, 'POST', {}, other)).status, 200)
    const saved = (await fixture.request('/material-requests', 'GET', undefined, gustavo)).data.manualRequests
    assert.equal(saved.length, 1)
    assert.equal(saved[0].requestRejection.rejectedByName, 'Marina')
    assert.equal(saved[0].purchaseQuantity, 12.5)
    const history = await fixture.request(`/material-requests/${material.id}/history`, 'GET', undefined, gustavo)
    assert.deepEqual(history.data.items.map((event) => [event.type, event.userName]), [['requested', 'Gustavo'], ['rejected', 'Marina']])
    assert.equal((await fixture.request(`/material-requests/${material.id}/receive-local`, 'POST', { materialId: 6, quantity: 12.5 }, other)).status, 409)
    assert.equal((await fixture.request(`/material-requests/${material.id}/history`)).status, 401)
    assert.ok(!JSON.stringify(history.data).includes('password'))
  } finally { await fixture.close() }
})

test('manual stock requests keep complete partial receipt history and never allocate to an OS', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const auth = await login(fixture)
    const material = (await fixture.request('/material-requests', 'POST', { name: 'Inox', detail: 'Chapa', inventoryId: 7, quantity: 10 }, auth)).data.item
    const route = `/material-requests/${material.id}/receive-local`
    const first = { materialId: 7, quantity: 4, receiptId: 'first' }
    assert.equal((await fixture.request(route, 'POST', first, auth)).data.item.allocatedQuantity, 0)
    assert.equal((await fixture.request(route, 'POST', first, auth)).data.item.alreadyReceived, true)
    assert.equal((await fixture.request('/material-requests', 'GET', undefined, auth)).data.manualRequests[0].purchaseQuantity, 6)
    assert.equal((await fixture.request(route, 'POST', { materialId: 7, quantity: 6, receiptId: 'second' }, auth)).status, 200)
    const history = (await fixture.request(`/material-requests/${material.id}/history`, 'GET', undefined, auth)).data.items
    assert.deepEqual(history.map((event) => event.type), ['requested', 'received', 'received'])
    assert.deepEqual(history.map((event) => event.userName), ['Gustavo', 'Gustavo', 'Gustavo'])
    assert.deepEqual(history.slice(1).map((event) => event.quantity), [4, 6])
    assert.ok(history.slice(1).every((event) => !event.orderCode && event.allocatedQuantity === 0))
    assert.equal((await fixture.request('/material-requests', 'GET', undefined, auth)).data.manualRequests[0].purchaseQuantity, 0)
  } finally { await fixture.close() }
})

test('OS request history tracks the resource creator, preserves server identity and handles legacy unknown actors', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const auth = await login(fixture)
    const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
    const body = { materials: [{ id: 'material', name: 'Titanio', quantity: 10, purchaseQuantity: 10, requestedByName: 'Forged name' }], laborEntries: [], stages: ['painting'], kind: 'service' }
    const saved = await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', body, auth)
    assert.equal(saved.data.item.resources.materials[0].requestedByName, 'Gustavo')
    const id = `${offer.id}-material`
    assert.equal((await fixture.request(`/material-requests/${id}/history`, 'GET', undefined, auth)).data.items[0].userName, 'Gustavo')
    await fixture.request(`/material-requests/${id}/reject`, 'POST', {}, auth)
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', body, auth)
    const history = (await fixture.request(`/material-requests/${id}/history`, 'GET', undefined, auth)).data.items
    assert.deepEqual(history.map((event) => event.userName), ['Gustavo', 'Gustavo'])
    await fixture.mutateStore((store) => { store.offers.push({ id: 'old', resources: { materials: [{ id: 'material', name: 'Ferro', quantity: 1 }] } }) })
    assert.equal((await fixture.request('/material-requests/old-material/history', 'GET', undefined, auth)).data.items[0].userName, 'Não identificado (registro antigo)')
  } finally { await fixture.close() }
})
