import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

test('an operator works on one OS at a time: starting another asks first and, once confirmed, pauses the current one with "Troca de serviço"', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  const [service] = (await fixture.adminRequest('/labor-services')).data.items
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001' })).data.item
  const other = (await fixture.adminRequest('/employees', 'POST', { name: 'Bruno Teste', cpf: '00000000002', birthDate: '1992-06-20', email: 'bruno@example.invalid' })).data.item
  assert.equal(employee.birthDate, null, 'birth date and e-mail are optional for employees')
  async function order(name) {
    const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: name })).data.item
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['painting'] })
    await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offer.deadline } })
    return (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  }
  const first = await order('Eixo da primeira OS'), second = await order('Flange da segunda OS')
  const start = (code, worker, fields = {}) => fixture.request(`/operations/orders/${code}/start`, 'POST', { employeeId: worker.id, laborServiceId: service.id, ...fields }, operator)
  const started = await start(first.code, employee)
  assert.equal(started.status, 200)
  assert.deepEqual(started.data.switched, [])
  // Another person on the other OS is not affected.
  assert.equal((await start(second.code, other)).status, 200)

  const asked = await start(second.code, employee)
  assert.equal(asked.status, 409)
  assert.equal(asked.data.code, 'WORKING_ELSEWHERE')
  assert.deepEqual(asked.data.busyOrder, { code: first.code, service: 'Eixo da primeira OS' })
  assert.match(asked.data.message, new RegExp(`Ana Teste já está trabalhando na OS ${first.code}`))
  assert.equal((await start(second.code, employee, { switchFrom: 'OS-OUTRA' })).status, 409, 'the confirmation names the OS being left')

  const switched = await start(second.code, employee, { switchFrom: first.code })
  assert.equal(switched.status, 200)
  assert.deepEqual(switched.data.switched, [{ orderCode: first.code, sessionId: started.data.session.id }])
  const orders = (await fixture.adminRequest('/operations/orders')).data.items
  const left = orders.find((item) => item.code === first.code).operation, joined = orders.find((item) => item.code === second.code).operation
  assert.equal(left.status, 'paused')
  assert.equal(left.lastPauseReason, 'Troca de serviço')
  assert.equal(left.activeSessions.length, 0)
  assert.deepEqual(joined.activeSessions.map((session) => session.employeeName).sort(), ['Ana Teste', 'Bruno Teste'])
  const events = (await fixture.adminRequest(`/operations/orders/${first.code}/events`)).data.items
  const pause = events.find((event) => event.type === 'paused')
  assert.equal(pause.reason, 'Troca de serviço')
  assert.equal(pause.at, switched.data.session.startedAt, 'the old work ends when the new one starts')
  // The old session key no longer works; the operator is free to go back, asking again.
  assert.equal((await fixture.request(`/operations/orders/${first.code}/pause`, 'POST', { sessionId: started.data.session.id, sessionToken: started.data.sessionToken, reason: 'Descanso' }, operator)).status, 409)
  assert.equal((await start(first.code, employee)).data.code, 'WORKING_ELSEWHERE')

  // Who worked on each OS, for the filter of the finished services.
  const collaborators = (code) => orders.find((item) => item.code === code).collaborators.map((person) => person.name).sort()
  assert.deepEqual(collaborators(first.code), ['Ana Teste'])
  assert.deepEqual(collaborators(second.code), ['Ana Teste', 'Bruno Teste'])

  // Idle operators (Máquinas screen): nobody else is working; whoever stopped today shows when and why.
  const carla = (await fixture.adminRequest('/employees', 'POST', { name: 'Carla Teste', cpf: '00000000003' })).data.item
  assert.equal((await fixture.request('/operations/idle-employees')).status, 401)
  let idle = (await fixture.adminRequest('/operations/idle-employees')).data
  assert.deepEqual(idle.items.map((person) => person.name), ['Carla Teste'])
  assert.equal(idle.working, 2)
  const anaSession = { sessionId: switched.data.session.id, sessionToken: switched.data.sessionToken }
  assert.equal((await fixture.request(`/operations/orders/${second.code}/pause`, 'POST', { ...anaSession, reason: 'Descanso' }, operator)).status, 200)
  idle = (await fixture.adminRequest('/operations/idle-employees')).data.items
  assert.deepEqual(idle.map((person) => [person.name, person.reason, person.orderCode]), [['Carla Teste', null, null], ['Ana Teste', 'Descanso', second.code]])
  assert.equal(idle[0].idleSince, null)
  assert.ok(Date.parse(idle[1].idleSince) >= Date.parse(switched.data.session.startedAt))
  assert.equal(idle.some((person) => person.id === carla.id), true)
})
