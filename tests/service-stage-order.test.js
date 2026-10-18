import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultStageLayout, orderedStageSelection, readStageLayout, validStageLayout, legacyStageGroup } from '../server/serviceStages.js'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

test('stage layout validates complete groups and substeps without losing unchecked options', () => {
  const layout = defaultStageLayout()
  assert.equal(validStageLayout(layout), true)
  const ordered = [layout[1], layout[2], { ...layout[0], stages: [...layout[0].stages].reverse() }]
  assert.equal(validStageLayout(ordered), true)
  assert.deepEqual(orderedStageSelection(ordered, ['turning', 'assembly', 'painting', 'plasma-cut']), ['painting', 'plasma-cut', 'assembly', 'turning'])
  assert.equal(ordered.flatMap((entry) => entry.stages).length, 15)
  assert.equal(validStageLayout([layout[0], layout[0], layout[2]]), false)
  assert.equal(validStageLayout([null, layout[1], layout[2]]), false)
  assert.equal(validStageLayout([{ ...layout[0], stages: layout[0].stages.slice(1) }, ...layout.slice(1)]), false)
  assert.equal(validStageLayout([{ ...layout[0], stages: ['painting', ...layout[0].stages.slice(1)] }, ...layout.slice(1)]), false)
  assert.equal(validStageLayout([{ ...layout[0], stages: Array(7).fill('turning') }, ...layout.slice(1)]), false)
  assert.deepEqual(readStageLayout(), layout)
  assert.deepEqual(readStageLayout({ stageLayout: ordered }), ordered)
  assert.deepEqual(orderedStageSelection(ordered, ['welding', 'cutting', 'assembly', 'painting', 'boiler']), ['painting', 'assembly', 'welding', 'cutting', 'boiler'])
  const withLegacy = readStageLayout({ stageLayout: ordered, stages: ['painting', 'welding', 'cutting'] })
  assert.equal(validStageLayout(withLegacy), true)
  assert.equal(withLegacy.at(-1).group, legacyStageGroup)
  const legacyFirst = [withLegacy.at(-1), ...ordered]
  assert.deepEqual(orderedStageSelection(legacyFirst, ['painting', 'welding', 'cutting']), ['cutting', 'welding', 'painting'])
})

test('custom stage order persists across reload, proposal, PDF and OS without changing existing orders', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  await fixture.mutateStore((store) => store.orders.push({ code: 'OS-EXISTING', quantity: 10, operation: { status: 'waiting', stages: [{ key: 'original', name: 'Original' }], stageCounts: { original: 0 }, activeSession: null, accumulatedMs: 0 } }))
  const { data } = await fixture.adminRequest('/offers', 'POST', offerDraft)
  const route = `/offers/${data.item.id}`
  const layout = defaultStageLayout()
  const stageLayout = [layout[1], layout[2], { ...layout[0], stages: [...layout[0].stages].reverse() }]
  const stages = orderedStageSelection(stageLayout, ['turning', 'assembly', 'painting', 'plasma-cut'])
  const resources = { materials: [], laborEntries: [], stageLayout, stages, kind: 'service' }
  const saved = await fixture.adminRequest(`${route}/resources`, 'PUT', resources)
  assert.equal(saved.status, 200)
  const reloaded = (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items.find((row) => row.id === data.item.id)
  assert.deepEqual(reloaded.resources.stageLayout, stageLayout)
  assert.deepEqual(reloaded.resources.stages, stages)
  // Older clients can update resources without erasing the saved group layout.
  await fixture.adminRequest(`${route}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'product' })
  assert.deepEqual((await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items[0].resources.stageLayout, stageLayout)
  const proposal = { key: 'A', title: 'Teste', deadline: '2026-12-20', serviceValue: 600, materials: 0, labor: 600, machine: '2 horas', serviceTime: '2 horas', margin: 0, discount: 0, profit: 0 }
  const generated = await fixture.adminRequest(`${route}/proposal`, 'POST', { proposal, layout: 'classic' })
  assert.equal(generated.status, 200)
  assert.deepEqual(generated.data.item.proposal.stages, stages)
  const pdf = await fetch(`${fixture.url}/api${route}/proposal.pdf`, { headers: fixture.admin })
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF')
  const accepted = await fixture.adminRequest(`${route}/accept`, 'POST')
  assert.equal(accepted.status, 201)
  assert.deepEqual(accepted.data.item.resources.stageLayout, stageLayout)
  const orders = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items
  assert.deepEqual(orders.find((row) => row.code === accepted.data.item.code).operation.stages.map((stage) => stage.name), ['Pintura', 'Corte a plasma', 'Montagem', 'Tornearia'])
  assert.deepEqual(orders.find((row) => row.code === 'OS-EXISTING').operation.stages, [{ key: 'original', name: 'Original' }])
})

test('resource API rejects invalid group orders and deduplicates selected stages without sorting them', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const { data } = await fixture.adminRequest('/offers', 'POST', offerDraft)
  const route = `/offers/${data.item.id}/resources`
  const resources = { materials: [], laborEntries: [], stages: ['painting', 'turning', 'painting'], kind: 'service' }
  assert.equal((await fixture.adminRequest(route, 'PUT', { ...resources, stageLayout: [] })).status, 400)
  assert.equal((await fixture.adminRequest(route, 'PUT', { ...resources, stageLayout: [null, null, null] })).status, 400)
  const saved = await fixture.adminRequest(route, 'PUT', resources)
  assert.deepEqual(saved.data.item.resources.stages, ['painting', 'turning'])
})
