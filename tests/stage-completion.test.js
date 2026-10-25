import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

test('a finished stage makes everyone on it idle, and the last stage keeps the work until the service is completed', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, quantity: 2 })).data.item
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['turning', 'painting'], kind: 'service' })).status, 200)
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })).status, 200)
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const ana = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana', cpf: '00000000001' })).data.item
  const bruno = (await fixture.adminRequest('/employees', 'POST', { name: 'Bruno', cpf: '00000000002' })).data.item
  const auth = { Authorization: `Bearer ${fixture.operatorToken}` }
  const route = `/operations/orders/${order.code}`
  const start = async (employee, stageKey) => {
    const started = (await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id, stageKey }, auth)).data
    return { sessionId: started.session.id, sessionToken: started.sessionToken }
  }
  const anaKey = await start(ana, 'stage-1')
  const brunoKey = await start(bruno, 'stage-1')

  // A partial count keeps both working.
  let result = await fixture.request(`${route}/stages/stage-1`, 'POST', { ...anaKey, quantity: 1, completedBySessionId: anaKey.sessionId }, auth)
  assert.equal(result.status, 200)
  assert.equal(result.data.operation.activeSessions.length, 2)
  assert.equal(result.data.operation.status, 'running')

  // Every piece of the stage: both stop, and the OS shows the finished stage.
  result = await fixture.request(`${route}/stages/stage-1`, 'POST', { ...anaKey, quantity: 1, completedBySessionId: brunoKey.sessionId }, auth)
  assert.equal(result.status, 200)
  assert.equal(result.data.operation.activeSessions.length, 0)
  assert.equal(result.data.operation.status, 'stage_done')
  assert.deepEqual(result.data.events.map((event) => event.type), ['stage_progress', 'stage_completed', 'stage_completed'])
  assert.deepEqual(result.data.events.slice(1).map((event) => [event.employeeName, event.reason, event.workStageName]), [['Ana', 'Etapa concluída', 'Tornearia'], ['Bruno', 'Etapa concluída', 'Tornearia']])
  assert.notEqual((await fixture.request(`${route}/stages/stage-2`, 'POST', { ...anaKey, quantity: 1 }, auth)).status, 200, 'the closed session no longer registers')
  const idle = (await fixture.adminRequest('/operations/idle-employees')).data.items
  assert.deepEqual(idle.filter((person) => ['Ana', 'Bruno'].includes(person.name)).map((person) => [person.name, person.reason, person.orderCode]), [['Ana', 'Etapa concluída', order.code], ['Bruno', 'Etapa concluída', order.code]])

  // The next stage starts again; the last one keeps the work open until the service is completed.
  const next = await start(ana, 'stage-2')
  result = await fixture.request(`${route}/stages/stage-2`, 'POST', { ...next, quantity: 2 }, auth)
  assert.equal(result.status, 200)
  assert.equal(result.data.operation.status, 'finalizing')
  assert.equal(result.data.operation.activeSessions.length, 1)
  assert.equal((await fixture.request(`${route}/complete`, 'POST', next, auth)).status, 200)
})
