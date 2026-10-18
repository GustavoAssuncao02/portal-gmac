import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

async function acceptedOffer(fixture) {
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  return { offer, order }
}

test('an acceptance made by mistake is undone: the offer goes back and the OS number is never reused', async () => {
  const fixture = await createWorkflowFixture()
  try {
    const { offer, order } = await acceptedOffer(fixture)
    // Decisions taken during the OS on its material request, and the notices of the OS.
    await fixture.mutateStore((store) => {
      const item = store.offers.find((entry) => entry.id === offer.id)
      item.resources.materials = [{ id: 'm1', name: 'Aço', quantity: 5, purchaseQuantity: 5, requestRejection: { rejectedAt: new Date().toISOString() } }]
      store.materialRequestStatuses = [{ id: `${offer.id}-m1`, status: 'rejected' }, { id: 'outra-oferta-m1', status: 'purchase-requested' }]
      store.operationalNotifications = [{ id: `service-added:${order.code}`, type: 'service-added', orderCode: order.code }, { id: 'service-added:OS-OUTRA', type: 'service-added', orderCode: 'OS-OUTRA' }]
    })
    assert.equal((await fixture.request(`/offers/${offer.id}/unaccept`, 'POST', {})).status, 401)
    const undone = await fixture.request(`/offers/${offer.id}/unaccept`, 'POST', {}, fixture.admin)
    assert.equal(undone.status, 200, JSON.stringify(undone.data))
    assert.equal(undone.data.item.status, 'proposed')
    assert.equal(undone.data.item.orderCode, null)
    assert.equal(undone.data.item.acceptHistory[0].orderCode, order.code)
    const store = await fixture.mutateStore((current) => current)
    assert.ok(!store.orders.some((item) => item.code === order.code), 'the OS leaves the lists')
    assert.deepEqual(store.operationalNotifications.map((notice) => notice.orderCode), ['OS-OUTRA'], 'the notices of the cancelled OS go away, with no new one')
    assert.deepEqual(store.materialRequestStatuses.map((status) => status.id), ['outra-oferta-m1'], 'the decisions on its requests are cleared')
    assert.equal(store.offers.find((entry) => entry.id === offer.id).resources.materials[0].requestRejection, undefined)
    assert.equal(store.silentMaterialRequestIds, undefined, 'the temporary mark is not kept')
    assert.equal(store.cancelledOrders[0].code, order.code)
    assert.ok(store.cancelledOrders[0].auditEvents.some((event) => event.type === 'order_cancelled'))
    assert.equal((await fixture.request(`/offers/${offer.id}/unaccept`, 'POST', {}, fixture.admin)).status, 409)
    const again = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
    assert.notEqual(again.code, order.code, 'a new OS gets a new number')
  } finally { await fixture.close() }
})

test('the acceptance cannot be undone after something happened in the OS', async () => {
  const fixture = await createWorkflowFixture()
  try {
    const { offer, order } = await acceptedOffer(fixture)
    await fixture.mutateStore((store) => { store.orders.find((item) => item.code === order.code).operation = { status: 'paused', startedAt: new Date().toISOString(), stageCounts: { 'stage-1': 1 }, activeSessions: [] } })
    const blocked = await fixture.request(`/offers/${offer.id}/unaccept`, 'POST', {}, fixture.admin)
    assert.equal(blocked.status, 409)
    assert.match(blocked.data.message, /o trabalho na OS já foi iniciado/)
    await fixture.mutateStore((store) => { store.orders.find((item) => item.code === order.code).operation = null; store.receivables = [{ id: 'REC-1', orderCode: order.code }] })
    assert.match((await fixture.request(`/offers/${offer.id}/unaccept`, 'POST', {}, fixture.admin)).data.message, /contas a receber/)
  } finally { await fixture.close() }
})

test('with the stock database, what the OS took out comes back as an entry "Estorno de OS"', async () => {
  const executed = []
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, params) {
      executed.push([sql, params])
      if (sql.startsWith('SELECT data FROM order_operations')) return [[]]
      if (sql.includes('FROM inventory_movements WHERE order_code')) return [[{ materialId: 7, type: 'exit', quantity: '12.500' }, { materialId: 9, type: 'exit', quantity: '3' }, { materialId: 9, type: 'entry', quantity: '3' }]]
      if (sql.startsWith('SELECT id, name, quantity_kg')) return [[{ id: 7, name: 'Aço 1045', quantity_kg: '2.000', unit_price: '10.00' }]]
      return [{ affectedRows: 1 }]
    },
  }
  const pool = { getConnection: async () => connection, execute: async () => [[]] }
  const fixture = await createWorkflowFixture({ pool })
  try {
    const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
    await fixture.mutateStore((store) => {
      const item = store.offers.find((entry) => entry.id === offer.id)
      Object.assign(item, { status: 'accepted', orderCode: 'OS-2026-0900', proposal: { key: 'A' } })
      store.orders.push({ code: 'OS-2026-0900', offerId: offer.id, createdAt: new Date().toISOString(), resources: { materials: [] } })
    })
    const undone = await fixture.request(`/offers/${offer.id}/unaccept`, 'POST', {}, fixture.admin)
    assert.equal(undone.status, 200, JSON.stringify(undone.data))
    assert.deepEqual(undone.data.returned, [{ materialId: 7, name: 'Aço 1045', quantity: 12.5 }], 'material 9 already came back')
    assert.deepEqual(executed.find(([sql]) => sql.startsWith('UPDATE inventory_materials'))[1], [14.5, 7])
    const entry = executed.find(([sql]) => sql.startsWith('INSERT INTO inventory_movements'))[1]
    assert.deepEqual(entry.slice(0, 6), [7, 12.5, 10, 14.5, 'Estorno de OS', 'OS-2026-0900'])
  } finally { await fixture.close() }
})
