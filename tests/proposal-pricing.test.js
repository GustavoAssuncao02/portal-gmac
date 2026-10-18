import test from 'node:test'
import assert from 'node:assert/strict'
import { proposalCosts, proposalPricing, osValueOf, hoursText } from '../server/proposalMath.js'
import { orderValue } from '../server/receivables.js'
import { orderCosts } from '../server/payables.js'
import { proposalSections } from '../server/offers.js'
import { documentProposal } from '../server/proposalDocuments.js'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }

test('costs and hours: machine hours and labor (hora homem) hours are kept apart, with their total', () => {
  const costs = proposalCosts({
    materials: [{ quantity: 12.5, unitPrice: 40 }, { quantity: 3.2, unitPrice: 12.45 }],
    laborEntries: [{ type: 'machine', hours: 6, hourlyRate: 145 }, { type: 'machine', hours: 4.5, hourlyRate: 80 }, { type: 'person', hours: 2.5, hourlyRate: 60 }],
  })
  assert.deepEqual(costs, { materials: 539.84, labor: 1380, machineHours: 10.5, serviceHours: 2.5, totalHours: 13 })
  // Only machine hours: the service time is zero, not a copy of the machine time.
  assert.deepEqual(proposalCosts({ materials: [], laborEntries: [{ type: 'machine', hours: 30, hourlyRate: 10 }] }), { materials: 0, labor: 300, machineHours: 30, serviceHours: 0, totalHours: 30 })
  assert.deepEqual(proposalCosts(), { materials: 0, labor: 0, machineHours: 0, serviceHours: 0, totalHours: 0 })
  assert.deepEqual([0, 1, 2, 30, 3.5, 10.25].map(hoursText), ['0 horas', '1 hora', '2 horas', '30 horas', '3,5 horas', '10,25 horas'])
})

test('the OS value is the cost plus the gross profit, less the discount', () => {
  // The case of the proposal screen: R$ 1.532,40 of materials and R$ 300,00 of labor, 15% of gross profit.
  assert.deepEqual(proposalPricing({ materials: 1532.4, labor: 300, margin: 15, discount: 0 }), { serviceValue: 1832.4, osValue: 2107.26, profit: 274.86 })
  assert.deepEqual(proposalPricing({ materials: 1000, labor: 500, margin: 20, discount: 10 }), { serviceValue: 1500, osValue: 1620, profit: 120 })
  assert.deepEqual(proposalPricing({ materials: 1000, labor: 0, margin: 0, discount: 0 }), { serviceValue: 1000, osValue: 1000, profit: 0 })
  assert.equal(proposalPricing({ materials: 100, labor: 0, margin: 10, discount: 50 }).profit, -45, 'a deep discount shows as a loss')
  assert.deepEqual(proposalPricing({}), { serviceValue: 0, osValue: 0, profit: 0 })
})

test('the amount charged: document total, then OS value, then the price kept by older proposals', () => {
  assert.equal(osValueOf({ document: { total: 5170 }, osValue: 1, serviceValue: 2 }), 5170)
  assert.equal(osValueOf({ osValue: 2107.26, serviceValue: 1832.4, discount: 5 }), 2107.26)
  assert.equal(osValueOf({ serviceValue: 1000, discount: 10 }), 900, 'before the OS value existed')
  assert.equal(osValueOf(undefined), 0)
  // The receivable and the margin of the OS use the amount charged, never the cost.
  const order = { code: 'OS-1', proposal: { osValue: 2107.26, serviceValue: 1832.4, materials: 1532.4, labor: 300 } }
  assert.deepEqual(orderValue(order), { serviceCents: 210726, discount: 0, valueCents: 210726 })
  assert.deepEqual(orderValue({ proposal: { serviceValue: 1000, discount: 10 } }), { serviceCents: 100000, discount: 10, valueCents: 90000 })
  const costs = orderCosts({ payables: [], receivables: [] }, order)
  assert.deepEqual([costs.valueCents, costs.estimatedCostCents, costs.costCents, costs.marginCents], [210726, 183240, 183240, 27486])
})

test('the customer PDF charges the OS value and never shows the cost', () => {
  const offer = { service: 'Eixo', company: 'Cliente', cnpj: '12345678000190', labelNumber: 'E1', quantity: 10, deadline: '2026-12-20', description: 'x', attachments: [] }
  const conditions = (proposal) => proposalSections(offer, proposal, { materials: [], laborEntries: [] }).find((section) => section.name === 'Condições da proposta')
  const value = (section) => section.rows[0][section.columns.indexOf('Valor do serviço')]
  assert.equal(value(conditions({ key: 'A', serviceValue: 1832.4, osValue: 2107.26, discount: 0 })), 2107.26)
  assert.equal(value(conditions({ key: 'A', serviceValue: 600, discount: 0 })), 600, 'older proposals keep their price')
})

