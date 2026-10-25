import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// A machine in maintenance cannot be chosen by any operator until it is released; each period is kept.
test('maintenance takes a machine out of use, waits for the work on it to pause and keeps the history', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno 01', sectors: ['Usinagem'], sector: 'Usinagem', hourlyRate: 80 }, { id: 'fresa', name: 'Fresa 02', sectors: ['Usinagem'], sector: 'Usinagem', hourlyRate: 90 }] })
  const ana = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001' })).data.item
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning', 'milling'], stageResources: { turning: { type: 'machine', id: 'torno' } } })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offerDraft.deadline } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const maintenance = (id, body, headers) => fixture.request(`/machines/${id}/maintenance`, 'POST', body, headers)
  const machine = async (id) => (await fixture.adminRequest('/machines')).data.items.find((item) => item.id === id)

  assert.equal((await maintenance('torno', { active: true, reason: 'Troca do rolamento' }, operator)).status, 401, 'only administrators')
  assert.equal((await fixture.adminRequest('/machines/torno/maintenance', 'POST', { active: true, reason: ' ' })).status, 400, 'the reason is required')
  assert.equal((await fixture.adminRequest('/machines/nada/maintenance', 'POST', { active: true, reason: 'Troca do rolamento' })).status, 404)
  assert.equal((await fixture.adminRequest('/machines/torno/maintenance', 'POST', { active: true, reason: 'Troca do rolamento' })).status, 200)
  const stopped = await machine('torno')
  assert.equal(stopped.status, 'maintenance')
  assert.equal(stopped.maintenance.reason, 'Troca do rolamento')
  assert.ok(stopped.maintenance.since && stopped.maintenance.startedBy)

  // Any route that would put someone on the machine refuses it: the planned stage, and the free choice of a machine.
  const start = (fields) => fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: ana.id, ...fields }, operator)
  let refused = await start({ machineId: 'torno' })
  assert.equal(refused.status, 409)
  assert.equal(refused.data.code, 'MACHINE_MAINTENANCE')
  assert.equal(refused.data.message, 'A máquina Torno 01 está em manutenção.')
  const milling = (await fixture.adminRequest('/operations/orders')).data.items.find((item) => item.code === order.code).operation.stages[1]
  const started = await start({ machineId: 'fresa', stageKey: milling.key })
  assert.equal(started.status, 200, started.data?.message)
  const session = { sessionId: started.data.session.id, sessionToken: started.data.sessionToken }
  refused = await fixture.request(`/operations/orders/${order.code}/resource`, 'POST', { resourceType: 'machine', resourceId: 'torno', ...session }, operator)
  assert.equal(refused.data.code, 'MACHINE_MAINTENANCE')
  refused = await fixture.request(`/operations/orders/${order.code}/work-stage`, 'POST', { stageKey: (await fixture.adminRequest('/operations/orders')).data.items.find((item) => item.code === order.code).operation.stages[0].key, ...session }, operator)
  assert.equal(refused.data.code, 'MACHINE_MAINTENANCE', 'the stage planned on the machine waits for it')

  // A machine in use cannot go to maintenance: the work is paused first.
  const busy = await fixture.adminRequest('/machines/fresa/maintenance', 'POST', { active: true, reason: 'Revisão preventiva' })
  assert.equal(busy.status, 409)
  assert.match(busy.data.message, /sendo usada por Ana Teste.*Pause o trabalho/)

  // Editing the machine keeps the maintenance; releasing it keeps the period in the history.
  assert.equal((await fixture.adminRequest('/machines/torno', 'PUT', { ...stopped, name: 'Torno 01A', maintenance: null })).status, 200)
  assert.equal((await machine('torno')).status, 'maintenance')
  assert.equal((await fixture.adminRequest('/machines/torno/maintenance', 'POST', { active: false })).status, 200)
  const released = await machine('torno')
  assert.equal(released.status, 'idle')
  assert.equal(released.maintenance, null)
  assert.equal(released.maintenanceHistory.length, 1)
  assert.equal(released.maintenanceHistory[0].reason, 'Troca do rolamento')
  assert.ok(released.maintenanceHistory[0].until && released.maintenanceHistory[0].endedBy)
  const moved = await fixture.request(`/operations/orders/${order.code}/resource`, 'POST', { resourceType: 'machine', resourceId: 'torno', ...session }, operator)
  assert.notEqual(moved.data?.code, 'MACHINE_MAINTENANCE', 'released, the machine can be chosen again')
})
