import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { bySector, parseSectors } from '../src/machineSectors.js'

// A machine may serve more than one sector: it is saved with the list and a readable label, and shows in each sector group.
test('a machine of two sectors is one registration listed in both', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const shared = (await fixture.adminRequest('/machines', 'POST', { name: 'Têmpera', type: '', sectors: [' Usinagem ', 'Caldeiraria', 'Usinagem', ''], hourlyRate: 30 })).data.item
  assert.deepEqual([shared.sectors, shared.sector], [['Usinagem', 'Caldeiraria'], 'Usinagem e Caldeiraria'])
  const legacy = (await fixture.adminRequest('/machines', 'POST', { name: 'Serra', sector: 'Usinagem', hourlyRate: 10 })).data.item
  assert.deepEqual([legacy.sectors, legacy.sector], [['Usinagem'], 'Usinagem'], 'a single sector typed as text still works')
  const three = (await fixture.adminRequest(`/machines/${shared.id}`, 'PUT', { ...shared, sectors: ['Usinagem', 'Caldeiraria', 'Manutenção'] })).data.item
  assert.equal(three.sector, 'Usinagem, Caldeiraria e Manutenção')
  assert.deepEqual(parseSectors('Usinagem, Caldeiraria;  Usinagem ,'), ['Usinagem', 'Caldeiraria'])
  const groups = bySector([{ id: 's', name: 'Serra', sectors: ['Usinagem'] }, { id: 't', name: 'Têmpera', sectors: ['Usinagem', 'Caldeiraria'] }, { id: 'p', name: 'Policorte', sector: 'Caldeiraria' }, { id: 'x', name: 'Sem setor' }])
  assert.deepEqual(groups.map(([sector, machines]) => [sector, machines.map((machine) => machine.id)]), [['Usinagem', ['s', 't']], ['Caldeiraria', ['t', 'p']], ['Sem setor', ['x']]])
})
