import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createWorkflowFixture } from './workflowFixture.js'
import { parseOfx, parseOfxDate, amountCents, extractDocument, describeMemo, balanceKind } from '../server/ofx.js'
import { nameSimilarity } from '../server/bankStatements.js'
import { todayBahia } from '../server/payableRules.js'
import { sampleOfx, sampleRows } from './ofxSample.js'

const realFile = new URL('../Extrato_0443_988407_07-10-2026.ofx', import.meta.url)
test('OFX dates keep the bank day, amounts are exact cents and documents need valid punctuated CPF/CNPJ', () => {
  assert.deepEqual(parseOfxDate('20261001100000[-03:EST]'), { raw: '20261001100000[-03:EST]', date: '2026-10-01', time: '10:00:00', offset: '-03:00', zone: 'EST', instant: '2026-10-01T10:00:00-03:00' })
  assert.equal(parseOfxDate('20260231'), null)
  assert.equal(amountCents('-1000.00'), -100000); assert.equal(amountCents('2018.09'), 201809); assert.equal(amountCents('0.1'), 10); assert.equal(amountCents('1.005'), null); assert.equal(amountCents('abc'), null)
  assert.equal(extractDocument('PIX ENVIADO LOLA 061.930.835-45').digits, '06193083545')
  assert.equal(extractDocument('RECEBIMENTOS PLACO 00.700.460/0001-22').digits, '00700460000122')
  assert.equal(extractDocument('IOF 7314.39026-6/ C/C'), null)
  assert.equal(extractDocument('REFERENCIA 12345678901 06193083545'), null, 'Loose digit runs are not documents')
  assert.equal(extractDocument('PIX ENVIADO 111.111.111-11'), null, 'Invalid check digits are rejected')
  assert.equal(balanceKind('Saldo  total disponivel   dia'), 'daily')
  assert.equal(balanceKind('SALDO EM CONTA REMUNERADA'), null, 'Only the specific balance memos are balances')
  const pix = describeMemo('PIX RECEBIDO ANDRÉ F01/10 ANDRÉ FRÓES CORDEIRO GALVÃO 008.871.825-50')
  assert.deepEqual([pix.operationType, pix.counterpartyName, pix.counterpartyReference, pix.counterpartyDocument], ['pix-received', 'ANDRÉ FRÓES CORDEIRO GALVÃO', 'ANDRÉ F01/10', '00887182550'])
  const ted = describeMemo('TED RECEBIDA 237.3391.ARMAC L L E ARMAC LOCACAO, LOGISTICA E SERVICOS LTDA 00.242.184/0001-04')
  assert.equal(ted.counterpartyReference, '237.3391')
  for (const memo of ['SISPAG SALARIOS', 'IOF', 'AQUISICAO FORNECEDORES']) assert.equal(describeMemo(memo).counterpartyName, null, `${memo} must not invent a payee`)
  assert.ok(nameSimilarity('RIOS RIOS SC LTDA RIOS RIOS SC LTDA', 'Rios & Rios SC') >= 0.6)
})

test('balance records are separated, daily closings include movements after the balance record and divergence is reported', () => {
  const parsed = parseOfx(Buffer.from(sampleOfx(sampleRows), 'utf8'))
  assert.equal(parsed.records.length, 8); assert.equal(parsed.balances.length, 2); assert.equal(parsed.transactions.length, 6)
  assert.ok(parsed.transactions.some((row) => row.memo === 'SALDO EM CONTA REMUNERADA'))
  assert.equal(parsed.validation.days[0].closingCents, 85000); assert.equal(parsed.validation.days[0].matches, true)
  assert.equal(parsed.validation.computedFinalCents, 85900); assert.equal(parsed.validation.differenceCents, 18)
  assert.equal(parsed.transactions.filter((row) => row.amountCents === -80000).length, 2)
  assert.equal(parsed.warnings[0].code, 'encoding-mismatch')
  const legacy = parseOfx(Buffer.from(sampleOfx(sampleRows), 'latin1'))
  assert.equal(legacy.encoding, 'windows-1252'); assert.equal(legacy.balances[1].memo, 'SALDO TOTAL DISPONÍVEL DIA')
  assert.ok(legacy.warnings.some((warning) => warning.code === 'encoding-fallback'))
  const inconsistent = parseOfx(Buffer.from(sampleOfx([...sampleRows, ['DEBIT', '20261002', '5.00', 'T8', 'PIX ENVIADO TESTE']]), 'utf8'))
  const row = inconsistent.transactions.find((item) => item.fitId === 'T8')
  assert.equal(row.amountCents, 500, 'The sign is never inverted'); assert.equal(row.consistency, 'debit-positive')
  assert.ok(inconsistent.warnings.some((warning) => warning.code === 'type-sign-mismatch'))
})

