import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { createWorkflowFixture } from './workflowFixture.js'
import { filterPayables, dueLabel, todayBahia } from '../server/payableRules.js'

test('search finds accounts by value as typed in Brazil and by supplier CPF/CNPJ; due labels use the right plural', () => {
  const rows = [{ id: 'PAG-000001', supplierName: 'Fornecedor A', supplierDocument: '12345678000190', description: 'Chapas', documentNumber: 'NF1', valueCents: 123456, dueDate: '2026-10-10' }, { id: 'PAG-000002', supplierName: 'Fornecedor B', supplierDocument: '98765432000110', description: 'Frete', documentNumber: 'NF2', valueCents: 5000, dueDate: '2026-10-10' }]
  const found = (search) => filterPayables(rows, { search, status: 'all' }, '2026-10-01').map((row) => row.id)
  for (const value of ['1.234,56', '1234,56', '1234.56', 'R$ 1.234,56']) assert.deepEqual(found(value), ['PAG-000001'], value)
  assert.deepEqual(found('12.345.678/0001-90'), ['PAG-000001'])
  assert.deepEqual(found('98765432'), ['PAG-000002'])
  assert.deepEqual(found('50,00'), ['PAG-000002'])
  assert.deepEqual(found('7.777,77'), [])
  assert.deepEqual([-2, -1, 0, 1, 2].map(dueLabel), ['Vencida há 2 dias', 'Vencida há 1 dia', 'Vence hoje', 'Vence em 1 dia', 'Vence em 2 dias'])
})

test('the Tipo da conta filter keeps only normal, installment or recurring accounts (accounts without a type count as normal)', () => {
  const rows = [{ id: 'PAG-000001', kind: 'normal' }, { id: 'PAG-000002', kind: 'installment' }, { id: 'PAG-000003', kind: 'recurring' }, { id: 'PAG-000004' }].map((row) => ({ ...row, supplierName: 'Fornecedor', description: '', documentNumber: '', valueCents: 1000, dueDate: '2026-10-10' }))
  const found = (kind) => filterPayables(rows, { kind, status: 'all' }, '2026-10-01').map((row) => row.id)
  assert.deepEqual(found(''), ['PAG-000001', 'PAG-000002', 'PAG-000003', 'PAG-000004'])
  assert.deepEqual(found('normal'), ['PAG-000001', 'PAG-000004'])
  assert.deepEqual(found('installment'), ['PAG-000002'])
  assert.deepEqual(found('recurring'), ['PAG-000003'])
})

test('the Excel of Contas a Pagar has Completo and Resumo: interest or discount of the payment, net value and a TOTAL line', async () => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const row = (id, extra) => ({ id, supplierId: 's1', supplierName: 'Fornecedor Teste', classificationId: 'c1', classificationName: 'Aluguel', issueDate: '2026-11-01', kind: 'normal', attachments: [], ...extra })
    await f.mutateStore((store) => {
      store.suppliers = [{ id: 's1', name: 'Fornecedor Teste', document: '12345678000190' }]
      store.payables = [
        row('PAG-000001', { description: 'Aluguel', documentNumber: 'B1', valueCents: 100000, dueDate: '2026-12-10' }),
        row('PAG-000002', { description: 'Frete', documentNumber: 'B2', valueCents: 20000, dueDate: '2026-11-05', payment: { date: '2026-11-06', method: 'pix', interestCents: 350, discountCents: 0, finalCents: 20350 } }),
        row('PAG-000003', { description: 'Chapas', documentNumber: '', valueCents: 50000, dueDate: '2026-11-04', payment: { date: '2026-11-04', method: 'pix', interestCents: 0, discountCents: 1000, finalCents: 49000 } }),
      ]
    })
    const workbook = async (body) => {
      const response = await fetch(`${f.url}/api/payables/export`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'xlsx', filters: { status: 'all' }, ...body }) })
      assert.equal(response.status, 200)
      const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await response.arrayBuffer()))
      return { sheet: book.worksheets[0], name: response.headers.get('content-disposition') }
    }
    const values = (sheet) => sheet.getSheetValues().slice(1).map((line) => line.slice(1))
    const summary = await workbook({ variant: 'summary' })
    assert.match(summary.name, /gmac-contas-a-pagar-resumo\.xlsx/)
    assert.deepEqual(values(summary.sheet), [
      ['Fornecedor', 'Descrição', 'Documento', 'Valor bruto (R$)', 'Juros/Desconto (R$)', 'Valor líquido (R$)', 'Vencimento'],
      ['Fornecedor Teste', 'Aluguel', 'B1', 1000, '', 1000, '10/12/2026'],
      ['Fornecedor Teste', 'Frete', 'B2', 200, 3.5, 203.5, '05/11/2026'],
      ['Fornecedor Teste', 'Chapas', '', 500, -10, 490, '04/11/2026'],
      ['TOTAL', '3 contas', '', 1700, -6.5, 1693.5, ''],
    ])
    assert.equal(summary.sheet.getRow(5).font.bold, true)
    assert.deepEqual(values((await workbook({ variant: 'summary', ids: ['PAG-000002'] })).sheet).at(-1), ['TOTAL', '1 conta', '', 200, 3.5, 203.5, ''])
    const full = await workbook({})
    assert.match(full.name, /gmac-contas-a-pagar\.xlsx/)
    assert.equal(values(full.sheet)[0].length, 19, 'Completo keeps every column')
    assert.equal(values(full.sheet).length, 4, 'no TOTAL line in Completo')
  } finally { await f.close() }
})

