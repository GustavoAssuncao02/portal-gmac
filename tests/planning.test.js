import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { DAY_MS, SLOT_MS, addDays, blockOccupancy, blockState, dayStart, localDay, orderForecast, planningBacklog } from '../server/planningRules.js'

const at = (date, time) => new Date(Date.parse(`${date}T${time}:00-03:00`)).toISOString()

test('planning: blocks per machine on the 15-minute grid, what is left to plan, live status and the operator queue by sector', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno 01', sectors: ['Usinagem'], sector: 'Usinagem', hourlyRate: 80 }, { id: 'plasma', name: 'Plasma 01', sectors: ['Caldeiraria'], sector: 'Caldeiraria', hourlyRate: 90 }] })
  const usinagem = (await fixture.adminRequest('/sectors', 'POST', { name: 'Usinagem' })).data.item
  const ana = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001', sectorIds: [usinagem.id] })).data.item
  const bruno = (await fixture.adminRequest('/employees', 'POST', { name: 'Bruno Teste', cpf: '00000000002' })).data.item
  // The labor service of Usinagem (the default Tornearia): Ana's sector queue shows it. The list comes by name, so it is picked by name.
  const service = (await fixture.adminRequest('/labor-services')).data.items.find((item) => item.name === 'Tornearia')
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, quantity: 10 })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning', 'painting'], stageTimes: { turning: 120, painting: 60 }, stageResources: { turning: { type: 'machine', id: 'torno' } } })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offerDraft.deadline } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item

  const today = localDay(Date.now()), tomorrow = addDays(today, 1)
  assert.equal((await fixture.request(`/planning?from=${today}`, 'GET', undefined, operator)).status, 401, 'the plan is for the administrative portal')
  assert.equal((await fixture.adminRequest(`/planning?from=${today}&to=${addDays(today, 70)}`)).status, 400)
  let plan = (await fixture.adminRequest(`/planning?from=${tomorrow}`)).data
  assert.deepEqual(plan.backlog.map((row) => [row.stageCode, row.toPlanMinutes, row.suggested?.id ?? null]), [['turning', 120, 'torno'], ['painting', 60, null]])
  assert.deepEqual(plan.resources.find((item) => item.id === 'torno').sectors, ['Usinagem'])

  const block = (fields) => ({ orderCode: order.code, stageCode: 'turning', resourceType: 'machine', resourceId: 'torno', start: at(tomorrow, '08:00'), minutes: 120, ...fields })
  assert.equal((await fixture.adminRequest('/planning/blocks', 'POST', block({ start: at(tomorrow, '08:07') }))).status, 400, 'the start is on the 15-minute grid')
  assert.equal((await fixture.adminRequest('/planning/blocks', 'POST', block({ stageCode: 'milling' }))).status, 400)
  assert.equal((await fixture.adminRequest('/planning/blocks', 'POST', block({ resourceId: 'nada' }))).status, 400)
  assert.equal((await fixture.adminRequest('/planning/blocks', 'POST', block({ minutes: 0 }))).status, 400)
  // Tornearia is made on the Torno, as defined in the OS: the plan cannot put it on another machine.
  const elsewhere = await fixture.adminRequest('/planning/blocks', 'POST', block({ resourceId: 'plasma' }))
  assert.equal(elsewhere.status, 400)
  assert.match(elsewhere.data.message, /Tornearia .* é feita em Torno 01/)
  const first = (await fixture.adminRequest('/planning/blocks', 'POST', block())).data.item
  assert.ok(first.id && first.createdBy)
  const clash = await fixture.adminRequest('/planning/blocks', 'POST', block({ start: at(tomorrow, '09:30'), stageCode: 'painting' }))
  assert.equal(clash.status, 409)
  assert.match(clash.data.message, new RegExp(`Torno 01 já tem a ${order.code} das 08:00 às 10:00`))
  assert.equal((await fixture.adminRequest('/planning/blocks', 'POST', block({ start: at(tomorrow, '10:00'), stageCode: 'painting', minutes: 30 }))).status, 201, 'right after the previous one')
  // Labor services are people: blocks may overlap.
  for (let index = 0; index < 2; index += 1) assert.equal((await fixture.adminRequest('/planning/blocks', 'POST', block({ resourceType: 'labor-service', resourceId: service.id, stageCode: 'painting', minutes: 15 }))).status, 201)

  plan = (await fixture.adminRequest(`/planning?from=${tomorrow}`)).data
  assert.equal(plan.blocks.length, 4)
  assert.ok(plan.blocks.every((item) => item.status === 'planned' && item.service === offerDraft.service && item.stageName))
  assert.deepEqual(plan.backlog.map((row) => row.stageCode), [], 'turning (120 min) and painting (60 min) are fully planned')
  assert.equal((await fixture.adminRequest(`/planning/blocks/${first.id}`, 'PUT', block({ start: at(tomorrow, '09:45') }))).status, 409, 'moving onto the next block')
  assert.equal((await fixture.adminRequest(`/planning/blocks/${first.id}`, 'PUT', block({ start: at(tomorrow, '06:00') }))).status, 200)
  assert.equal((await fixture.adminRequest(`/planning?from=${tomorrow}`)).data.blocks.find((item) => item.id === first.id).end, at(tomorrow, '08:00'))

  // Planejar OS: the stages go together, all or none, each one checked against the plan and the others.
  const later = addDays(today, 5)
  const both = (paintingAt) => ({ items: [block({ start: at(later, '08:00') }), block({ stageCode: 'painting', start: at(later, paintingAt), minutes: 60 })] })
  const crossed = await fixture.adminRequest('/planning/blocks/batch', 'POST', both('09:00'))
  assert.equal(crossed.status, 409)
  assert.match(crossed.data.message, /Torno 01 já tem a/)
  assert.equal((await fixture.adminRequest(`/planning?from=${later}`)).data.blocks.length, 0, 'nothing of a refused batch is kept')
  assert.equal((await fixture.adminRequest('/planning/blocks/batch', 'POST', { items: [] })).status, 400)
  const batch = await fixture.adminRequest('/planning/blocks/batch', 'POST', both('10:00'))
  assert.equal(batch.status, 201)
  assert.deepEqual(batch.data.items.map((item) => [item.stageCode, item.start]), [['turning', at(later, '08:00')], ['painting', at(later, '10:00')]])
  for (const item of batch.data.items) assert.equal((await fixture.adminRequest(`/planning/blocks/${item.id}`, 'DELETE')).status, 204)

  // Now: a block covering this moment with nobody on the stage is late; once Ana starts, it runs; all pieces make it done.
  const slot = Math.floor(Date.now() / SLOT_MS) * SLOT_MS
  const live = (await fixture.adminRequest('/planning/blocks', 'POST', block({ start: new Date(slot).toISOString(), minutes: 60 }))).data.item
  const status = async () => (await fixture.adminRequest(`/planning?from=${localDay(slot)}`)).data.blocks.find((item) => item.id === live.id)
  assert.equal((await status()).status, 'late')
  const started = await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: ana.id, machineId: 'torno' }, operator)
  assert.equal(started.status, 200, started.data?.message)
  assert.equal((await status()).status, 'running')
  assert.equal((await fixture.adminRequest(`/planning?from=${localDay(slot)}`)).data.actual.some((item) => item.resourceId === 'torno' && item.employeeName === 'Ana Teste' && item.active), true, 'the real work is listed')

  // The tablet: Ana (Usinagem) sees the blocks of the Torno; Bruno has no sector and sees nothing.
  const queue = (await fixture.request(`/planning/operator-queue?employeeId=${ana.id}`, 'GET', undefined, operator)).data
  assert.deepEqual(queue.sectors, ['Usinagem'])
  // The Torno (the block running now first) and the labor service of Usinagem (the default Tornearia).
  assert.deepEqual(queue.items.map((item) => [item.resourceName, item.start]), [['Torno 01', new Date(slot).toISOString()], ['Torno 01', at(tomorrow, '06:00')], [service.name, at(tomorrow, '08:00')], [service.name, at(tomorrow, '08:00')], ['Torno 01', at(tomorrow, '10:00')]])
  assert.deepEqual((await fixture.request(`/planning/operator-queue?employeeId=${bruno.id}`, 'GET', undefined, operator)).data, { sectors: [], items: [] })
  assert.equal((await fixture.request('/planning/operator-queue?employeeId=nada', 'GET', undefined, operator)).status, 404)

  const session = { sessionId: started.data.session.id, sessionToken: started.data.sessionToken }
  const stageKey = (await fixture.adminRequest('/operations/orders')).data.items.find((item) => item.code === order.code).operation.stages[0].key
  assert.equal((await fixture.request(`/operations/orders/${order.code}/stages/${stageKey}`, 'POST', { quantity: 10, ...session }, operator)).status, 200)
  const done = await status()
  assert.equal(done.status, 'done')
  // The last pieces were registered inside the block: the rest of it is the time saved.
  assert.ok(Date.parse(done.doneAt) >= slot && Date.parse(done.doneAt) <= Date.now())
  assert.equal(done.earlyMinutes, Math.floor((slot + 3600000 - Date.parse(done.doneAt)) / 60000))
  assert.ok(done.earlyMinutes > 0 && done.delayMinutes === 0)
  assert.equal((await fixture.adminRequest(`/planning/blocks/${live.id}`, 'DELETE')).status, 204)
  assert.equal((await fixture.adminRequest(`/planning/blocks/${live.id}`, 'DELETE')).status, 404)
  assert.ok(dayStart(today) <= Date.now())
})

