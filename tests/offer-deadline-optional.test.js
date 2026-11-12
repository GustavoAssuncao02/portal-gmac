import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// The requested deadline is optional when the offer is created and analysed, but the proposal PDF is only generated with
// it (asked on the proposal screen): the OS comes from the accepted proposal, so every OS still has a deadline.
test('an offer without the requested deadline goes on normally, but the proposal PDF asks for it', async (t) => {
  const f = await createWorkflowFixture()
  t.after(() => f.close())
  const { deadline: _ignored, ...withoutDeadline } = offerDraft

  assert.equal((await f.adminRequest('/offers', 'POST', { ...withoutDeadline, deadline: '2026-02-30' })).status, 400, 'a date typed must exist')
  const created = await f.adminRequest('/offers', 'POST', withoutDeadline)
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const offer = created.data.item
  assert.equal(offer.deadline, '')

  // Informações do serviço: the deadline may stay empty while there is no PDF.
  const edit = (fields) => f.adminRequest(`/offers/${offer.id}`, 'PUT', { cnpj: offer.cnpj, company: offer.company, requester: '', buyer: '', service: offer.service, labelNumber: offer.labelNumber, deadline: '', requestedAt: offer.requestedAt.slice(0, 10), quantity: offer.quantity, ...fields })
  let edited = await edit({ labelNumber: 'ETQ-1' })
  assert.equal(edited.status, 200, JSON.stringify(edited.data))
  assert.deepEqual([edited.data.item.deadline, edited.data.item.labelNumber], ['', 'ETQ-1'])

  assert.equal((await f.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })).status, 200)
  // Option B keeps the delivery term typed; the others are empty.
  const options = ['A', 'B', 'C', 'D'].map((key, index) => ({ key, margin: 15 + index * 5, discount: 0, deadline: key === 'B' ? '15 dias' : '' }))
  assert.equal((await f.adminRequest(`/offers/${offer.id}/proposal-draft`, 'PUT', { selectedKey: 'A', options })).status, 200)

  const sheet = (await f.adminRequest(`/offers/${offer.id}/proposal-draft?model=etiqueta`)).data.draft
  const document = { ...sheet, labor: sheet.labor.map((row, index) => index === 0 ? { ...row, quantity: 1 } : row) }
  const generate = () => f.adminRequest(`/offers/${offer.id}/proposal-document`, 'POST', { model: 'etiqueta', document, option: { key: 'A', deadline: '' } })
  let generated = await generate()
  assert.equal(generated.status, 400)
  assert.equal(generated.data.message, 'Informe o prazo solicitado pelo cliente antes de gerar o PDF da proposta.')
  assert.equal((await f.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: '' } })).status, 400, 'the older route asks for it too')
  assert.equal((await f.adminRequest(`/offers/${offer.id}/accept`, 'POST')).status, 409, 'without the PDF there is no OS')

  // The date asked on the proposal screen goes to the offer and to the options with no delivery term.
  assert.equal((await f.adminRequest(`/offers/${offer.id}/deadline`, 'PUT', { deadline: '' })).status, 400)
  assert.equal((await f.adminRequest(`/offers/${offer.id}/deadline`, 'PUT', { deadline: '2026-13-01' })).status, 400)
  const dated = await f.adminRequest(`/offers/${offer.id}/deadline`, 'PUT', { deadline: '2026-12-20' })
  assert.equal(dated.status, 200, JSON.stringify(dated.data))
  assert.equal(dated.data.item.deadline, '2026-12-20')
  assert.deepEqual(dated.data.item.proposalDraft.options.map((option) => option.deadline), ['2026-12-20', '15 dias', '2026-12-20', '2026-12-20'])

  generated = await generate()
  assert.equal(generated.status, 200, JSON.stringify(generated.data))
  assert.deepEqual([generated.data.item.status, generated.data.item.proposal.deadline], ['proposed', '2026-12-20'], 'an option with no delivery term takes the requested deadline')

  // With the PDF, the deadline is changed in Informações do serviço (which discards it), never left empty.
  assert.equal((await f.adminRequest(`/offers/${offer.id}/deadline`, 'PUT', { deadline: '2026-12-22' })).status, 409)
  edited = await edit({ labelNumber: 'ETQ-1' })
  assert.equal(edited.status, 400)
  assert.match(edited.data.message, /não pode ficar em branco/)

  const accepted = await f.adminRequest(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data))
  assert.deepEqual([accepted.data.item.deadline, accepted.data.item.proposal.deadline], ['2026-12-20', '2026-12-20'])
})
