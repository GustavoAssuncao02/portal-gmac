import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// A machine is used by one person at a time, in any OS; labor services can be shared by several people.
test('a machine taken by one person cannot be started or switched to by another; labor services are shared', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno CNC', sectors: ['Usinagem'], sector: 'Usinagem', hourlyRate: 0 }, { id: 'fresa', name: 'Fresadora universal', sectors: ['Usinagem'], sector: 'Usinagem', hourlyRate: 0 }] })
  const [service] = (await fixture.adminRequest('/labor-services')).data.items
  const [ana, bruno, carla] = await Promise.all(['Ana', 'Bruno', 'Carla'].map(async (name, index) => (await fixture.adminRequest('/employees', 'POST', { name, cpf: `0000000000${index + 1}` })).data.item))
  async function order(name) {
    const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: name })).data.item
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['painting'] })
    await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offer.deadline } })
    return (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  }
  const first = await order('Eixo'), second = await order('Flange')
  const start = (code, worker, fields) => fixture.request(`/operations/orders/${code}/start`, 'POST', { employeeId: worker.id, ...fields }, operator)

  const anaStart = await start(first.code, ana, { machineId: 'torno' })
  assert.equal(anaStart.status, 200)
  for (const code of [first.code, second.code]) {
    const refused = await start(code, bruno, { machineId: 'torno' })
    assert.equal(refused.status, 409, 'the machine is taken in this OS and in any other')
    assert.equal(refused.data.code, 'MACHINE_BUSY')
    assert.equal(refused.data.message, `A máquina Torno CNC está sendo usada por Ana na ${first.code}.`)
  }
  const machines = (await fixture.request('/machines', 'GET', undefined, operator)).data.items
  assert.deepEqual(machines.find((row) => row.id === 'torno').inUseBy, [{ employeeId: ana.id, employeeName: 'Ana', orderCode: first.code }])
  assert.deepEqual(machines.find((row) => row.id === 'fresa').inUseBy, [])

  // Labor services are shared: two people on the same service at the same time.
  const brunoStart = await start(second.code, bruno, { laborServiceId: service.id })
  assert.equal((await start(second.code, carla, { laborServiceId: service.id })).status, 200)
  const bruno1 = { sessionId: brunoStart.data.session.id, sessionToken: brunoStart.data.sessionToken }
  const route = `/operations/orders/${second.code}`
  assert.equal((await fixture.request(`${route}/resource`, 'POST', { ...bruno1, resourceType: 'machine', resourceId: 'torno' }, operator)).data.code, 'MACHINE_BUSY')
  assert.equal((await fixture.request(`${route}/machine`, 'POST', { ...bruno1, machineId: 'torno' }, operator)).status, 409)
  assert.equal((await fixture.request(`${route}/resource`, 'POST', { ...bruno1, resourceType: 'machine', resourceId: 'fresa' }, operator)).status, 200)
  assert.equal((await start(first.code, carla, { machineId: 'fresa', switchFrom: second.code })).data.code, 'MACHINE_BUSY', 'Bruno has the fresa now')

  // Ana takes her own machine along when she moves to another OS.
  const moved = await start(second.code, ana, { machineId: 'torno', switchFrom: first.code })
  assert.equal(moved.status, 200)
  // Free again after a pause.
  assert.equal((await fixture.request(`${route}/pause`, 'POST', { sessionId: moved.data.session.id, sessionToken: moved.data.sessionToken, reason: 'Descanso' }, operator)).status, 200)
  assert.equal((await fixture.request(`${route}/resource`, 'POST', { ...bruno1, resourceType: 'machine', resourceId: 'torno' }, operator)).status, 200)
})
