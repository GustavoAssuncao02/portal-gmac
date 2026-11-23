import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// "Sem quantidade definida" (TCK-0005): the offer is inserted before the pieces are counted at the client. It keeps
// quantity 1 only as a placeholder; nothing that prints or opens an OS goes on until PUT /offers/:id/quantity.
test('an offer without a defined quantity asks it before the proposal, the OS and the end of its creation', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  fixture.finishCreatedOffers = false
  const { quantity, ...withoutQuantity } = offerDraft

  // The box is what lets the quantity stay empty.
  assert.equal((await fixture.adminRequest('/offers', 'POST', withoutQuantity)).status, 400)
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...withoutQuantity, quantityPending: true })).data.item
  assert.deepEqual([offer.quantity, offer.quantityPending, offer.status], [1, true, 'creating'])

  // Planned per piece: 2 kg and 30 min each, still for 1 piece.
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'm1', name: 'Aço SAE 1045', unit: 'kg', quantity: 2, quantityPerPiece: 2, unitPrice: 10 }], laborEntries: [], kind: 'service', stages: ['turning'], entryMode: 'piece', stageTimesPerPiece: { turning: 30 } })
  const finishing = await fixture.adminRequest(`/offers/${offer.id}/finish`, 'POST')
  assert.deepEqual([finishing.status, finishing.data.message], [409, 'Informe a quantidade de peças da oferta antes de gerar a proposta.'])

  // Neither the proposal nor its PDF while "A definir".
  await fixture.mutateStore((store) => { store.offers.find((item) => item.id === offer.id).status = 'review' })
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })).status, 409)
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/proposal-document`, 'POST', { model: 'model-a', document: {} })).status, 409)

  // Informações do serviço keeps it "A definir" (the placeholder stays) while there is no proposal.
  const info = { ...withoutQuantity, requestedAt: offer.requestedAt.slice(0, 10), quantity: null, quantityPending: true }
  const kept = (await fixture.adminRequest(`/offers/${offer.id}`, 'PUT', info)).data.item
  assert.deepEqual([kept.quantity, kept.quantityPending], [1, true])

  // The quantity counted at the client: per piece, materials and stage times follow it; it is defined only once here.
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/quantity`, 'PUT', { quantity: 0 })).status, 400)
  const defined = (await fixture.adminRequest(`/offers/${offer.id}/quantity`, 'PUT', { quantity: 4 })).data.item
  assert.equal(defined.quantity, 4)
  assert.equal(defined.quantityPending, undefined)
  assert.equal(defined.resources.materials[0].quantity, 8)
  assert.equal(defined.resources.stageTimes.turning, 120)
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/quantity`, 'PUT', { quantity: 5 })).status, 409, 'later it is corrected in Informações do serviço')
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })).status, 200)

  // With a proposal it cannot go back to "A definir".
  const back = await fixture.adminRequest(`/offers/${offer.id}`, 'PUT', { ...info, quantity: 4 })
  assert.equal(back.status, 400)

  // Etiqueta: its OS opens without a proposal, so it also waits for the quantity.
  const label = (await fixture.adminRequest('/offers', 'POST', { ...withoutQuantity, labelNumber: '5320', quantityPending: true })).data.item
  await fixture.adminRequest(`/offers/${label.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'], stageTimes: { turning: 60 } })
  await fixture.mutateStore((store) => { store.offers.find((item) => item.id === label.id).status = 'review' })
  const opening = await fixture.adminRequest(`/offers/${label.id}/accept`, 'POST')
  assert.deepEqual([opening.status, opening.data.message], [409, 'Informe a quantidade de peças da oferta antes de abrir a OS.'])
})