test('the October statement meets the acceptance totals', { skip: !existsSync(realFile) && 'Extrato real não versionado' }, () => {
  const parsed = parseOfx(readFileSync(realFile))
  const v = parsed.validation
  assert.equal(parsed.records.length, 89); assert.equal(parsed.balances.length, 5); assert.equal(parsed.transactions.length, 84)
  assert.deepEqual([v.creditCount, v.debitCount, v.creditsCents, v.debitsCents, v.openingCents, v.openingDate], [16, 68, 23061815, 17422055, 201809, '2026-09-30'])
  assert.deepEqual([v.computedFinalCents, v.ledgerCents, v.differenceCents], [5841569, 5841587, 18])
  assert.deepEqual(v.days.map((day) => [day.date, day.closingCents, day.matches]), [['2026-10-01', 3804395, true], ['2026-10-02', 3775498, true], ['2026-10-05', 5257921, true], ['2026-10-06', 5588517, true], ['2026-10-07', 5841569, null]])
  assert.deepEqual([parsed.statement.bankId, parsed.statement.accountId, parsed.statement.currency], ['0341', '0443988407', 'BRL'])
  assert.ok(parsed.balances.some((row) => row.memo === 'SALDO TOTAL DISPONÍVEL DIA'))
  assert.ok(parsed.transactions.every((row) => row.checkNum === row.fitId)); assert.equal(new Set(parsed.transactions.map((row) => row.fitId)).size, 84)
  assert.equal(parsed.transactions.filter((row) => row.bankDate === '2026-10-05' && row.amountCents === -80000).length, 2)
})