test('recurring accounts can be generated ahead, OS links are validated and the OS real cost and margin add up', async () => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const request = (route, method, body) => f.request(route, method, body, { Authorization: `Bearer ${token}` })
    await f.mutateStore((store) => { store.orders = [{ code: 'OS-2026-0001', service: 'Eixo usinado', company: 'Cliente', proposal: { serviceValue: 1000, discount: 10, materials: 300, labor: 200, margin: 25 }, operation: { status: 'completed' } }] })
    const supplier = (await request('/suppliers', 'POST', { name: 'Aluguel Galpao', document: '12345678000190' })).data.item
    const category = (await request('/classifications', 'POST', { name: 'Aluguel' })).data.item
    const base = { supplierId: supplier.id, classificationId: category.id, issueDate: todayBahia(), value: '1500.00', dueDate: '2026-01-31', kind: 'recurring', recurrence: 'monthly' }
    assert.equal((await request('/payables', 'POST', { ...base, ahead: 1201 })).status, 400)
    const series = await request('/payables', 'POST', { ...base, ahead: 11 })
    assert.equal(series.status, 201)
    const rows = series.data.items
    assert.equal(rows.length, 12)
    assert.deepEqual(rows.slice(0, 3).map((row) => row.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31'], 'Month ends are clamped without drifting')
    assert.equal(rows.at(-1).dueDate, '2026-12-31')
    assert.equal(new Set(rows.map((row) => row.seriesId)).size, 1)
    assert.deepEqual([rows[0].seriesIndex, rows[0].seriesCount, rows[11].seriesIndex], [1, 12, 12])
    const yearly = (await request('/payables', 'POST', { ...base, value: '900', recurrence: 'yearly', ahead: 1 })).data.items
    assert.deepEqual(yearly.map((row) => row.dueDate), ['2026-01-31', '2027-01-31'])
    assert.equal((await request('/payables', 'POST', { ...base, kind: 'normal', value: '10', dueDate: '2026-05-05', orderCode: 'OS-0000' })).status, 400)
    const steel = (await request('/payables', 'POST', { ...base, kind: 'normal', value: '400', dueDate: '2026-05-05', orderCode: 'OS-2026-0001', description: 'Aco' })).data.items[0]
    const freight = (await request('/payables', 'POST', { ...base, kind: 'normal', value: '120.50', dueDate: '2026-05-06', orderCode: 'OS-2026-0001', description: 'Frete' })).data.items[0]
    await request(`/payables/${steel.id}/pay`, 'POST', { date: todayBahia(), method: 'pix', interest: '10' })
    const costs = (await request('/payables/order-costs/OS-2026-0001')).data.item
    // The cost planned in the proposal is already posted; the linked accounts are what came up beyond it.
    assert.deepEqual([costs.valueCents, costs.estimatedCostCents, costs.extraCostCents, costs.costCents, costs.paidCostCents, costs.pendingCostCents, costs.marginCents, costs.marginPercent, costs.expectedMarginPercent], [90000, 50000, 53050, 103050, 41000, 12050, -13050, -12.7, 25])
    assert.deepEqual(costs.payables.map((row) => row.id).sort(), [steel.id, freight.id].sort())
    const list = (await request('/payables/order-costs')).data.items
    assert.equal(list.find((row) => row.code === 'OS-2026-0001').payableCount, 2)
    assert.equal((await request('/payables')).data.orders[0].code, 'OS-2026-0001')
    assert.equal((await request('/payables')).data.items.find((row) => row.id === steel.id).supplierDocument, '12345678000190')
    assert.equal((await request('/payables/order-costs/OS-9999')).status, 404)
  } finally { await f.close() }
})

