import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

test('a client has many requesters; name and client are required and the client keeps them', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const nestle = (await fixture.adminRequest('/clients', 'POST', { name: 'Nestlé', documentType: 'cnpj', document: '60.409.075/0001-52' })).data.item
  const other = (await fixture.adminRequest('/clients', 'POST', { name: 'Outra Empresa', documentType: 'cnpj', document: '11.222.333/0001-81' })).data.item

  // Only the name and the client: CPF, e-mail and phone stay blank.
  const joao = await fixture.adminRequest('/requesters', 'POST', { name: '  João   Silva ', clientId: nestle.id })
  assert.equal(joao.status, 201)
  assert.deepEqual({ name: joao.data.item.name, clientId: joao.data.item.clientId, clientName: joao.data.item.clientName, cpf: joao.data.item.cpf, email: joao.data.item.email, phone: joao.data.item.phone }, { name: 'João Silva', clientId: String(nestle.id), clientName: 'Nestlé', cpf: '', email: '', phone: '' })
  const pedro = (await fixture.adminRequest('/requesters', 'POST', { name: 'Pedro Souza', clientId: nestle.id, cpf: '123.456.789-09', email: 'Pedro@Nestle.com', phone: '(71) 99876-5432' })).data.item
  assert.deepEqual([pedro.cpf, pedro.email, pedro.phone], ['12345678909', 'pedro@nestle.com', '71998765432'])

  // Name and client are required; the client must be registered; the optional fields are checked when filled.
  assert.equal((await fixture.adminRequest('/requesters', 'POST', { name: ' ', clientId: nestle.id })).data.message, 'Informe o nome do solicitante.')
  assert.equal((await fixture.adminRequest('/requesters', 'POST', { name: 'Maria' })).data.message, 'Selecione o cliente do solicitante.')
  assert.equal((await fixture.adminRequest('/requesters', 'POST', { name: 'Maria', clientId: 'nao-existe' })).status, 400)
  assert.equal((await fixture.adminRequest('/requesters', 'POST', { name: 'Maria', clientId: nestle.id, cpf: '123' })).status, 400)
  assert.equal((await fixture.adminRequest('/requesters', 'POST', { name: 'Maria', clientId: nestle.id, email: 'maria@' })).status, 400)
  assert.equal((await fixture.adminRequest('/requesters', 'POST', { name: 'Maria', clientId: nestle.id, phone: '9999' })).status, 400)

  // The same name twice in one client is refused; in another client it is a different person.
  assert.equal((await fixture.adminRequest('/requesters', 'POST', { name: 'joão silva', clientId: nestle.id })).status, 409)
  assert.equal((await fixture.adminRequest('/requesters', 'POST', { name: 'João Silva', clientId: other.id })).status, 201)

  // The client cannot be deleted while it has requesters; moving them away frees it.
  const blocked = await fixture.adminRequest(`/clients/${nestle.id}`, 'DELETE')
  assert.equal(blocked.status, 409)
  assert.match(blocked.data.message, /2 solicitantes vinculados/)
  const moved = await fixture.adminRequest(`/requesters/${pedro.id}`, 'PUT', { ...pedro, clientId: other.id })
  assert.equal(moved.data.item.clientName, 'Outra Empresa')
  assert.equal((await fixture.adminRequest(`/requesters/${joao.data.item.id}`, 'DELETE')).status, 204)
  assert.equal((await fixture.adminRequest(`/clients/${nestle.id}`, 'DELETE')).status, 200)

  const list = (await fixture.adminRequest('/requesters')).data.items
  assert.deepEqual(list.map((row) => [row.name, row.clientName]), [['João Silva', 'Outra Empresa'], ['Pedro Souza', 'Outra Empresa']])
})

