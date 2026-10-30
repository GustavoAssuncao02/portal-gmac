import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

test('completion remains unacknowledged until explicit confirmation, preserving the OS and an idempotent audit event', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cut-bend'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const route = `/operations/orders/${order.code}`
  assert.equal((await fixture.adminRequest(`${route}/acknowledge-completion`, 'POST')).status, 409)
  assert.equal((await fixture.adminRequest('/operations/orders/unknown/acknowledge-completion', 'POST')).status, 404)
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Funcionario de teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'teste@example.invalid', identification: '001' }, fixture.admin)).data.item
  const headers = { Authorization: `Bearer ${fixture.operatorToken}` }
  const started = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id }, headers)
  const session = { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken }
  const stage = started.data.operation.stages[0]
  assert.equal((await fixture.request(`${route}/stages/${stage.key}`, 'POST', { ...session, quantity: order.quantity }, headers)).status, 200)
  assert.equal((await fixture.adminRequest(`${route}/acknowledge-completion`, 'POST')).status, 409)
  const completed = await fixture.request(`${route}/complete`, 'POST', session, headers)
  assert.equal(completed.status, 200)
  assert.equal(completed.data.operation.status, 'completed')
  assert.ok(!completed.data.operation.completionAcknowledgedAt)
  let items = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items
  assert.equal(items.length, 1)
  assert.ok(!items[0].operation.completionAcknowledgedAt)
  const acknowledged = await fixture.adminRequest(`${route}/acknowledge-completion`, 'POST')
  assert.equal(acknowledged.status, 200)
  const at = acknowledged.data.operation.completionAcknowledgedAt
  assert.ok(Number.isFinite(Date.parse(at)))
  assert.equal(acknowledged.data.operation.status, 'completed')
  assert.equal(acknowledged.data.operation.completedAt, completed.data.operation.completedAt)
  assert.equal(acknowledged.data.operation.accumulatedMs, completed.data.operation.accumulatedMs)
  assert.equal(acknowledged.data.operation.progress, 100)
  assert.equal(acknowledged.data.event.type, 'completion_acknowledged')
  const repeat = await fixture.adminRequest(`${route}/acknowledge-completion`, 'POST')
  assert.equal(repeat.status, 200)
  assert.equal(repeat.data.operation.completionAcknowledgedAt, at)
  assert.equal(repeat.data.event, null)
  const events = (await fixture.request(`${route}/events`, 'GET', undefined, { Authorization: `Bearer ${fixture.operatorToken}` })).data.items
  assert.equal(events.filter((event) => event.type === 'completion_acknowledged').length, 1)
  items = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items
  assert.equal(items.length, 1)
  assert.equal(items[0].operation.completionAcknowledgedAt, at)
  assert.equal(items[0].offerId, offer.id)
  assert.equal(items[0].description, offerDraft.description)
  assert.equal((await fixture.request('/orders', 'GET', undefined, fixture.admin)).data.items.length, 1)
})
