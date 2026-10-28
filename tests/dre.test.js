import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { suggestedTerm, termCounterpart, compareCodes } from '../server/accountPlanRules.js'
import { dreColumns, variation, visibleDreRows } from '../server/dreRules.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123' }
const byCode = (items, code) => items.find((item) => item.code === code)

test('codes sort number by number and à vista / a prazo pairs are found by name', () => {
  assert.deepEqual(['1.10', '10.01', '1.02', '2.01'].sort(compareCodes), ['1.02', '1.10', '2.01', '10.01'])
  const list = [{ id: 'a', name: 'Receita de Serviços à Vista' }, { id: 'b', name: 'Receita de Serviços a Prazo' }, { id: 'c', name: 'Receita de Industrialização à Vista' }]
  assert.equal(termCounterpart(list[0], list).id, 'b')
  assert.equal(termCounterpart(list[1], list).id, 'a')
  assert.equal(termCounterpart(list[2], list), null, 'without its pair nothing is suggested')
  assert.equal(suggestedTerm({ treasury: true }), 'vista')
  assert.equal(suggestedTerm({ kind: 'installment', issueDate: '2026-10-01', dueDate: '2026-10-01' }), 'prazo')
  assert.equal(suggestedTerm({ kind: 'single', issueDate: '2026-10-01', dueDate: '2026-11-01' }), 'prazo')
  assert.equal(suggestedTerm({ kind: 'single', issueDate: '2026-10-01', dueDate: '2026-10-01' }), 'vista')
  assert.deepEqual(variation({ nature: 'expense' }, -15000, -10000), { value: 50, good: false }, 'a cost that grew shows a positive change, bad for the result')
  assert.deepEqual(variation({ nature: 'revenue' }, 15000, 10000), { value: 50, good: true })
  assert.equal(variation({ nature: 'revenue' }, 15000, 0), null)
})

test('the plan replaces the test classifications, moves their accounts and spreads recurring issue dates', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env, fillClassifications: false })
  try {
    await f.mutateStore((store) => {
      store.classifications = [{ id: 'old-raw', name: 'Matéria-prima' }, { id: 'old-energy', name: 'Energia elétrica' }]
      store.payables = [
        { id: 'PAG-000001', supplierId: 's1', classificationId: 'old-raw', classificationName: 'Matéria-prima', valueCents: 1000, issueDate: '2026-09-01', dueDate: '2026-09-10', kind: 'normal' },
        { id: 'PAG-000002', supplierId: 's1', classificationId: 'old-raw', classificationName: 'Matéria-prima + Energia elétrica', classificationSplit: [{ classificationId: 'old-raw', classificationName: 'Matéria-prima', valueCents: 600 }, { classificationId: 'old-energy', classificationName: 'Energia elétrica', valueCents: 400 }], valueCents: 1000, issueDate: '2026-09-01', dueDate: '2026-09-10', kind: 'normal' },
        ...[1, 2, 3].map((index) => ({ id: `PAG-00001${index}`, supplierId: 's1', classificationId: 'old-energy', valueCents: 500, issueDate: '2026-09-01', dueDate: `2026-${String(8 + index).padStart(2, '0')}-15`, kind: 'recurring', recurrence: 'monthly', seriesId: 'serie', seriesIndex: index })),
      ]
      store.receivables = [
        { id: 'REC-000001', customerName: 'Cliente', valueCents: 1000, issueDate: '2026-09-01', dueDate: '2026-09-01', kind: 'single' },
        { id: 'REC-000002', customerName: 'Cliente', valueCents: 1000, issueDate: '2026-09-01', dueDate: '2026-10-01', kind: 'single' },
      ]
    })
    const { ensureAccountPlan } = await f.serverModule('accountPlan.js')
    await ensureAccountPlan()
    await ensureAccountPlan()
    const plan = (await f.adminRequest('/account-groups')).data
    assert.deepEqual(plan.groups.map((group) => `${group.code} ${group.name}`), ['1 Custos de produção', '2 Despesas administrativas', '3 Despesas comerciais', '4 Resultado financeiro', '5 Tributos', '6 Movimentações fora do resultado', '7 Receitas'])
    assert.equal(plan.items.length, 80, '72 classifications of the spreadsheet plus 4.06, 4.07, 6.11, 6.12 and the 4 revenues')
    assert.ok(!plan.items.some((item) => item.id.startsWith('old-')), 'the test classifications are gone')
    assert.equal(byCode(plan.items, '5.05').dreLine, 'income_tax')
    assert.equal(byCode(plan.items, '5.07').dreLine, 'tax_charges')
    assert.equal(byCode(plan.items, '4.06').nature, 'revenue')
    assert.equal(byCode(plan.items, '6.11').nature, 'both')
    assert.equal(plan.settings.iss, byCode(plan.items, '5.02').id)
    assert.equal(plan.settings.interestPaid, byCode(plan.items, '4.05').id)
    const store = await (await f.serverModule('offers.js')).readStore()
    const [raw, split] = store.payables
    assert.equal(raw.classificationId, byCode(plan.items, '1.01').id)
    assert.deepEqual(split.classificationSplit.map((part) => part.classificationId), [byCode(plan.items, '1.01').id, byCode(plan.items, '1.23').id])
    assert.equal(split.classificationName, 'Matéria-prima + Energia da produção')
    assert.deepEqual(store.payables.filter((row) => row.seriesId).map((row) => row.issueDate), ['2026-09-01', '2026-10-01', '2026-11-01'])
    assert.deepEqual(store.receivables.map((row) => row.classificationName), ['Receita de Serviços à Vista', 'Receita de Serviços a Prazo'])
  } finally { await f.close() }
})

