import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { sicoobOfx } from './ofxSample.js'
import ExcelJS from 'exceljs'

// Closing the reconciliation settles the linked accounts still open, with the date and value of the bank movement, the
// bank of the statement account and the way the money moved (from the bank operation or chosen by the user). A receivable
// is matched by its value net of the ISS withheld. Undoing a link after reopening reverses only a settlement made this way.
test('closing the reconciliation settles the linked open accounts and undoing the link reverses it', async (t) => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => f.close())
  const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const headers = { Authorization: `Bearer ${token}` }
  const request = (route, method, body) => f.request(route, method, body, headers)
  const { item: batch } = await (await fetch(`${f.url}/api/bank-statements/import?name=sicoob.ofx`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: sicoobOfx() })).json()
  const paid = { date: '2026-10-01', method: 'pix', interestCents: 0, discountCents: 0, finalCents: 20000, note: '', receipts: [] }
  const payable = (id, valueCents, payment = null) => ({ id, supplierId: null, supplierName: 'Fornecedor Exemplo', description: '', documentNumber: '', issueDate: '2026-09-20', dueDate: '2026-10-01', valueCents, payment, inactive: false, attachments: [], createdAt: '2026-09-20T12:00:00.000Z' })
  await f.mutateStore((store) => {
    // R$ 1.575,00 with R$ 75,00 of ISS arrives as R$ 1.500,00 (S1, a TED).
    store.receivables = [{ id: 'REC-000001', origin: 'manual', kind: 'single', customerName: 'Cliente Exemplo Indústria e Comércio Ltda', customerDocument: null, description: '', documentNumber: '', issueDate: '2026-09-20', dueDate: '2026-10-01', valueCents: 157500, issCents: 7500, receipt: null, inactive: false, attachments: [], createdAt: '2026-09-20T12:00:00.000Z' }]
    store.receivableSequence = 1
    // S5 (convênio: the statement does not say how) is still open; S3 (PIX) was already paid by hand.
    store.payables = [payable('PAG-000001', 35000), payable('PAG-000002', 20000, paid)]
    store.payableSequence = 2
    store.banks = [{ id: 'sicoob', name: 'Sicoob', agency: '3025', account: '9999-9' }]
  })
  const read = () => f.mutateStore((store) => structuredClone({ receivables: store.receivables, payables: store.payables, receivableEvents: store.receivableEvents || [], payableEvents: store.payableEvents || [] }))
  // The export shows gross value, ISS (expected while open) and net value.
  const exported = await fetch(`${f.url}/api/receivables/export`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'xlsx', filters: { status: 'all' } }) })
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()))
  const sheetRows = []
  workbook.eachSheet((sheet) => sheet.eachRow((row) => sheetRows.push(row.values.slice(1).map((cell) => cell?.result ?? cell))))
  const header = sheetRows.find((row) => row.includes('Valor líquido (R$)'))
  const line = sheetRows.find((row) => row[0] === 'REC-000001')
  assert.deepEqual(['Valor bruto (R$)', 'ISS retido (R$)', 'Valor líquido (R$)'].map((name) => Number(line[header.indexOf(name)])), [1575, 75, 1500])
  let state = (await request('/bank-statements')).data
  const byFit = (fitId) => state.transactions.find((row) => row.fitId === fitId)

  const candidates = (await request(`/bank-statements/transactions/${byFit('S1').id}/candidates`)).data.candidates
  assert.deepEqual(candidates.map((row) => [row.id, row.valueCents]), [['REC-000001', 150000]], 'the receivable is offered by its net value')
  for (const [fitId, kind, recordId] of [['S1', 'receivable', 'REC-000001'], ['S5', 'payable', 'PAG-000001'], ['S3', 'payable', 'PAG-000002']]) {
    assert.equal((await request(`/bank-statements/transactions/${byFit(fitId).id}/reconcile`, 'POST', { kind, recordId })).status, 200, fitId)
  }
  state = (await request('/bank-statements')).data
  const close = (body) => request('/bank-statements/closings', 'POST', { bankAccountId: batch.bankAccountId, month: '2026-10', note: 'PIX sem conta lançada.', ...body })

  const noMethod = await close({})
  assert.equal(noMethod.status, 400)
  assert.match(noMethod.data.message, /forma de pagamento ou recebimento de 1 baixa/)
  const methods = { [byFit('S5').id]: 'boleto' }
  const noBank = await close({ methods })
  assert.equal(noBank.status, 400, 'with banks registered, the statement account must be tied to one')
  assert.match(noBank.data.message, /não está ligada a um banco/)
  let after = await read()
  assert.equal(after.receivables[0].receipt, null, 'a refused closing settles nothing')
  assert.equal((await request(`/bank-statements/accounts/${batch.bankAccountId}/bank`, 'PUT', { bankId: 'sicoob' })).status, 200)

  const closed = await close({ methods })
  assert.equal(closed.status, 200)
  assert.equal(closed.data.item.summary.settled, 2)
  assert.deepEqual(closed.data.item.settlements.map((row) => [row.recordId, row.method, row.finalCents]), [['REC-000001', 'transfer', 150000], ['PAG-000001', 'boleto', 35000]])
  after = await read()
  const receipt = after.receivables[0].receipt
  assert.deepEqual([receipt.date, receipt.method, receipt.issCents, receipt.finalCents, receipt.bankId, receipt.reconciliation.closingId], ['2026-10-01', 'transfer', 7500, 150000, 'sicoob', 'CON-000001'])
  assert.match(receipt.note, /encerramento da conciliação bancária CON-000001/)
  assert.deepEqual([after.payables[0].payment.method, after.payables[0].payment.finalCents, after.payables[0].payment.bankId], ['boleto', 35000, 'sicoob'])
  assert.deepEqual(after.payables[1].payment, paid, 'an account already paid is not touched')
  assert.equal(after.receivableEvents.at(-1).type, 'received')
  assert.equal(after.payableEvents.at(-1).type, 'paid')
  assert.equal((await request('/receivables/REC-000001')).data.item.status, 'received')
  assert.equal((await request('/bank-statements')).data.settings.operationMethods['automatic-debit'], 'boleto', 'the way chosen for a convênio debit is remembered')
  state = (await request('/bank-statements')).data
  assert.equal(byFit('S1').reconciliation.record.settledBy, byFit('S1').id)
  assert.equal(byFit('S3').reconciliation.record.settledBy, null)

  // Reopened, undoing a link reverses the settlement the closing made, and only that one.
  assert.equal((await request('/bank-statements/closings/CON-000001/reopen', 'POST', { reason: 'Conferir os vínculos do mês.' })).status, 200)
  const undone = await request(`/bank-statements/transactions/${byFit('S1').id}/reconcile`, 'DELETE')
  assert.equal(undone.status, 200)
  assert.deepEqual([undone.data.reversed.recordId, undone.data.reversed.finalCents], ['REC-000001', 150000])
  const kept = await request(`/bank-statements/transactions/${byFit('S3').id}/reconcile`, 'DELETE')
  assert.equal(kept.data.reversed, null)
  after = await read()
  assert.equal(after.receivables[0].receipt, null)
  assert.equal(after.receivableEvents.at(-1).type, 'reversed')
  assert.match(after.receivableEvents.at(-1).reason, /Estorno automático/)
  assert.deepEqual(after.payables[1].payment, paid, 'the payment made by hand stays')
  assert.ok(after.payables[0].payment, 'the other settlement of the closing stays while its link stays')

  // Linked again and closed again: settled again; what is already settled is not settled twice.
  assert.equal((await request(`/bank-statements/transactions/${byFit('S1').id}/reconcile`, 'POST', { kind: 'receivable', recordId: 'REC-000001' })).status, 200)
  const again = await close({ note: 'PIX e tarifa sem conta lançada.' })
  assert.equal(again.status, 200)
  assert.equal(again.data.item.summary.settled, 1)
  assert.deepEqual(again.data.item.settlements.map((row) => row.recordId), ['REC-000001', 'PAG-000001', 'REC-000001'])
  assert.equal((await read()).receivables[0].receipt.reconciliation.closingId, 'CON-000001')
  // Deleting the closing keeps the links and the settlements.
  assert.equal((await request('/bank-statements/closings/CON-000001', 'DELETE')).status, 200)
  after = await read()
  assert.ok(after.receivables[0].receipt && after.payables[0].payment, 'settlements stay after the closing is deleted')
})
