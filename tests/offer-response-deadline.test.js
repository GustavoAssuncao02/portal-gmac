import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'
import { parseResponseDays, responseBadge, responseDeadlineOf, responseNoticePlan, responseNoticeText } from '../server/offerResponseRules.js'

// TCK-0012 (2026-11-26): "Prazo para resposta do cliente (dias)" on the manual offer and in Editar informações. The days
// count from the Data da solicitação (retroactive offers included) and give the day the client has to accept or refuse
// the proposal; the bell warns at 07:30, by default 3 days before, 1 day before and on the day, each person by their own
// settings (Configurações › Notificações › Comercial). The notices stop once the offer is accepted or refused.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Administradora' }
const person = (index) => ({ name: `Funcionário ${index}`, birthDate: '1990-01-01', cpf: `0000000000${index}`, email: `funcionario${index}@example.invalid`, identification: '', type: 'administrative', password: 'senha123' })
const shiftDay = (day, days) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const at = (day, time = '07:30') => Date.parse(`${day}T${time}:00-03:00`)

async function people(fixture, indexes) {
  const result = []
  for (const index of indexes) {
    assert.equal((await fixture.adminRequest('/employees', 'POST', person(index))).status, 201)
    const login = await fixture.request('/auth/login', 'POST', { cpf: `0000000000${index}`, password: 'senha123' })
    const headers = { Authorization: `Bearer ${login.data.token}` }
    const call = (route, method = 'GET', body) => fixture.request(route, method, body, headers)
    result.push(Object.assign(call, { id: login.data.user.id }))
  }
  return result
}
const bell = async (call) => (await call('/notifications')).data.items.filter((item) => String(item.type).startsWith('offer-response-'))

test('the rules: days to a day, the badge and the plan of the notices', () => {
  assert.equal(parseResponseDays(''), null)
  assert.equal(parseResponseDays(null), null)
  assert.equal(parseResponseDays('10'), 10)
  for (const wrong of ['0', '366', '2.5', 'dez', -3]) assert.ok(Number.isNaN(parseResponseDays(wrong)), String(wrong))
  assert.equal(responseDeadlineOf('2026-11-26', 10), '2026-12-06')
  assert.equal(responseDeadlineOf('2026-11-20T12:00:00.000Z', 1), '2026-11-21')

  const offer = { responseDeadline: '2026-12-06', status: 'proposal' }
  assert.deepEqual(responseBadge(offer, '2026-11-26'), { days: 10, label: 'em 10 dias', tone: 'ok' })
  assert.equal(responseBadge(offer, '2026-12-03').tone, 'soon')
  assert.equal(responseBadge(offer, '2026-12-05').label, 'em 1 dia')
  assert.deepEqual([responseBadge(offer, '2026-12-06').label, responseBadge(offer, '2026-12-06').tone], ['vence hoje', 'today'])
  assert.deepEqual([responseBadge(offer, '2026-12-08').label, responseBadge(offer, '2026-12-08').tone], ['vencido há 2 dias', 'late'])
  assert.equal(responseBadge({ ...offer, status: 'rejected' }, '2026-12-08'), null, 'answered: no badge')
  assert.equal(responseBadge({ ...offer, orderCode: 'OS-2026-0001' }, '2026-12-08'), null)

  const defaults = { offerResponseFirst: true, offerResponseFirstDays: 3, offerResponseSecond: true, offerResponseSecondDays: 1, offerResponseDueDay: true }
  assert.deepEqual(responseNoticePlan('2026-12-06', defaults).map(({ kind, day }) => `${kind}:${day}`), ['first:2026-12-03', 'second:2026-12-05', 'due:2026-12-06'])
  assert.deepEqual(responseNoticePlan('2026-12-06', { ...defaults, offerResponseSecondDays: 3 }).map(({ kind }) => kind), ['first', 'due'], 'the same days arrive once')
  assert.deepEqual(responseNoticePlan('2026-12-06', { ...defaults, offerResponseFirst: false, offerResponseDueDay: false }).map(({ kind }) => kind), ['second'])

  const text = { code: 'OF-2026-0007', company: 'Cliente Fictício', responseDeadline: '2026-12-06', proposal: { key: 'A' } }
  assert.equal(responseNoticeText(text, 3), 'OF-2026-0007 · Cliente Fictício: faltam 3 dias para o cliente responder a proposta (até 06/12)')
  assert.equal(responseNoticeText(text, 1), 'OF-2026-0007 · Cliente Fictício: falta 1 dia para o cliente responder a proposta (até 06/12)')
  assert.equal(responseNoticeText({ ...text, proposal: null }, 0), 'OF-2026-0007 · Cliente Fictício: o prazo para o cliente responder a proposta vence hoje (06/12) e a proposta ainda não foi feita')
})

