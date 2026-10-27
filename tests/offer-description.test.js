import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { serviceDescriptionText } from '../server/serviceStages.js'

const proposal = { layout: 'classic', proposal: { key: 'A', title: 'A', deadline: '2026-12-20', serviceValue: 100 } }

test('an older details text joins the description only when it adds something', () => {
  assert.equal(serviceDescriptionText('Bolinho de banana', ''), 'Bolinho de banana')
  assert.equal(serviceDescriptionText('Bolinho de banana', undefined), 'Bolinho de banana')
  assert.equal(serviceDescriptionText('Bolinho de banana', 'banana'), 'Bolinho de banana')
  assert.equal(serviceDescriptionText(' Bolinho de banana ', ' Com canela '), 'Bolinho de banana\n\nCom canela')
  assert.equal(serviceDescriptionText('', 'Com canela'), 'Com canela')
})

test('the service description is a single text: the details of the offer edit the one typed when it was created', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, description: 'Bolinho de banana' })).data.item
  const route = `/offers/${offer.id}`
  const resources = { materials: [], laborEntries: [], stages: ['painting'], kind: 'service' }
  const stored = async () => (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items.find((item) => item.id === offer.id)

  // Details saved without the description keep the one typed at creation.
  let saved = (await fixture.adminRequest(`${route}/resources`, 'PUT', resources)).data.item
  assert.equal(saved.description, 'Bolinho de banana')
  assert.equal(saved.resources.serviceDescription, '')

  // The details screen edits that same text.
  saved = (await fixture.adminRequest(`${route}/resources`, 'PUT', { ...resources, description: '  Bolinho de banana com canela  ' })).data.item
  assert.equal(saved.description, 'Bolinho de banana com canela')
  assert.equal((await stored()).description, 'Bolinho de banana com canela')

  // Erasing it is refused and nothing of that save is kept.
  const blank = await fixture.adminRequest(`${route}/resources`, 'PUT', { ...resources, stages: ['turning'], description: '   ' })
  assert.equal(blank.status, 400)
  assert.equal(blank.data.message, 'Preencha a descrição do serviço.')
  assert.equal((await stored()).description, 'Bolinho de banana com canela')
  assert.deepEqual((await stored()).resources.stages, ['painting'])
  assert.equal((await fixture.adminRequest(`${route}/resources`, 'PUT', { ...resources, description: 42 })).status, 400)

  // A caller that still sends the separate text has it joined to the description.
  saved = (await fixture.adminRequest(`${route}/resources`, 'PUT', { ...resources, serviceDescription: 'Sem rebarbas' })).data.item
  assert.equal(saved.description, 'Bolinho de banana com canela\n\nSem rebarbas')
  assert.equal(saved.resources.serviceDescription, '')
})

test('an older offer with a separate details text joins it to the description without discarding the proposal', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  const route = `/offers/${offer.id}`
  await fixture.adminRequest(`${route}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['turning', 'painting'], kind: 'service' })
  // Saved before the description became a single text.
  await fixture.mutateStore((store) => { store.offers.find((item) => item.id === offer.id).resources.serviceDescription = 'Acabamento conforme desenho.' })
  assert.equal((await fixture.adminRequest(`${route}/proposal`, 'POST', proposal)).data.item.status, 'proposed')
  const current = (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items.find((item) => item.id === offer.id)

  // The details screen opens with both texts in the description; saving it as it is keeps the proposal.
  const joined = `${offerDraft.description}\n\nAcabamento conforme desenho.`
  const kept = (await fixture.adminRequest(`${route}/resources`, 'PUT', { ...current.resources, description: joined })).data.item
  assert.equal(kept.description, joined)
  assert.equal(kept.resources.serviceDescription, '')
  assert.equal(kept.status, 'proposed')
  assert.ok(kept.proposal)

  // A different text goes in the proposal, so it discards it like any other change in the details.
  const changed = (await fixture.adminRequest(`${route}/resources`, 'PUT', { ...kept.resources, description: 'Bolinho de banana' })).data.item
  assert.equal(changed.description, 'Bolinho de banana')
  assert.equal(changed.status, 'review')
  assert.equal(changed.proposal, null)
})
