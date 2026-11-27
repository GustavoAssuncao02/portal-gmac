import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'
import { requestDay } from '../server/retroactiveEntry.js'

// Lançamento retroativo (2026-11-25): "Inserir oferta manualmente" takes the day of the request (today by default),
// which cannot be after today, and the deadline cannot come before it. A retroactive offer opens its OS on that same
// day, with nothing asked again on the acceptance. The real moment of each entry is kept apart (createdAt of the offer, registeredAt of the
// OS), and the bell tells about the new service now, not on the retroactive day.
const shiftDay = (day, days) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)

test('a manual offer and its OS can be entered with earlier dates', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const today = todayBahia(), tomorrow = shiftDay(today, 1), past = shiftDay(today, -20), later = shiftDay(today, -15)
  const create = (fields) => fixture.adminRequest('/offers', 'POST', { ...offerDraft, ...fields })

  // Without the field (a screen of the previous version) it is today, as before.
  const plain = await create({})
  assert.equal(plain.status, 201)
  assert.equal(plain.data.item.requestedAt, plain.data.item.createdAt)

  assert.equal((await create({ requestedAt: '2026-02-30' })).status, 400)
  const future = await create({ requestedAt: tomorrow })
  assert.deepEqual([future.status, future.data.message], [400, 'A data da solicitação não pode ser depois de hoje.'])
  const early = await create({ requestedAt: past, deadline: shiftDay(past, -1) })
  assert.deepEqual([early.status, early.data.message], [400, 'O prazo solicitado não pode ser antes da data da solicitação.'])

  // A past day: the list and the OS show that day; the moment of the entry stays the real one.
  const created = await create({ requestedAt: past, deadline: later })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const offer = created.data.item
  assert.equal(offer.requestedAt, `${past}T12:00:00.000Z`)
  assert.equal(offer.createdAt.slice(0, 10), new Date().toISOString().slice(0, 10))
  // Today chosen on the form keeps the real moment.
  const todays = (await create({ requestedAt: today })).data.item
  assert.equal(todays.requestedAt, todays.createdAt)

  // Editing: a future day or a deadline before the request is refused; the day may still change backwards.
  const base = { cnpj: offer.cnpj, company: offer.company, service: offer.service, quantity: offer.quantity, quantityUnit: 'un', labelNumber: '', requesters: [''], buyer: '', deadline: later }
  const edit = (fields) => fixture.adminRequest(`/offers/${offer.id}`, 'PUT', { ...base, ...fields })
  assert.deepEqual([(await edit({ requestedAt: tomorrow })).data.message], ['A data da solicitação não pode ser depois de hoje.'])
  assert.deepEqual([(await edit({ requestedAt: past, deadline: shiftDay(past, -2) })).data.message], ['O prazo solicitado não pode ser antes da data da solicitação.'])
  assert.equal((await edit({ requestedAt: shiftDay(past, -1) })).status, 200)
  assert.equal((await edit({ requestedAt: past })).status, 200)

  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [{ id: 'l1', type: 'machine', resource: 'Torno', hours: 2, hourlyRate: 30 }], stages: ['turning'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Proposta A', serviceValue: 350, materials: 0, labor: 60, margin: 15, discount: 0, deadline: later, machine: '2 horas', serviceTime: '0 horas' } })

  // The acceptance asks for no date (user's decision of 2026-11-25): the OS of a retroactive offer takes its "Data da
  // solicitação". A date sent by an older screen is ignored.
  const accepted = await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST', { orderDate: shiftDay(past, 2) })
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data))
  const order = accepted.data.item
  assert.equal(order.createdAt, `${past}T12:00:00.000Z`)
  assert.equal(order.requestedAt, `${past}T12:00:00.000Z`)
  assert.equal(order.registeredAt.slice(0, 10), new Date().toISOString().slice(0, 10))
  assert.match(order.auditEvents.at(-1).details, new RegExp(`Lançamento retroativo: data da OS ${past.split('-').reverse().join('/')}\\.`))
  const notice = (await fixture.mutateStore((store) => store)).operationalNotifications.find((item) => item.id === `service-added:${order.code}`)
  assert.equal(notice.at, order.registeredAt)

  // An offer requested today is not retroactive: its OS has the moment of the acceptance.
  const other = (await create({})).data.item
  await fixture.adminRequest(`/offers/${other.id}/resources`, 'PUT', { materials: [], laborEntries: [{ id: 'l1', type: 'machine', resource: 'Torno', hours: 2, hourlyRate: 30 }], stages: ['turning'], kind: 'service' })
  await fixture.adminRequest(`/offers/${other.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Proposta A', serviceValue: 350, materials: 0, labor: 60, margin: 15, discount: 0, deadline: '2026-12-21', machine: '2 horas', serviceTime: '0 horas' } })
  const current = (await fixture.adminRequest(`/offers/${other.id}/accept`, 'POST', { orderDate: shiftDay(today, -3) })).data.item
  assert.equal(current.registeredAt, undefined)
  assert.ok(Date.now() - Date.parse(current.createdAt) < 60000, 'the real moment of the acceptance')
  assert.doesNotMatch(current.auditEvents.at(-1).details, /retroativo/)
})

// 2026-11-27: the screens showed the day of the request in UTC, so an offer entered from 21:00 on (Bahia) appeared on the
// next day in the list, in Ver oferta and in Editar. The day of the request is the day in Bahia everywhere.
test('the day of the request is the day in Bahia, also for an offer entered at night', async (t) => {
  assert.equal(requestDay('2026-11-27T02:50:00.000Z'), '2026-11-26', '23:50 in Bahia')
  assert.equal(requestDay('2026-11-27T03:00:00.000Z'), '2026-11-27')
  assert.equal(requestDay('2026-11-20T12:00:00.000Z'), '2026-11-20', 'a retroactive day')
  assert.equal(requestDay('2026-11-26'), '2026-11-26')
  assert.deepEqual([requestDay(''), requestDay(undefined), requestDay('ontem')], ['', '', ''])

  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const today = todayBahia(), night = new Date(Date.parse(`${today}T23:50:00-03:00`)).toISOString()
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, deadline: '' })).data.item
  await fixture.mutateStore((store) => Object.assign(store.offers.find((item) => item.id === offer.id), { createdAt: night, requestedAt: night }))
  const base = { cnpj: offer.cnpj, company: offer.company, service: offer.service, quantity: offer.quantity, quantityUnit: 'un', labelNumber: '', requesters: [''], buyer: '', deadline: '' }
  // Editar sends the day it shows (today in Bahia): the real moment of the entry stays, it is not a new day.
  // The Prazo para enviar a proposta on that same day is not before the request (in UTC it would be).
  const kept = await fixture.adminRequest(`/offers/${offer.id}`, 'PUT', { ...base, requestedAt: today, proposalDeadline: today })
  assert.equal(kept.status, 200, JSON.stringify(kept.data))
  assert.equal(kept.data.item.requestedAt, night)
  assert.equal(kept.data.item.proposalDeadline, today)
  // The day in UTC (what the screens showed before) is tomorrow in Bahia: refused like any future day.
  const utc = await fixture.adminRequest(`/offers/${offer.id}`, 'PUT', { ...base, requestedAt: night.slice(0, 10) })
  assert.deepEqual([utc.status, utc.data.message], [400, 'A data da solicitação não pode ser depois de hoje.'])
})
