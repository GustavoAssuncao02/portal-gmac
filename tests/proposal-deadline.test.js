import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'
import { deadlineOffers, parseProposalDeadline, proposalDeadlineBadge, proposalDue, proposalNoticePlan, proposalNoticeText, urgentFirst } from '../server/proposalDeadlineRules.js'
import { proposalNoticesOnByDefault } from '../server/accounts.js'

// TCK-0012 (revised 2026-11-27): "Prazo para enviar a proposta" on the manual offer and in Editar informações. An optional
// day, never before the Data da solicitação. While the offer waits for its proposal the list highlights it and the bell
// warns at 07:30, each person by their own settings (Configurações › Notificações › Comercial): off by default, on for
// the CPFs of PROPOSAL_DEADLINE_NOTICE_CPFS. Everything stops once the proposal is generated, accepted or refused.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Administradora' }
const cpf = (index) => `0000000000${index}`
const person = (index) => ({ name: `Funcionário ${index}`, birthDate: '1990-01-01', cpf: cpf(index), email: `funcionario${index}@example.invalid`, identification: '', type: 'administrative', password: 'senha123' })
const shiftDay = (day, days) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const at = (day, time = '07:30') => Date.parse(`${day}T${time}:00-03:00`)
const message = 'Prazo para enviar a proposta: escolha uma data a partir da data da solicitação ou deixe em branco.'

async function people(fixture, indexes) {
  const result = []
  for (const index of indexes) {
    assert.equal((await fixture.adminRequest('/employees', 'POST', person(index))).status, 201)
    const login = await fixture.request('/auth/login', 'POST', { cpf: cpf(index), password: 'senha123' })
    const headers = { Authorization: `Bearer ${login.data.token}` }
    const call = (route, method = 'GET', body) => fixture.request(route, method, body, headers)
    result.push(Object.assign(call, { id: login.data.user.id }))
  }
  return result
}
const bell = async (call) => (await call('/notifications')).data.items.filter((item) => String(item.type).startsWith('proposal-deadline-'))
// The CPFs with the notices on by default live only in the server environment: set here, put back afterwards.
async function withNoticeCpfs(value, run) {
  const before = process.env.PROPOSAL_DEADLINE_NOTICE_CPFS
  if (value === undefined) delete process.env.PROPOSAL_DEADLINE_NOTICE_CPFS
  else process.env.PROPOSAL_DEADLINE_NOTICE_CPFS = value
  try { return await run() } finally {
    if (before === undefined) delete process.env.PROPOSAL_DEADLINE_NOTICE_CPFS
    else process.env.PROPOSAL_DEADLINE_NOTICE_CPFS = before
  }
}