test('the manual offer and Editar informações take the days from the request day; editing never discards the proposal', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const today = todayBahia(), past = shiftDay(today, -20)
  const create = (fields) => fixture.adminRequest('/offers', 'POST', { ...offerDraft, ...fields })

  for (const wrong of ['0', '366', '1.5', 'abc']) {
    const refused = await create({ responseDays: wrong })
    assert.deepEqual([refused.status, refused.data.message], [400, 'Prazo para resposta do cliente: informe de 1 a 365 dias ou deixe em branco.'], wrong)
  }
  const plain = (await create({ responseDays: '' })).data.item
  assert.equal(plain.responseDays, undefined, 'empty: no deadline')
  assert.equal(plain.responseDeadline, undefined)

  const todays = (await create({ responseDays: '10' })).data.item
  assert.deepEqual([todays.responseDays, todays.responseDeadline], [10, shiftDay(today, 10)])
  assert.ok(todays.responseSetAt)

  // A retroactive offer counts from its Data da solicitação, not from the day it was entered.
  const created = await create({ requestedAt: past, deadline: shiftDay(today, 5), responseDays: 7 })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const offer = created.data.item
  assert.deepEqual([offer.responseDays, offer.responseDeadline], [7, shiftDay(past, 7)])

  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [{ id: 'l1', type: 'machine', resource: 'Torno', hours: 2, hourlyRate: 30 }], stages: ['turning'], kind: 'service' })
  const proposal = await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Proposta A', serviceValue: 350, materials: 0, labor: 60, margin: 15, discount: 0, deadline: shiftDay(today, 5), machine: '2 horas', serviceTime: '0 horas', payment: '28 dias' } })
  assert.equal(proposal.status, 200, JSON.stringify(proposal.data))

  const base = { cnpj: offer.cnpj, company: offer.company, service: offer.service, quantity: offer.quantity, quantityUnit: 'un', labelNumber: '', requesters: [''], buyer: '', requestedAt: past, deadline: offer.deadline }
  const edit = async (fields) => fixture.adminRequest(`/offers/${offer.id}`, 'PUT', { ...base, ...fields })
  assert.deepEqual([(await edit({ responseDays: 400 })).status, (await edit({ responseDays: 400 })).data.message], [400, 'Prazo para resposta do cliente: informe de 1 a 365 dias ou deixe em branco.'])

  // A screen of the previous version does not send the field: it is kept.
  const kept = await edit({})
  assert.equal(kept.status, 200, JSON.stringify(kept.data))
  assert.deepEqual([kept.data.item.responseDays, kept.data.item.responseDeadline, kept.data.item.responseSetAt], [7, offer.responseDeadline, offer.responseSetAt])

  const changed = (await edit({ responseDays: '30' })).data.item
  assert.deepEqual([changed.responseDays, changed.responseDeadline], [30, shiftDay(past, 30)])
  assert.ok(changed.proposal, 'the deadline for the answer is not printed: the proposal stays')
  assert.ok(Date.parse(changed.responseSetAt) >= Date.parse(offer.responseSetAt))

  // A new Data da solicitação moves the day too.
  const moved = (await edit({ requestedAt: shiftDay(past, -2), responseDays: 30 })).data.item
  assert.equal(moved.responseDeadline, shiftDay(past, 28))

  const removed = (await edit({ requestedAt: shiftDay(past, -2), responseDays: '' })).data.item
  assert.deepEqual([removed.responseDays, removed.responseDeadline, removed.responseSetAt], [undefined, undefined, undefined])
  assert.ok(removed.proposal)
})

