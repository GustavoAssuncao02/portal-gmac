import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
async function login(fixture, cpf = env.DEMO_ADMIN_CPF) {
  const response = await fixture.request('/auth/login', 'POST', { cpf, password: env.DEMO_ADMIN_PASSWORD })
  assert.equal(response.status, 200)
  return { Authorization: `Bearer ${response.data.token}` }
}

test('an open offer waits on the list with nobody creating it, tells the others and goes to whoever opens it first', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  fixture.finishCreatedOffers = false
  const previous = process.env.OPEN_OFFER_DEFAULT_CPFS
  process.env.OPEN_OFFER_DEFAULT_CPFS = '12345678902'
  try {
    // The box comes checked only for the CPFs of OPEN_OFFER_DEFAULT_CPFS (server environment, never sent to the browser).
    const { openOfferDefault } = await fixture.serverModule('offers.js')
    const sample = { OPEN_OFFER_DEFAULT_CPFS: '111.222.333-44, 55566677788' }
    assert.equal(openOfferDefault('11122233344', sample), true)
    assert.equal(openOfferDefault('555.666.777-88', sample), true)
    assert.equal(openOfferDefault('99988877766', sample), false)
    assert.equal(openOfferDefault('', sample), false, 'an account without CPF is never in the list')
    assert.equal(openOfferDefault('11122233344', {}), false, 'without the variable the box comes unchecked')
    const gustavo = await login(fixture)
    await fixture.request('/admins', 'POST', { name: 'Marina', birthDate: '1990-01-01', cpf: '12345678902', email: 'marina@example.invalid', password: env.DEMO_ADMIN_PASSWORD }, gustavo)
    const marina = await login(fixture, '12345678902')
    // The box comes checked for Marina's CPF only; the browser gets the answer, never the list.
    assert.deepEqual((await fixture.request('/offers/open-default', 'GET', undefined, marina)).data, { checked: true })
    assert.deepEqual((await fixture.request('/offers/open-default', 'GET', undefined, gustavo)).data, { checked: false })
    assert.equal((await fixture.request('/offers/open-default')).status, 401)

    const created = await fixture.request('/offers', 'POST', { ...offerDraft, deadline: '', open: true }, marina)
    assert.equal(created.status, 201)
    const offer = created.data.item
    assert.deepEqual([offer.status, offer.openForTeam, offer.editingBy, offer.createdByName], ['creating', true, undefined, 'Marina'])
    // A normal manual offer still belongs to whoever adds it.
    const own = (await fixture.request('/offers', 'POST', offerDraft, gustavo)).data.item
    assert.deepEqual([own.status, own.openForTeam, own.editingBy?.name], ['creating', undefined, 'Gustavo'])

    // The others are told; who inserted it is not.
    const notice = (headers) => fixture.request('/notifications', 'GET', undefined, headers).then((response) => response.data.items.find((item) => item.type === 'open-offer' && item.offerId === offer.id))
    const told = await notice(gustavo)
    assert.equal(told?.title, 'Nova oferta em aberto')
    assert.match(told.description, new RegExp(`${offer.code} · ${offerDraft.company} · inserida por Marina`))
    assert.equal(await notice(marina), undefined)

    // Whoever opens it first becomes the one creating it, like an offer of the site.
    const taken = (await fixture.request(`/offers/${offer.id}/take-over`, 'POST', {}, gustavo)).data.item
    assert.deepEqual([taken.status, taken.editingBy?.name], ['creating', 'Gustavo'])
  } finally {
    if (previous === undefined) delete process.env.OPEN_OFFER_DEFAULT_CPFS
    else process.env.OPEN_OFFER_DEFAULT_CPFS = previous
    await fixture.close()
  }
})
