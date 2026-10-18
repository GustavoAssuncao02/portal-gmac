import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { parseOfx } from '../server/ofx.js'
import { sicoobOfx } from './ofxSample.js'

test('both Sicoob models are read alike: closed tags, Windows-1252 accents, short memos and <NAME> as counterparty', () => {
  const money = parseOfx(sicoobOfx('\r\n')), unix = parseOfx(sicoobOfx('\n'))
  const summary = (parsed) => parsed.transactions.map((row) => [row.fitId, row.amountCents, row.bankDate, row.memo, row.operationType, row.counterpartyName, row.counterpartyReference])
  assert.deepEqual(summary(money), summary(unix))
  assert.deepEqual(summary(money), [
    ['S1', 150000, '2026-10-01', 'CRÉD.TED-STR', 'ted-received', 'CLIENTE EXEMPLO INDUSTRIA E COM', null],
    ['S2', -100000, '2026-10-01', 'RDC AUTOMÁTICO', 'investment', null, null],
    ['S3', -20000, '2026-10-01', 'PIX EMITIDO OUTRA IF', 'pix-sent', null, '***.123.456-**'],
    ['S4', 100000, '2026-10-01', 'RESGATE RDC AUTOMÁTICO', 'investment-redemption', null, null],
    ['S5', -35000, '2026-10-01', 'DÉB.CONV.DEMAIS EMPRESAS', 'automatic-debit', null, null],
  ])
  assert.equal(money.encoding, 'windows-1252')
  assert.deepEqual([money.statement.bankId, money.statement.branchId, money.statement.accountId, money.statement.ledgerBalance.cents, money.balances.length], ['756', '0001-0', '12345-6', 95000, 0])
  assert.equal(money.transactions[0].posted.offset, '-03:00')
})

test('several Sicoob files go in as separate batches of one account; "Conciliar tudo" leaves the RDC application and redemption out', async () => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const headers = { Authorization: `Bearer ${token}` }
    const upload = async (bytes, name) => { const response = await fetch(`${f.url}/api/bank-statements/import?name=${name}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: bytes }); return { status: response.status, data: await response.json() } }
    const first = await upload(sicoobOfx('\r\n'), 'extrato-money.ofx'), second = await upload(sicoobOfx('\n'), 'extrato-unix.ofx')
    assert.deepEqual([first.status, first.data.item.counts.new, second.status, second.data.item.counts.new, second.data.item.counts.existing], [201, 5, 201, 0, 5], 'the two models of the same period are the same movements')
    assert.equal(first.data.item.bankAccountId, second.data.item.bankAccountId)
    // No balance records is the format of this bank: an information, not a warning.
    assert.equal(first.data.item.warnings.find((row) => row.code === 'no-opening-balance').level, 'info')
    await f.mutateStore((store) => {
      const receivable = (id, customerName, valueCents) => ({ id, origin: 'manual', kind: 'single', customerName, customerDocument: null, description: '', documentNumber: '', issueDate: '2026-09-20', dueDate: '2026-10-01', valueCents, receipt: null, inactive: false, createdAt: '2026-09-20T12:00:00.000Z' })
      store.receivables = [receivable('REC-000001', 'Cliente Exemplo Indústria e Comércio Ltda', 150000), receivable('REC-000002', 'Outro cliente', 100000)]
      store.receivableSequence = 2
    })
    const state = (await f.request('/bank-statements', 'GET', undefined, headers)).data
    const ted = state.transactions.find((row) => row.fitId === 'S1')
    const candidates = (await f.request(`/bank-statements/transactions/${ted.id}/candidates`, 'GET', undefined, headers)).data.candidates
    assert.deepEqual(candidates.map((row) => [row.id, row.level]), [['REC-000001', 3]], 'the <NAME> finds the customer by name')
    const linked = (await f.request('/bank-statements/reconcile-all', 'POST', {}, headers)).data.items
    assert.deepEqual(linked.map((row) => [row.fitId, row.reconciliation.recordId]), [['S1', 'REC-000001']], 'the R$ 1.000,00 redemption is not tied to the R$ 1.000,00 bill')
  } finally { await f.close() }
})
