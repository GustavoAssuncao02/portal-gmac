import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { hourReport, localDate, reportRange, workIntervals } from '../server/reportData.js'

test('service registry is seeded once, admin-managed, validated and intentionally stays empty after deletion', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const auth = { Authorization: `Bearer ${fixture.adminToken}` }
  const request = (path, method, body) => fixture.request(path, method, body, auth)
  const seeded = (await request('/labor-services')).data.items
  assert.equal(seeded.length, 7)
  assert.ok(seeded.every((item) => item.hourlyRate > 0 && !('status' in item)))
  assert.equal((await fixture.request('/labor-services', 'POST', { name: 'Teste', hourlyRate: 10 })).status, 401)
  assert.equal((await fixture.request(`/labor-services/${seeded[0].id}/history`)).status, 401)
  for (const hourlyRate of [-1, '', null, 'abc', false, {}]) assert.equal((await request('/labor-services', 'POST', { name: 'Teste', hourlyRate })).status, 400)
  const created = await request('/labor-services', 'POST', { name: 'Ajuste de bancada', sector: 'Montagem', hourlyRate: 72.5 })
  assert.equal(created.status, 201)
  const service = created.data.item
  assert.equal((await request(`/labor-services/${service.id}`, 'PUT', { ...service, hourlyRate: 80 })).data.item.hourlyRate, 80)
  assert.equal((await request(`/labor-services/${service.id}/history?period=invalid`)).status, 400)
  assert.equal((await request('/labor-services/missing/history')).status, 404)
  for (const row of (await request('/labor-services')).data.items) assert.equal((await request(`/labor-services/${row.id}`, 'DELETE')).status, 200)
  assert.deepEqual((await request('/labor-services')).data.items, [])
})

test('operator selection and changes audit actual service hours and preserve session ownership, machines and progress', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const auth = { Authorization: `Bearer ${fixture.adminToken}` }
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  const request = (path, method, body) => fixture.request(path, method, body, auth)
  const [first, second] = (await request('/labor-services')).data.items
  const employee = (await request('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001', birthDate: '1990-01-01', email: 'ana@example.invalid', identification: '001' })).data.item
  const offer = (await request('/offers', 'POST', offerDraft)).data.item
  await request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [{ id: 'person', type: 'person', resource: first.name, laborServiceId: first.id, hours: 2, hourlyRate: first.hourlyRate }], kind: 'service', stages: ['painting'] })
  await request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offer.deadline } })
  const order = (await request(`/offers/${offer.id}/accept`, 'POST')).data.item
  assert.equal(order.resources.laborEntries[0].laborServiceId, first.id)
  const route = `/operations/orders/${order.code}`
  assert.equal((await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id, laborServiceId: 'missing' }, operator)).status, 400)
  const started = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id, laborServiceId: first.id }, operator)
  assert.equal(started.status, 200)
  assert.equal(started.data.event.laborServiceName, first.name)
  const session = { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken }
  assert.equal((await request(`/labor-services/${first.id}`, 'DELETE')).status, 409)
  assert.equal((await fixture.request(`${route}/labor-service`, 'POST', { ...session, sessionToken: 'wrong', laborServiceId: second.id }, operator)).status, 403)
  assert.equal((await fixture.request(`${route}/labor-service`, 'POST', { ...session, laborServiceId: 'missing' }, operator)).status, 400)
  assert.equal((await fixture.request(`${route}/labor-service`, 'POST', { ...session, laborServiceId: first.id }, operator)).status, 409)
  const at = Date.now()
  await fixture.mutateStore((store) => {
    const current = store.orders.find((row) => row.code === order.code)
    current.operation.activeSessions[0].startedAt = current.operation.activeSince = new Date(at - 3600000).toISOString()
    current.operationEvents[0].at = current.operation.activeSessions[0].startedAt
  })
  const changed = await fixture.request(`${route}/labor-service`, 'POST', { ...session, laborServiceId: second.id }, operator)
  assert.equal(changed.status, 200)
  assert.equal(changed.data.operation.activeSession.id, session.sessionId)
  assert.equal(changed.data.operation.activeSession.laborServiceId, second.id)
  assert.equal(changed.data.operation.activeSession.machineId, null)
  assert.deepEqual(changed.data.operation.stageCounts, started.data.operation.stageCounts)
  const history = (await request(`/labor-services/${first.id}/history`)).data.items
  assert.equal(history.length, 1)
  assert.equal(history[0].employeeName, employee.name)
  assert.equal(history[0].orderCode, order.code)
  assert.ok(history[0].durationMs >= 3600000)
  assert.ok(!/tokenHash|sessionToken/.test(JSON.stringify(history)))
  const paused = await fixture.request(`${route}/pause`, 'POST', { ...session, reason: 'Descanso' }, operator)
  assert.equal(paused.status, 200)
  assert.equal((await request(`/labor-services/${second.id}/history`)).data.items[0].active, false)
  const input = { kind: 'service-hours', start: localDate(at - 3600000), end: localDate(Date.now()), ids: [first.id] }
  assert.equal((await request('/reports/generate', 'POST', { ...input, end: 'invalid' })).status, 400)
  const report = await request('/reports/generate', 'POST', input)
  assert.equal(report.status, 200)
  assert.equal(report.data.sections[0].rows.length, 1)
  assert.ok(report.data.sections[0].rows[0][2] >= 1)
  assert.equal(report.data.sections[3].rows[0][1], employee.name)
  assert.ok(!/tokenHash|sessionToken/.test(JSON.stringify(report.data)))
  for (const format of ['pdf', 'xlsx']) {
    const response = await fetch(`${fixture.url}/api/reports/export`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, format }) })
    assert.equal(response.status, 200)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (format === 'pdf') assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
    else { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes); assert.equal(workbook.worksheets.length, 5) }
  }
  assert.equal((await request(`/labor-services/${first.id}`, 'DELETE')).status, 200)
  assert.ok((await request('/reports/generate', 'POST', input)).data.sections[0].rows[0][2] >= 1, 'Deleted services retain historic time and their original name')
})

