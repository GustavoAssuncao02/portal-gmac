import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase, createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { materialCostDeltaCents } from '../server/orderMaterials.js'

// Real margin of an OS (Custo real e margem): the material counts at what it really cost — the stock price when it left
// for the OS, the price paid when it was bought for it — while the Valor da OS and the proposal stay as they were. The
// purchase posted from the receipt of the material request ("Lançar esta compra no financeiro?") is not counted again.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }

test('a material saved before the real cost was kept counts at its estimate', () => {
  assert.equal(materialCostDeltaCents({ resources: { materials: [{ quantity: 20, unitPrice: 6, inventoryConsumedQuantity: 20 }] } }), 0)
  assert.equal(materialCostDeltaCents({ resources: { materials: [{ quantity: 20, unitPrice: 6, inventoryConsumedQuantity: 20, inventoryConsumedCost: 130 }, { quantity: 4, unitPrice: 10, inventoryConsumedQuantity: 0, inventoryConsumedCost: 0, purchaseQuantity: 4 }] } }), 1000)
})

test('the OS real cost follows the price paid for its material and the stock price of what it took', async (t) => {
  const stock = await createTestDatabase('gmac_test_real_cost')
  const f = await createWorkflowFixture({ accountsEnv: env, inventoryPool: stock.pool })
  t.after(async () => { await f.close(); await stock.drop() })
  const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = async (route, method = 'GET', body) => {
    const response = await f.request(route, method, body, { Authorization: `Bearer ${token}` })
    assert.ok(response.status < 400, `${method} ${route}: ${response.status} ${JSON.stringify(response.data)}`)
    return response.data
  }
  const costs = async (code) => (await api(`/payables/order-costs/${code}`)).item
  async function openOrder(service, material, materials) {
    const offer = (await api('/offers', 'POST', { ...offerDraft, service })).item
    await api(`/offers/${offer.id}/resources`, 'PUT', { materials: [material], laborEntries: [], kind: 'service', stages: ['turning'] })
    await api(`/offers/${offer.id}/finish`, 'POST', {})
    await api(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offer.deadline, materials, labor: 200, serviceValue: materials + 200, margin: 50, discount: 0, osValue: (materials + 200) * 1.5 } })
    return { offer, order: (await api(`/offers/${offer.id}/accept`, 'POST')).item }
  }

  // 20 kg of steel not in stock, estimated at R$ 6/kg (R$ 120); bought at R$ 6,50/kg (R$ 130).
  const { offer, order } = await openOrder('Eixo do redutor', { id: 'aco', name: 'Aço SAE 1020', unit: 'kg', quantity: 20, unitPrice: 6, stockStatus: 'missing', stockAvailable: 0, purchaseQuantity: 20 }, 120)
  let item = await costs(order.code)
  assert.deepEqual([item.valueCents, item.materialEstimatedCents, item.materialCostCents, item.costCents, item.marginCents], [48000, 12000, 12000, 32000, 16000], 'pending material keeps the estimate')
  const requestId = `${offer.id}-aco`
  await api('/inventory', 'POST', { name: 'Aço SAE 1020', unit: 'kg', minimum: 0, unitPrice: 6.5, icon: 'sheet', quantity: 20, materialRequestId: requestId, materialReceiptId: 'r1' })
  item = await costs(order.code)
  assert.deepEqual([item.valueCents, item.estimatedCostCents, item.materialCostCents, item.extraCostCents, item.costCents, item.marginCents, item.marginPercent], [48000, 32000, 13000, 0, 33000, 15000, 45.5], 'bought at R$ 130: margin R$ 150')
  const saved = (await api('/operations/orders')).items.find((row) => row.code === order.code)
  assert.deepEqual([saved.proposal.materials, saved.proposal.osValue], [120, 480], 'the proposal and the Valor da OS do not change')

  // The purchase posted from the receipt is that request's purchase: listed, not counted again. Another bill linked to
  // the OS (freight, outsourced work) is an extra cost; a request link on another OS does not hold.
  const classification = (await api('/classifications', 'POST', { name: 'Compra de material' })).item
  const supplier = (await api('/suppliers', 'POST', { name: 'Loja de aço', document: '11222333000181' })).item
  const bill = { supplierId: supplier.id, classificationId: classification.id, issueDate: '2026-11-15', value: '130.00', dueDate: '2026-12-15', kind: 'normal', description: 'Compra de material: Aço SAE 1020 (20 kg)' }
  const [purchase] = (await api('/payables', 'POST', { ...bill, orderCode: order.code, materialRequestId: requestId })).items
  assert.equal(purchase.materialRequestId, requestId)
  item = await costs(order.code)
  assert.deepEqual([item.costCents, item.extraCostCents, item.extraCount, item.payables.map((row) => row.materialPurchase)], [33000, 0, 0, [true]])
  await api('/payables', 'POST', { ...bill, value: '40.00', dueDate: '2026-12-16', description: 'Frete', orderCode: order.code })
  item = await costs(order.code)
  assert.deepEqual([item.costCents, item.extraCostCents, item.marginCents], [37000, 4000, 11000], 'other linked bills stay extra costs')
  const list = (await api('/payables/order-costs')).items.find((row) => row.code === order.code)
  assert.equal(list.payableCount, 1, 'the list counts the extra costs only')

  // Editing the purchase keeps the link while it stays on the OS; taking it off the OS drops it.
  const edited = (await api(`/payables/${purchase.id}`, 'PUT', { ...bill, description: 'Compra do aço', orderCode: order.code })).items[0]
  assert.equal(edited.materialRequestId, requestId)
  const unlinked = (await api(`/payables/${purchase.id}`, 'PUT', { ...bill, orderCode: '' })).items[0]
  assert.equal(unlinked.materialRequestId, null)

  // Material already in stock: the OS pays the stock price when it left (R$ 5/kg), not the R$ 6/kg typed in the offer.
  await api('/inventory', 'POST', { name: 'Bronze TM-23', unit: 'kg', minimum: 0, unitPrice: 5, icon: 'sheet', quantity: 30 })
  const second = (await openOrder('Bucha', { id: 'bronze', name: 'Bronze TM-23', unit: 'kg', quantity: 10, unitPrice: 6 }, 60)).order
  item = await costs(second.code)
  assert.deepEqual([item.materialEstimatedCents, item.materialCostCents, item.costCents], [6000, 5000, 25000])
})
