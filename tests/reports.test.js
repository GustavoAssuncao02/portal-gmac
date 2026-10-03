import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { hourReport, reportRange, workIntervals } from '../server/reportData.js'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
test('hour reports split Bahia midnight, clip the interval and merge overlapping work without counting pauses', () => {
  const orders = [{ code: 'OS-1', operationEvents: [
    { type: 'started', sessionId: 'a', at: '2026-10-01T23:30:00-03:00', employeeId: 1, employeeName: 'Ana', machineId: 2, machineName: 'Torno' },
    { type: 'paused', sessionId: 'a', at: '2026-10-02T00:30:00-03:00', durationMs: 3600000 },
    { type: 'resumed', sessionId: 'b', at: '2026-10-02T01:00:00-03:00', employeeId: 1, employeeName: 'Ana', machineId: 2 },
    { type: 'admin_interrupted', sessionId: 'b', at: '2026-10-02T02:00:00-03:00', durationMs: 3600000, employeeId: null },
  ] }, { code: 'OS-2', operation: { activeSession: { id: 'c', startedAt: '2026-10-02T01:30:00-03:00', employeeId: 1, employeeName: 'Ana', machineId: 2 } } }]
  const intervals = workIntervals(orders, Date.parse('2026-10-02T02:00:00-03:00'))
  const result = hourReport(intervals, [{ id: 1, name: 'Ana' }, { id: 3, name: 'Bruno' }], 'employeeId', reportRange('2026-10-01', '2026-10-02'))
  assert.equal(result.totalMs, 7200000)
  assert.deepEqual(result.details.map((row) => [row.date, row.ms]), [['2026-10-01', 1800000], ['2026-10-02', 5400000]])
  assert.equal(result.totals[1].ms, 0)
  assert.equal(hourReport(intervals, [{ id: 1, name: 'Ana' }], 'employeeId', reportRange('2026-10-02', '2026-10-02'), [1]).totalMs, 5400000)
  assert.equal(hourReport(intervals, [{ id: 3, name: 'Bruno' }], 'employeeId', reportRange('2026-10-01', '2026-10-02'), [3]).totalMs, 0)
  assert.equal(hourReport(intervals, [{ id: 2, name: 'Torno' }], 'machineId', reportRange('2026-10-01', '2026-10-02')).totalMs, 7200000)
  assert.throws(() => reportRange('2026-02-30', '2026-03-01'))
  assert.throws(() => reportRange('2026-10-03', '2026-10-01'))
})