test('classifications: group, code and nature rules', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env, fillClassifications: false })
  try {
    await (await f.serverModule('accountPlan.js')).ensureAccountPlan()
    const request = (route, method, body) => f.adminRequest(route, method, body)
    const { groups, items } = (await request('/classifications')).data
    const costs = groups.find((group) => group.code === '1'), revenue = groups.find((group) => group.code === '7')
    assert.equal((await request('/classifications', 'POST', { code: '1.27', name: 'Nova', behavior: 'variable' })).status, 400, 'the group is mandatory')
    assert.equal((await request('/classifications', 'POST', { groupId: costs.id, code: '1.5', name: 'Nova', behavior: 'variable' })).status, 400, 'code N.NN')
    assert.equal((await request('/classifications', 'POST', { groupId: costs.id, code: '2.30', name: 'Nova', behavior: 'variable' })).status, 400, 'the code starts with the group')
    const duplicate = await request('/classifications', 'POST', { groupId: costs.id, code: '1.01', name: 'Nova', behavior: 'variable' })
    assert.equal(duplicate.status, 409); assert.match(duplicate.data.message, /Matéria-prima/)
    const created = await request('/classifications', 'POST', { groupId: costs.id, code: '1.27', name: 'Combustível da produção', behavior: 'variable' })
    assert.equal(created.status, 200); assert.equal(created.data.item.dreLine, 'costs', 'the line comes from the group')

    const supplier = (await request('/suppliers', 'POST', { name: 'Fornecedor', document: '12345678000190' })).data.item
    const bill = { supplierId: supplier.id, issueDate: '2026-10-01', dueDate: '2026-10-20', kind: 'normal', value: '100.00' }
    assert.equal((await request('/payables', 'POST', { ...bill, classificationId: byCode(items, '7.01').id })).status, 400, 'a payable does not take a revenue')
    assert.equal((await request('/payables', 'POST', { ...bill, classificationId: created.data.item.id })).status, 201)
    assert.equal((await request('/payables', 'POST', { ...bill, value: '50.00', classificationId: byCode(items, '6.04').id })).status, 201, 'money outside the result goes both ways')
    const sale = { customerName: 'Cliente', issueDate: '2026-10-01', dueDate: '2026-10-01', value: '100.00' }
    assert.equal((await request('/receivables', 'POST', sale)).status, 400, 'a receivable needs its classification')
    assert.equal((await request('/receivables', 'POST', { ...sale, classificationId: created.data.item.id })).status, 400, 'a receivable does not take an expense')
    const received = await request('/receivables', 'POST', { ...sale, classificationId: byCode(items, '7.01').id })
    assert.equal(received.status, 201)
    assert.equal((await request(`/receivables/${received.data.item.id}`, 'PUT', { ...sale, description: 'Editada' })).data.item.classificationId, byCode(items, '7.01').id, 'an edit without a classification keeps the one it has')

    assert.equal((await request(`/classifications/${created.data.item.id}`, 'DELETE')).status, 409, 'a classification in use is only deactivated')
    assert.equal((await request(`/classifications/${created.data.item.id}`, 'PUT', { ...created.data.item, dreLine: 'gross_revenue' })).status, 409, 'its payables would not fit a revenue line')
    assert.equal((await request(`/account-groups/${costs.id}`, 'DELETE')).status, 409, 'a group with classifications is only deactivated')
    assert.equal((await request(`/classifications/${byCode(items, '5.02').id}`, 'DELETE')).status, 409, 'the ISS classification is configured')
    const renumbered = await request(`/account-groups/${revenue.id}`, 'PUT', { ...revenue, code: '8' })
    assert.equal(renumbered.status, 200)
    assert.deepEqual((await request('/classifications')).data.items.filter((item) => item.groupId === revenue.id).map((item) => item.code), ['8.01', '8.02', '8.03', '8.04'], 'the classifications follow the new group code')
  } finally { await f.close() }
})

