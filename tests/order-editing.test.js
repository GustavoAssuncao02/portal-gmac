import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { defaultStageLayout, productionStages } from '../server/serviceStages.js'
import { editOrder, operationVersion } from '../server/orderEditing.js'

export function draftFor(order) {
  const stages = order.operation.stages.map((stage) => productionStages.find(([, name]) => name === stage.name)?.[0] || stage.name)
  return { order: { ...structuredClone(order), attachmentIds: (order.attachments || []).map((item) => item.id), resources: { ...order.resources, stages, stageLayout: order.resources?.stageLayout || defaultStageLayout(), kind: 'service', manufacturedFrom: null, tempering: null, paintColor: '', serviceDescription: '', strictProcess: true }, proposal: { materials: 0, labor: 0, discount: 0, margin: 0, ...order.proposal } }, expectedUpdatedAt: order.updatedAt || order.createdAt, expectedOperation: operationVersion(order.operation), stageCounts: Object.fromEntries(stages.map((code, index) => [code, order.operation.stageCounts[order.operation.stages[index].key] || 0])) }
}

export async function seedOrder(fixture) {
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'm1', name: 'Ferro', detail: '10mm', quantity: 10, unitPrice: 20 }], laborEntries: [{ id: 'l1', type: 'machine', resource: 'Torno', hours: 2, hourlyRate: 30 }], stages: ['turning', 'painting'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Proposta A', serviceValue: 350, materials: 200, labor: 60, margin: 15, discount: 0, deadline: '2026-12-21', machine: '2 horas', serviceTime: '3 horas' } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  return (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items.find((item) => item.code === order.code)
}

test('order editing is admin-only, persists every business field and audit snapshots, and updates linked offer, operator view and PDF', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const order = await seedOrder(fixture)
  const draft = draftFor(order)
  draft.order.service = 'Servico alterado'
  draft.order.company = 'Cliente atualizado'
  draft.order.cnpj = '99999999000199'
  draft.order.description = 'Descricao revisada'
  draft.order.quantity = 20
  draft.order.labelNumber = 'ET-20'
  draft.order.deadline = '2026-12-29'
  draft.order.resources.materials[0].name = 'Aco novo'
  draft.order.resources.laborEntries[0].hours = 4
  draft.order.resources.serviceDescription = 'Detalhes alterados'
  draft.order.resources.paintColor = 'Azul'
  draft.order.resources.tempering = true
  draft.order.resources.manufacturedFrom = 'drawing'
  draft.order.resources.kind = 'product'
  draft.order.resources.strictProcess = false
  draft.order.resources.stages = ['painting', 'turning']
  draft.stageCounts = { painting: 8, turning: 5 }
  draft.order.proposal.serviceValue = 800
  draft.order.proposal.key = 'B'
  draft.order.proposal.deadline = '2026-12-30'
  const url = `/operations/orders/${order.code}`
  assert.equal((await fixture.request(url, 'PUT', draft)).status, 401)
  assert.equal((await fixture.request(url, 'PUT', draft, { Authorization: `Bearer ${fixture.operatorToken}` })).status, 401)
  assert.equal((await fixture.request(url, 'PUT', { ...draft, deadlineReason: 'curto' }, { Authorization: `Bearer ${fixture.adminToken}` })).status, 400)
  const response = await fixture.request(url, 'PUT', { ...draft, deadlineReason: 'Cliente pediu mais prazo' }, { Authorization: `Bearer ${fixture.adminToken}` })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  const saved = response.data.item
  assert.equal(saved.deadlineChange.reason, 'Cliente pediu mais prazo'); assert.equal(saved.deadlineChange.to, '2026-12-29')
  assert.equal(saved.quantity, 20)
  assert.equal(saved.code, order.code)
  assert.equal(saved.offerId, order.offerId)
  assert.equal(saved.resources.materials[0].name, 'Aco novo')
  assert.equal(saved.proposal.kind, 'product')
  assert.equal(saved.operation.stages[0].key, order.operation.stages[1].key)
  assert.deepEqual(Object.values(saved.operation.stageCounts), [8, 5])
  assert.equal((await fixture.request(`${url}/events`, 'GET', undefined, { Authorization: `Bearer ${fixture.operatorToken}` })).data.items.at(-1).changes, undefined)
  const event = (await fixture.request(`${url}/events`, 'GET', undefined, { Authorization: `Bearer ${fixture.adminToken}` })).data.items.at(-1)
  assert.equal(event.type, 'order_edited')
  assert.equal(event.changes.before.service, order.service)
  assert.equal(event.changes.after.service, 'Servico alterado')
  assert.ok(event.lines.includes('Serviço: '+order.service+' → Servico alterado'))
  assert.match(event.details, /Justificativa do novo prazo: Cliente pediu mais prazo/)
  const linked = (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items[0]
  assert.equal(linked.service, saved.service)
  assert.equal(linked.proposal.serviceValue, 800)
  assert.equal(linked.status, 'accepted')
  assert.equal((await fixture.request('/operations/operator/orders', 'GET', undefined, { Authorization: `Bearer ${fixture.operatorToken}` })).data.items[0].quantity, 20)
  const pdf = await fetch(`${fixture.url}/api/offers/${order.offerId}/proposal.pdf`, { headers: fixture.admin })
  assert.equal(pdf.status, 200)
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF')
  assert.equal((await fixture.request(url, 'PUT', { ...draft, deadlineReason: 'Cliente pediu mais prazo' }, { Authorization: `Bearer ${fixture.adminToken}` })).status, 409)
})

