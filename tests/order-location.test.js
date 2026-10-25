import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { serviceLocationTimes } from '../server/serviceLocation.js'

const upload = (fixture, offerId, name) => fetch(`${fixture.url}/api/offers/${offerId}/attachments?name=${encodeURIComponent(name)}&type=text/plain`, { method: 'POST', headers: { ...fixture.admin, 'Content-Type': 'application/octet-stream' }, body: Buffer.from(`conteúdo de ${name}`) })

test('offer: Interno by default, Externo kept without discarding the proposal; stages get a planned machine or service', async () => {
  const fixture = await createWorkflowFixture()
  try {
    const machine = (await fixture.adminRequest('/machines', 'POST', { name: 'Torno CNC', type: 'Torno', sector: 'Usinagem', hourlyRate: 90 })).data.item
    const service = (await fixture.adminRequest('/labor-services')).data.items[0]
    const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
    const route = `/offers/${offer.id}/resources`
    const base = { materials: [], laborEntries: [], kind: 'service', stages: ['turning', 'painting'] }
    assert.equal((await fixture.adminRequest(route, 'PUT', base)).data.item.resources.serviceLocation, 'internal')
    await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
    const external = (await fixture.adminRequest(route, 'PUT', { ...base, serviceLocation: 'external', stageResources: { turning: { type: 'machine', id: machine.id }, painting: { type: 'labor-service', id: service.id } } })).data.item
    assert.equal(external.resources.serviceLocation, 'external')
    assert.ok(external.proposal, 'the type of service and the stage resources do not discard the proposal')
    assert.deepEqual(external.resources.stageResources, { turning: { type: 'machine', id: machine.id, name: 'Torno CNC' }, painting: { type: 'labor-service', id: service.id, name: service.name } })
    assert.equal((await fixture.adminRequest(route, 'PUT', { ...base, serviceLocation: 'remote' })).status, 400)
    assert.equal((await fixture.adminRequest(route, 'PUT', { ...base, stageResources: { turning: { type: 'machine', id: 'inexistente' } } })).status, 400)
    const unchecked = (await fixture.adminRequest(route, 'PUT', { ...base, stages: ['turning'], serviceLocation: 'external', stageResources: external.resources.stageResources })).data.item
    assert.deepEqual(Object.keys(unchecked.resources.stageResources), ['turning'], 'an unchecked stage loses its resource')
  } finally { await fixture.close() }
})

test('OS: switching Interno/Externo is recorded; the time in each one comes from the switches', async () => {
  const fixture = await createWorkflowFixture()
  try {
    const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
    await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
    const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
    const route = `/orders/${order.code}/location`
    assert.equal((await fixture.request(route, 'PUT', { location: 'external' })).status, 401)
    assert.equal((await fixture.adminRequest(route, 'PUT', { location: 'outro' })).status, 400)
    const same = (await fixture.adminRequest(route, 'PUT', { location: 'internal' })).data.item
    assert.deepEqual(same.locationChanges, [], 'choosing the current one is not a switch')
    const moved = (await fixture.adminRequest(route, 'PUT', { location: 'external' })).data.item
    assert.equal(moved.serviceLocation, 'external')
    assert.deepEqual(moved.locationChanges.map((change) => [change.from, change.to]), [['internal', 'external']])
    const history = (await fixture.adminRequest(`/operations/orders/${order.code}/events`)).data.items
    assert.ok(history.some((event) => event.type === 'location_changed'))

    const created = Date.parse('2026-10-01T08:00:00Z'), hour = 3600000
    const sample = { createdAt: new Date(created).toISOString(), resources: { serviceLocation: 'internal' }, locationChanges: [{ at: new Date(created + 2 * hour).toISOString(), from: 'internal', to: 'external' }, { at: new Date(created + 5 * hour).toISOString(), from: 'external', to: 'internal' }] }
    assert.equal(serviceLocationTimes({ ...sample, locationChanges: [] }, created + 9 * hour), null, 'no time is shown before the first switch')
    assert.deepEqual(serviceLocationTimes(sample, created + 9 * hour), { internal: 6 * hour, external: 3 * hour })
    assert.deepEqual(serviceLocationTimes({ ...sample, operation: { status: 'completed', completedAt: new Date(created + 6 * hour).toISOString() } }, created + 9 * hour), { internal: 3 * hour, external: 3 * hour }, 'a completed OS stops counting')
  } finally { await fixture.close() }
})

test('OS attachments: added and removed from Ver OS', async () => {
  const fixture = await createWorkflowFixture()
  try {
    const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
    await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
    const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
    assert.equal((await upload(fixture, offer.id, 'desenho.txt')).status, 201)
    assert.equal((await upload(fixture, offer.id, 'errado.txt')).status, 201)
    const listed = (await fixture.adminRequest('/orders')).data.items.find((item) => item.code === order.code)
    assert.deepEqual(listed.attachments.map((file) => file.name), ['desenho.txt', 'errado.txt'])
    const wrong = listed.attachments[1]
    assert.equal((await fixture.request(`/orders/${order.code}/attachments/${wrong.id}`, 'DELETE')).status, 401)
    assert.equal((await fixture.adminRequest(`/orders/${order.code}/attachments/${wrong.id}`, 'DELETE')).status, 204)
    assert.equal((await fixture.adminRequest(`/orders/${order.code}/attachments/${wrong.id}`, 'DELETE')).status, 404)
    const after = (await fixture.adminRequest('/orders')).data.items.find((item) => item.code === order.code)
    assert.deepEqual(after.attachments.map((file) => file.name), ['desenho.txt'])
    assert.equal((await fetch(`${fixture.url}/api/offers/${offer.id}/attachments/${wrong.id}`, { headers: fixture.admin })).status, 404, 'the removed file is gone from the offer too')
  } finally { await fixture.close() }
})
