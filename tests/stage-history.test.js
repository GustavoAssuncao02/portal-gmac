import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture } from './workflowFixture.js'
import { cellValue } from '../src/tableSort.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Rafael Teste' }

test('the stage history tells who created, changed, deactivated, reactivated, reordered and deleted', async (t) => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  assert.equal((await fixture.request('/stages/history')).status, 401, 'only administrators')

  const { sectors } = (await api('/stages')).data
  const [first, second] = sectors
  const created = await api('/stages', 'POST', { name: 'Brunimento', sectorId: first.id, resources: [] })
  assert.equal(created.status, 201)
  const { code } = created.data.stages.find((row) => row.name === 'Brunimento')
  await api(`/stages/${code}`, 'PUT', { name: 'Brunimento', sectorId: first.id, resources: [] })
  await api(`/stages/${code}`, 'PUT', { name: 'Brunimento fino', sectorId: second.id, resources: [] })
  await api(`/stages/${code}/active`, 'PATCH', { active: false })
  await api(`/stages/${code}/active`, 'PATCH', { active: false })
  await api(`/stages/${code}/active`, 'PATCH', { active: true })

  const own = (await api(`/stages/history?code=${code}`)).data.items
  assert.deepEqual(own.map((row) => row.type), ['activated', 'deactivated', 'edited', 'created'], 'newest first; saving or repeating without a change records nothing')
  assert.ok(own.every((row) => row.userName === 'Rafael Teste' && row.at))
  assert.deepEqual(own[2].changes, ['Nome: Brunimento → Brunimento fino', `Setor: ${first.name} → ${second.name}`])
  assert.equal(own[2].stageName, 'Brunimento fino')

  await api(`/stages/${code}`, 'DELETE')
  const stages = (await api('/stages')).data
  await api('/stages-order', 'PUT', { groups: sectors.map((row) => row.id), stages: stages.stages.map((row) => row.code) })
  const all = (await api('/stages/history')).data.items
  assert.deepEqual(all.slice(0, 2).map((row) => [row.type, row.stageName]), [['reordered', null], ['deleted', 'Brunimento fino']])
})

test('a report cell sorts as what it is', () => {
  assert.equal(cellValue('R$ 1.234,56'), 1234.56)
  assert.equal(cellValue('1.234,56'), 1234.56)
  assert.equal(cellValue('12'), 12)
  assert.equal(cellValue('31/12/2026'), '2026-12-31')
  assert.equal(cellValue('31/12/2026 14:30'), '2026-12-31 14:30')
  assert.equal(cellValue('OS-2026-0001'), 'OS-2026-0001')
  assert.equal(cellValue(null), null)
})