// 2026-11-28: a block holds its machine as it really goes. A late block holds it from now for what is left of it (its
// minutes less the share of the pieces registered), a block done early frees the rest, a block late for more than 7
// days holds nothing and its stage needs a new plan. The forecast end of an OS chains its stages: a late stage pushes
// the ones after it, without moving the blocks of the plan.
test('planning rules: real occupancy of the blocks, what is left to plan and the forecast end of an OS', () => {
  const now = Date.parse('2026-12-01T12:00:00-03:00'), at = (time, day = '2026-12-01') => new Date(Date.parse(`${day}T${time}:00-03:00`)).toISOString()
  const hour = 3600000
  const order = (counts = {}, status = 'waiting') => ({ code: 'OS-1', quantity: 10, resources: { stages: ['turning', 'milling', 'painting'], stageTimes: { turning: 120, milling: 60, painting: 60 } }, operation: { status, stages: [{ key: 's1', name: 'Tornearia' }, { key: 's2', name: 'Freza' }, { key: 's3', name: 'Pintura' }], stageCounts: counts } })
  const block = (stageCode, start, minutes) => ({ id: `${stageCode}-${start}`, orderCode: 'OS-1', stageCode, resourceType: 'machine', resourceId: 'torno', start, minutes })
  const held = (item, source = order()) => blockOccupancy(item, blockState(item, source, now), now)

  // Planned ahead: its own interval. Late with nobody on it: from its start until now plus what is left.
  assert.deepEqual(held(block('painting', at('14:00'), 60)), { start: Date.parse(at('14:00')), end: Date.parse(at('15:00')) })
  assert.deepEqual(held(block('turning', at('08:00'), 120)), { start: Date.parse(at('08:00')), end: now + 2 * hour })
  assert.deepEqual(held(block('turning', at('08:00'), 120), order({ s1: 5 })), { start: Date.parse(at('08:00')), end: now + hour }, 'half the pieces made: half of the block is left')
  // Late for more than 7 days: it holds nothing and its stage is to plan again.
  const stale = block('turning', at('08:00', '2026-11-23'), 120)
  assert.equal(blockState(stale, order(), now).stale, true)
  assert.equal(held(stale), null)
  assert.equal(blockState(block('turning', at('08:00', '2026-11-25'), 120), order(), now).stale, false, '6 days late still holds the machine')

  // What is left to plan: a late block still counts for what is left of it; a stale one does not.
  const backlog = (blocks, source = order()) => planningBacklog([source], blocks, now).map((row) => [row.stageCode, row.toPlanMinutes, row.replan])
  assert.deepEqual(backlog([block('turning', at('08:00'), 120)]), [['milling', 60, false], ['painting', 60, false]])
  assert.deepEqual(backlog([stale]), [['turning', 120, true], ['milling', 60, false], ['painting', 60, false]])

  // The forecast: turning late (from now, 2 h), milling planned 10:00–11:00 (late too, after the turning: 14:00–15:00),
  // painting planned 14:00–15:00 (after the milling: 15:00–16:00).
  const plan = [block('turning', at('08:00'), 120), block('milling', at('10:00'), 60), block('painting', at('14:00'), 60)]
  assert.deepEqual(orderForecast(order(), plan, now), { planned: 3, total: 3, replan: false, finished: false, end: at('16:00') })
  // Planned ahead and on time, nothing moves.
  const ahead = [block('turning', at('13:00'), 120), block('milling', at('15:00'), 60), block('painting', at('17:00'), 60)]
  assert.equal(orderForecast(order(), ahead, now).end, at('18:00'))
  // Incomplete: a stage without blocks, or with less than its time; a stale stage asks for a new plan.
  assert.deepEqual(orderForecast(order(), plan.slice(0, 2), now), { planned: 2, total: 3, replan: false, finished: false, end: null })
  assert.equal(orderForecast(order(), [block('turning', at('13:00'), 60), ...plan.slice(1)], now).planned, 2)
  assert.deepEqual(orderForecast(order(), [stale, ...plan.slice(1)], now), { planned: 2, total: 3, replan: true, finished: false, end: null })
  // Stages done count as planned; with all of them done there is nothing left to forecast.
  assert.equal(orderForecast(order({ s1: 10 }), plan.slice(1), now).end, at('15:00'), 'the milling (late) runs from now to 13:00; the painting keeps its 14:00–15:00')
  assert.deepEqual(orderForecast(order({ s1: 10, s2: 10, s3: 10 }), [], now), { planned: 3, total: 3, replan: false, finished: true, end: null })
  assert.ok(DAY_MS > 0)
})