test('completed editing needs explicit confirmation; reopening preserves quantities, history and elapsed time and clears panel acknowledgement', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const order = await seedOrder(fixture)
  await fixture.mutateStore((store) => {
    const current = store.orders[0]
    current.operation = { ...order.operation, status: 'completed', startedAt: '2026-10-01T10:00:00Z', completedAt: '2026-10-02T10:00:00Z', completionAcknowledgedAt: '2026-10-02T11:00:00Z', accumulatedMs: 3600000, stageCounts: { 'stage-1': 10, 'stage-2': 10 } }
    current.operationEvents = [{ id: 'original', type: 'completed', at: current.operation.completedAt }]
  })
  const current = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0]
  const draft = draftFor(current)
  draft.order.description = 'Revisao apos finalizar'
  const headers = { Authorization: `Bearer ${fixture.adminToken}` }
  const route = `/operations/orders/${order.code}`
  assert.equal((await fixture.adminRequest(route, 'PUT', draft, headers)).status, 409)
  const edited = await fixture.adminRequest(route, 'PUT', { ...draft, confirmCompleted: true }, headers)
  assert.equal(edited.status, 200)
  assert.equal(edited.data.item.operation.status, 'completed')
  assert.equal((await fixture.request(`${route}/reopen`, 'POST')).status, 401)
  const reopened = await fixture.request(`${route}/reopen`, 'POST', {}, headers)
  assert.equal(reopened.status, 200)
  assert.equal(reopened.data.item.operation.status, 'paused')
  assert.equal(reopened.data.item.operation.accumulatedMs, 3600000)
  assert.equal(reopened.data.item.operation.completedAt, null)
  assert.equal(reopened.data.item.operation.completionAcknowledgedAt, null)
  assert.deepEqual(reopened.data.item.operation.stageCounts, { 'stage-1': 10, 'stage-2': 10 })
  const adjusting = draftFor(reopened.data.item)
  adjusting.order.quantity = 20
  const adjusted = await fixture.adminRequest(route, 'PUT', adjusting, headers)
  assert.equal(adjusted.status, 200)
  assert.equal(adjusted.data.item.operation.progress, 50)
  assert.deepEqual((await fixture.request(`${route}/events`, 'GET', undefined, { Authorization: `Bearer ${fixture.operatorToken}` })).data.items.map((event) => event.type), ['completed', 'order_edited', 'order_reopened', 'order_edited'])
  assert.equal((await fixture.request(`${route}/reopen`, 'POST', {}, headers)).status, 409)
})