test('imports are idempotent per account and FITID, conflicts are kept for review and reconciliation needs exact, unique links', async () => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const headers = { Authorization: `Bearer ${token}` }
    const request = (route, method, body) => f.request(route, method, body, headers)
    async function upload(text, name = 'extrato.ofx') { const response = await fetch(`${f.url}/api/bank-statements/import?name=${name}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: Buffer.from(text, 'utf8') }); return { status: response.status, data: await response.json() } }
    assert.equal((await f.request('/bank-statements')).status, 401)
    const first = await upload(sampleOfx(sampleRows)); assert.equal(first.status, 201)
    assert.deepEqual([first.data.item.counts.new, first.data.item.counts.existing, first.data.item.counts.balancesNew], [6, 0, 2])
    assert.equal(first.data.item.warnings[0].message, 'Divergência de saldo do extrato: R$ 0,18.')
    const again = await upload(sampleOfx(sampleRows)); assert.deepEqual([again.data.item.counts.new, again.data.item.counts.existing], [0, 6]); assert.deepEqual(again.data.item.sameFileImportIds, [first.data.item.id])
    const changed = await upload(sampleOfx(sampleRows.map((row) => row[3] === 'T1' ? [...row.slice(0, 2), '501.00', ...row.slice(3)] : row)))
    assert.equal(changed.data.item.counts.conflicts, 1)
    const otherAccount = await upload(sampleOfx(sampleRows, '859.18', '0009999999')); assert.equal(otherAccount.data.item.counts.new, 6, 'FITID is scoped by account')
    let state = (await request('/bank-statements')).data
    assert.equal(state.transactions.length, 12); assert.equal(state.balances.length, 4)
    assert.equal(state.transactions.find((row) => row.fitId === 'T1' && row.bankAccountId === first.data.item.bankAccountId).amountCents, 50000, 'Conflicts never overwrite')
    assert.equal(state.conflicts.filter((row) => row.status === 'open').length, 1)
    assert.equal((await request(`/bank-statements/conflicts/${state.conflicts[0].id}/review`, 'POST', {})).status, 200)
    const category = (await request('/classifications', 'POST', { name: 'Beneficios' })).data.item
    const sodexo = (await request('/suppliers', 'POST', { name: 'Sodexo Pass do Brasil', document: '49930514000135' })).data.item
    const quimica = (await request('/suppliers', 'POST', { name: 'Fornecedor quimico', document: '12345678000190' })).data.item
    const payable = (supplier) => request('/payables', 'POST', { supplierId: supplier.id, classificationId: category.id, issueDate: todayBahia(), value: '800.00', dueDate: '2026-10-01', kind: 'normal' })
    const sodexoBill = (await payable(sodexo)).data.items[0], quimicaBill = (await payable(quimica)).data.items[0]
    const ours = state.transactions.filter((row) => row.bankAccountId === first.data.item.bankAccountId)
    const pixSodexo = ours.find((row) => row.fitId === 'T2'), boleto = ours.find((row) => row.fitId === 'T3')
    let suggestions = (await request(`/bank-statements/transactions/${pixSodexo.id}/candidates`)).data
    assert.deepEqual(suggestions.candidates.map((row) => [row.id, row.level]), [[sodexoBill.id, 1], [quimicaBill.id, 4]])
    assert.equal(suggestions.ambiguous, false)
    suggestions = (await request(`/bank-statements/transactions/${boleto.id}/candidates`)).data
    assert.equal(suggestions.ambiguous, true, 'Two same-value, same-day bills without a document are left for review')
    assert.equal((await request(`/bank-statements/transactions/${pixSodexo.id}/reconcile`, 'POST', { kind: 'receivable', recordId: sodexoBill.id })).status, 400)
    assert.equal((await request(`/bank-statements/transactions/${pixSodexo.id}/reconcile`, 'POST', { kind: 'payable', recordId: sodexoBill.id })).status, 200)
    assert.equal((await request(`/bank-statements/transactions/${boleto.id}/reconcile`, 'POST', { kind: 'payable', recordId: sodexoBill.id })).status, 409, 'A record cannot back two full reconciliations')
    assert.equal((await request(`/payables/${sodexoBill.id}`, 'DELETE')).status, 409)
    assert.deepEqual((await request(`/bank-statements/transactions/${boleto.id}/candidates`)).data.candidates.map((row) => row.id), [quimicaBill.id])
    assert.equal((await request(`/bank-statements/transactions/${pixSodexo.id}/reconcile`, 'DELETE')).status, 200)
    const receivable = await request('/receivables', 'POST', { customerName: 'Cliente Teste Ltda', customerDocument: '11222333000181', value: '500.00', dueDate: '2026-10-03' })
    assert.equal(receivable.status, 201)
    const credit = ours.find((row) => row.fitId === 'T1')
    suggestions = (await request(`/bank-statements/transactions/${credit.id}/candidates`)).data
    assert.deepEqual(suggestions.candidates.map((row) => [row.id, row.level]), [[receivable.data.item.id, 2]])
    state = (await request('/bank-statements')).data
    assert.equal(state.transactions.filter((row) => row.reconciliation).length, 0)
  } finally { await f.close() }
})

test('receivables follow OS completion, receipts, reversal reasons and duplicate rules', async () => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const request = (route, method, body) => f.request(route, method, body, { Authorization: `Bearer ${token}` })
    assert.equal((await f.request('/receivables')).status, 401)
    await f.mutateStore((store) => { store.orders = [{ code: 'OS-2026-0001', offerId: 'offer', company: 'Cliente da OS', cnpj: '11.222.333/0001-81', service: 'Usinagem', proposal: { serviceValue: 1250.5, discount: 10 }, operation: { status: 'completed' } }, { code: 'OS-2026-0002', company: 'Outro', service: 'Pintura', proposal: { serviceValue: 100 }, operation: { status: 'running' } }] })
    const info = (await request('/receivables/order/OS-2026-0001')).data
    assert.deepEqual([info.order.serviceCents, info.order.valueCents, info.item], [125050, 112545, null])
    assert.equal((await request('/receivables', 'POST', { orderCode: 'OS-2026-0002', value: '100', dueDate: '2026-11-10' })).status, 409)
    const created = await request('/receivables', 'POST', { orderCode: 'OS-2026-0001', value: '1100.00', dueDate: '2026-11-10' })
    assert.equal(created.status, 201)
    assert.deepEqual([created.data.item.id, created.data.item.customerDocument, created.data.item.valueCents, created.data.item.origin], ['REC-000001', '11222333000181', 110000, 'order'])
    assert.equal((await request('/receivables', 'POST', { orderCode: 'OS-2026-0001', value: '1100.00', dueDate: '2026-11-10' })).status, 409)
    assert.equal((await request('/receivables/order/OS-2026-0001')).data.item.id, 'REC-000001')
    const manual = { customerName: 'Cliente avulso', value: '50.10', dueDate: '2026-11-11' }
    assert.equal((await request('/receivables', 'POST', manual)).status, 201)
    assert.equal((await request('/receivables', 'POST', manual)).status, 409)
    assert.equal((await request('/receivables', 'POST', { ...manual, customerDocument: '123' })).status, 400)
    assert.equal((await request('/receivables/REC-000001/receive', 'POST', { date: '2099-01-01', method: 'pix' })).status, 400)
    const received = await request('/receivables/REC-000001/receive', 'POST', { date: todayBahia(), method: 'transfer', interest: '5' })
    assert.equal(received.data.item.receipt.finalCents, 110500); assert.equal(received.data.item.status, 'received')
    assert.equal((await request('/receivables/REC-000001', 'PUT', { value: '1', dueDate: '2026-11-10' })).status, 409)
    assert.equal((await request('/receivables/REC-000001/reverse', 'POST', { reason: 'curto' })).status, 400)
    assert.equal((await request('/receivables/REC-000001/reverse', 'POST', { reason: 'Recebimento lançado em duplicidade' })).status, 200)
    assert.equal((await request('/receivables/REC-000001', 'DELETE')).status, 409, 'History with receipts is preserved')
    const detail = (await request('/receivables/REC-000001')).data
    assert.deepEqual(detail.history.map((row) => row.type), ['reversed', 'received', 'created'])
    const exported = await fetch(`${f.url}/api/receivables/export`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'xlsx', filters: { status: 'all' } }) })
    assert.equal(exported.status, 200)
  } finally { await f.close() }
})
