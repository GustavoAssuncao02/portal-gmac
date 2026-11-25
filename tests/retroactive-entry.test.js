import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'

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
