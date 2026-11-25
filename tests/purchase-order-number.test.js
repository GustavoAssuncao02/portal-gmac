import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { createWorkSearch } from '../src/workSearch.js'
import { missingPurchaseInfo } from '../src/purchaseOrders.js'

// Nº do pedido de compra and Nota de entrada (2026-11-25): asked when an offer is accepted; "Gerar OS com informações
// pendentes" keeps what was filled in and leaves the rest for Ver OS, where each can be filled in, changed or removed.
// Each change goes to the history of the OS.
async function proposedOffer(fixture, fields = {}) {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, ...fields })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [{ id: 'l1', type: 'machine', resource: 'Torno', hours: 2, hourlyRate: 30 }], stages: ['turning'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Proposta A', serviceValue: 350, materials: 0, labor: 60, margin: 15, discount: 0, deadline: '2026-12-21', machine: '2 horas', serviceTime: '0 horas' } })
  return offer
}

test('the purchase order and the nota de entrada are asked on the acceptance and can be filled in later', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())

  const first = await proposedOffer(fixture)
  const complete = await fixture.adminRequest(`/offers/${first.id}/accept`, 'POST', { purchaseOrderNumber: '  4500123456 ', entryInvoiceNumber: ' NF 3321 ' })
  assert.equal(complete.status, 201, JSON.stringify(complete.data))
  assert.equal(complete.data.item.purchaseOrderNumber, '4500123456')
  assert.equal(complete.data.item.entryInvoiceNumber, 'NF 3321')
  assert.match(complete.data.item.auditEvents.at(-1).details, /Nº do pedido de compra: 4500123456\. Nota de entrada: NF 3321\./)
  assert.deepEqual(missingPurchaseInfo(complete.data.item), [])

  const second = await proposedOffer(fixture)
  const pending = (await fixture.adminRequest(`/offers/${second.id}/accept`, 'POST', { purchaseOrderNumber: '', entryInvoiceNumber: '' })).data.item
  assert.equal(pending.purchaseOrderNumber, undefined)
  assert.equal(pending.entryInvoiceNumber, undefined)
  assert.match(pending.auditEvents.at(-1).details, /Sem pedido de compra\. Sem nota de entrada\./)
  assert.deepEqual(missingPurchaseInfo(pending), ['pedido de compra', 'nota de entrada'])

  const set = (code, fields) => fixture.adminRequest(`/orders/${code}/purchase-info`, 'PUT', fields)
  assert.equal((await set('OS-9999-999', { purchaseOrderNumber: 'X' })).status, 404)
  assert.equal((await set(pending.code, { purchaseOrderNumber: 'PC-77' })).data.item.purchaseOrderNumber, 'PC-77')
  assert.equal((await set(pending.code, { purchaseOrderNumber: 'PC-78' })).data.item.purchaseOrderNumber, 'PC-78')
  // The nota de entrada alone: the purchase order, left out of the body, is not touched.
  const entry = (await set(pending.code, { entryInvoiceNumber: '889' })).data.item
  assert.deepEqual([entry.entryInvoiceNumber, entry.purchaseOrderNumber], ['889', 'PC-78'])
  assert.deepEqual(missingPurchaseInfo(entry), [])
  const removed = (await set(pending.code, { purchaseOrderNumber: '', entryInvoiceNumber: '889' })).data.item
  assert.equal(removed.purchaseOrderNumber, undefined)
  assert.deepEqual(missingPurchaseInfo(removed), ['pedido de compra'])
  const history = removed.auditEvents.filter((event) => ['purchase_order_number', 'entry_invoice_number'].includes(event.type)).map((event) => event.details)
  assert.deepEqual(history, ['Nº do pedido de compra informado: PC-77.', 'Nº do pedido de compra alterado de PC-77 para PC-78.', 'Nota de entrada informada: 889.', 'Nº do pedido de compra removido (era PC-78).'])
  // The same numbers again change nothing and record nothing.
  await set(complete.data.item.code, { purchaseOrderNumber: '4500123456', entryInvoiceNumber: 'NF 3321' })
  const store = await fixture.mutateStore((value) => value)
  assert.equal(store.orders.find((order) => order.code === complete.data.item.code).auditEvents.filter((event) => ['purchase_order_number', 'entry_invoice_number'].includes(event.type)).length, 0)
})

test('the work search finds requesters, buyer, purchase order and nota de entrada', () => {
  const offer = { id: 'o1', code: 'OF-0001', service: 'Eixo', company: 'Indústria', requesters: [{ name: 'Mariana Lopes' }, { name: 'João Pedro' }], buyer: 'Carla Souza', orderCode: 'OS-2026-001' }
  const order = { code: 'OS-2026-001', offerId: 'o1', service: 'Eixo', company: 'Indústria', purchaseOrderNumber: '4500123456', entryInvoiceNumber: 'NFE-98765', labelNumber: 'ET-55' }
  const search = createWorkSearch([offer], [order])
  for (const query of ['mariana', 'JOAO', 'carla', '4500123', 'nfe-987', 'et-55']) {
    assert.equal(search.offer(offer, query), true, `offer by ${query}`)
    assert.equal(search.order(order, query), true, `order by ${query}`)
  }
  assert.equal(search.order(order, 'fernanda'), false)
  // Offers made before the list of requesters keep a single name.
  assert.equal(createWorkSearch([{ id: 'o2', requester: 'Roberto Dias' }], []).offer({ id: 'o2', requester: 'Roberto Dias' }, 'roberto'), true)
})