test('planning: a late block keeps its machine busy, a block done early frees it, and the forecast of each open OS', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno 01', sectors: ['Usinagem'], sector: 'Usinagem', hourlyRate: 80 }] })
  const ana = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001' })).data.item
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, quantity: 10 })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning', 'painting'], stageTimes: { turning: 60, painting: 60 } })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offerDraft.deadline } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const block = (fields) => ({ orderCode: order.code, stageCode: 'turning', resourceType: 'machine', resourceId: 'torno', minutes: 60, ...fields })

  // The Tornearia from the current quarter, nobody on it: late. Right after its planned end the Torno is still busy.
  const slot = Math.floor(Date.now() / SLOT_MS) * SLOT_MS
  const live = (await fixture.adminRequest('/planning/blocks', 'POST', block({ start: new Date(slot).toISOString() }))).data.item
  const busy = await fixture.adminRequest('/planning/blocks', 'POST', block({ stageCode: 'painting', start: new Date(slot + 3600000).toISOString() }))
  assert.equal(busy.status, 409)
  assert.match(busy.data.message, new RegExp(`Torno 01 ainda está com a ${order.code}, em atraso, até`))
  let forecast = (await fixture.adminRequest('/planning/forecasts')).data.items.find((item) => item.orderCode === order.code)
  assert.deepEqual([forecast.planned, forecast.total, forecast.end], [1, 2, null], 'the Pintura is not planned yet')

  // Ana makes the 10 pieces of the Tornearia now: the rest of its block is free again.
  const started = await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: ana.id, machineId: 'torno' }, operator)
  assert.equal(started.status, 200, started.data?.message)
  const stageKey = (await fixture.adminRequest('/operations/orders')).data.items.find((item) => item.code === order.code).operation.stages[0].key
  assert.equal((await fixture.request(`/operations/orders/${order.code}/stages/${stageKey}`, 'POST', { quantity: 10, sessionId: started.data.session.id, sessionToken: started.data.sessionToken }, operator)).status, 200)
  const next = Math.ceil(Date.now() / SLOT_MS) * SLOT_MS
  const painting = await fixture.adminRequest('/planning/blocks', 'POST', block({ stageCode: 'painting', start: new Date(next).toISOString() }))
  assert.equal(painting.status, 201, painting.data?.message)
  forecast = (await fixture.adminRequest('/planning/forecasts')).data.items.find((item) => item.orderCode === order.code)
  assert.deepEqual([forecast.planned, forecast.total, forecast.end], [2, 2, new Date(next + 3600000).toISOString()])
  assert.equal((await fixture.request('/planning/forecasts', 'GET', undefined, operator)).status, 401, 'the forecasts are for the administrative portal')
  assert.ok(live.id)
})