test('DRE by cash and by competência, with interest, ISS, adjustments and exports', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env, fillClassifications: false })
  try {
    await (await f.serverModule('accountPlan.js')).ensureAccountPlan()
    const request = async (route, method, body) => { const result = await f.adminRequest(route, method, body); assert.ok(result.status < 400, `${route}: ${result.data?.message}`); return result.data }
    const { items } = await request('/classifications')
    const id = (code) => byCode(items, code).id
    const supplier = (await request('/suppliers', 'POST', { name: 'Aço Bahia', document: '12345678000190' })).item
    // September: a service invoiced a prazo (R$ 1.000, ISS R$ 50), received in October. Raw material bought in September,
    // paid in October with R$ 10 of interest. A tax and a machine paid in September.
    const sale = (await request('/receivables', 'POST', { customerName: 'Cliente', classificationId: id('7.02'), issueDate: '2026-09-05', dueDate: '2026-10-05', value: '1000.00', iss: '50.00' })).item
    await request(`/receivables/${sale.id}/receive`, 'POST', { date: '2026-10-05', method: 'pix', iss: '50.00' })
    const bill = (await request('/payables', 'POST', { supplierId: supplier.id, classificationId: id('1.01'), issueDate: '2026-09-02', dueDate: '2026-09-30', kind: 'normal', value: '300.00' })).items[0]
    await request(`/payables/${bill.id}/pay`, 'POST', { date: '2026-10-03', method: 'pix', interest: '10.00' })
    await request('/payables', 'POST', { treasury: true, supplierId: supplier.id, classificationId: id('5.05'), date: '2026-09-20', method: 'pix', value: '40.00' })
    await request('/payables', 'POST', { treasury: true, supplierId: supplier.id, classificationId: id('6.04'), date: '2026-09-21', method: 'pix', value: '500.00' })
    // Depreciation: R$ 100 for three months, 10% less each month; and a reversal.
    const repeated = (await request('/dre-adjustments', 'POST', { month: '2026-09', classificationId: id('1.26'), value: '100.00', description: 'Depreciação das máquinas', repeat: 3, variation: '-10' })).items
    assert.deepEqual(repeated.map((row) => [row.month, row.valueCents]), [['2026-09', 10000], ['2026-10', 9000], ['2026-11', 8100]])
    await request('/dre-adjustments', 'POST', { month: '2026-10', classificationId: id('1.26'), value: '20.00', description: 'Estorno parcial', reversal: true })
    assert.equal((await f.adminRequest('/dre-adjustments', 'POST', { month: '2026-10', classificationId: id('6.04'), value: '10.00', description: 'Fora' })).status, 400, 'no adjustments outside the result')

    const row = (report, key) => report.rows.find((item) => item.key === key || item.code === key)
    const cash = await request('/dre?view=cash&start=2026-09&end=2026-10')
    assert.deepEqual(cash.months, ['2026-09', '2026-10'])
    assert.equal(row(cash, '7.02').values['2026-10'], 100000, 'the revenue enters when the money arrives')
    assert.equal(row(cash, '7.02').values['2026-09'], 0)
    assert.equal(row(cash, '5.02').values['2026-10'], -5000, 'the ISS withheld goes with the receipt')
    assert.equal(row(cash, '1.01').values['2026-10'], -30000)
    assert.equal(row(cash, '4.05').values['2026-10'], -1000, 'the interest paid goes to 4.05')
    assert.equal(row(cash, '5.05').values['2026-09'], -4000)
    assert.equal(row(cash, '1.26').values['2026-10'], -7000, 'adjustment of R$ 90 minus the reversal of R$ 20')
    assert.equal(row(cash, 'net_income').values['2026-09'], -4000 - 10000)
    assert.equal(row(cash, 'net_income').values['2026-10'], 100000 - 5000 - 30000 - 1000 - 7000)
    assert.equal(row(cash, '6.04').values['2026-09'], -50000, 'the machine purchase is shown outside the result')
    assert.equal(row(cash, 'outside').values['2026-09'], -50000)
    assert.equal(row(cash, 'gross_revenue').total, 100000)
    assert.equal(row(cash, 'net_income').percent, (row(cash, 'net_income').total / 100000) * 100)

    const accrual = await request('/dre?view=accrual&start=2026-09&end=2026-09')
    assert.equal(accrual.previousMonth, '2026-08')
    assert.equal(row(accrual, '7.02').values['2026-09'], 100000, 'by competência the revenue belongs to the issue month')
    assert.equal(row(accrual, '5.02').values['2026-09'], -5000)
    assert.equal(row(accrual, '1.01').values['2026-09'], -30000)
    assert.equal(row(accrual, '4.05').values['2026-09'], 0, 'interest happens on the payment, in October')
    assert.deepEqual(dreColumns(accrual).map((column) => column.label), ['ago/2026', 'set/2026', 'Variação', '% da receita'])
    assert.ok(!visibleDreRows(accrual).some((item) => item.code === '1.02'), 'lines without values are hidden')
    assert.ok(visibleDreRows(accrual, true).some((item) => item.code === '1.02'))
    assert.ok(accrual.entries.some((entry) => entry.refId === sale.id && entry.kind === 'iss'))

    for (const format of ['pdf', 'xlsx']) {
      const response = await fetch(`${f.url}/api/dre/export`, { method: 'POST', headers: { ...f.admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ format, view: 'cash', start: '2026-01', end: '2026-12' }) })
      assert.equal(response.status, 200)
      const bytes = Buffer.from(await response.arrayBuffer())
      assert.equal(bytes.subarray(0, format === 'pdf' ? 4 : 2).toString(), format === 'pdf' ? '%PDF' : 'PK')
    }
    assert.equal((await f.adminRequest('/dre?start=2026-12&end=2026-10')).status, 400)
  } finally { await f.close() }
})