test('the rules: the day, the badge, the order of the list and the plan of the notices', () => {
  assert.equal(parseProposalDeadline(''), null)
  assert.equal(parseProposalDeadline(null), null)
  assert.equal(parseProposalDeadline('2026-12-06'), '2026-12-06')
  assert.equal(parseProposalDeadline('2026-12-06', '2026-12-06'), '2026-12-06', 'the day of the request itself')
  for (const wrong of ['2026-02-30', '06/12/2026', 'amanhã', 20261206]) assert.ok(Number.isNaN(parseProposalDeadline(wrong)), String(wrong))
  assert.ok(Number.isNaN(parseProposalDeadline('2026-12-05', '2026-12-06')), 'before the request')
  assert.equal(parseProposalDeadline('2026-11-27', '2026-11-28T02:50:00.000Z'), '2026-11-27', 'the request day is the day in Bahia')

  const offer = { proposalDeadline: '2026-12-06', status: 'creating' }
  assert.equal(proposalDeadlineBadge(offer, '2026-12-03'), null, 'far away: the date is enough')
  assert.deepEqual(proposalDeadlineBadge(offer, '2026-12-04'), { days: 2, label: 'em 2 dias', tone: 'soon' })
  assert.deepEqual(proposalDeadlineBadge(offer, '2026-12-05'), { days: 1, label: 'amanhã', tone: 'soon' })
  assert.deepEqual(proposalDeadlineBadge(offer, '2026-12-06'), { days: 0, label: 'vence hoje', tone: 'today' })
  assert.deepEqual(proposalDeadlineBadge({ ...offer, status: 'review' }, '2026-12-07'), { days: -1, label: 'atrasada há 1 dia', tone: 'late' })
  assert.equal(proposalDeadlineBadge(offer, '2026-12-09').label, 'atrasada há 3 dias')
  for (const stopped of [{ status: 'proposed' }, { status: 'accepted' }, { status: 'rejected' }, { status: 'review', orderCode: 'OS-2026-0001' }]) {
    assert.equal(proposalDeadlineBadge({ ...offer, ...stopped }, '2026-12-09'), null, JSON.stringify(stopped))
  }
  assert.deepEqual([proposalDue(offer, '2026-12-03'), proposalDue(offer, '2026-12-04'), proposalDue(offer, '2026-12-05'), proposalDue(offer, '2026-12-06'), proposalDue(offer, '2026-12-08'), proposalDue({ status: 'creating' }, '2026-12-08')], [false, true, true, true, true, false])

  const list = [
    { code: 'OF-1', status: 'review' },
    { code: 'OF-2', status: 'creating', proposalDeadline: '2026-12-20' },
    { code: 'OF-3', status: 'creating', proposalDeadline: '2026-12-07' },
    { code: 'OF-4', status: 'proposed', proposalDeadline: '2026-12-01' },
    { code: 'OF-5', status: 'review', proposalDeadline: '2026-12-03' },
    { code: 'OF-6', status: 'creating', proposalDeadline: '2026-12-05' },
  ]
  assert.deepEqual(urgentFirst(list, '2026-12-05').map((item) => item.code), ['OF-5', 'OF-6', 'OF-3', 'OF-1', 'OF-2', 'OF-4'], 'late, today and the next 2 days first; the rest keeps its order')
  assert.deepEqual(deadlineOffers(list, '2026-12-05').map((item) => item.code), ['OF-5', 'OF-6', 'OF-3', 'OF-2'], 'the widget: every pending offer with a deadline')

  const on = { proposalDeadlineFirst: true, proposalDeadlineFirstDays: 3, proposalDeadlineSecond: true, proposalDeadlineSecondDays: 1, proposalDeadlineDueDay: true }
  assert.deepEqual(proposalNoticePlan('2026-12-06', on).map(({ kind, day }) => `${kind}:${day}`), ['first:2026-12-03', 'second:2026-12-05', 'due:2026-12-06'])
  assert.deepEqual(proposalNoticePlan('2026-12-06', { ...on, proposalDeadlineSecondDays: 3 }).map(({ kind }) => kind), ['first', 'due'], 'the same days arrive once')
  assert.deepEqual(proposalNoticePlan('2026-12-06', { ...on, proposalDeadlineFirst: false, proposalDeadlineDueDay: false }).map(({ kind }) => kind), ['second'])
  assert.deepEqual(proposalNoticePlan('', on), [])

  const text = { code: 'OF-2026-0007', company: 'Cliente Fictício', proposalDeadline: '2026-12-06' }
  assert.equal(proposalNoticeText(text, 3), 'OF-2026-0007 · Cliente Fictício: faltam 3 dias para enviar a proposta (até 06/12)')
  assert.equal(proposalNoticeText(text, 1), 'OF-2026-0007 · Cliente Fictício: falta 1 dia para enviar a proposta (até 06/12)')
  assert.equal(proposalNoticeText(text, 0), 'OF-2026-0007 · Cliente Fictício: o prazo para enviar a proposta vence hoje (06/12)')

  const environment = { PROPOSAL_DEADLINE_NOTICE_CPFS: '000.000.000-04, 00000000009' }
  assert.deepEqual([cpf(4), cpf(9), cpf(5), ''].map((value) => proposalNoticesOnByDefault({ cpf: value }, environment)), [true, true, false, false])
  assert.equal(proposalNoticesOnByDefault({ cpf: cpf(4) }, {}), false, 'no variable: off for everybody')
  assert.equal(proposalNoticesOnByDefault(null, environment), false)
})

