import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const person = (index, fields = {}) => ({ name: `Funcionário ${index}`, cpf: `0000000000${index}`, ...fields })

async function orderFor(fixture) {
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  return (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
}

test('sectors: simple registry linked to employees, protected while in use', async () => {
  const fixture = await createWorkflowFixture()
  try {
    assert.equal((await fixture.request('/sectors')).status, 401)
    const usinagem = (await fixture.adminRequest('/sectors', 'POST', { name: '  Usinagem ' })).data.item
    assert.equal(usinagem.name, 'Usinagem')
    assert.equal((await fixture.adminRequest('/sectors', 'POST', { name: 'usinagem' })).status, 409, 'names do not repeat')
    assert.equal((await fixture.adminRequest('/sectors', 'POST', { name: '' })).status, 400)
    const pintura = (await fixture.adminRequest('/sectors', 'POST', { name: 'Pintura' })).data.item
    assert.equal((await fixture.adminRequest('/employees', 'POST', person(1, { sectorId: 'inexistente' }))).status, 400)
    const ana = (await fixture.adminRequest('/employees', 'POST', person(1, { sectorId: usinagem.id }))).data.item
    let list = (await fixture.adminRequest('/employees')).data
    assert.equal(list.items[0].sectorName, 'Usinagem')
    assert.deepEqual(list.sectors.map((sector) => sector.name), ['Pintura', 'Usinagem'])
    assert.equal((await fixture.adminRequest('/sectors')).data.items.find((sector) => sector.id === usinagem.id).employees, 1)
    assert.equal((await fixture.adminRequest(`/sectors/${usinagem.id}`, 'DELETE')).status, 409, 'a sector with employees stays')
    await fixture.adminRequest(`/employees/${ana.id}`, 'PUT', person(1, { sectorId: pintura.id, accessCode: ana.accessCode }))
    await fixture.adminRequest(`/sectors/${pintura.id}`, 'PUT', { name: 'Pintura industrial' })
    list = (await fixture.adminRequest('/employees')).data
    assert.equal(list.items[0].sectorName, 'Pintura industrial', 'renaming reaches the employees')
    // Machines and labor services keep sector names from the registry: a rename reaches them, and they protect it too.
    const services = async () => (await fixture.adminRequest('/labor-services')).data.items
    assert.deepEqual((await services()).find((item) => item.name === 'Pintura industrial').sectors, ['Pintura industrial'])
    const removal = await fixture.adminRequest(`/sectors/${usinagem.id}`, 'DELETE')
    assert.equal(removal.status, 409)
    assert.match(removal.data.message, /2 serviços/)
    const machine = (await fixture.adminRequest('/machines', 'POST', { name: 'Torno 01', sectors: ['usinagem', 'Solda'], hourlyRate: 80 })).data.item
    assert.deepEqual(machine.sectors, ['Usinagem', 'Solda'], 'the spelling of the registry, and a new name is registered')
    const sectors = (await fixture.adminRequest('/sectors')).data.items
    assert.deepEqual(sectors.map((sector) => [sector.name, sector.machines]), [['Pintura industrial', 0], ['Solda', 1], ['Usinagem', 1]].filter(([name]) => sectors.some((item) => item.name === name)))
    await fixture.adminRequest(`/sectors/${usinagem.id}`, 'PUT', { name: 'Usinagem CNC' })
    assert.deepEqual((await fixture.adminRequest('/machines')).data.items[0].sectors, ['Usinagem CNC', 'Solda'])
    assert.equal((await fixture.adminRequest('/machines')).data.items[0].sector, 'Usinagem CNC e Solda')
    // An employee may belong to more than one sector.
    const solda = sectors.find((sector) => sector.name === 'Solda')
    const both = (await fixture.adminRequest('/employees', 'POST', person(4, { sectorIds: [usinagem.id, solda.id] }))).data.item
    assert.deepEqual(both.sectorIds, [usinagem.id, solda.id])
    assert.equal(both.sectorId, usinagem.id, 'the first one is kept for older readers')
    assert.deepEqual((await fixture.adminRequest('/employees')).data.items.find((item) => item.id === both.id).sectorNames, ['Usinagem CNC', 'Solda'])
    assert.equal((await fixture.adminRequest('/employees', 'POST', person(5, { sectorIds: [usinagem.id, 'inexistente'] }))).status, 400)
  } finally { await fixture.close() }
})

test('the first start creates Usinagem, Caldeiraria and Pintura once, and registers the sectors already typed in machines and services', async () => {
  const fixture = await createWorkflowFixture()
  try {
    await fixture.mutateStore((store) => { store.machines = [{ id: 'm1', name: 'Plasma', sectors: ['caldeiraria'], sector: 'caldeiraria' }, { id: 'm2', name: 'Lixadeira', sector: 'Acabamento fino' }] })
    const { ensureSectors } = await fixture.serverModule('registries.js')
    await ensureSectors()
    const names = async () => (await fixture.adminRequest('/sectors')).data.items.map((sector) => sector.name)
    for (const name of ['Usinagem', 'Caldeiraria', 'Pintura', 'Acabamento fino', 'Montagem']) assert.ok((await names()).includes(name), name)
    assert.equal((await names()).filter((name) => name.toLowerCase() === 'caldeiraria').length, 1, 'a typed name joins the registered one')
    assert.deepEqual((await fixture.adminRequest('/machines')).data.items.find((item) => item.id === 'm1').sectors, ['Caldeiraria'])
    const pintura = (await fixture.adminRequest('/sectors')).data.items.find((sector) => sector.name === 'Pintura')
    await fixture.mutateStore((store) => { store.laborServices = store.laborServices.filter((item) => !item.sectors.includes('Pintura')) })
    assert.equal((await fixture.adminRequest(`/sectors/${pintura.id}`, 'DELETE')).status, 204)
    await ensureSectors()
    assert.ok(!(await names()).includes('Pintura'), 'a default sector removed later does not come back')
  } finally { await fixture.close() }
})

test('employees: delete only before any work; afterwards deactivate, which blocks the operator code', async () => {
  const fixture = await createWorkflowFixture()
  try {
    const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
    const unused = (await fixture.adminRequest('/employees', 'POST', person(2))).data.item
    const worker = (await fixture.adminRequest('/employees', 'POST', person(3))).data.item
    const order = await orderFor(fixture)
    const started = await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: worker.id }, operator)
    assert.equal(started.status, 200)
    const rows = (await fixture.adminRequest('/employees')).data.items
    assert.deepEqual(rows.map((row) => [row.name, row.hasActivity, row.active]), [['Funcionário 2', false, true], ['Funcionário 3', true, true]])
    assert.equal((await fixture.adminRequest(`/employees/${worker.id}`, 'DELETE')).status, 409, 'an employee who worked is kept')
    assert.equal((await fixture.adminRequest(`/employees/${worker.id}/active`, 'PATCH', { active: false })).status, 409, 'not while working')
    const session = { sessionId: started.data.session.id, sessionToken: started.data.sessionToken }
    assert.equal((await fixture.request(`/operations/orders/${order.code}/pause`, 'POST', { ...session, reason: 'Descanso' }, operator)).status, 200)
    assert.equal((await fixture.adminRequest(`/employees/${worker.id}/active`, 'PATCH', { active: false })).status, 200)
    assert.equal((await fixture.request('/operations/operator/identify', 'POST', { code: worker.accessCode }, operator)).status, 403)
    assert.equal((await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: worker.id }, operator)).status, 403)
    assert.equal((await fixture.adminRequest('/employees')).data.items.find((row) => row.id === worker.id).active, false)
    assert.equal((await fixture.adminRequest(`/employees/${worker.id}/active`, 'PATCH', { active: true })).status, 200)
    assert.equal((await fixture.request('/operations/operator/identify', 'POST', { code: worker.accessCode }, operator)).status, 200)
    assert.equal((await fixture.adminRequest(`/employees/${unused.id}`, 'DELETE')).status, 204, 'a registration never used can be deleted')
  } finally { await fixture.close() }
})

