import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

function assertOperationalData(value) {
  for (const [key, child] of Object.entries(value || {})) {
    assert.ok(!['proposal', 'unitPrice', 'hourlyRate', 'serviceValue', 'margin', 'discount', 'profit', 'pdfId', 'tokenHash'].includes(key), `Unexpected field: ${key}`)
    if (child && typeof child === 'object') assertOperationalData(child)
  }
}

test('operator project data includes technical details and files but excludes financial data', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  const resources = { materials: [{ id: 'material', name: 'Aluminio', detail: 'Chapa 10 mm', quantity: 12.5, unitPrice: 999, stockAvailable: 8, stockStatus: 'partial', purchaseQuantity: 4.5 }], laborEntries: [{ id: 'machine', type: 'machine', resource: 'Torno CNC', hours: 2, hourlyRate: 777 }], kind: 'product', stages: ['cutting', 'assembly'] }
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', resources)
  const upload = await fetch(`${fixture.url}/api/offers/${offer.id}/attachments?name=desenho-tecnico.txt&type=text/plain`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('Especificacao tecnica da peca') })
  assert.equal(upload.status, 201)
  await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 98765, materials: 12487.5, labor: 1554, margin: 25, discount: 10, profit: 12345, machine: '2 horas', serviceTime: '2 horas' } })
  const order = (await fixture.request(`/offers/${offer.id}/accept`, 'POST')).data.item
  assert.equal((await fixture.request('/operations/operator/orders')).status, 401)
  const headers = { Authorization: `Bearer ${fixture.operatorToken}` }
  const result = await fixture.request('/operations/operator/orders', 'GET', undefined, headers)
  assert.equal(result.status, 200)
  const item = result.data.items[0]
  assertOperationalData(item)
  assert.equal(item.description, offerDraft.description)
  assert.equal(item.cnpj, offerDraft.cnpj)
  assert.equal(item.kind, 'product')
  assert.equal(item.deliveryDeadline, offerDraft.deadline)
  assert.equal(item.resources.materials[0].detail, 'Chapa 10 mm')
  assert.equal(item.resources.materials[0].purchaseQuantity, 4.5)
  assert.equal(item.resources.laborEntries[0].hours, 2)
  assert.equal(item.attachments[0].name, 'desenho-tecnico.txt')
  assert.deepEqual(item.operation.stages.map((stage) => stage.name), ['Corte', 'Montagem'])
  const downloaded = await fetch(`${fixture.url}/api/offers/${offer.id}/attachments/${item.attachments[0].id}`)
  assert.equal(await downloaded.text(), 'Especificacao tecnica da peca')
  const adminOrder = (await fixture.request('/operations/orders')).data.items[0]
  assert.equal(adminOrder.proposal.serviceValue, 98765)
  assert.equal(adminOrder.resources.materials[0].unitPrice, 999)
  const employee = (await fixture.request('/employees', 'POST', { name: 'Operador teste', birthDate: '1990-01-01', cpf: '12345678901', email: 'teste@example.com', identification: '001' })).data.item
  const started = await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: employee.id }, headers)
  assert.equal(started.status, 200)
  assertOperationalData(started.data.order)
  assert.ok(started.data.sessionToken)
  const paused = await fixture.request(`/operations/orders/${order.code}/pause`, 'POST', { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken, reason: 'Descanso' }, headers)
  assert.equal(paused.status, 200)
  assertOperationalData(paused.data.order)
})
