import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

async function send(fixture, offerId, email) {
  const body = new FormData()
  body.append('email', JSON.stringify({ ...email, fileNames: [] }))
  const response = await fetch(`${fixture.url}/api/offers/${offerId}/proposal-email`, { method: 'POST', headers: fixture.admin, body })
  return { status: response.status, data: await response.json() }
}

// TCK-0006: "Recusar" clicked by mistake. "Desfazer recusa" goes through the server (memory, cache and database together)
// and brings the offer back to "Em análise" with everything it had; the refusal undone stays recorded on the offer.
test('undoing a refusal brings the offer back to analysis with its data, in the database too, and the proposal goes on', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const client = (await fixture.adminRequest('/clients', 'POST', { name: 'Nestlé', documentType: 'cnpj', document: '60.409.075/0001-52', email: 'compras@nestle.com' })).data.item
  await fixture.adminRequest('/buyers', 'POST', { name: 'Carla Souza', clientId: client.id, email: 'carla@nestle.com' })
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, cnpj: '60.409.075/0001-52', company: 'Nestlé', buyer: 'Carla Souza' })).data.item
  const route = `/offers/${offer.id}`
  await fixture.adminRequest(`${route}/resources`, 'PUT', { materials: [{ id: 'm1', name: 'Aço SAE 1045', unit: 'kg', quantity: 2, unitPrice: 10 }], laborEntries: [], kind: 'service', stages: ['turning'] })
  // A saved proposal and an earlier e-mail, as on the offer of TCK-0006: nothing of it may be lost.
  await fixture.mutateStore((store) => {
    const item = store.offers.find((entry) => entry.id === offer.id)
    item.proposalDraft = { selectedKey: 'B', savedAt: '2026-11-20T12:00:00.000Z' }
    item.proposalEmails = [{ id: 'e1', subject: 'Proposta anterior', to: ['carla@nestle.com'], attachments: [] }]
  })
  const before = (await fixture.adminRequest('/offers')).data.items.find((item) => item.id === offer.id)

  // Only a refused offer, and not a proposal the client declined (that one has its own undo).
  assert.equal((await fixture.adminRequest(`${route}/unreject`, 'POST', {})).status, 409)
  assert.equal((await fixture.adminRequest('/offers/missing/unreject', 'POST', {})).status, 404)
  assert.equal((await fixture.adminRequest(`${route}/reject`, 'POST', {})).status, 200)
  // The same permission as refusing: administrators only.
  assert.equal((await fixture.request(`${route}/unreject`, 'POST', {})).status, 401)
  assert.equal((await fixture.request(`${route}/unreject`, 'POST', {}, { Authorization: `Bearer ${fixture.operatorToken}` })).status, 401)

  const undone = await fixture.adminRequest(`${route}/unreject`, 'POST', {})
  assert.equal(undone.status, 200)
  const item = undone.data.item
  assert.equal(item.status, 'review')
  assert.ok(!('rejectedAt' in item) && !('rejectedBy' in item))
  assert.deepEqual([item.resources, item.proposalDraft, item.proposalEmails, item.attachments], [before.resources, before.proposalDraft, before.proposalEmails, before.attachments])
  assert.equal(item.rejectionHistory.length, 1)
  const [record] = item.rejectionHistory
  assert.equal(record.rejectedBy, 0)
  assert.ok(Number.isFinite(Date.parse(record.rejectedAt)) && Number.isFinite(Date.parse(record.undoneAt)))
  assert.equal(record.undoneBy, 0)
  assert.equal(typeof record.undoneByName, 'string')
  // Twice does nothing more.
  assert.equal((await fixture.adminRequest(`${route}/unreject`, 'POST', {})).status, 409)

  // Out of "Recusadas", in "Em análise" for every screen that reads the list, and the row in the database says the same.
  const listed = (await fixture.adminRequest('/offers')).data.items.find((entry) => entry.id === offer.id)
  assert.equal(listed.status, 'review')
  const { storePool } = await fixture.serverModule('store.js')
  const [[row]] = await storePool().query('SELECT data FROM portal_offers WHERE record_key = ?', [offer.id])
  const stored = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
  assert.equal(stored.status, 'review')
  assert.ok(!('rejectedAt' in stored) && !('rejectedBy' in stored))
  assert.deepEqual([stored.proposalDraft, stored.proposalEmails, stored.rejectionHistory.length], [before.proposalDraft, before.proposalEmails, 1])

  // The proposal is generated and sent again, as if the refusal had never happened.
  assert.equal((await fixture.adminRequest(`${route}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })).status, 200)
  const { draft } = (await fixture.adminRequest(`${route}/proposal-email`)).data
  const sent = await send(fixture, offer.id, draft)
  assert.equal(sent.status, 201)
  assert.equal(sent.data.item.proposalEmails.length, 2, 'the earlier e-mail stays with the new one')
  assert.equal(sent.data.item.status, 'proposed')

  // Refused and undone again: the history keeps both.
  const again = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${again.id}/reject`, 'POST', {})
  await fixture.adminRequest(`/offers/${again.id}/unreject`, 'POST', {})
  await fixture.adminRequest(`/offers/${again.id}/reject`, 'POST', {})
  const twice = (await fixture.adminRequest(`/offers/${again.id}/unreject`, 'POST', {})).data.item
  assert.deepEqual([twice.status, twice.rejectionHistory.length], ['review', 2])
})

test('a declined proposal keeps its own undo, and a site offer refused while being created goes back to creation', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const declined = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${declined.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
  await fixture.adminRequest(`/offers/${declined.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  assert.equal((await fixture.adminRequest(`/offers/${declined.id}/decline`, 'POST', {})).status, 200)
  assert.equal((await fixture.adminRequest(`/offers/${declined.id}/unreject`, 'POST', {})).status, 409)
  assert.equal((await fixture.adminRequest(`/offers/${declined.id}/undecline`, 'POST', {})).data.item.status, 'proposed')

  const site = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Pedido do site' })).data.item
  await fixture.mutateStore((store) => { const item = store.offers.find((entry) => entry.id === site.id); item.origin = 'Site'; item.status = 'creating' })
  assert.equal((await fixture.adminRequest(`/offers/${site.id}/reject`, 'POST', {})).status, 200)
  assert.equal((await fixture.adminRequest(`/offers/${site.id}/unreject`, 'POST', {})).data.item.status, 'creating')

  const finished = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Pedido do site concluído' })).data.item
  await fixture.mutateStore((store) => { const item = store.offers.find((entry) => entry.id === finished.id); item.origin = 'Site'; item.creationFinishedAt = '2026-11-20T12:00:00.000Z' })
  await fixture.adminRequest(`/offers/${finished.id}/reject`, 'POST', {})
  assert.equal((await fixture.adminRequest(`/offers/${finished.id}/unreject`, 'POST', {})).data.item.status, 'review')
})
