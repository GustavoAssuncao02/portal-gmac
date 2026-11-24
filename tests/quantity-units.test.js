import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { quantityLabel, quantityUnitOf, quantityUnitPdf, validQuantityUnit } from '../server/quantityUnits.js'
import { describeOrderChanges, realChangedFields } from '../server/orderHistory.js'
import { defaultStageLayout, productionStages } from '../server/serviceStages.js'
import { operationVersion } from '../server/orderEditing.js'

// The Editar OS draft, as tests/order-editing.test.js builds it (importing that file would run its tests here too).
function editDraft(order) {
  const stages = order.operation.stages.map((stage) => productionStages.find(([, name]) => name === stage.name)?.[0] || stage.name)
  return { order: { ...structuredClone(order), attachmentIds: (order.attachments || []).map((item) => item.id), resources: { ...order.resources, stages, stageLayout: order.resources?.stageLayout || defaultStageLayout(), kind: 'service', manufacturedFrom: null, tempering: null, paintColor: '', serviceDescription: '', strictProcess: true }, proposal: { materials: 0, labor: 0, discount: 0, margin: 0, ...order.proposal } }, expectedUpdatedAt: order.updatedAt || order.createdAt, expectedOperation: operationVersion(order.operation), stageCounts: Object.fromEntries(stages.map((code, index) => [code, order.operation.stageCounts[order.operation.stages[index].key] || 0])) }
}

// TCK-0009: the quantity of an offer is in unidades, pares or conjuntos. The number is what production counts; the measure
// changes how the quantity is written on the screens ("2 pares") and in the proposal PDFs ("Par").
test('the measure of the quantity is written in full on the screens and abbreviated in the PDFs', () => {
  assert.deepEqual([quantityLabel(1, 'un'), quantityLabel(2, 'un'), quantityLabel(1, 'par'), quantityLabel(2, 'par'), quantityLabel(3, 'cj')], ['1 unidade', '2 unidades', '1 par', '2 pares', '3 conjuntos'])
  assert.deepEqual([quantityLabel(2, undefined, { short: true }), quantityLabel(2, 'par', { short: true }), quantityLabel(1, 'par', { short: true }), quantityLabel(4, 'cj', { short: true })], ['2 un', '2 pares', '1 par', '4 cj'])
  assert.deepEqual([quantityUnitPdf(), quantityUnitPdf('par'), quantityUnitPdf('cj')], ['Un', 'Par', 'Cj'])
  // Offers and OS from before the field are unidades; only the three measures are accepted.
  assert.equal(quantityUnitOf(undefined), 'un')
  assert.deepEqual([validQuantityUnit(undefined), validQuantityUnit(''), validQuantityUnit('par'), validQuantityUnit('kg')], [true, true, true, false])
  // An old OS (no field) saved again as unidades is not a change in its history.
  assert.deepEqual(realChangedFields({ before: { quantityUnit: null }, after: { quantityUnit: 'un' }, changed: ['quantityUnit'] }), [])
  assert.deepEqual(describeOrderChanges({ before: { quantityUnit: 'par' }, after: { quantityUnit: 'cj' }, changed: ['quantityUnit'] }), ['Medida da quantidade: Pares → Conjuntos'])
})

test('pares and conjuntos go from the offer to the proposal draft, the OS and its edition', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())

  assert.equal((await fixture.adminRequest('/offers', 'POST', { ...offerDraft, quantityUnit: 'kg' })).status, 400)
  const before = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  assert.equal(before.quantityUnit, 'un', 'not sent, it is unidades')
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, quantity: 2, quantityUnit: 'par' })).data.item
  assert.deepEqual([offer.quantity, offer.quantityUnit], [2, 'par'])

  // Informações do serviço: a screen of the previous version (no field) keeps it; the new one changes it.
  const info = { ...offerDraft, quantity: 2, requestedAt: offer.requestedAt.slice(0, 10) }
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}`, 'PUT', info)).data.item.quantityUnit, 'par')
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}`, 'PUT', { ...info, quantityUnit: 'cj' })).data.item.quantityUnit, 'cj')
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}`, 'PUT', { ...info, quantityUnit: 'pacote' })).status, 400)
  await fixture.adminRequest(`/offers/${offer.id}`, 'PUT', { ...info, quantityUnit: 'par' })

  // The proposal models start with the measure of the offer.
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['turning'], kind: 'service' })
  const letter = (await fixture.adminRequest(`/offers/${offer.id}/proposal-draft?model=model-a&value=200`)).data.draft
  assert.deepEqual([letter.items[0].quantity, letter.items[0].unit], [2, 'Par'])
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/proposal-draft?model=nestle`)).data.draft.quantityUnit, 'Par')

  // The OS keeps the measure; Editar OS changes it and the history says so.
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Opção A', deadline: '2026-12-20', serviceValue: 200, materials: 0, labor: 100, discount: 0, margin: 10, machine: '1 hora', serviceTime: '1 hora' } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  assert.equal(order.quantityUnit, 'par')
  const listed = (await fixture.adminRequest('/operations/orders')).data.items.find((item) => item.code === order.code)
  assert.equal(listed.quantityUnit, 'par')
  const draft = editDraft(listed)
  draft.order.quantityUnit = 'cj'
  const edited = await fixture.adminRequest(`/operations/orders/${order.code}`, 'PUT', draft)
  assert.equal(edited.status, 200, edited.data.message)
  assert.equal(edited.data.item.quantityUnit, 'cj')
  assert.ok(edited.data.event.changes.changed.includes('quantityUnit'))
  assert.match(edited.data.event.details, /Medida da quantidade/)
  // The offer follows its OS, as the other fields do.
  assert.equal((await fixture.adminRequest('/offers')).data.items.find((item) => item.id === offer.id).quantityUnit, 'cj')
  assert.equal((await fixture.request('/operations/operator/orders', 'GET', undefined, { Authorization: `Bearer ${fixture.operatorToken}` })).data.items.find((item) => item.code === order.code).quantityUnit, 'cj')
})
