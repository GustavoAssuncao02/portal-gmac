import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { pieceKey, pieceAverages, pieceSuggestion } from '../server/pieces.js'

test('a piece is its name, and the average per piece weighs every piece the same', () => {
  assert.equal(pieceKey('  Porca  Nº 48 '), pieceKey('porca nº 48'))
  assert.notEqual(pieceKey('Porca 48'), pieceKey('Porca nº 48'))
  const averages = pieceAverages([{ quantity: 1, materials: { a: 5 }, stages: {} }, { quantity: 99, materials: { a: 198 }, stages: { turning: 99 } }])
  assert.equal(averages.materials.a, 2.03)
  assert.equal(averages.stages.turning, 1)
  // Without history yet, the last time is copied in proportion to the new quantity.
  const orders = [{ code: 'OS-1', offerId: 'x', service: 'Bucha', quantity: 10, createdAt: '2026-01-01', resources: { materials: [{ name: 'Bronze', quantity: 5 }], stages: ['turning'], stageTimes: { turning: 30 }, laborEntries: [{ id: 'l', type: 'machine', hours: 2 }] } }]
  const suggestion = pieceSuggestion({ offers: [], orders, name: 'bucha', quantity: 20 })
  assert.equal(suggestion.resources.materials[0].quantity, 10)
  assert.equal(suggestion.resources.stageTimes.turning, 60)
  assert.equal(suggestion.resources.laborEntries[0].hours, 2, 'labor is copied as it was, without average')
  assert.equal(pieceSuggestion({ offers: [], orders, name: 'Outra peça', quantity: 1 }), null)
})

test('stage times follow the operator, and new offers of the piece come with the averages of material and time', async () => {
  const fixture = await createWorkflowFixture()
  try {
    const admin = fixture.admin, auth = { Authorization: `Bearer ${fixture.operatorToken}` }
    const machine = (await fixture.adminRequest('/machines', 'POST', { name: 'Torno', type: 'Torno', sector: 'Usinagem', hourlyRate: 100 }, admin)).data.item
    const ana = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana', birthDate: '1990-01-01', cpf: '00000000001', email: 'ana@example.invalid' }, admin)).data.item
    const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Porca Sextavada M48', quantity: 10 })).data.item
    const resources = { materials: [{ id: 'm1', name: 'Aço 1045', quantity: 20, unitPrice: 10 }], laborEntries: [], kind: 'service', stages: ['turning', 'cut-bend'], stageTimes: { turning: 60, 'cut-bend': 120 } }
    assert.equal((await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { ...resources, stageTimes: { turning: 1.5 } })).status, 400)
    assert.equal((await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', resources)).status, 200)
    await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
    const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
    assert.equal(order.pieceTracking, true)
    assert.deepEqual(order.pieceEstimate, { quantity: 10, materials: { 'name:aco 1045|': 20 }, stages: { turning: 60, 'cut-bend': 120 } }, 'the first OS brings the estimate into the average')

    const route = `/operations/orders/${order.code}`
    const startResponse = await fixture.request(`${route}/start`, 'POST', { employeeId: ana.id, machineId: machine.id, stageKey: 'stage-2', pendingMaterialsConfirmation: [['aco 1045|', 20]] }, auth)
    assert.equal(startResponse.status, 200, JSON.stringify(startResponse.data))
    const started = startResponse.data
    assert.equal(started.operation.activeSessions[0].stageName, 'Corte e dobra')
    const key = { sessionId: started.session.id, sessionToken: started.sessionToken }
    assert.equal((await fixture.request(`${route}/work-stage`, 'POST', { ...key, stageKey: 'stage-2' }, auth)).status, 409)
    const changed = (await fixture.request(`${route}/work-stage`, 'POST', { ...key, stageKey: 'stage-1' }, auth)).data
    assert.equal(changed.event.type, 'stage_changed')
    assert.equal(changed.operation.activeSessions[0].stageKey, 'stage-1')
    assert.ok(changed.operation.stageTimeMs['stage-2'] >= 0)
    assert.equal(changed.order.resources.stageTimes.turning, 60, 'the operator sees the planned time')
    await fixture.request(`${route}/stages/stage-1`, 'POST', { ...key, quantity: 10 }, auth)
    await fixture.request(`${route}/stages/stage-2`, 'POST', { ...key, quantity: 10 }, auth)
    assert.equal((await fixture.request(`${route}/complete`, 'POST', key, auth)).status, 200)

    // Real execution: turning took 30 min, cut and bend 60 min, and 30 kg of steel were used.
    await fixture.mutateStore((store) => {
      const saved = store.orders.find((item) => item.code === order.code)
      saved.operation.stageTimeMs = { 'stage-1': 30 * 60000, 'stage-2': 60 * 60000 }
      saved.resources.materials[0].quantity = 30
    })
    const suggestion = async () => (await fixture.request('/pieces/suggestion?name=porca%20sextavada%20m48&quantity=20', 'GET', undefined, admin)).data.item
    let item = await suggestion()
    assert.equal(item.samples, 2)
    assert.deepEqual(item.resources.stageTimes, { turning: 90, 'cut-bend': 180 }, '(60 + 30) ÷ 20 pieces × 20')
    assert.equal(item.resources.materials[0].quantity, 50, '(20 + 30) kg ÷ 20 pieces × 20')
    assert.deepEqual(item.resources.stages, ['turning', 'cut-bend'])

    assert.equal((await fixture.request(`/orders/${order.code}/atypical`, 'PUT', { atypical: true })).status, 401)
    assert.equal((await fixture.request(`/orders/${order.code}/atypical`, 'PUT', { atypical: true }, admin)).status, 200)
    item = await suggestion()
    assert.equal(item.samples, 0, 'an atypical OS leaves the average entirely')
    assert.equal(item.resources.materials[0].quantity, 60, 'without history, the last time in proportion')
    const pieces = (await fixture.request('/pieces', 'GET', undefined, admin)).data.items
    assert.deepEqual(pieces.map((row) => row.name), ['Porca Sextavada M48'])
    const history = (await fixture.request(`${route}/events`, 'GET', undefined, admin)).data.items
    assert.ok(history.some((event) => event.type === 'marked_atypical'))
  } finally { await fixture.close() }
})

test('lead time of a piece: average days from the OS to its completion, without atypical, old or the current one', async () => {
  const { pieceLeadTime } = await import('../server/pieces.js')
  const order = (code, days, extra = {}) => ({ code, offerId: code, service: 'Porca M48', pieceTracking: true, createdAt: '2026-10-01T00:00:00Z', operation: { status: 'completed', completedAt: new Date(Date.parse('2026-10-01T00:00:00Z') + days * 86400000).toISOString() }, ...extra })
  const orders = [order('OS-1', 4), order('OS-2', 6), order('OS-3', 30, { atypical: true }), order('OS-4', 50, { pieceTracking: false }), order('OS-5', 9, { operation: { status: 'running' } }), order('OS-6', 1, { service: 'Outra peça' })]
  assert.deepEqual(pieceLeadTime(orders, 'porca m48'), { count: 2, averageDays: 5, lastDays: 6, lastCode: 'OS-2' })
  assert.equal(pieceLeadTime(orders, 'porca m48', 'OS-2').count, 1, 'the offer being viewed does not count itself')
  assert.equal(pieceLeadTime(orders, 'Peça nova'), null, 'a new piece shows nothing')
})