test('the notices come at 07:30, once, each person by their settings, and stop once the client answered', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const [ana, bia, caio] = await people(fixture, [4, 5, 6])
    const ids = (list, who) => list.filter((id) => id.includes(`:${who.id}:`)).map((id) => id.split(':')[3])
    // Bia: 1º aviso 5 dias antes and nothing on the day; Caio: 2º aviso igual ao 1º (one notice only).
    assert.equal((await bia('/account/notifications', 'PATCH', { offerResponseFirstDays: 5 })).status, 200)
    assert.equal((await bia('/account/notifications', 'PATCH', { offerResponseDueDay: false })).status, 200)
    assert.equal((await caio('/account/notifications', 'PATCH', { offerResponseSecondDays: 3 })).status, 200)

    const today = todayBahia()
    const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, responseDays: 10 })).data.item
    const deadline = shiftDay(today, 10)
    const sweep = async (day, time) => fixture.offerResponseSweep(at(day, time))

    assert.deepEqual(await sweep(shiftDay(deadline, -5), '07:29'), [], 'not before 07:30')
    const fiveBefore = await sweep(shiftDay(deadline, -5))
    assert.deepEqual([ids(fiveBefore, ana), ids(fiveBefore, bia), ids(fiveBefore, caio)], [[], ['first'], []])
    assert.deepEqual(await sweep(shiftDay(deadline, -5), '15:00'), [], 'once')

    const threeBefore = await sweep(shiftDay(deadline, -3))
    assert.deepEqual([ids(threeBefore, ana), ids(threeBefore, bia), ids(threeBefore, caio)], [['first'], [], ['first']])
    const oneBefore = await sweep(shiftDay(deadline, -1))
    assert.deepEqual([ids(oneBefore, ana), ids(oneBefore, bia), ids(oneBefore, caio)], [['second'], ['second'], []])

    const [notice] = await bell(ana)
    assert.deepEqual([notice.type, notice.offerId, notice.title], ['offer-response-second', offer.id, 'Prazo de resposta do cliente'])
    assert.match(notice.description, new RegExp(`^${offer.code} · Teste de fluxo: falta 1 dia para o cliente responder a proposta \\(até ${deadline.slice(8, 10)}/${deadline.slice(5, 7)}\\) e a proposta ainda não foi feita$`))
    assert.equal((await bell(bia)).length, 2)

    // A notice turned off afterwards leaves the bell too, like every other kind.
    await ana('/account/notifications', 'PATCH', { offerResponseFirst: false })
    assert.deepEqual((await bell(ana)).map((item) => item.type), ['offer-response-second'])

    const onTheDay = await sweep(deadline)
    assert.deepEqual([ids(onTheDay, ana), ids(onTheDay, bia), ids(onTheDay, caio)], [['due'], [], ['due']])
    assert.equal((await bell(caio)).find((item) => item.type === 'offer-response-due').title, 'Prazo de resposta vence hoje')

    // A refused offer warns no more; a deadline set after 07:30 does not warn that same day.
    const refused = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, responseDays: 3 })).data.item
    assert.equal((await fixture.adminRequest(`/offers/${refused.id}/reject`, 'POST', { reason: 'Cliente desistiu' })).status, 200)
    assert.deepEqual((await sweep(refused.responseDeadline)).filter((id) => id.includes(refused.id)), [])

    const late = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, responseDays: 2 })).data.item
    const firstDay = shiftDay(late.responseDeadline, -3)
    await fixture.mutateStore((store) => { store.offers.find((item) => item.id === late.id).responseSetAt = new Date(at(shiftDay(late.responseDeadline, -1), '09:00')).toISOString() })
    assert.ok(firstDay < late.responseDeadline)
    assert.deepEqual((await sweep(shiftDay(late.responseDeadline, -1))).filter((id) => id.includes(late.id)), [], 'set after 07:30 of that day')
    assert.deepEqual(ids((await sweep(late.responseDeadline)).filter((id) => id.includes(late.id)), ana), ['due'])
  } finally { await fixture.close() }
})

test('the settings of the notices are saved one by one, strict, with defaults', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const [ana, bia] = await people(fixture, [4, 5])
    const defaults = (await ana('/account/notifications')).data.settings
    assert.deepEqual([defaults.offerResponseFirst, defaults.offerResponseFirstDays, defaults.offerResponseSecond, defaults.offerResponseSecondDays, defaults.offerResponseDueDay], [true, 3, true, 1, true])
    for (const body of [{ offerResponseFirstDays: 0 }, { offerResponseFirstDays: 31 }, { offerResponseSecondDays: '2' }, { offerResponseSecondDays: 1.5 }]) {
      const refused = await ana('/account/notifications', 'PATCH', body)
      assert.deepEqual([refused.status, refused.data.message], [400, 'Escolha de 1 a 30 dias antes do prazo de resposta.'], JSON.stringify(body))
    }
    assert.equal((await ana('/account/notifications', 'PATCH', { offerResponseDueDay: 'sim' })).status, 400)
    const saved = (await ana('/account/notifications', 'PATCH', { offerResponseSecondDays: 30 })).data.settings
    assert.deepEqual([saved.offerResponseSecondDays, saved.offerResponseFirstDays, saved.offerResponseDueDay], [30, 3, true], 'one change at a time keeps the rest')
    assert.equal((await ana('/account/notifications', 'PATCH', { offerResponseFirst: false })).data.settings.offerResponseFirst, false)
    assert.equal((await bia('/account/notifications')).data.settings.offerResponseFirst, true, 'one account does not change another')
  } finally { await fixture.close() }
})
