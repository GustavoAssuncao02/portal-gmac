import assert from 'node:assert/strict'
import test from 'node:test'
import { activityDateRange } from '../server/employeeActivity.js'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const day = 86400000
test('activity date ranges use Bahia midnight and inclusive calendar days', () => {
  const now = Date.parse('2026-10-03T16:00:00Z')
  const today = Date.parse('2026-10-03T03:00:00Z')
  for (const [period, offset, end] of [['today', 0, 1], ['yesterday', -1, 0], ['7days', -6, 1], ['30days', -29, 1]]) {
    assert.deepEqual(activityDateRange(period, undefined, now), { start: today + offset * day, end: today + end * day })
  }
  assert.deepEqual(activityDateRange('today', undefined, Date.parse('2026-10-03T02:59:59Z')), { start: today - day, end: today })
  assert.equal(activityDateRange('all'), null)
  assert.deepEqual(activityDateRange('date', '2024-02-29'), { start: Date.parse('2024-02-29T03:00:00Z'), end: Date.parse('2024-03-01T03:00:00Z') })
  for (const date of [undefined, '', '03/10/2026', '2026-02-29', '2026-13-01', '2026-04-31']) assert.throws(() => activityDateRange('date', date), RangeError)
  for (const period of ['unknown', 'constructor', 'toString']) assert.throws(() => activityDateRange(period), RangeError)
})

test('employee history filters across OS, excludes other employees and preserves boundary events', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const today = activityDateRange('today').start
  const event = (id, time, employeeId = 'employee-a', fields = {}) => ({ id, at: new Date(time).toISOString(), employeeId, type: 'started', ...fields })
  await fixture.mutateStore((store) => {
    store.employees = [{ id: 'employee-a', name: 'Ana' }, { id: 'employee-b', name: 'Bruno' }]
    store.orders = [
      { code: 'OS-A', service: 'Estrutura A', company: 'Cliente A', quantity: 10, operationEvents: [event('old', today - 40 * day), event('30', today - 29 * day), event('7', today - 6 * day), event('yesterday', today - 1), event('midnight', today, 'employee-a', { sessionId: 'session-a' }), event('other', today + 1, 'employee-b', { sessionId: 'session-b' })] },
      { code: 'OS-B', service: 'Estrutura B', quantity: 5, operationEvents: [event('today', today + 1), event('interrupted', today + 2, null, { type: 'admin_interrupted', sessionId: 'session-a', reason: 'Troca de atividade' }), event('other-interruption', today + 3, null, { type: 'admin_interrupted', sessionId: 'session-b' }), event('tomorrow', today + day)] },
    ]
  })
  const route = '/employees/employee-a/activities'
  const ids = async (query = '') => {
    const response = await fixture.request(route + query)
    assert.equal(response.status, 200)
    return response.data.items.map((item) => item.id)
  }
  assert.deepEqual(await ids(), ['interrupted', 'today', 'midnight'])
  assert.deepEqual(await ids('?period=yesterday'), ['yesterday'])
  assert.deepEqual(await ids('?period=7days'), ['interrupted', 'today', 'midnight', 'yesterday', '7'])
  assert.deepEqual(await ids('?period=30days'), ['interrupted', 'today', 'midnight', 'yesterday', '7', '30'])
  assert.deepEqual(await ids('?period=all'), ['tomorrow', 'interrupted', 'today', 'midnight', 'yesterday', '7', '30', 'old'])
  const date = new Date(today - day).toISOString().slice(0, 10)
  assert.deepEqual(await ids(`?period=date&date=${date}`), ['yesterday'])
  assert.equal((await fixture.request(route + '?period=date&date=2000-01-01')).data.items.length, 0)
  assert.equal((await fixture.request(route + '?period=date&date=2026-02-30')).status, 400)
  assert.equal((await fixture.request(route + '?period=date')).status, 400)
  assert.equal((await fixture.request(route + '?period=toString')).status, 400)
  assert.equal((await fixture.request('/employees/unknown/activities')).status, 404)
  const history = (await fixture.request(route)).data.items
  assert.equal(history.find((item) => item.id === 'today').service, 'Estrutura B')
  assert.equal(history.find((item) => item.id === 'midnight').company, 'Cliente A')
  assert.equal(history.find((item) => item.id === 'midnight').targetQuantity, 10)
})