test('the manual offer and Editar informações take a day not before the request; editing never discards the proposal', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const today = todayBahia(), past = shiftDay(today, -20)
  const create = (fields) => fixture.adminRequest('/offers', 'POST', { ...offerDraft, ...fields })

  for (const wrong of ['2026-02-30', 'amanhã', shiftDay(today, -1)]) {
    const refused = await create({ proposalDeadline: wrong })
    assert.deepEqual([refused.status, refused.data.message], [400, message], wrong)
  }
  const plain = (await create({ proposalDeadline: '' })).data.item
  assert.deepEqual([plain.proposalDeadline, plain.proposalDeadlineSetAt], [undefined, undefined], 'empty: no deadline')

  const todays = (await create({ proposalDeadline: today })).data.item
  assert.equal(todays.proposalDeadline, today)
  assert.ok(todays.proposalDeadlineSetAt)

  // A retroactive offer takes a deadline from its Data da solicitação on (already past, then late).
  assert.equal((await create({ requestedAt: past, deadline: shiftDay(today, 5), proposalDeadline: shiftDay(past, -1) })).status, 400)
  const created = await create({ requestedAt: past, deadline: shiftDay(today, 5), proposalDeadline: shiftDay(past, 3) })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const offer = created.data.item
  assert.equal(offer.proposalDeadline, shiftDay(past, 3))

  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [{ id: 'l1', type: 'machine', resource: 'Torno', hours: 2, hourlyRate: 30 }], stages: ['turning'], kind: 'service' })
  const proposal = await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Proposta A', serviceValue: 350, materials: 0, labor: 60, margin: 15, discount: 0, deadline: shiftDay(today, 5), machine: '2 horas', serviceTime: '0 horas', payment: '28 dias' } })
  assert.equal(proposal.status, 200, JSON.stringify(proposal.data))

  const base = { cnpj: offer.cnpj, company: offer.company, service: offer.service, quantity: offer.quantity, quantityUnit: 'un', labelNumber: '', requesters: [''], buyer: '', requestedAt: past, deadline: offer.deadline }
  const edit = async (fields) => fixture.adminRequest(`/offers/${offer.id}`, 'PUT', { ...base, ...fields })
  for (const wrong of ['31/12/2026', shiftDay(past, -1)]) assert.deepEqual([(await edit({ proposalDeadline: wrong })).status, (await edit({ proposalDeadline: wrong })).data.message], [400, message], wrong)

  // A screen of the previous version does not send the field: it is kept.
  const kept = await edit({})
  assert.equal(kept.status, 200, JSON.stringify(kept.data))
  assert.deepEqual([kept.data.item.proposalDeadline, kept.data.item.proposalDeadlineSetAt], [offer.proposalDeadline, offer.proposalDeadlineSetAt])

  const changed = (await edit({ proposalDeadline: shiftDay(today, 7) })).data.item
  assert.equal(changed.proposalDeadline, shiftDay(today, 7))
  assert.ok(changed.proposal, 'the deadline is not printed: the proposal stays')
  assert.ok(Date.parse(changed.proposalDeadlineSetAt) >= Date.parse(offer.proposalDeadlineSetAt))

  // A Data da solicitação moved after the deadline is refused; moved before it, fine.
  assert.equal((await edit({ requestedAt: today, proposalDeadline: shiftDay(today, -1) })).status, 400)
  assert.equal((await edit({ requestedAt: shiftDay(past, -2), proposalDeadline: shiftDay(today, 7) })).status, 200)

  // The fields of the first version (days for the client to answer) leave with any edit.
  await fixture.mutateStore((store) => Object.assign(store.offers.find((item) => item.id === offer.id), { responseDays: 5, responseDeadline: today, responseSetAt: new Date().toISOString() }))
  const removed = (await edit({ requestedAt: shiftDay(past, -2), proposalDeadline: '' })).data.item
  assert.deepEqual([removed.proposalDeadline, removed.proposalDeadlineSetAt, removed.responseDays, removed.responseDeadline, removed.responseSetAt], [undefined, undefined, undefined, undefined, undefined])
  assert.ok(removed.proposal)
})