test('generating a proposal document derives costs and hours from the offer and charges the OS value', () => {
  // R$ 500,00 + R$ 1.032,40 of materials and R$ 300,00 of labor: cost R$ 1.832,40, all of it machine time; 15% of gross profit.
  const item = { quantity: 10, resources: { kind: 'service', materials: [{ quantity: 12.5, unitPrice: 40 }, { quantity: 8, unitPrice: 129.05 }], laborEntries: [{ type: 'machine', hours: 30, hourlyRate: 10 }] } }
  assert.deepEqual(proposalPricing({ ...proposalCosts(item.resources), margin: 15, discount: 0 }), { serviceValue: 1832.4, osValue: 2107.26, profit: 274.86 })
  // The values sent by the form are not trusted: costs and hours come from the offer.
  const option = { key: 'A', title: 'Opção A', deadline: '2027-01-01', margin: 15, discount: 0, serviceValue: 1, materials: 2, labor: 3, machine: 'x', serviceTime: '999 horas', totalTime: 'y' }
  // Letter model: 10 pieces at R$ 210,73 is R$ 2.107,30, the card's R$ 2.107,26 rounded per piece; the chosen margin stays.
  const letter = documentProposal({ item, option, document: { total: 2107.3 }, model: 'model-a', stages: ['turning'] })
  assert.deepEqual([letter.materials, letter.labor, letter.serviceValue, letter.machine, letter.serviceTime, letter.totalTime], [1532.4, 300, 1832.4, '30 horas', '0 horas', '30 horas'])
  assert.deepEqual([letter.osValue, letter.margin, letter.discount, letter.profit], [2107.3, 15, 0, 274.9])
  // A discount in the card is already in the OS value the document charges.
  const discounted = documentProposal({ item, option: { ...option, margin: 20, discount: 10 }, document: { total: 1978.99 }, model: 'model-a', stages: ['turning'] })
  assert.deepEqual([discounted.osValue, discounted.margin, discounted.discount, discounted.profit], [1978.99, 20, 10, 146.59])
  // An edited price, or a price list, states its own value: the margin is the real one on the cost.
  const edited = documentProposal({ item, option: { ...option, discount: 5 }, document: { total: 3000 }, model: 'model-a', stages: ['turning'] })
  assert.deepEqual([edited.osValue, edited.discount, edited.margin, edited.profit], [3000, 0, 63.7, 1167.6])
  // Without planned resources there is no cost to compare with: the chosen margin is kept.
  assert.deepEqual(documentProposal({ item: { quantity: 1, resources: {} }, option, document: { total: 500 }, model: 'etiqueta', stages: [] }).margin, 15)
  // The percentages are kept within their limits.
  const extreme = documentProposal({ item, option: { ...option, margin: -5, discount: 500 }, document: { total: 1 }, model: 'etiqueta', stages: [] })
  assert.deepEqual([extreme.margin, extreme.discount], [-99.9, 0])
})
test('editing an accepted OS keeps the profit measured on the OS value', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const request = (route, method, body) => f.request(route, method, body, { Authorization: `Bearer ${token}` })
    const offer = (await f.adminRequest('/offers', 'POST', offerDraft)).data.item
    await f.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [{ id: 'l1', type: 'machine', resource: 'Torno', hours: 30, hourlyRate: 10 }], stages: ['turning'], kind: 'service' })
    await f.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'A', deadline: offerDraft.deadline, serviceValue: 300, osValue: 345, materials: 0, labor: 300, margin: 15, discount: 0, machine: '30 horas', serviceTime: '0 horas', totalTime: '30 horas' } })
    const order = (await request(`/offers/${offer.id}/accept`, 'POST')).data.item
    const info = (await request('/operations/orders')).data.items.find((item) => item.code === order.code)
    const base = { order: { ...info, resources: { ...order.resources, strictProcess: true }, attachmentIds: [], proposal: { ...order.proposal } }, expectedUpdatedAt: info.updatedAt || info.createdAt, expectedOperation: { status: info.operation.status, stages: info.operation.stages, stageCounts: info.operation.stageCounts, activeSessionIds: [] }, stageCounts: { turning: 0 } }
    const edited = await request(`/operations/orders/${order.code}`, 'PUT', { ...base, order: { ...base.order, proposal: { ...base.order.proposal, osValue: 400 } } })
    assert.equal(edited.status, 200, JSON.stringify(edited.data))
    const proposal = edited.data.item.proposal
    assert.deepEqual([proposal.osValue, proposal.serviceValue, proposal.profit, proposal.totalTime], [400, 300, 100, '30 horas'])
    // Without an OS value in the form the stored one stays and the profit follows it.
    const { osValue, ...withoutOsValue } = proposal
    const again = await request(`/operations/orders/${order.code}`, 'PUT', { ...base, order: { ...base.order, proposal: withoutOsValue }, expectedUpdatedAt: edited.data.item.updatedAt })
    assert.equal(again.status, 200, JSON.stringify(again.data))
    assert.deepEqual([again.data.item.proposal.osValue, again.data.item.proposal.profit], [400, 100])
  } finally { await f.close() }
})