test('service reports sum different employees, deduplicate the same employee, split days and preserve machine and employee totals across service changes', () => {
  const start = Date.parse('2026-10-04T02:00:00Z')
  const session = { id: 'session', employeeId: 'ana', employeeName: 'Ana', machineId: 'torno', machineName: 'Torno', laborServiceId: 'painting', laborServiceName: 'Pintura' }
  const event = (type, offset, fields = {}) => ({ ...session, sessionId: session.id, type, at: new Date(start + offset * 3600000).toISOString(), ...fields })
  const orders = [{ code: 'OS-1', operationEvents: [event('started', 0), event('labor_service_changed', 1, { nextLaborServiceId: 'welding', nextLaborServiceName: 'Soldagem' }), event('paused', 2)] }]
  const intervals = workIntervals(orders, start + 3 * 3600000)
  const range = reportRange('2026-10-03', '2026-10-04')
  const services = [{ id: 'painting', name: 'Pintura' }, { id: 'welding', name: 'Soldagem' }]
  const first = intervals[0]
  const overlapping = [...intervals, { ...first, orderCode: 'OS-2' }, { ...first, employeeId: 'bruno', employeeName: 'Bruno', orderCode: 'OS-3' }]
  const result = hourReport(overlapping, services, 'laborServiceId', range, [], { parallelField: 'employeeId' })
  assert.equal(result.totalMs, 3 * 3600000)
  assert.equal(result.details.find((row) => row.id === 'painting').date, '2026-10-03')
  assert.equal(hourReport(intervals, [{ id: 'ana', name: 'Ana' }], 'employeeId', range).totalMs, 2 * 3600000)
  assert.equal(hourReport(intervals, [{ id: 'torno', name: 'Torno' }], 'machineId', range).totalMs, 2 * 3600000)
})