test('the notices: off by default, on for the CPFs of the environment, at 07:30, once, each by their settings', async () => {
  await withNoticeCpfs(`${cpf(7)},000.000.000-08`, async () => {
    const fixture = await createWorkflowFixture({ accountsEnv: env })
    try {
      const [ana, bia, caio, davi] = await people(fixture, [4, 5, 7, 8])
      const ids = (list, who) => list.filter((id) => id.includes(`:${who.id}:`)).map((id) => id.split(':')[3])
      // Ana turns them on (1º aviso 5 dias antes, nothing on the day); Bia never does; Caio comes with all of them on;
      // Davi too, but turns the 2º aviso off.
      for (const body of [{ proposalDeadlineFirst: true }, { proposalDeadlineFirstDays: 5 }, { proposalDeadlineSecond: true }]) assert.equal((await ana('/account/notifications', 'PATCH', body)).status, 200)
      assert.equal((await davi('/account/notifications', 'PATCH', { proposalDeadlineSecond: false })).status, 200)

      const today = todayBahia(), deadline = shiftDay(today, 10)
      const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, proposalDeadline: deadline })).data.item
      const sweep = async (day, time) => fixture.proposalDeadlineSweep(at(day, time))

      assert.deepEqual(await sweep(shiftDay(deadline, -5), '07:29'), [], 'not before 07:30')
      const fiveBefore = await sweep(shiftDay(deadline, -5))
      assert.deepEqual([ids(fiveBefore, ana), ids(fiveBefore, bia), ids(fiveBefore, caio), ids(fiveBefore, davi)], [['first'], [], [], []])
      assert.deepEqual(await sweep(shiftDay(deadline, -5), '15:00'), [], 'once')

      const threeBefore = await sweep(shiftDay(deadline, -3))
      assert.deepEqual([ids(threeBefore, ana), ids(threeBefore, bia), ids(threeBefore, caio), ids(threeBefore, davi)], [[], [], ['first'], ['first']])
      const oneBefore = await sweep(shiftDay(deadline, -1))
      assert.deepEqual([ids(oneBefore, ana), ids(oneBefore, bia), ids(oneBefore, caio), ids(oneBefore, davi)], [['second'], [], ['second'], []])

      const [notice] = await bell(caio)
      assert.deepEqual([notice.type, notice.offerId, notice.title], ['proposal-deadline-second', offer.id, 'Prazo para enviar a proposta'])
      assert.match(notice.description, new RegExp(`^${offer.code} · Teste de fluxo: falta 1 dia para enviar a proposta \\(até ${deadline.slice(8, 10)}/${deadline.slice(5, 7)}\\)$`))
      assert.equal((await bell(caio)).length, 2)
      assert.equal((await bell(bia)).length, 0)

      // A notice turned off afterwards leaves the bell too, like every other kind.
      await caio('/account/notifications', 'PATCH', { proposalDeadlineFirst: false })
      assert.deepEqual((await bell(caio)).map((item) => item.type), ['proposal-deadline-second'])

      const onTheDay = await sweep(deadline)
      assert.deepEqual([ids(onTheDay, ana), ids(onTheDay, bia), ids(onTheDay, caio), ids(onTheDay, davi)], [[], [], ['due'], ['due']])
      assert.equal((await bell(davi)).find((item) => item.type === 'proposal-deadline-due').title, 'Prazo da proposta vence hoje')

      // A generated proposal warns no more (a discarded one would warn again); a refused offer neither.
      const proposed = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, proposalDeadline: shiftDay(today, 3) })).data.item
      await fixture.mutateStore((store) => { store.offers.find((item) => item.id === proposed.id).status = 'proposed' })
      assert.deepEqual((await sweep(proposed.proposalDeadline)).filter((id) => id.includes(proposed.id)), [])
      const refused = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, proposalDeadline: shiftDay(today, 3) })).data.item
      assert.equal((await fixture.adminRequest(`/offers/${refused.id}/reject`, 'POST', { reason: 'Cliente desistiu' })).status, 200)
      assert.deepEqual((await sweep(refused.proposalDeadline)).filter((id) => id.includes(refused.id)), [])

      // A deadline set after 07:30 does not warn that same day.
      const late = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, proposalDeadline: shiftDay(today, 2) })).data.item
      await fixture.mutateStore((store) => { store.offers.find((item) => item.id === late.id).proposalDeadlineSetAt = new Date(at(shiftDay(late.proposalDeadline, -1), '09:00')).toISOString() })
      assert.deepEqual((await sweep(shiftDay(late.proposalDeadline, -1))).filter((id) => id.includes(late.id)), [], 'set after 07:30 of that day')
      assert.deepEqual(ids((await sweep(late.proposalDeadline)).filter((id) => id.includes(late.id)), caio), ['due'])
    } finally { await fixture.close() }
  })
})

