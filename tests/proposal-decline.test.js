import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

test('the customer declines a proposal: the offer closes and the option counts as declined', async () => {
  const fixture = await createWorkflowFixture()
  try {
    const admin = fixture.admin
    const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
    assert.equal((await fixture.request(`/offers/${offer.id}/decline`, 'POST', {}, admin)).status, 409, 'there is no proposal yet')
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
    await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'B', deadline: offerDraft.deadline, serviceValue: 100, margin: 20 } })
    assert.equal((await fixture.request(`/offers/${offer.id}/decline`, 'POST', {})).status, 401)
    assert.equal((await fixture.request(`/offers/${offer.id}/decline`, 'POST', { reason: 'Caro' }, admin)).status, 400)
    const declined = await fixture.request(`/offers/${offer.id}/decline`, 'POST', { reason: 'Preço', note: 'Achou caro' }, admin)
    assert.equal(declined.status, 200)
    assert.equal(declined.data.item.status, 'rejected')
    assert.deepEqual([declined.data.item.proposalDecline.key, declined.data.item.proposalDecline.reason], ['B', 'Preço'])
    assert.equal((await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).status, 409, 'a declined offer cannot generate an OS')
    const margins = (await fixture.request('/proposal-margins', 'GET', undefined, admin)).data.items
    assert.deepEqual(margins.find((row) => row.key === 'B'), { key: 'B', margin: 20, average: 20, accepted: 0, won: 0, declined: 1, rate: 0 })
    // Undoing a decline registered by mistake: back to "Proposta gerada" and out of the acceptance rate.
    assert.equal((await fixture.request(`/offers/${offer.id}/undecline`, 'POST', {})).status, 401)
    const undone = await fixture.request(`/offers/${offer.id}/undecline`, 'POST', {}, admin)
    assert.equal(undone.status, 200)
    assert.equal(undone.data.item.status, 'proposed')
    assert.equal(undone.data.item.proposalDecline, undefined)
    assert.equal(undone.data.item.declineHistory[0].reason, 'Preço')
    assert.equal((await fixture.request(`/offers/${offer.id}/undecline`, 'POST', {}, admin)).status, 409)
    assert.equal((await fixture.request('/proposal-margins', 'GET', undefined, admin)).data.items.find((row) => row.key === 'B').rate, null)
  } finally { await fixture.close() }
})
