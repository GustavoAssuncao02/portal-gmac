import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'

test('purchase orders are attached to the OS by administrators only and stay out of the operator view', async () => {
  const f = await createWorkflowFixture()
  try {
    await f.mutateStore((store) => { store.orders.push({ code: 'OS-900001', offerId: 'x', service: 'Teste', attachments: [], createdAt: new Date().toISOString() }); return store })
    const upload = (headers) => fetch(`${f.url}/api/orders/OS-900001/purchase-orders?name=pedido.pdf&type=application/pdf`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: Buffer.from('pedido') })
    assert.equal((await upload({})).status, 401)
    assert.equal((await upload({ Authorization: `Bearer ${f.operatorToken}` })).status, 401)
    const created = await upload(f.admin)
    assert.equal(created.status, 201)
    const file = (await created.json()).item
    assert.equal((await fetch(`${f.url}/api/orders/OS-900001/purchase-orders/${file.id}`)).status, 401)
    const download = await fetch(`${f.url}/api/orders/OS-900001/purchase-orders/${file.id}`, { headers: f.admin })
    assert.equal(download.status, 200); assert.equal(await download.text(), 'pedido')
    const operator = await f.request('/operations/operator/orders', 'GET', undefined, { Authorization: `Bearer ${f.operatorToken}` })
    assert.ok(!JSON.stringify(operator.data).includes('purchaseOrders'))
    assert.equal((await f.request(`/orders/OS-900001/purchase-orders/${file.id}`, 'DELETE', undefined, f.admin)).status, 200)
    assert.equal((await f.request(`/orders/OS-900001/purchase-orders/${file.id}`, 'DELETE', undefined, f.admin)).status, 404)
  } finally { await f.close() }
})