test('accounts and registries persist; protected reports export actual PDF/XLSX without credentials', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    assert.equal((await fixture.request('/reports/catalog')).status, 401)
    const login = await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })
    let headers = { Authorization: `Bearer ${login.data.token}` }
    const employee = (await fixture.request('/employees', 'POST', { name: 'Ana Teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'ana@example.invalid', identification: '001' })).data.item
    const client = (await fixture.request('/clients', 'POST', { name: '=SUM(1,2)', documentType: 'cnpj', document: '12345678000190', email: 'client@example.invalid' }, headers)).data.item
    const admin = (await fixture.request('/admins', 'POST', { name: 'Admin Teste', birthDate: '1990-01-01', cpf: '00000000002', email: 'admin@example.invalid', password: 'senha123' }, headers)).data.item
    assert.equal(admin.passwordHash, undefined)
    const machine = (await fixture.request('/machines', 'POST', { name: 'Torno teste', type: 'Torno', sector: 'Usinagem', hourlyRate: 150 }, headers)).data.item
    const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
    const resources = { materials: [], laborEntries: [], stages: ['turning', 'painting', 'plasma-cut'], kind: 'product', manufacturedFrom: 'drawing', tempering: true, paintColor: 'Azul epoxi', serviceDescription: 'Acabamento conforme desenho.' }
    assert.equal((await fixture.request(`/offers/${offer.id}/resources`, 'PUT', resources)).status, 200)
    await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'A', deadline: '2026-12-20', serviceValue: 100 } })
    const order = (await fixture.request(`/offers/${offer.id}/accept`, 'POST')).data.item
    const operatorHeaders = { Authorization: `Bearer ${fixture.operatorToken}` }
    assert.equal((await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: employee.id, machineId: 'nonexistent' }, operatorHeaders)).status, 400)
    const started = (await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: employee.id, machineId: machine.id }, operatorHeaders)).data
    assert.equal(started.operation.activeSession.machineName, 'Torno teste')
    assert.deepEqual(started.operation.stages.map((row) => row.name), ['Tornearia', 'Pintura', 'Corte a plasma'])
    await fixture.mutateStore((store) => {
      const current = store.orders.find((row) => row.code === order.code)
      const start = new Date(Date.now() - 1200000).toISOString()
      current.createdAt = '2026-10-01T12:00:00-03:00'
      current.operation.activeSession.startedAt = start
      current.operationEvents[0].at = start
    })
    const paused = (await fixture.request(`/operations/orders/${order.code}/pause`, 'POST', { sessionId: started.operation.activeSession.id, sessionToken: started.sessionToken, reason: 'Descanso' }, operatorHeaders)).data
    assert.equal(paused.event.machineId, machine.id)
    assert.equal(paused.operation.activeSession, null)
    for (const kind of ['employees', 'clients', 'admins', 'employee-hours', 'machine-hours', 'orders']) {
      const body = { kind, start: '2026-10-01', end: '2026-10-03', ids: [] }
      const preview = await fixture.request('/reports/generate', 'POST', body, headers)
      assert.equal(preview.status, 200, JSON.stringify(preview.data))
      assert.ok(!/password|tokenHash|sessionToken|senha123|teste123/.test(JSON.stringify(preview.data)))
      if (kind.endsWith('-hours')) assert.ok(preview.data.sections[0].rows[0][2] >= 1 / 3)
      if (kind === 'orders') assert.equal(preview.data.sections[0].rows[0][16], 'Azul epoxi')
      for (const format of ['pdf', 'xlsx']) {
        const response = await fetch(`${fixture.url}/api/reports/export`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, format }) })
        assert.equal(response.status, 200)
        const bytes = Buffer.from(await response.arrayBuffer())
        if (format === 'pdf') assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
        else {
          assert.equal(bytes.subarray(0, 2).toString(), 'PK')
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load(bytes)
          assert.equal(workbook.worksheets.length, preview.data.sections.length + 1)
          if (kind === 'clients') assert.equal(workbook.worksheets[0].getRow(2).getCell(2).value, '=SUM(1,2)')
        }
      }
    }
    assert.equal((await fixture.request('/reports/generate', 'POST', { kind: 'machine-hours', start: '2026-10-03', end: '2026-10-01' }, headers)).status, 400)
    assert.equal((await fixture.request('/account', 'PATCH', { name: 'Novo Nome', currentPassword: 'errada' }, headers)).status, 403)
    const updated = await fixture.request('/account', 'PATCH', { name: 'Gustavo Atualizado', currentPassword: env.DEMO_ADMIN_PASSWORD, password: 'novaSenha123' }, headers)
    assert.equal(updated.status, 200)
    assert.equal((await fixture.request('/reports/catalog', 'GET', undefined, headers)).status, 401)
    assert.equal((await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).status, 401)
    const again = await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: 'novaSenha123' })
    assert.equal(again.data.user.name, 'Gustavo Atualizado')
    headers = { Authorization: `Bearer ${again.data.token}` }
    assert.equal((await fixture.request('/clients', 'GET', undefined, headers)).data.items[0].id, client.id)
    assert.equal((await fixture.request('/admins/0', 'DELETE', undefined, headers)).status, 409)
    assert.equal((await fixture.request('/auth/login', 'POST', { cpf: admin.cpf, password: 'senha123' })).status, 200)
  } finally { await fixture.close() }
})