test('an offer names its requester: new names join the client registry and the proposal comes filled', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const nestle = (await fixture.adminRequest('/clients', 'POST', { name: 'Nestlé', documentType: 'cnpj', document: '60.409.075/0001-52' })).data.item
  await fixture.adminRequest('/requesters', 'POST', { name: 'João Silva', clientId: nestle.id })
  const draft = { ...offerDraft, cnpj: '60.409.075/0001-52', company: 'Nestlé' }

  // A registered requester of the client is reused, written as registered.
  const known = (await fixture.adminRequest('/offers', 'POST', { ...draft, requester: ' joão silva ' })).data
  assert.equal(known.requesterCreated, false)
  assert.equal(known.item.requester, 'João Silva')

  // A new name with a registered client is registered for that client.
  const fresh = (await fixture.adminRequest('/offers', 'POST', { ...draft, requester: 'Gustavo Assunção da Silva' })).data
  assert.equal(fresh.requesterCreated, true)
  const registered = (await fixture.adminRequest('/requesters')).data.items.find((row) => row.name === 'Gustavo Assunção da Silva')
  assert.equal(registered.clientName, 'Nestlé')
  assert.equal(fresh.item.requesterId, registered.id)

  // Without a registered client, or without a name, nothing is registered.
  const loose = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, requester: 'Maria' })).data
  assert.deepEqual([loose.requesterCreated, loose.item.requester, loose.item.requesterId], [false, 'Maria', null])
  assert.equal((await fixture.adminRequest('/offers', 'POST', draft)).data.requesterCreated, false)
  assert.equal((await fixture.adminRequest('/requesters')).data.items.length, 2)

  // The proposal opens with the requester of the offer.
  for (const model of ['model-a', 'etiqueta']) assert.equal((await fixture.adminRequest(`/offers/${fresh.item.id}/proposal-draft?model=${model}`)).data.draft.requester, 'Gustavo Assunção da Silva')
})

test('buyers are kept like requesters: a registry per client, and the offer registers a new buyer of its client', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const nestle = (await fixture.adminRequest('/clients', 'POST', { name: 'Nestlé', documentType: 'cnpj', document: '60.409.075/0001-52' })).data.item
  assert.equal((await fixture.adminRequest('/buyers', 'POST', { name: ' ', clientId: nestle.id })).data.message, 'Informe o nome do comprador.')
  const carla = await fixture.adminRequest('/buyers', 'POST', { name: 'Carla Compras', clientId: nestle.id, email: 'carla@nestle.com' })
  assert.equal(carla.status, 201)
  assert.equal(carla.data.item.clientName, 'Nestlé')
  assert.equal((await fixture.adminRequest('/buyers', 'POST', { name: 'carla compras', clientId: nestle.id })).data.message, 'Este cliente já tem um comprador com esse nome.')

  // Requesters and buyers are separate registries: the same person name does not clash between them.
  const draft = { ...offerDraft, cnpj: '60.409.075/0001-52', company: 'Nestlé' }
  const known = (await fixture.adminRequest('/offers', 'POST', { ...draft, requester: 'João Silva', buyer: ' carla compras ' })).data
  assert.deepEqual([known.requesterCreated, known.buyerCreated, known.item.buyer, known.item.buyerId], [true, false, 'Carla Compras', carla.data.item.id])
  const fresh = (await fixture.adminRequest('/offers', 'POST', { ...draft, buyer: 'Bruno Suprimentos' })).data
  assert.deepEqual([fresh.requesterCreated, fresh.buyerCreated], [false, true])
  assert.deepEqual((await fixture.adminRequest('/buyers')).data.items.map((row) => [row.name, row.clientName]), [['Bruno Suprimentos', 'Nestlé'], ['Carla Compras', 'Nestlé']])
  assert.deepEqual((await fixture.adminRequest('/requesters')).data.items.map((row) => row.name), ['João Silva'])

  // The letter proposals open with the buyer of the offer in "Comprador" (the former "Aos cuidados de").
  for (const model of ['model-a', 'model-b']) assert.equal((await fixture.adminRequest(`/offers/${known.item.id}/proposal-draft?model=${model}`)).data.draft.attention, 'Carla Compras')
  assert.equal((await fixture.adminRequest(`/offers/${fresh.item.id}/proposal-draft?model=model-b`)).data.draft.requester, '')

  // The client cannot be deleted while it has buyers either.
  await fixture.adminRequest(`/requesters/${(await fixture.adminRequest('/requesters')).data.items[0].id}`, 'DELETE')
  const blocked = await fixture.adminRequest(`/clients/${nestle.id}`, 'DELETE')
  assert.equal(blocked.status, 409)
  assert.match(blocked.data.message, /2 compradores vinculados.*Cadastros > Compradores/)
  assert.equal((await fixture.adminRequest(`/buyers/${carla.data.item.id}`, 'DELETE')).status, 204)
  assert.equal((await fixture.adminRequest(`/buyers/${carla.data.item.id}`, 'DELETE')).data.message, 'Comprador não encontrado.')
})
