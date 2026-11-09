import assert from 'node:assert/strict'
import test from 'node:test'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// "Inserir Oferta Manualmente" creates the offer as "Criando oferta": the list shows who is creating it and since when,
// nothing of the analysis is open yet, and only "Fazer proposta" (POST /offers/:id/finish) puts it in analysis. Another
// administrator may take it over; an offer given up is discarded without its number ever coming back.
test('a manual offer is created as "Criando oferta", can be taken over or discarded, and goes to analysis with Fazer proposta', async (t) => {
  const f = await createWorkflowFixture({ fillStageTimes: false })
  f.finishCreatedOffers = false
  t.after(() => f.close())
  await f.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno 01' }] })

  const created = await f.adminRequest('/offers', 'POST', offerDraft)
  assert.equal(created.status, 201)
  const offer = created.data.item
  assert.equal(offer.status, 'creating')
  assert.ok(offer.createdAt && offer.createdByName, 'who created it and when')
  assert.equal(offer.editingBy.name, offer.createdByName)

  // Filling the details keeps it being created; nothing of the analysis is open.
  const resources = { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] }
  const saved = await f.adminRequest(`/offers/${offer.id}/resources`, 'PUT', resources)
  assert.equal(saved.status, 200)
  assert.equal(saved.data.item.status, 'creating')
  assert.equal((await f.adminRequest(`/offers/${offer.id}/reject`, 'POST', {})).status, 409, 'it cannot be refused')
  const proposal = await f.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offerDraft.deadline } })
  assert.equal(proposal.status, 409)
  assert.match(proposal.data.message, /ainda está sendo criada/)
  assert.equal((await f.adminRequest(`/offers/${offer.id}/proposal-document`, 'POST', { model: 'A' })).status, 409)
  const draft = { selectedKey: 'A', options: ['A', 'B', 'C', 'D'].map((key) => ({ key, margin: 30, discount: 0, deadline: '10 dias' })) }
  assert.equal((await f.adminRequest(`/offers/${offer.id}/proposal-draft`, 'PUT', draft)).status, 409, 'the proposal screen is not saved yet')

  // Someone else was creating it; this administrator confirms "editar mesmo assim" and becomes the one creating it. The
  // time keeps its start and the author of the creation stays.
  await f.mutateStore((store) => { store.offers.find((item) => item.id === offer.id).editingBy = { id: 'outro-admin', name: 'Outro Admin', at: offer.createdAt } })
  const taken = await f.adminRequest(`/offers/${offer.id}/take-over`, 'POST', {})
  assert.equal(taken.status, 200)
  assert.equal(taken.data.item.editingBy.name, offer.createdByName)
  assert.notEqual(taken.data.item.editingBy.id, 'outro-admin')
  assert.equal(taken.data.item.createdAt, offer.createdAt)
  assert.equal(taken.data.item.createdByName, offer.createdByName, 'the author of the creation stays')

  // "Fazer proposta" asks for the planned stages, as the proposal does; then the offer is in analysis for everybody.
  let finished = await f.adminRequest(`/offers/${offer.id}/finish`, 'POST', {})
  assert.equal(finished.status, 400)
  assert.match(finished.data.message, /Informe o tempo previsto/)
  await f.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { ...resources, stageTimes: { turning: 60 }, stageResources: { turning: { type: 'machine', id: 'torno' } } })
  finished = await f.adminRequest(`/offers/${offer.id}/finish`, 'POST', {})
  assert.equal(finished.status, 200)
  assert.equal(finished.data.item.status, 'review')
  assert.equal(finished.data.item.editingBy, undefined)
  assert.equal((await f.adminRequest(`/offers/${offer.id}/finish`, 'POST', {})).data.item.status, 'review', 'finishing again changes nothing')
  assert.equal((await f.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { ...resources, stages: ['turning', 'painting'] })).data.item.status, 'review')
  assert.equal((await f.adminRequest(`/offers/${offer.id}`, 'DELETE')).status, 409, 'an offer in analysis is not discarded')
  assert.equal((await f.adminRequest(`/offers/${offer.id}/take-over`, 'POST', {})).status, 409)

  // Discarded while being created: the offer and its files go away and its number is not used again.
  const other = (await f.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Peca descartada' })).data.item
  const upload = await fetch(`${f.url}/api/offers/${other.id}/attachments?name=desenho.pdf&type=application/pdf`, { method: 'POST', headers: { ...f.admin, 'Content-Type': 'application/octet-stream' }, body: Buffer.from('%PDF-1.4 teste') })
  assert.equal(upload.status, 201)
  const file = (await upload.json()).item.attachments[0]
  const filePath = path.join(f.directory, 'data', 'files', file.id)
  await stat(filePath)
  assert.equal((await f.request(`/offers/${other.id}`, 'DELETE')).status, 401, 'only an administrator discards')
  assert.equal((await f.adminRequest(`/offers/${other.id}`, 'DELETE')).status, 204)
  assert.equal((await f.adminRequest('/offers')).data.items.some((item) => item.id === other.id), false)
  await assert.rejects(stat(filePath), 'the attachment left the disk')
  assert.equal((await f.adminRequest(`/offers/${other.id}`, 'DELETE')).status, 404)
  const next = (await f.adminRequest('/offers', 'POST', offerDraft)).data.item
  assert.notEqual(next.code, other.code, 'the number of a discarded offer is never reused')
})
