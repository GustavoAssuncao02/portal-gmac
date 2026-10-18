import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { sicoobOfx, sicoobRecords } from './ofxSample.js'

// One closing per account and month: pending movements need a justification, the links of a closed month are locked,
// reopening (with a reason) unlocks them, closing again keeps the same record with a new version, deleting keeps the links.
test('bank reconciliation is closed per account and month, locked, reopened, closed again and deleted', async (t) => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => f.close())
  const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const headers = { Authorization: `Bearer ${token}` }
  const request = (route, method, body) => f.request(route, method, body, headers)
  const upload = async (bytes) => (await fetch(`${f.url}/api/bank-statements/import?name=sicoob.ofx`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: bytes })).json()
  const { item: batch } = await upload(sicoobOfx())
  await f.mutateStore((store) => { store.receivables = [{ id: 'REC-000001', origin: 'manual', kind: 'single', customerName: 'Cliente Exemplo Indústria e Comércio Ltda', customerDocument: null, description: '', documentNumber: '', issueDate: '2026-09-20', dueDate: '2026-10-01', valueCents: 150000, receipt: null, inactive: false, createdAt: '2026-09-20T12:00:00.000Z' }]; store.receivableSequence = 1 })
  let state = (await request('/bank-statements')).data
  const byFit = (fitId) => state.transactions.find((row) => row.fitId === fitId)
  assert.equal((await request(`/bank-statements/transactions/${byFit('S1').id}/reconcile`, 'POST', { kind: 'receivable', recordId: 'REC-000001' })).status, 200)
  const close = (body) => request('/bank-statements/closings', 'POST', { bankAccountId: batch.bankAccountId, month: '2026-10', ...body })

  assert.equal((await f.request('/bank-statements/closings', 'POST', {})).status, 401)
  assert.equal((await close({ month: '2026-13' })).status, 400)
  assert.equal((await close({ month: '2026-09' })).status, 400, 'a month without movements cannot be closed')
  const missing = await close({ note: 'curto' })
  assert.equal(missing.status, 400)
  assert.match(missing.data.message, /2 movimentações sem conciliação/, 'the RDC application and redemption need no justification')
  const closed = await close({ note: 'PIX e convênio sem conta lançada; conferir com o financeiro.' })
  assert.equal(closed.status, 200)
  assert.deepEqual([closed.data.item.id, closed.data.item.status, closed.data.item.version, closed.data.item.monthLabel], ['CON-000001', 'closed', 1, 'outubro de 2026'])
  assert.deepEqual([closed.data.item.summary.movements, closed.data.item.summary.reconciled, closed.data.item.summary.pending, closed.data.item.summary.internal, closed.data.item.summary.pendingCents], [5, 1, 2, 2, 55000])
  assert.equal(closed.data.item.items.find((row) => row.fitId === 'S1').reconciliation.recordId, 'REC-000001')
  assert.equal((await close({ note: 'outra vez, de novo' })).status, 409, 'one closing per account and month')

  // Closed: the links of the month cannot change, one by one or with "Conciliar tudo".
  assert.equal((await request(`/bank-statements/transactions/${byFit('S1').id}/reconcile`, 'DELETE')).status, 409)
  assert.equal((await request(`/bank-statements/transactions/${byFit('S3').id}/reconcile`, 'POST', { kind: 'payable', recordId: 'PAG-000001' })).status, 409)
  assert.deepEqual((await request('/bank-statements/reconcile-all', 'POST', {})).data.items, [])
  // A movement of the month imported after the closing is pointed out.
  await upload(sicoobOfx('\n', [...sicoobRecords, ['DEBIT', '-80.00', 'S6', 'TARIFA PACOTE DE SERVIÇOS']]))
  state = (await request('/bank-statements')).data
  assert.equal(state.closings[0].addedAfterClose, 1)

  assert.equal((await request('/bank-statements/closings/CON-000001/reopen', 'POST', { reason: 'curto' })).status, 400)
  const reopened = await request('/bank-statements/closings/CON-000001/reopen', 'POST', { reason: 'Faltou conciliar a tarifa do mês.' })
  assert.deepEqual([reopened.status, reopened.data.item.status], [200, 'reopened'])
  assert.equal((await request('/bank-statements/closings/CON-000001/reopen', 'POST', { reason: 'Faltou conciliar a tarifa do mês.' })).status, 409)
  assert.equal((await request(`/bank-statements/transactions/${byFit('S1').id}/reconcile`, 'DELETE')).status, 200, 'reopened, the links can change')
  assert.equal((await request(`/bank-statements/transactions/${byFit('S1').id}/reconcile`, 'POST', { kind: 'receivable', recordId: 'REC-000001' })).status, 200)
  const again = await close({ note: 'Tarifa, PIX e convênio ainda sem conta lançada.' })
  assert.deepEqual([again.data.item.id, again.data.item.version, again.data.item.summary.movements, again.data.item.addedAfterClose], ['CON-000001', 2, 6, 0])
  assert.deepEqual(again.data.item.history.map((row) => row.type), ['closed', 'reopened', 'reclosed'])
  assert.equal(again.data.item.history[1].reason, 'Faltou conciliar a tarifa do mês.')

  assert.equal((await request('/bank-statements/closings/CON-000099', 'DELETE')).status, 404)
  assert.equal((await request('/bank-statements/closings/CON-000001', 'DELETE')).status, 200)
  state = (await request('/bank-statements')).data
  assert.deepEqual(state.closings, [])
  assert.equal(byFit('S1').reconciliation.recordId, 'REC-000001', 'deleting the closing keeps the links')
  assert.equal((await request(`/bank-statements/transactions/${byFit('S1').id}/reconcile`, 'DELETE')).status, 200, 'and the month is open again')
})