test('a bank in the DRE keeps only the accounts settled in it and leaves the adjustments out', async () => {
  const { dreReport } = await import('../server/dre.js')
  const store = {
    banks: [{ id: 'b1', name: 'Sicoob', agency: '1', account: '2' }, { id: 'b2', name: 'Caixa' }],
    classifications: [], suppliers: [],
    payables: [{ id: 'P1', issueDate: '2026-10-01', valueCents: 1000, payment: { date: '2026-10-02', bankId: 'b1', finalCents: 1000 } }, { id: 'P2', issueDate: '2026-10-01', valueCents: 3000, payment: { date: '2026-10-03', bankId: 'b2', finalCents: 3000 } }, { id: 'P3', issueDate: '2026-10-01', valueCents: 5000 }],
    receivables: [{ id: 'R1', issueDate: '2026-10-01', valueCents: 7000, receipt: { date: '2026-10-04', bankId: 'b1', finalCents: 7000 } }],
    dreAdjustments: [{ id: 'A1', month: '2026-10', valueCents: 900 }],
  }
  const ids = (report) => report.entries.map((entry) => entry.refId).sort()
  assert.deepEqual(ids(dreReport(store, { view: 'cash', start: '2026-10', end: '2026-10' })), ['A1', 'P1', 'P2', 'R1'])
  const filtered = dreReport(store, { view: 'accrual', start: '2026-10', end: '2026-10', bankId: 'b1' })
  assert.deepEqual(ids(filtered), ['P1', 'R1'])
  assert.equal(filtered.bankName, 'Sicoob · Ag. 1 · C/C 2')
})
