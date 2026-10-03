import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { defaultStageLayout, serviceDetails } from '../server/serviceStages.js'
import { currentPieceProgress } from '../src/serviceProgress.js'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

async function createOrder(fixture, strictProcess) {
  const offer = (await fixture.request('/offers', 'POST', { ...offerDraft, quantity: 20 })).data.item
  const layout = defaultStageLayout()
  const resources = { materials: [], laborEntries: [], stages: ['cut-bend', 'turning', 'painting'], stageLayout: [layout[2], layout[0], layout[1]], kind: 'service' }
  if (strictProcess !== undefined) resources.strictProcess = strictProcess
  assert.equal((await fixture.request(`/offers/${offer.id}/resources`, 'PUT', resources)).status, 200)
  const proposed = await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100, strictProcess: strictProcess !== false ? false : true } })
  assert.equal(proposed.status, 200)
  assert.equal(proposed.data.item.proposal.strictProcess, strictProcess !== false)
  const accepted = await fixture.request(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(accepted.status, 201)
  return { offer, order: accepted.data.item }
}

test('process mode defaults to ordered, persists explicit free mode and validates resource updates', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  assert.equal(serviceDetails().strictProcess, true)
  const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  const route = `/offers/${offer.id}/resources`
  const resources = { materials: [], laborEntries: [], stages: ['painting'], kind: 'service' }
  assert.equal((await fixture.request(route, 'PUT', resources)).data.item.resources.strictProcess, true)
  assert.equal((await fixture.request(route, 'PUT', { ...resources, strictProcess: false })).data.item.resources.strictProcess, false)
  assert.equal((await fixture.request('/offers')).data.items[0].resources.strictProcess, false)
  // Older clients must not reset a previously saved choice.
  assert.equal((await fixture.request(route, 'PUT', resources)).data.item.resources.strictProcess, false)
  for (const strictProcess of ['false', null, 0, 1, {}, []]) {
    assert.equal((await fixture.request(route, 'PUT', { ...resources, strictProcess })).status, 400)
  }
  assert.equal((await fixture.request('/offers')).data.items[0].resources.strictProcess, false)
  const { order, offer: acceptedOffer } = await createOrder(fixture, false)
  assert.equal(order.resources.strictProcess, false)
  assert.equal((await fixture.request(`/offers/${acceptedOffer.id}/resources`, 'PUT', { ...resources, strictProcess: true })).status, 404)
  assert.equal((await fixture.request('/operations/orders')).data.items.find((item) => item.code === order.code).resources.strictProcess, false)
})

test('free stages count only pieces processed in every stage and preserve session, quantity and completion protections', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const { order } = await createOrder(fixture, false)
  const employee = (await fixture.request('/employees', 'POST', { name: 'Ana', birthDate: '1990-01-01', cpf: '00000000001', email: 'ana@example.invalid', identification: '001' })).data.item
  const auth = { Authorization: `Bearer ${fixture.operatorToken}` }
  const route = `/operations/orders/${order.code}`
  const started = (await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id }, auth)).data
  const credentials = { sessionId: started.operation.activeSession.id, sessionToken: started.sessionToken }
  const register = (key, quantity, session = credentials, headers = auth) => fixture.request(`${route}/stages/${key}`, 'POST', { ...session, quantity }, headers)
  assert.equal((await register('stage-3', 20, credentials, {})).status, 401)
  assert.equal((await register('stage-3', 20, { ...credentials, sessionToken: 'foreign' })).status, 403)
  for (const quantity of [0, -1, 0.5]) assert.equal((await register('stage-3', quantity)).status, 400)
  assert.equal((await register('stage-3', 21)).status, 409)
  let result = await register('stage-3', 20)
  assert.equal(result.status, 200)
  assert.equal(currentPieceProgress(result.data.operation, 20).completedPieces, 0)
  assert.equal(result.data.operation.progress, 33)
  assert.equal((await fixture.request(`${route}/complete`, 'POST', credentials, auth)).status, 409)
  assert.equal((await register('stage-3', 1)).status, 409)
  assert.equal((await register('stage-1', 20)).status, 200)
  result = await register('stage-2', 5)
  assert.equal(result.status, 200)
  assert.equal(currentPieceProgress(result.data.operation, 20).completedPieces, 5)
  assert.equal((await fixture.request(`${route}/complete`, 'POST', credentials, auth)).status, 409)
  result = await register('stage-2', 15)
  assert.equal(result.status, 200)
  assert.equal(currentPieceProgress(result.data.operation, 20).completedPieces, 20)
  assert.equal(result.data.operation.progress, 100)
  assert.equal(result.data.operation.status, 'finalizing')
  assert.equal((await fixture.request(`${route}/complete`, 'POST', credentials, auth)).status, 200)
})