test('the settings of the notices: off by default, on for the CPFs of the environment, saved one by one, strict', async () => {
  await withNoticeCpfs(cpf(5), async () => {
    const fixture = await createWorkflowFixture({ accountsEnv: env })
    try {
      const [ana, bia] = await people(fixture, [4, 5])
      const read = async (call) => { const settings = (await call('/account/notifications')).data.settings; return [settings.proposalDeadlineFirst, settings.proposalDeadlineFirstDays, settings.proposalDeadlineSecond, settings.proposalDeadlineSecondDays, settings.proposalDeadlineDueDay] }
      assert.deepEqual(await read(ana), [false, 3, false, 1, false])
      assert.deepEqual(await read(bia), [true, 3, true, 1, true])
      for (const body of [{ proposalDeadlineFirstDays: 0 }, { proposalDeadlineFirstDays: 31 }, { proposalDeadlineSecondDays: '2' }, { proposalDeadlineSecondDays: 1.5 }]) {
        const refused = await ana('/account/notifications', 'PATCH', body)
        assert.deepEqual([refused.status, refused.data.message], [400, 'Escolha de 1 a 30 dias antes do prazo para enviar a proposta.'], JSON.stringify(body))
      }
      assert.equal((await ana('/account/notifications', 'PATCH', { proposalDeadlineDueDay: 'sim' })).status, 400)
      const saved = (await ana('/account/notifications', 'PATCH', { proposalDeadlineSecondDays: 30 })).data.settings
      assert.deepEqual([saved.proposalDeadlineSecondDays, saved.proposalDeadlineFirstDays, saved.proposalDeadlineDueDay], [30, 3, false], 'one change at a time keeps the rest')
      // Bia changes one: the others stay on (written as on, so the bell, which knows only the id, sees them too).
      const bias = (await bia('/account/notifications', 'PATCH', { proposalDeadlineFirst: false })).data.settings
      assert.deepEqual([bias.proposalDeadlineFirst, bias.proposalDeadlineSecond, bias.proposalDeadlineDueDay], [false, true, true])
      assert.deepEqual(await read(ana), [false, 3, false, 30, false], 'one account does not change another')
      const stored = await fixture.mutateStore((store) => store.adminNotificationPreferences.find((item) => String(item.userId) === String(bia.id)))
      assert.deepEqual([stored.proposalDeadlineFirst, stored.proposalDeadlineSecond, stored.proposalDeadlineDueDay], [false, true, true])
    } finally { await fixture.close() }
  })
})