test('a payable is deleted alone or with the rest of its installment plan / recurring series; paid ones stay', async () => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const request = (route, method, body) => f.request(route, method, body, { Authorization: `Bearer ${token}` })
    const supplier = (await request('/suppliers', 'POST', { name: 'Receita', document: '12345678000190' })).data.item
    const category = (await request('/classifications', 'POST', { name: 'Parcelamentos' })).data.item
    const base = { supplierId: supplier.id, classificationId: category.id, issueDate: todayBahia(), value: '300.00', dueDate: '2026-12-10' }
    const ids = async () => (await request('/payables')).data.items.map((row) => row.id)

    // More than 24 occurrences ahead can be generated now.
    const series = (await request('/payables', 'POST', { ...base, kind: 'recurring', recurrence: 'monthly', ahead: 137 })).data.items
    assert.equal(series.length, 138)
    assert.equal((await request(`/payables/${series[0].id}`)).data.deleteOthers, 137)
    // Only this one: the rest of the series is numbered again.
    assert.deepEqual((await request(`/payables/${series[1].id}?scope=one`, 'DELETE')).data.removed, [series[1].id])
    assert.equal((await request(`/payables/${series[2].id}`)).data.item.seriesCount, 137)
    // A paid occurrence stays when the others go.
    assert.equal((await request(`/payables/${series[0].id}/pay`, 'POST', { date: todayBahia(), method: 'pix' })).status, 200)
    assert.equal((await request(`/payables/${series[0].id}`)).data.canDelete, false)
    assert.equal((await request(`/payables/${series[3].id}?scope=all`, 'DELETE')).data.removed.length, 136)
    assert.deepEqual((await ids()).filter((id) => series.some((row) => row.id === id)), [series[0].id])

    // Installments: one goes and the plan is renumbered; then the rest goes together.
    const parts = (await request('/payables', 'POST', { ...base, kind: 'installment', count: 3 })).data.items
    assert.equal((await request(`/payables/${parts[0].id}`)).data.canDelete, true)
    await request(`/payables/${parts[1].id}?scope=one`, 'DELETE')
    const left = (await request(`/payables/${parts[2].id}`)).data.item
    assert.deepEqual([left.installmentNumber, left.installmentCount, left.originalTotalCents], [2, 2, 20000])
    assert.equal((await request(`/payables/${parts[0].id}?scope=all`, 'DELETE')).data.removed.length, 2)
    assert.ok(!(await ids()).some((id) => parts.some((row) => row.id === id)))
  } finally { await f.close() }
})