test('default and legacy orders still require pieces to pass the preceding stage', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const employee = (await fixture.request('/employees', 'POST', { name: 'Ana', birthDate: '1990-01-01', cpf: '00000000001', email: 'ana@example.invalid', identification: '001' })).data.item
  const auth = { Authorization: `Bearer ${fixture.operatorToken}` }
  for (const legacy of [false, true]) {
    const { order } = await createOrder(fixture)
    if (legacy) await fixture.mutateStore((store) => { delete store.orders.find((item) => item.code === order.code).resources.strictProcess })
    const route = `/operations/orders/${order.code}`
    const started = (await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id }, auth)).data
    const credentials = { sessionId: started.operation.activeSession.id, sessionToken: started.sessionToken }
    const register = (key, quantity) => fixture.request(`${route}/stages/${key}`, 'POST', { ...credentials, quantity }, auth)
    assert.equal((await register('stage-3', 1)).status, 409)
    assert.equal((await register('stage-2', 1)).status, 409)
    assert.equal((await register('stage-1', 5)).status, 200)
    assert.equal((await register('stage-2', 6)).status, 409)
    assert.equal((await register('stage-2', 5)).status, 200)
    assert.equal((await register('stage-3', 5)).status, 200)
    assert.equal((await fixture.request(`${route}/pause`, 'POST', { ...credentials, reason: 'Descanso' }, auth)).status, 200)
  }
})

test('MySQL applies the saved mode inside the locked transaction and rolls back rejected progress', async (t) => {
  let state = { status: 'running', stages: [{ key: 'stage-1', name: 'Tornearia' }, { key: 'stage-2', name: 'Pintura' }], stageCounts: { 'stage-1': 0, 'stage-2': 0 }, accumulatedMs: 0, activeSession: { id: 'session', tokenHash: createHash('sha256').update('private').digest('hex'), employeeId: 1, employeeName: 'Ana', startedAt: new Date().toISOString() } }
  const events = []
  const calls = []
  let snapshot
  const connection = {
    async beginTransaction() { snapshot = structuredClone(state); calls.push('begin') },
    async execute(sql, params) {
      calls.push(sql)
      if (sql.startsWith('SELECT data')) return [[{ data: JSON.stringify(state) }]]
      if (sql.startsWith('UPDATE order_operations')) state = JSON.parse(params[0])
      if (sql.startsWith('INSERT INTO order_operation_events')) events.push(JSON.parse(params[2]))
      return [{}]
    },
    async commit() { calls.push('commit') },
    async rollback() { state = snapshot; calls.push('rollback') },
    release() { calls.push('release') },
  }
  const fixture = await createWorkflowFixture({ pool: { async getConnection() { return connection } } })
  t.after(() => fixture.close())
  await fixture.mutateStore((store) => { store.orders = [{ code: 'OS-DB', quantity: 20, service: 'Teste', resources: {}, proposal: {} }] })
  const route = '/operations/orders/OS-DB/stages/stage-2'
  const body = { sessionId: 'session', sessionToken: 'private', quantity: 20 }
  const headers = { Authorization: `Bearer ${fixture.operatorToken}` }
  assert.equal((await fixture.request(route, 'POST', body, headers)).status, 409)
  assert.equal(state.stageCounts['stage-2'], 0)
  assert.deepEqual(calls.slice(-2), ['rollback', 'release'])
  await fixture.mutateStore((store) => { store.orders[0].resources.strictProcess = false })
  assert.equal((await fixture.request(route, 'POST', body, headers)).status, 200)
  assert.equal(state.stageCounts['stage-2'], 20)
  assert.equal(state.stageCounts['stage-1'], 0)
  assert.equal(events.length, 1)
  assert.equal(currentPieceProgress(state, 20).completedPieces, 0)
  assert.ok(calls.some((sql) => sql.endsWith('FOR UPDATE')))
  assert.deepEqual(calls.slice(-2), ['commit', 'release'])
})
