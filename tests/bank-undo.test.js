import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { sicoobOfx } from './ofxSample.js'

// "Desconciliar tudo" undoes the links of the account in the month (closed months stay), and a batch imported by mistake
// can be removed: its movements leave with their links, settlements made by a closing are reversed, and a movement that
// also came in another batch stays.
test('undoing every link and removing an imported batch', async (t) => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => f.close())
  const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const headers = { Authorization: `Bearer ${token}` }
  const request = (route, method, body) => f.request(route, method, body, headers)
  const upload = async () => (await (await fetch(`${f.url}/api/bank-statements/import?name=sicoob.ofx`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: sicoobOfx() })).json()).item
  const payable = (id, valueCents) => ({ id, supplierId: null, supplierName: 'Fornecedor Exemplo', description: '', documentNumber: '', issueDate: '2026-09-20', dueDate: '2026-10-01', valueCents, payment: null, inactive: false, attachments: [], createdAt: '2026-09-20T12:00:00.000Z' })
  await f.mutateStore((store) => {
    store.receivables = [{ id: 'REC-000001', origin: 'manual', kind: 'single', customerName: 'Cliente Exemplo Indústria e Comércio Ltda', customerDocument: null, description: '', documentNumber: '', issueDate: '2026-09-20', dueDate: '2026-10-01', valueCents: 157500, issCents: 7500, receipt: null, inactive: false, attachments: [], createdAt: '2026-09-20T12:00:00.000Z' }]
    store.receivableSequence = 1
    store.payables = [payable('PAG-000001', 35000)]
    store.payableSequence = 1
  })
  const batch = await upload()
  let state = (await request('/bank-statements')).data
  const byFit = (fitId) => state.transactions.find((row) => row.fitId === fitId)
  const link = async () => {
    for (const [fitId, kind, recordId] of [['S1', 'receivable', 'REC-000001'], ['S5', 'payable', 'PAG-000001']]) assert.equal((await request(`/bank-statements/transactions/${byFit(fitId).id}/reconcile`, 'POST', { kind, recordId })).status, 200, fitId)
  }
  const accounts = () => f.mutateStore((store) => structuredClone({ receipt: store.receivables[0].receipt, payment: store.payables[0].payment }))
  await link()
  const close = () => request('/bank-statements/closings', 'POST', { bankAccountId: batch.bankAccountId, month: '2026-10', note: 'PIX sem conta lançada.', methods: { [byFit('S5').id]: 'boleto' } })
  assert.equal((await close()).status, 200)
  assert.ok((await accounts()).receipt, 'settled by the closing')

  // Closed: nothing is undone and the batch cannot be removed.
  const lockedUndo = await request('/bank-statements/unreconcile-all', 'POST', { bankAccountId: batch.bankAccountId, month: '2026-10' })
  assert.deepEqual([lockedUndo.data.undone, lockedUndo.data.skipped], [0, 2])
  const lockedRemove = await request(`/bank-statements/imports/${batch.id}`, 'DELETE')
  assert.equal(lockedRemove.status, 409)
  assert.match(lockedRemove.data.message, /outubro de 2026 está encerrada[\s\S]*Reabra/)

  // Reopened: "Desconciliar tudo" undoes both links and reverses the settlements the closing made.
  assert.equal((await request('/bank-statements/closings/CON-000001/reopen', 'POST', { reason: 'Extrato importado errado.' })).status, 200)
  const undone = await request('/bank-statements/unreconcile-all', 'POST', { bankAccountId: batch.bankAccountId, month: '2026-10' })
  assert.equal(undone.status, 200)
  assert.deepEqual([undone.data.undone, undone.data.reversed.map((row) => row.recordId).sort()], [2, ['PAG-000001', 'REC-000001']])
  assert.deepEqual(await accounts(), { receipt: null, payment: null })
  state = (await request('/bank-statements')).data
  assert.equal(state.transactions.filter((row) => row.reconciliation).length, 0)

  // The same file imported again shares its movements; removing the first batch keeps them with the second.
  await link()
  const second = await upload()
  const total = state.transactions.length
  const shared = await request(`/bank-statements/imports/${batch.id}`, 'DELETE')
  assert.deepEqual([shared.status, shared.data.removed, shared.data.unlinked], [200, 0, 0])
  state = (await request('/bank-statements')).data
  assert.equal(state.transactions.length, total)
  assert.ok(state.transactions.every((row) => row.importIds.join() === second.id && row.importId === second.id))
  assert.deepEqual(state.imports.map((row) => row.id), [second.id])

  // Removing the last batch takes its movements, undoes their links and the account of the statement goes too.
  const removed = await request(`/bank-statements/imports/${second.id}`, 'DELETE')
  assert.deepEqual([removed.status, removed.data.removed, removed.data.unlinked, removed.data.reversed], [200, total, 2, []])
  state = (await request('/bank-statements')).data
  assert.deepEqual([state.transactions.length, state.imports.length, state.balances.length], [0, 0, 0])
  assert.equal(state.accounts.length, 1, 'the account stays while its (reopened) closing exists')
  const events = await f.mutateStore((store) => store.bankEvents.map((row) => row.type))
  assert.equal(events.filter((type) => type === 'import_removed').length, 2)
  // The accounts are free to be linked again with the right statement.
  await upload()
  state = (await request('/bank-statements')).data
  assert.equal((await request(`/bank-statements/transactions/${byFit('S1').id}/candidates`)).data.candidates[0]?.id, 'REC-000001')
})