test('history includes actual persisted starts, progress, pauses, resumes, admin interruptions and completion', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const employee = (await fixture.request('/employees', 'POST', { name: 'Funcionario de teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'teste@example.invalid', identification: '001' })).data.item
  const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cutting'], kind: 'service' })
  await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.request(`/offers/${offer.id}/accept`, 'POST')).data.item
  const route = `/operations/orders/${order.code}`
  const headers = { Authorization: `Bearer ${fixture.operatorToken}` }
  const start = async () => {
    const response = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id }, headers)
    assert.equal(response.status, 200)
    return { sessionId: response.data.operation.activeSession.id, sessionToken: response.data.sessionToken }
  }
  let session = await start()
  assert.equal((await fixture.request(`${route}/stages/stage-1`, 'POST', { ...session, quantity: 10 }, headers)).status, 200)
  assert.equal((await fixture.request(`${route}/pause`, 'POST', { ...session, reason: 'Descanso' }, headers)).status, 200)
  await start()
  assert.equal((await fixture.request(`${route}/interrupt`, 'POST', { reason: 'Manutencao' })).status, 200)
  session = await start()
  assert.equal((await fixture.request(`${route}/complete`, 'POST', session, headers)).status, 200)
  await fixture.request(`${route}/acknowledge-completion`, 'POST')
  const history = (await fixture.request(`/employees/${employee.id}/activities?period=all`)).data.items
  assert.equal(history.length, 7)
  assert.deepEqual(history.map((item) => item.type).sort(), ['started', 'stage_progress', 'paused', 'resumed', 'admin_interrupted', 'resumed', 'completed'].sort())
  assert.ok(history.every((item) => item.orderCode === order.code && item.service === offerDraft.service))
  assert.equal(history.find((item) => item.type === 'paused').reason, 'Descanso')
  assert.equal(history.find((item) => item.type === 'stage_progress').stageTotal, 10)
  assert.ok(history.find((item) => item.type === 'completed').durationMs >= 0)
})

test('MySQL history binds employee and date parameters, and links legacy admin events through sessions', async (t) => {
  const queries = []
  const pool = { async execute(sql, params) {
    if (sql.includes('FROM employees')) return [[{ id: 12, name: 'Ana' }]]
    queries.push({ sql, params })
    return [[{ orderCode: 'OS-DB', data: JSON.stringify({ id: 'db-event', type: 'paused', at: '2026-10-03T04:00:00Z', employeeId: 12 }) }]]
  } }
  const fixture = await createWorkflowFixture({ pool })
  t.after(() => fixture.close())
  await fixture.mutateStore((store) => { store.orders = [{ code: 'OS-DB', service: 'Peca DB', quantity: 10 }] })
  const response = await fixture.request('/employees/12/activities?period=date&date=2026-10-03')
  assert.equal(response.status, 200)
  assert.equal(response.data.items[0].service, 'Peca DB')
  assert.deepEqual(queries[0].params, ['12', '12', new Date('2026-10-03T03:00:00Z'), new Date('2026-10-04T03:00:00Z')])
  assert.match(queries[0].sql, /admin_interrupted/)
  assert.match(queries[0].sql, /sessionId/)
  assert.match(queries[0].sql, /occurred_at >= \? AND occurred_at < \?/)
  await fixture.request('/employees/12/activities?period=all')
  assert.deepEqual(queries[1].params, ['12', '12'])
  assert.ok(!queries[1].sql.includes('occurred_at >= ?'))
})