// Ações em massa: Excluir, Desfazer baixa e Alterar classificação, each account with the rule of the individual action.
test('bulk actions in Contas a Pagar: preview with the blocked accounts and why, all or nothing, history marked', async () => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const bulk = (body) => f.request('/payables/bulk', 'POST', body, { Authorization: `Bearer ${token}` })
    const paid = (finalCents, date = '2026-11-05') => ({ date, method: 'pix', interestCents: 0, discountCents: 0, finalCents, bankName: 'Banco Teste', receipts: [] })
    const row = (id, extra) => ({ id, supplierId: 's1', supplierName: 'Fornecedor Teste', classificationId: 'c1', classificationName: 'Juros de tributos', description: id, documentNumber: '', issueDate: '2026-11-01', dueDate: '2026-12-01', kind: 'normal', valueCents: 10000, attachments: [], ...extra })
    await f.mutateStore((store) => {
      store.suppliers = [{ id: 's1', name: 'Fornecedor Teste', document: '12345678000190' }]
      store.classifications = [{ id: 'c1', name: 'Juros de tributos' }, { id: 'c2', name: 'Parcelamentos tributários' }, { id: 'r1', name: 'Receita', dreLine: 'gross_revenue' }]
      store.payables = [
        row('PAG-000001'),
        row('PAG-000002', { kind: 'recurring', seriesId: 'serie', seriesIndex: 1, seriesCount: 2, dueDate: '2026-12-10' }),
        row('PAG-000003', { kind: 'recurring', seriesId: 'serie', seriesIndex: 2, seriesCount: 2, dueDate: '2027-01-10', previousId: 'PAG-000002' }),
        row('PAG-000004', { payment: paid(10000) }),
        row('PAG-000005', { kind: 'installment', groupId: 'plano', installmentNumber: 1, installmentCount: 2, originalTotalCents: 30000, valueCents: 15000 }),
        row('PAG-000006', { kind: 'installment', groupId: 'plano', installmentNumber: 2, installmentCount: 2, originalTotalCents: 30000, valueCents: 15000, dueDate: '2027-01-01' }),
        row('PAG-000007', { classificationSplit: [{ classificationId: 'c1', classificationName: 'Juros de tributos', valueCents: 6000 }, { classificationId: 'c2', classificationName: 'Parcelamentos tributários', valueCents: 4000 }] }),
        row('PAG-000008', { treasury: true, payment: paid(10000) }),
        // A final payment of PAG-000009 and its partial payment PAG-000010.
        row('PAG-000009', { valueCents: 6000, partialPaidCents: 4000, partialIds: ['PAG-000010'], payment: paid(6000, '2026-11-10') }),
        row('PAG-000010', { valueCents: 4000, partialOf: 'PAG-000009', payment: paid(4000, '2026-11-03') }),
      ]
    })
    const ids = (...numbers) => numbers.map((number) => `PAG-${String(number).padStart(6, '0')}`)
    const preview = async (body) => { const response = await bulk({ ...body, preview: true }); assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data.preview }

    // Excluir: the paid account and the recurring one whose next account stays are listed with the reason.
    const deletion = await preview({ action: 'delete', ids: ids(1, 2, 4, 5) })
    assert.deepEqual([deletion.total, deletion.count, deletion.ids, deletion.amounts], [4, 2, ids(1, 5), { totalCents: 25000 }])
    assert.deepEqual(deletion.blocked.map((item) => [item.id, item.name, item.valueCents, item.reason]), [
      ['PAG-000002', 'Fornecedor Teste', 10000, 'Conta com recorrência seguinte vinculada: exclua antes a conta seguinte.'],
      ['PAG-000004', 'Fornecedor Teste', 10000, 'Conta com pagamento: preserve o histórico; desative quando paga.'],
    ])
    // With the next account in the selection too, the recurrence leaves in the right order.
    const series = await preview({ action: 'delete', ids: ids(1, 2, 3, 4, 5) })
    assert.deepEqual(series.ids, ids(1, 2, 3, 5))
    assert.ok(series.facts.includes('1 recorrência fica sem lançamentos em aberto'), series.facts.join(' | '))
    assert.ok(series.facts.includes('Vencimentos de 01/12/2026 a 10/01/2027'))
    assert.ok(series.facts.includes('Fornecedor: Fornecedor Teste (4)'))
    // A confirmation of another preview saves nothing and brings the current one.
    const stale = await bulk({ action: 'delete', ids: ids(1, 2, 3, 4, 5), token: deletion.token })
    assert.deepEqual([stale.status, stale.data.code, stale.data.preview.token], [409, 'BULK_CHANGED', series.token])
    assert.equal((await f.request('/payables', 'GET', undefined, { Authorization: `Bearer ${token}` })).data.items.length, 10, 'nothing deleted')
    const deleted = await bulk({ action: 'delete', ids: ids(1, 2, 3, 4, 5), token: series.token })
    assert.deepEqual([deleted.status, deleted.data.count, deleted.data.ids], [200, 4, ids(1, 2, 3, 5)])
    let store = await f.mutateStore((current) => structuredClone(current))
    assert.deepEqual(store.payables.map((item) => item.id), ids(4, 6, 7, 8, 9, 10))
    const rest = store.payables.find((item) => item.id === 'PAG-000006')
    assert.deepEqual([rest.installmentNumber, rest.installmentCount, rest.originalTotalCents], [1, 1, 15000], 'the plan is numbered again')
    const deletedEvents = store.payableEvents.filter((item) => item.type === 'deleted')
    assert.deepEqual(deletedEvents.map((item) => [item.accountId, item.details.bulk, item.details.text, item.userName]), ids(1, 2, 3, 5).map((id) => [id, true, 'Exclusão em massa (4 contas)', 'Gustavo']))

    // Alterar classificação: split and Tesouraria accounts stay as they are; an account changed after the preview stops it.
    assert.equal((await bulk({ action: 'classify', ids: ids(6), classificationId: 'r1', preview: true })).status, 400, 'a revenue classification does not fit money out')
    const classify = await preview({ action: 'classify', ids: ids(4, 6, 7, 8), classificationId: 'c2' })
    assert.deepEqual([classify.ids, classify.blocked.map((item) => [item.id, item.reason])], [ids(6), [['PAG-000004', 'Conta paga: desfaça a baixa antes de alterar a classificação.'], ['PAG-000007', 'Classificação dividida: altere na conta.'], ['PAG-000008', 'Lançamento da Tesouraria: altere na conta.']]])
    assert.deepEqual(classify.facts.slice(0, 2), ['Nova classificação: Parcelamentos tributários', 'Classificação atual: Juros de tributos (1)'])
    await f.mutateStore((current) => { current.payables.find((item) => item.id === 'PAG-000006').valueCents = 15500 })
    const changed = await bulk({ action: 'classify', ids: ids(4, 6, 7, 8), classificationId: 'c2', token: classify.token })
    assert.deepEqual([changed.status, changed.data.code], [409, 'BULK_CHANGED'])
    assert.equal((await f.mutateStore((current) => structuredClone(current))).payables.find((item) => item.id === 'PAG-000006').classificationId, 'c1')
    const classified = await bulk({ action: 'classify', ids: ids(4, 6, 7, 8), classificationId: 'c2', token: changed.data.preview.token })
    assert.deepEqual([classified.status, classified.data.ids], [200, ids(6)])
    store = await f.mutateStore((current) => structuredClone(current))
    assert.deepEqual(store.payables.filter((item) => ['PAG-000006', 'PAG-000007'].includes(item.id)).map((item) => [item.classificationId, item.classificationName]), [['c2', 'Parcelamentos tributários'], ['c1', 'Juros de tributos']])
    assert.equal(store.payableEvents.at(-1).details.text, 'Classificação alterada em massa: Juros de tributos → Parcelamentos tributários')

    // Desfazer baixa: a reason for all; a partial payment waits for the final payment of its account, unless both go.
    assert.equal((await bulk({ action: 'reverse', ids: ids(4), reason: 'curto', token: 'qualquer' })).status, 400)
    assert.equal((await bulk({ action: 'reverse', ids: ids(4), preview: true })).status, 200, 'the preview comes before the reason')
    const reason = 'Baixas lançadas no banco errado'
    const alone = await preview({ action: 'reverse', ids: ids(6, 10), reason })
    assert.deepEqual([alone.count, alone.blocked.map((item) => [item.id, item.reason])], [0, [['PAG-000006', 'Conta sem baixa.'], ['PAG-000010', 'Baixa parcial de PAG-000009: desfaça antes a baixa final de PAG-000009.']]])
    assert.equal((await bulk({ action: 'reverse', ids: ids(6, 10), reason, token: alone.token })).status, 409, 'nothing to do')
    const both = await preview({ action: 'reverse', ids: ids(4, 9, 10), reason })
    assert.deepEqual([both.ids, both.amounts.totalCents], [ids(4, 9, 10), 20000])
    assert.ok(both.facts.includes('Baixas de 03/11/2026 a 10/11/2026'))
    assert.ok(both.facts.includes('Banco: Banco Teste (3)'))
    assert.equal((await bulk({ action: 'reverse', ids: ids(4, 9, 10), reason, token: both.token })).status, 200)
    store = await f.mutateStore((current) => structuredClone(current))
    const parent = store.payables.find((item) => item.id === 'PAG-000009')
    assert.deepEqual([parent.payment, parent.valueCents, parent.partialPaidCents, store.payables.some((item) => item.id === 'PAG-000010'), store.payables.find((item) => item.id === 'PAG-000004').payment], [null, 10000, undefined, false, null])
    assert.deepEqual(store.payableEvents.filter((item) => item.type === 'reversed').map((item) => [item.accountId, item.reason, item.details.bulk]), [['PAG-000004', reason, true], ['PAG-000009', reason, true], ['PAG-000010', reason, true]])
  } finally { await f.close() }
})