test('pause reasons: registry used by the operator pause, with the count of pauses per reason', async () => {
  const fixture = await createWorkflowFixture()
  try {
    const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
    const reasons = (await fixture.request('/pause-reasons', 'GET', undefined, operator)).data.items
    assert.deepEqual(reasons.map((item) => item.name), ['Descanso', 'Horário de almoço', 'Jossenilson mandou parar', 'Troca de atividade'], 'the previous fixed reasons become the first registrations')
    assert.equal((await fixture.request('/pause-reasons', 'POST', { name: 'Falta de energia' }, operator)).status, 401, 'only the administration manages the list')
    const energy = (await fixture.adminRequest('/pause-reasons', 'POST', { name: 'Falta de energia' })).data.item
    assert.equal((await fixture.adminRequest('/pause-reasons', 'POST', { name: 'Troca de serviço' })).status, 409, 'the reason recorded by the system is reserved')
    const worker = (await fixture.adminRequest('/employees', 'POST', person(4))).data.item
    const order = await orderFor(fixture)
    const pauseWith = async (reason) => {
      const started = await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: worker.id }, operator)
      return fixture.request(`/operations/orders/${order.code}/pause`, 'POST', { sessionId: started.data.session.id, sessionToken: started.data.sessionToken, reason }, operator)
    }
    assert.equal((await pauseWith('Falta de energia')).status, 200)
    assert.equal((await pauseWith('Descanso')).status, 200)
    assert.equal((await pauseWith('Falta de energia')).status, 200)
    assert.equal((await pauseWith('Motivo inventado')).status, 400, 'only registered reasons')
    await fixture.adminRequest(`/pause-reasons/${energy.id}`, 'DELETE')
    assert.deepEqual((await fixture.adminRequest('/pause-reasons/stats')).data.items, [{ name: 'Falta de energia', count: 2 }, { name: 'Descanso', count: 1 }], 'pauses already recorded keep counting after the reason is removed')
  } finally { await fixture.close() }
})
