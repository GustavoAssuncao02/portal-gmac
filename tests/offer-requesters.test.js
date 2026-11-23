import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// An offer names up to 5 requesters (TCK-0004). Each one joins the client registry like a single one did; `requester`
// keeps the names joined by ", " for the proposal PDF and the lists, `requesters` keeps each one with its registration.
test('an offer has up to 5 requesters: registered, edited, e-mailed and printed on every proposal model', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const client = (await fixture.adminRequest('/clients', 'POST', { name: 'Bracell', documentType: 'cnpj', document: '08.855.790/0001-07' })).data.item
  const ana = (await fixture.adminRequest('/requesters', 'POST', { name: 'Ana Lima', clientId: client.id, email: 'ana@bracell.com' })).data.item
  const draft = { ...offerDraft, cnpj: '08.855.790/0001-07', company: 'Bracell' }

  // Blank fields are dropped and a name repeated (any case) counts once; the new ones are registered.
  const created = (await fixture.adminRequest('/offers', 'POST', { ...draft, requesters: ['Ana Lima', ' ana lima ', '', 'Bruno Dias', 'Carla Reis'] })).data
  const offer = created.item
  assert.equal(offer.requester, 'Ana Lima, Bruno Dias, Carla Reis')
  assert.equal(offer.requesterId, ana.id, 'the first one stays as the main requester')
  assert.deepEqual(offer.requesters.map((item) => item.name), ['Ana Lima', 'Bruno Dias', 'Carla Reis'])
  assert.ok(offer.requesters.every((item) => item.id), 'all registered in the client')
  assert.deepEqual([created.requestersCreated, created.requesterCreated], [2, true])

  // More than 5 is refused; exactly 5 is accepted; the single field of the older screens still works.
  const six = await fixture.adminRequest('/offers', 'POST', { ...draft, requesters: ['A', 'B', 'C', 'D', 'E', 'F'] })
  assert.deepEqual([six.status, six.data.message], [400, 'Informe no máximo 5 solicitantes.'])
  const five = (await fixture.adminRequest('/offers', 'POST', { ...draft, requesters: ['Ana Lima', 'Bruno Dias', 'Carla Reis', 'Diego Santos', 'Elaine Moura'] })).data.item
  assert.equal(five.requesters.length, 5)
  assert.equal((await fixture.adminRequest('/offers', 'POST', { ...draft, requester: 'Ana Lima' })).data.item.requester, 'Ana Lima')

  // Informações do serviço: the list is replaced; editing with 6 is refused.
  const edit = { ...draft, requestedAt: offer.requestedAt.slice(0, 10), buyer: '', labelNumber: '' }
  const edited = (await fixture.adminRequest(`/offers/${offer.id}`, 'PUT', { ...edit, requesters: ['Bruno Dias', 'Ana Lima'] })).data.item
  assert.deepEqual([edited.requester, edited.requesters.length], ['Bruno Dias, Ana Lima', 2])
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}`, 'PUT', { ...edit, requesters: ['A', 'B', 'C', 'D', 'E', 'F'] })).status, 400)
  // A tab of the previous version sends the joined names in one field: unchanged, the list is kept.
  const oldScreen = (await fixture.adminRequest(`/offers/${offer.id}`, 'PUT', { ...edit, requester: 'Bruno Dias, Ana Lima' })).data.item
  assert.deepEqual(oldScreen.requesters.map((item) => item.name), ['Bruno Dias', 'Ana Lima'])
  assert.equal((await fixture.adminRequest('/requesters')).data.items.some((row) => row.name === 'Bruno Dias, Ana Lima'), false)

  // The proposal e-mail goes to every registered requester with an e-mail.
  const bruno = (await fixture.adminRequest('/requesters')).data.items.find((row) => row.name === 'Bruno Dias')
  await fixture.adminRequest(`/requesters/${bruno.id}`, 'PUT', { ...bruno, email: 'bruno@bracell.com' })
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })).status, 200)
  const email = (await fixture.adminRequest(`/offers/${offer.id}/proposal-email`)).data.draft
  assert.ok(email.to.includes('ana@bracell.com') && email.to.includes('bruno@bracell.com'), JSON.stringify(email.to))

  // Every proposal model comes with all the names and generates the PDF with the 5 of them.
  await fixture.adminRequest(`/offers/${five.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'], stageTimes: { turning: 60 } })
  for (const model of ['model-a', 'model-b', 'etiqueta', 'nestle']) {
    const document = (await fixture.adminRequest(`/offers/${five.id}/proposal-draft?model=${model}`)).data.draft
    assert.equal(document.requester, 'Ana Lima, Bruno Dias, Carla Reis, Diego Santos, Elaine Moura', model)
    const filled = model === 'etiqueta' ? { ...document, labelNumber: '5319', labor: document.labor.map((row, index) => (index ? row : { ...row, quantity: 1 })) }
      : model === 'nestle' ? { ...document, labor: document.labor.map((row, index) => (index ? row : { ...row, quantity: 1 })) }
        : { ...document, items: document.items.map((item) => ({ ...item, unitPrice: 100 })), fiscal: { cnae: [{ code: '2539-0/01' }], nbs: [{ code: '1.2001.50.00' }], ncm: [] } }
    const saved = await fixture.adminRequest(`/offers/${five.id}/proposal-document`, 'POST', { model, document: filled })
    assert.equal(saved.status, 200, `${model}: ${JSON.stringify(saved.data)}`)
    assert.equal(saved.data.item.proposal.document.requester, document.requester)
    const pdf = await fetch(`${fixture.url}/api/offers/${five.id}/proposal.pdf`, { headers: fixture.admin })
    assert.equal(pdf.status, 200, model)
    if (process.env.SAVE_REQUESTER_PDFS) (await import('node:fs')).writeFileSync(`${process.env.SAVE_REQUESTER_PDFS}/${model}.pdf`, Buffer.from(await pdf.arrayBuffer()))
  }
})
