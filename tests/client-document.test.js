import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { defaultStageLayout, productionStages } from '../server/serviceStages.js'
import { operationVersion } from '../server/orderEditing.js'
import { documentKind, isClientDocument, maskClientDocument } from '../server/clientDocument.js'

test('a client document is a CNPJ or a CPF, masked while typed', () => {
  assert.equal(maskClientDocument('5299822'), '529.982.2')
  assert.equal(maskClientDocument('52998224725'), '529.982.247-25')
  assert.equal(maskClientDocument('561840270001'), '56.184.027/0001')
  assert.equal(maskClientDocument('56184027000136'), '56.184.027/0001-36')
  assert.equal(maskClientDocument('56.184.027/0001-3699'), '56.184.027/0001-36')
  assert.equal(documentKind('529.982.247-25'), 'CPF')
  assert.equal(documentKind('56.184.027/0001-36'), 'CNPJ')
  assert.deepEqual(['529.982.247-25', '56184027000136', '5299822472', '561840270001'].map(isClientDocument), [true, true, false, false])
})

test('offers and their OS accept a client with CPF and keep refusing incomplete documents', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  assert.equal((await fixture.adminRequest('/offers', 'POST', { ...offerDraft, cnpj: '561840270001' })).status, 400)
  const created = await fixture.adminRequest('/offers', 'POST', { ...offerDraft, cnpj: '529.982.247-25', company: 'João Pereira da Silva' })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const offer = created.data.item
  assert.equal(offer.cnpj, '529.982.247-25')
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [{ id: 'l1', type: 'machine', resource: 'Torno', hours: 2, hourlyRate: 30 }], stages: ['turning'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Proposta A', serviceValue: 350, materials: 0, labor: 60, margin: 15, discount: 0, deadline: '2026-12-21', machine: '2 horas', serviceTime: '0 horas' } })
  const accepted = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  assert.equal(accepted.cnpj, '529.982.247-25')

  const order = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items.find((item) => item.code === accepted.code)
  const stages = order.operation.stages.map((stage) => productionStages.find(([, name]) => name === stage.name)?.[0] || stage.name)
  const draft = { order: { ...structuredClone(order), attachmentIds: [], resources: { ...order.resources, stages, stageLayout: order.resources?.stageLayout || defaultStageLayout() }, proposal: { materials: 0, labor: 0, discount: 0, margin: 0, ...order.proposal } }, expectedUpdatedAt: order.updatedAt || order.createdAt, expectedOperation: operationVersion(order.operation), stageCounts: Object.fromEntries(stages.map((code) => [code, 0])) }
  const url = `/operations/orders/${order.code}`
  const incomplete = await fixture.request(url, 'PUT', { ...draft, order: { ...draft.order, cnpj: '5299822472' } }, fixture.admin)
  assert.equal(incomplete.status, 400)
  assert.match(incomplete.data.message, /CPF \(11 dígitos\)/)
  const edited = await fixture.request(url, 'PUT', { ...draft, order: { ...draft.order, cnpj: '111.444.777-35', company: 'Maria Souza Lima' } }, fixture.admin)
  assert.equal(edited.status, 200, JSON.stringify(edited.data))
  const events = (await fixture.request(`${url}/events`, 'GET', undefined, fixture.admin)).data.items
  assert.match(events.at(-1).details, /CNPJ\/CPF/)
})
