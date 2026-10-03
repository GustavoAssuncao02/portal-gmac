import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'

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
  assert.deepEqual((await fixture.request('/material-requests', 'GET', undefined, otherHeaders)).data, first.data)
  assert.deepEqual((await fixture.request('/material-requests/import', 'POST', { items: [] }, otherHeaders)).data, first.data)
  const imported = await fixture.request('/material-requests/import', 'POST', { items: [{ id: 'offer-a-material-a', status: 'purchase-requested' }, { id: 'offer-a-material-b', status: 'purchase-requested' }, { id: 'deleted-material', status: 'purchase-requested' }] }, otherHeaders)
  assert.equal(imported.data.items.length, 2)
  assert.deepEqual(imported.data.items[0], first.data.items[0])
  assert.equal((await fixture.request('/material-requests/import', 'POST', { items: [{ id: 'wrong', status: 'pending' }] }, headers)).status, 400)
})
