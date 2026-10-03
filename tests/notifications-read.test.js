import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'

test('notification reads persist per administrator without deleting alerts or hiding new arrivals', async (t) => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  assert.equal((await fixture.request('/payables/notifications/read-all', 'POST')).status, 401)
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const headers = { Authorization: `Bearer ${token}` }
  const request = (route, method, body) => fixture.request(route, method, body, headers)
  const second = (await request('/admins', 'POST', { name: 'Outro Admin', cpf: '00000000002', email: 'admin@example.invalid', birthDate: '1990-01-01', password: 'teste123' })).data.item
  const secondToken = (await fixture.request('/auth/login', 'POST', { cpf: second.cpf, password: 'teste123' })).data.token
  const secondHeaders = { Authorization: `Bearer ${secondToken}` }
  const supplier = (await request('/suppliers', 'POST', { name: 'Fornecedor', document: '12345678000190' })).data.item
  const classification = (await request('/classifications', 'POST', { name: 'Materiais' })).data.item
  const draft = { supplierId: supplier.id, classificationId: classification.id, description: 'Aviso de teste', issueDate: todayBahia(), dueDate: todayBahia(), kind: 'normal' }
  for (const value of ['10', '20']) await request('/payables', 'POST', { ...draft, value })
  const initial = (await request('/payables/notifications')).data.items
  assert.equal(initial.length, 2)
  assert.ok(initial.every((item) => item.readAt === null))
  const before = (await request('/payables')).data.items
  const read = await request('/payables/notifications/read-all', 'POST', { userId: second.id })
  assert.equal(read.status, 200)
  assert.equal(read.data.items.length, 2)
  assert.ok(read.data.items.every((item) => Number.isFinite(Date.parse(item.readAt)) && item.readBy === undefined))
  assert.deepEqual((await request('/payables/notifications')).data.items, read.data.items)
  assert.deepEqual((await request('/payables/notifications/read-all', 'POST')).data.items, read.data.items)
  assert.deepEqual((await request('/payables')).data.items, before)
  const other = (await fixture.request('/payables/notifications', 'GET', undefined, secondHeaders)).data.items
  assert.ok(other.every((item) => item.readAt === null))
  const newAccount = (await request('/payables', 'POST', { ...draft, value: '30' })).data.items[0]
  const withNew = (await request('/payables/notifications')).data.items
  assert.equal(withNew.filter((item) => !item.readAt).length, 1)
  assert.equal(withNew.find((item) => !item.readAt).accountId, newAccount.id)
  await request('/payables/notifications/read-all', 'POST')
  assert.equal((await request('/payables/notifications')).data.items.filter((item) => !item.readAt).length, 0)
  assert.equal((await fixture.request('/payables/notifications', 'GET', undefined, secondHeaders)).data.items.filter((item) => !item.readAt).length, 3)
})
