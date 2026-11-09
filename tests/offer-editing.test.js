import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

test('the service information of an offer is corrected without creating it again; what goes on the proposal discards it', async () => {
  const f = await createWorkflowFixture()
  try {
    const client = (await f.adminRequest('/clients', 'POST', { name: 'Cliente Certo', documentType: 'cnpj', document: '11222333000181', email: '' })).data.item
    const offer = (await f.adminRequest('/offers', 'POST', { ...offerDraft, quantity: 10 })).data.item
    const edit = (body) => f.adminRequest(`/offers/${offer.id}`, 'PUT', { cnpj: '11.222.333/0001-81', company: 'Cliente Certo', requester: 'Ana', buyer: '', service: offer.service, labelNumber: 'ETQ-9', deadline: '2026-12-30', requestedAt: offer.requestedAt.slice(0, 10), quantity: 10, ...body })

    assert.equal((await f.adminRequest(`/offers/${offer.id}`, 'PUT', {})).status, 400)
    assert.equal((await edit({ quantity: 0 })).status, 400)
    assert.equal((await edit({ deadline: '2026-02-30' })).status, 400)

    // Client, requester, label, deadline and request date: the requester joins the client now chosen.
    let saved = await edit({ requestedAt: '2026-11-05' })
    assert.equal(saved.status, 200)
    let item = saved.data.item
    assert.deepEqual([item.company, item.cnpj, item.labelNumber, item.deadline, item.requestedAt, item.quantity], ['Cliente Certo', '11.222.333/0001-81', 'ETQ-9', '2026-12-30', '2026-11-05T12:00:00.000Z', 10])
    assert.equal(item.requester, 'Ana')
    const requesters = (await f.adminRequest('/requesters')).data.items
    assert.equal(requesters.find((row) => row.id === item.requesterId)?.clientId, String(client.id))

    // A generated proposal stays when only the request date changes; the quantity is on the proposal and discards it, keeping the saved options.
    await f.mutateStore((store) => {
      const row = store.offers.find((entry) => entry.id === offer.id)
      Object.assign(row, { status: 'proposed', proposal: { key: 'A', title: 'Proposta A', deadline: '2026-12-30', serviceValue: 100, generatedAt: '2026-11-06T12:00:00.000Z' }, proposalDraft: { selectedKey: 'A' } })
    })
    saved = await edit({ requestedAt: '2026-11-04' })
    assert.equal(saved.data.proposalDiscarded, false)
    assert.equal(saved.data.item.status, 'proposed')
    saved = await edit({ requestedAt: '2026-11-04', quantity: 15 })
    assert.equal(saved.data.proposalDiscarded, true)
    assert.deepEqual([saved.data.item.status, saved.data.item.proposal, saved.data.item.proposalDraft.selectedKey], ['review', null, 'A'])

    // Launched per piece, materials and stage times follow the new quantity.
    await f.mutateStore((store) => {
      const row = store.offers.find((entry) => entry.id === offer.id)
      row.resources = { ...row.resources, entryMode: 'piece', stages: ['turning'], stageTimesPerPiece: { turning: 30 }, stageTimes: { turning: 450 }, materials: [{ id: 'm1', name: 'Aço', unit: 'kg', quantityPerPiece: 2, quantity: 30, unitPrice: 10 }] }
    })
    item = (await edit({ requestedAt: '2026-11-04', quantity: 20 })).data.item
    assert.equal(item.resources.materials[0].quantity, 40)
    assert.equal(item.resources.stageTimes.turning, 600)

    // A refused offer is undone first; an accepted one is corrected in its OS.
    await f.mutateStore((store) => { store.offers.find((entry) => entry.id === offer.id).status = 'rejected' })
    assert.equal((await edit({ requestedAt: '2026-11-04', quantity: 20 })).status, 409)
    await f.mutateStore((store) => { Object.assign(store.offers.find((entry) => entry.id === offer.id), { status: 'accepted', orderCode: 'OS-2026-0001' }) })
    const accepted = await edit({ requestedAt: '2026-11-04', quantity: 20 })
    assert.equal(accepted.status, 409)
    assert.match(accepted.data.message, /OS-2026-0001/)
  } finally { await f.close() }
})