test('editing validates dates, quantities, ordered counts and stages; preserves live credentials and rejects production edits or stale progress', () => {
  const state = { status: 'running', stages: [{ key: 'stage-1', name: 'Tornearia' }, { key: 'stage-2', name: 'Pintura' }], stageCounts: { 'stage-1': 4, 'stage-2': 2 }, activeSession: { id: 'active', tokenHash: 'private', employeeName: 'Ana' }, accumulatedMs: 1500, startedAt: '2026-10-01T10:00:00Z' }
  const order = { ...offerDraft, code: 'OS-X', createdAt: '2026-10-01T10:00:00Z', requestedAt: '2026-10-01T10:00:00Z', operation: state, attachments: [], resources: { materials: [], laborEntries: [] }, proposal: { key: 'A', deadline: '2026-12-20', serviceValue: 500, materials: 0, labor: 0, margin: 15, discount: 0 } }
  const draft = draftFor(order)
  const invalid = (mutate, status = 400) => {
    const payload = structuredClone(draft)
    mutate(payload)
    assert.throws(() => editOrder(structuredClone(order), structuredClone(state), payload), (error) => error.status === status)
  }
  invalid((item) => { item.order.quantity = 0 })
  invalid((item) => { item.order.deadline = '2026-02-30' })
  invalid((item) => { item.stageCounts.turning = -1 })
  invalid((item) => { item.stageCounts.turning = 11 })
  invalid((item) => { item.stageCounts.painting = 5 })
  invalid((item) => { item.order.resources.stages.push('bad') })
  invalid((item) => { item.order.quantity = 20 }, 409)
  invalid((item) => { item.expectedOperation.stageCounts['stage-1'] = 3 }, 409)
  const copy = structuredClone(order)
  const operation = structuredClone(state)
  draft.order.service = 'Nome atualizado'
  editOrder(copy, operation, draft)
  assert.equal(operation.activeSession.tokenHash, 'private')
  assert.equal(operation.accumulatedMs, 1500)
  assert.equal(operation.status, 'running')
})

test('SQL management rolls back metadata when commit fails, and persists state/history under row lock when it succeeds', async (t) => {
  let stored, transaction, failCommit = true, locks = 0
  const connection = {
    async beginTransaction() { transaction = structuredClone(stored) },
    async execute(sql, values) {
      if (sql.startsWith('INSERT IGNORE')) { transaction ||= JSON.parse(values[1]); return [{}] }
      if (sql.includes('FOR UPDATE')) { locks += 1; return [[{ data: JSON.stringify(transaction) }]] }
      if (sql.startsWith('UPDATE')) transaction = JSON.parse(values[0])
      return [{}]
    },
    async commit() { if (failCommit) { const error = new Error('Commit failure'); error.status = 503; throw error } stored = transaction },
    async rollback() { transaction = null },
    release() {},
  }
  const fixture = await createWorkflowFixture({ pool: { async getConnection() { return connection }, async execute() { return [stored ? [{ order_code: 'OS-SQL', data: JSON.stringify(stored) }] : []] } } })
  t.after(() => fixture.close())
  const operation = { status: 'waiting', stages: [{ key: 'stage-1', name: 'Tornearia' }], stageCounts: { 'stage-1': 0 }, activeSession: null, accumulatedMs: 0, startedAt: null }
  stored = operation
  const order = { ...offerDraft, code: 'OS-SQL', offerId: 'offer', createdAt: '2026-10-01T10:00:00Z', requestedAt: '2026-10-01T10:00:00Z', resources: { materials: [], laborEntries: [], stages: ['turning'] }, proposal: { key: 'A', deadline: '2026-12-20', serviceValue: 500 }, attachments: [], operation }
  await fixture.mutateStore((store) => { store.orders = [order]; store.offers = [{ id: 'offer', status: 'accepted' }] })
  const draft = draftFor(order)
  draft.order.service = 'Nome SQL atualizado'
  const headers = { Authorization: `Bearer ${fixture.adminToken}` }
  assert.equal((await fixture.request('/operations/orders/OS-SQL', 'PUT', draft, headers)).status, 503)
  assert.equal((await fixture.request('/orders', 'GET', undefined, fixture.admin)).data.items[0].service, offerDraft.service)
  failCommit = false
  assert.equal((await fixture.request('/operations/orders/OS-SQL', 'PUT', draft, headers)).status, 200)
  assert.equal((await fixture.request('/orders', 'GET', undefined, fixture.admin)).data.items[0].service, 'Nome SQL atualizado')
  assert.equal(locks, 2)
})
