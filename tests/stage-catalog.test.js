import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const byName = (stages, name) => stages.find((row) => row.name === name)

test('Etapas: the stages of the system come registered by sector, and new ones are created, edited, deactivated and deleted', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const first = (await fixture.adminRequest('/stages')).data
  assert.deepEqual(first.groups, ['Usinagem', 'Pintura', 'Caldeiraria'])
  assert.equal(first.stages.length, 19)
  assert.deepEqual(first.stages.filter((row) => !row.active).map((row) => row.name), ['Corte', 'Usinagem', 'Soldagem', 'Caldeiraria'])
  assert.equal(byName(first.stages, 'Tornearia').group, 'Usinagem')
  assert.equal((await fixture.request('/stages', 'POST', { name: 'X' })).status, 401, 'administrators only')
  const usinagem = first.sectors.find((row) => row.name === 'Usinagem')
  const caldeiraria = first.sectors.find((row) => row.name === 'Caldeiraria')

  // A new stage with its machines and services (the first is the default); only registered ones are accepted.
  const lathe = (await fixture.adminRequest('/machines', 'POST', { name: 'Torno 01', type: 'Torno', sector: 'Usinagem', hourlyRate: 100 })).data.item
  const grinder = (await fixture.adminRequest('/machines', 'POST', { name: 'Retífica 02', type: 'Retífica', sector: 'Usinagem', hourlyRate: 90 })).data.item
  const bench = (await fixture.adminRequest('/labor-services', 'POST', { name: 'Bancada', hourlyRate: 50 })).data.item
  assert.equal((await fixture.adminRequest('/stages', 'POST', { name: 'Retífica', sectorId: usinagem.id, resources: [{ type: 'machine', id: 'nao-existe' }] })).status, 400)
  assert.equal((await fixture.adminRequest('/stages', 'POST', { name: 'tornearia', sectorId: usinagem.id })).status, 409, 'names are unique')
  assert.equal((await fixture.adminRequest('/stages', 'POST', { name: 'Retífica', sectorId: 'nenhum' })).status, 400)
  const created = await fixture.adminRequest('/stages', 'POST', { name: 'Retífica', sectorId: usinagem.id, resources: [{ type: 'machine', id: grinder.id }, { type: 'labor-service', id: bench.id }, { type: 'machine', id: grinder.id }] })
  assert.equal(created.status, 201)
  const grinding = byName(created.data.stages, 'Retífica')
  assert.deepEqual([grinding.group, grinding.active, grinding.inUse, grinding.resources], ['Usinagem', true, false, [{ type: 'machine', id: grinder.id }, { type: 'labor-service', id: bench.id }]])

  // An offer can check it at once; its default order has it at the end of Usinagem.
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  const saved = await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: [grinding.code, 'turning'], stageResources: { [grinding.code]: { type: 'machine', id: grinder.id }, turning: { type: 'machine', id: lathe.id } }, stageTimes: { [grinding.code]: 60, turning: 30 } })
  assert.equal(saved.status, 200)
  assert.equal(saved.data.item.resources.stageLayout[0].stages.at(-1), grinding.code)

  // Used, it cannot be deleted, only deactivated; an unused stage is deleted.
  assert.equal((await fixture.adminRequest(`/stages/${grinding.code}`, 'DELETE')).status, 409)
  const spare = byName((await fixture.adminRequest('/stages', 'POST', { name: 'Brunimento', sectorId: usinagem.id })).data.stages, 'Brunimento')
  assert.equal((await fixture.adminRequest(`/stages/${spare.code}`, 'DELETE')).status, 200)
  assert.equal(byName((await fixture.adminRequest('/stages')).data.stages, 'Brunimento'), undefined)
  const off = await fixture.adminRequest(`/stages/${grinding.code}/active`, 'PATCH', { active: false })
  assert.equal(byName(off.data.stages, 'Retífica').active, false)

  // Deactivated: the offer that has it keeps it, another one cannot check it.
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: [grinding.code, 'turning'] })).status, 200)
  const other = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  const refused = await fixture.adminRequest(`/offers/${other.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: [grinding.code] })
  assert.equal(refused.status, 400)
  assert.match(refused.data.message, /Retífica está desativada/)

  // Moved to another sector, the stage goes to that group; the sector cannot be deleted while it has stages.
  const moved = await fixture.adminRequest(`/stages/${grinding.code}`, 'PUT', { name: 'Retífica', sectorId: caldeiraria.id, resources: [] })
  assert.deepEqual([byName(moved.data.stages, 'Retífica').group, byName(moved.data.stages, 'Retífica').resources], ['Caldeiraria', []])
  const blocked = await fixture.adminRequest(`/sectors/${caldeiraria.id}`, 'DELETE')
  assert.equal(blocked.status, 409)
  assert.match(blocked.data.message, /etapas/)

  // The order of the screen is the order of the catalog: groups and stages.
  const order = (await fixture.adminRequest('/stages')).data
  const reordered = await fixture.adminRequest('/stages-order', 'PUT', { groups: [caldeiraria.id, usinagem.id], stages: ['polishing', ...order.stages.map((row) => row.code).filter((code) => code !== 'polishing')] })
  assert.deepEqual(reordered.data.groups, ['Caldeiraria', 'Usinagem', 'Pintura'])
  assert.equal(reordered.data.stages.filter((row) => row.group === 'Caldeiraria')[0].code, 'polishing')
})

test('a renamed stage keeps its code: offers and OS follow the new name and the old one stays reserved', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const usinagem = (await fixture.adminRequest('/stages')).data.sectors.find((row) => row.name === 'Usinagem')
  await fixture.mutateStore((store) => store.orders.push({ code: 'OS-OLD', quantity: 5, resources: { stages: ['turning'] }, proposal: { stages: ['turning'] }, operation: { status: 'waiting', stages: [{ key: 'stage-1', name: 'Tornearia' }], stageCounts: { 'stage-1': 0 }, activeSessions: [], accumulatedMs: 0 }, operationEvents: [{ id: 'e1', type: 'progress', at: new Date().toISOString(), stageName: 'Tornearia' }] }))
  const renamed = await fixture.adminRequest('/stages/turning', 'PUT', { name: 'Torno convencional', sectorId: usinagem.id })
  assert.equal(renamed.status, 200)
  const turning = renamed.data.stages.find((row) => row.code === 'turning')
  assert.deepEqual([turning.name, turning.aliases, turning.inUse], ['Torno convencional', ['Tornearia'], true])
  const order = (await fixture.adminRequest('/orders')).data.items.find((row) => row.code === 'OS-OLD')
  assert.deepEqual(order.operation.stages, [{ key: 'stage-1', name: 'Torno convencional' }])
  assert.equal(order.operationEvents[0].stageName, 'Torno convencional')
  // The old name cannot be given to another stage: an OS could still mean the first one by it.
  assert.equal((await fixture.adminRequest('/stages', 'POST', { name: 'Tornearia', sectorId: usinagem.id })).status, 409)
  // Back to the old name, the alias goes away.
  const back = await fixture.adminRequest('/stages/turning', 'PUT', { name: 'Tornearia', sectorId: usinagem.id })
  assert.deepEqual(back.data.stages.find((row) => row.code === 'turning').aliases, ['Torno convencional'])
})
