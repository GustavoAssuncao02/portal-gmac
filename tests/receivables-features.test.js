import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'
import ExcelJS from 'exceljs'
import { filterReceivables, receivablesReport } from '../server/receivables.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const day = (offset) => new Date(Date.parse(todayBahia()) + offset * 86400000).toISOString().slice(0, 10)

test('receivables search by value as typed in Brazil and by the payer CPF/CNPJ', () => {
  const rows = [{ id: 'REC-000001', customerName: 'Nestlé', customerDocument: '08334818000152', valueCents: 150000, dueDate: '2026-11-01' }, { id: 'REC-000002', customerName: 'Vipal', customerDocument: '07857217000161', valueCents: 99, dueDate: '2026-11-01' }]
  const ids = (search) => filterReceivables(rows, { search, status: 'all' }).map((row) => row.id)
  assert.deepEqual(ids('1.500,00'), ['REC-000001']); assert.deepEqual(ids('1500.00'), ['REC-000001'])
  assert.deepEqual(ids('08.334.818/0001-52'), ['REC-000001']); assert.deepEqual(ids('07857217'), ['REC-000002'])
  assert.deepEqual(ids('nestle'), ['REC-000001'])
})

// Filtros panel (same as Contas a Pagar): Cliente, Classificação and Tipo do recebimento, also in the PDF and the spreadsheet.
const filterRows = () => [
  { id: 'REC-000001', clientId: '1', customerName: 'Cliente Alfa', classificationId: 'c-servico', kind: 'single', valueCents: 1000, dueDate: '2026-11-10' },
  { id: 'REC-000002', clientId: '1', customerName: 'Cliente Alfa', classificationId: 'c-servico', kind: 'installment', groupId: 'g1', installmentNumber: 1, installmentCount: 2, valueCents: 500, dueDate: '2026-11-10' },
  { id: 'REC-000003', clientId: '2', customerName: 'Cliente Beta', classificationId: 'c-aluguel', kind: 'recurring', seriesId: 's1', recurrence: 'monthly', valueCents: 700, dueDate: '2026-11-10' },
  // Older installments may lack the kind: the group says it.
  { id: 'REC-000004', clientId: '2', customerName: 'Cliente Beta', classificationId: 'c-servico', groupId: 'g2', installmentNumber: 1, installmentCount: 3, valueCents: 300, dueDate: '2026-11-10' },
].map((row) => ({ description: '', documentNumber: '', issueDate: '2026-11-01', ...row }))

test('the Filtros panel of Contas a Receber filters by client, classification and Tipo do recebimento', () => {
  const ids = (filters) => filterReceivables(filterRows(), { status: 'all', ...filters }, '2026-11-01').map((row) => row.id)
  assert.deepEqual(ids({}), ['REC-000001', 'REC-000002', 'REC-000003', 'REC-000004'])
  assert.deepEqual(ids({ kind: 'single' }), ['REC-000001'])
  assert.deepEqual(ids({ kind: 'installment' }), ['REC-000002', 'REC-000004'])
  assert.deepEqual(ids({ kind: 'recurring' }), ['REC-000003'])
  assert.deepEqual(ids({ clientId: '2' }), ['REC-000003', 'REC-000004'])
  assert.deepEqual(ids({ classificationId: 'c-servico', clientId: '2' }), ['REC-000004'])
  assert.deepEqual(ids({ classificationId: 'c-servico', kind: 'installment', clientId: '1' }), ['REC-000002'])
  // The filters that existed keep working as before: without a situation, received accounts stay out.
  assert.deepEqual(filterReceivables([...filterRows(), { ...filterRows()[0], id: 'REC-000005', receipt: { date: '2026-11-01', finalCents: 1000 } }], {}, '2026-11-01').map((row) => row.id), ['REC-000001', 'REC-000002', 'REC-000003', 'REC-000004'])
  const store = { receivables: filterRows(), classifications: [{ id: 'c-servico', name: 'Receita de serviços' }] }
  const notes = receivablesReport([], { kind: 'recurring', clientId: '2', classificationId: 'c-servico' }, false, store).notes
  assert.deepEqual(notes.slice(1), ['Cliente: Cliente Beta', 'Classificação: Receita de serviços', 'Tipo do recebimento: Contrato recorrente'])
  assert.deepEqual(receivablesReport([], {}, false, store).notes, ['Situação: Pendentes e vencidas'], 'no filter, no extra note')
})

test('the spreadsheet of Contas a Receber follows the Tipo do recebimento filter', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    await f.mutateStore((store) => { store.receivables = filterRows().map((row) => ({ ...row, dueDate: day(10) })) })
    const exported = async (filters) => {
      const response = await fetch(`${f.url}/api/receivables/export`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'xlsx', filters }) })
      assert.equal(response.status, 200)
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()))
      const sheet = workbook.worksheets[0]
      return Array.from({ length: sheet.rowCount - 1 }, (_, index) => sheet.getCell(`A${index + 2}`).value)
    }
    assert.deepEqual(await exported({ kind: 'installment' }), ['REC-000002', 'REC-000004'])
    assert.deepEqual(await exported({ kind: 'recurring', clientId: '2' }), ['REC-000003'])
    assert.equal((await exported({})).length, 4)
  } finally { await f.close() }
})

// Excel "Resumo": the columns asked for and a TOTAL line; "Completo" stays as it was; the selection is respected.
test('the Excel of Contas a Receber has Completo and Resumo, with a TOTAL line in the summary', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    await f.mutateStore((store) => { store.receivables = [
      { ...filterRows()[0], description: 'Usinagem', documentNumber: 'NF 10', valueCents: 100000, issCents: 5000, dueDate: '2026-12-10' },
      { ...filterRows()[2], description: 'Contrato', documentNumber: 'NF 11', valueCents: 50050, issCents: 0, dueDate: '2026-12-20' },
      { ...filterRows()[3], description: 'Parcela', documentNumber: '', valueCents: 30000, issCents: 1500, dueDate: '2026-12-15' },
    ] })
    const workbook = async (body) => {
      const response = await fetch(`${f.url}/api/receivables/export`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'xlsx', filters: { status: 'all' }, ...body }) })
      assert.equal(response.status, 200)
      const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await response.arrayBuffer()))
      return { sheet: book.worksheets[0], name: response.headers.get('content-disposition') }
    }
    const values = (sheet) => sheet.getSheetValues().slice(1).map((row) => row.slice(1))
    const summary = await workbook({ variant: 'summary' })
    assert.match(summary.name, /gmac-contas-a-receber-resumo\.xlsx/)
    assert.deepEqual(values(summary.sheet), [
      ['Cliente', 'Descrição', 'Documento', 'Valor bruto (R$)', 'ISS (R$)', 'Valor líquido (R$)', 'Vencimento'],
      ['Cliente Alfa', 'Usinagem', 'NF 10', 1000, 50, 950, '10/12/2026'],
      ['Cliente Beta', 'Contrato', 'NF 11', 500.5, 0, 500.5, '20/12/2026'],
      ['Cliente Beta', 'Parcela', '', 300, 15, 285, '15/12/2026'],
      ['TOTAL', '3 contas', '', 1800.5, 65, 1735.5, ''],
    ])
    assert.equal(summary.sheet.getRow(5).font.bold, true)
    assert.equal(summary.sheet.autoFilter, 'A1:G4', 'sorting never moves the TOTAL line')
    // Selected accounts only.
    assert.deepEqual(values((await workbook({ variant: 'summary', ids: ['REC-000003'] })).sheet).slice(1), [['Cliente Beta', 'Contrato', 'NF 11', 500.5, 0, 500.5, '20/12/2026'], ['TOTAL', '1 conta', '', 500.5, 0, 500.5, '']])
    // Completo is the spreadsheet of before: every column, no TOTAL line.
    const full = await workbook({})
    assert.match(full.name, /gmac-contas-a-receber\.xlsx/)
    assert.equal(values(full.sheet)[0].length, 21)
    assert.deepEqual(values(full.sheet).slice(1).map((row) => row[0]), ['REC-000001', 'REC-000003', 'REC-000004'])
    // The PDF does not change.
    const pdf = await fetch(`${f.url}/api/receivables/export`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'pdf', variant: 'summary', filters: { status: 'all' } }) })
    assert.match(pdf.headers.get('content-disposition'), /gmac-contas-a-receber\.pdf/)
  } finally { await f.close() }
})

test('recurring contracts, attachments, receipts with proof, bulk receipt and bell reminders', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const headers = { Authorization: `Bearer ${token}` }
    const request = (route, method, body) => f.request(route, method, body, headers)
    async function upload(route, name = 'nota.pdf', type = 'application/pdf') { const response = await fetch(`${f.url}/api${route}?name=${name}&type=${type}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: Buffer.from('%PDF-1.4 teste') }); return { status: response.status, data: await response.json() } }
    const base = { customerName: 'Nestlé Nordeste Alimentos e Bebidas Ltda', customerDocument: '08334818000152', description: 'Manutenção mensal' }

    // Recurring contracts are generated ahead; each occurrence stays independent.
    assert.equal((await request('/receivables', 'POST', { ...base, value: '1500', dueDate: shiftMonth(todayBahia(), 1), kind: 'recurring' })).status, 400, 'Recurrence is required')
    assert.equal((await request('/receivables', 'POST', { ...base, value: '1500', dueDate: shiftMonth(todayBahia(), 1), kind: 'recurring', recurrence: 'monthly', ahead: 1201 })).status, 400)
    const contractFile = await upload('/receivables/uploads', 'contrato.pdf')
    const contract = await request('/receivables', 'POST', { ...base, value: '1500', dueDate: shiftMonth(todayBahia(), 1), kind: 'recurring', recurrence: 'monthly', ahead: 11, fileIds: [contractFile.data.item.id] })
    assert.equal(contract.status, 201)
    const occurrences = contract.data.items
    assert.equal(occurrences.length, 12)
    assert.deepEqual([occurrences[0].kind, occurrences[0].seriesIndex, occurrences[11].seriesIndex, occurrences[11].dueDate], ['recurring', 1, 12, shiftMonth(todayBahia(), 12)])
    assert.equal(new Set(occurrences.map((row) => row.seriesId)).size, 1)
    assert.deepEqual([occurrences[0].attachments.length, occurrences[1].attachments.length], [1, 0], 'Contract files stay on the first occurrence')
    const yearly = (await request('/receivables', 'POST', { ...base, value: '900', dueDate: shiftMonth(todayBahia(), 1), kind: 'recurring', recurrence: 'yearly', ahead: 1, description: 'Licença anual' })).data.items
    assert.deepEqual(yearly.map((row) => row.dueDate), [shiftMonth(todayBahia(), 1), shiftMonth(todayBahia(), 13)])
    assert.equal((await request(`/receivables/${occurrences[1].id}`, 'PUT', { ...base, value: '1600', issueDate: todayBahia(), dueDate: occurrences[1].dueDate, kind: 'recurring', recurrence: 'monthly' })).data.item.valueCents, 160000, 'One occurrence is edited alone')
    assert.equal((await request(`/receivables/${occurrences[2].id}`)).data.item.valueCents, 150000)

    // Attachments: files on the account until it is received; proofs travel with the receipt.
    const single = (await request('/receivables', 'POST', { ...base, value: '320.50', dueDate: day(2), description: 'Usinagem avulsa' })).data.item
    const added = await upload(`/receivables/${single.id}/files`, 'boleto.pdf')
    assert.equal(added.status, 201)
    assert.equal((await fetch(`${f.url}/api/receivables/${single.id}/files/${added.data.item.id}`, { headers })).status, 200)
    const proof = await upload('/receivables/uploads', 'comprovante.pdf')
    const received = await request(`/receivables/${single.id}/receive`, 'POST', { date: todayBahia(), method: 'pix', interest: '4.50', fileIds: [proof.data.item.id] })
    assert.deepEqual([received.data.item.receipt.finalCents, received.data.item.receipt.receipts.length], [32500, 1])
    assert.equal((await upload(`/receivables/${single.id}/files`)).status, 409, 'Received accounts are locked')
    assert.equal((await request(`/receivables/${single.id}/files/${added.data.item.id}`, 'DELETE')).status, 409)
    assert.equal((await fetch(`${f.url}/api/receivables/${single.id}/files/${proof.data.item.id}`, { headers })).status, 200)

    // Bulk receipt: no adjustments and only open accounts.
    const ids = occurrences.slice(2, 4).map((row) => row.id)
    assert.equal((await request('/receivables/bulk', 'POST', { action: 'receive', ids, date: todayBahia(), method: 'transfer', interest: '1' })).status, 400)
    assert.equal((await request('/receivables/bulk', 'POST', { action: 'receive', ids: [...ids, single.id], date: todayBahia(), method: 'transfer' })).status, 409)
    const bulk = await request('/receivables/bulk', 'POST', { action: 'receive', ids, date: todayBahia(), method: 'transfer' })
    assert.equal(bulk.status, 200)
    assert.ok(bulk.data.items.every((row) => row.status === 'received' && row.receipt.finalCents === 150000))

    // Bell: due soon (reminder days) and overdue, each once, read individually per admin.
    const soon = (await request('/receivables', 'POST', { ...base, value: '210', dueDate: day(2), description: 'Vence logo' })).data.item
    const late = (await request('/receivables', 'POST', { ...base, value: '199', issueDate: day(-10), dueDate: day(-3), description: 'Atrasada' })).data.item
    let notices = (await request('/notifications')).data.items.filter((item) => item.type === 'receivable')
    assert.deepEqual(notices.map((item) => [item.accountId, item.days]).sort(), [[late.id, 'overdue'], [soon.id, 3]].sort())
    assert.ok(notices.every((item) => !item.readAt))
    await request('/notifications/read-all', 'POST', {})
    notices = (await request('/notifications')).data.items.filter((item) => item.type === 'receivable')
    assert.ok(notices.every((item) => item.readAt))
    assert.equal((await request('/notifications')).data.items.filter((item) => item.type === 'receivable').length, 2, 'Sweeping again does not duplicate')
    await request(`/receivables/${soon.id}/receive`, 'POST', { date: todayBahia(), method: 'pix' })
    assert.deepEqual((await request('/notifications')).data.items.filter((item) => item.type === 'receivable').map((item) => item.accountId), [late.id], 'Received accounts leave the bell')
    assert.equal((await request('/account/notifications', 'PATCH', { receivableReminderDays: 9 })).status, 400)
    assert.equal((await request('/account/notifications', 'PATCH', { receivableReminderDays: 'never' })).status, 200)
    assert.equal((await request('/notifications')).data.items.filter((item) => item.type === 'receivable').length, 0)
  } finally { await f.close() }
})

test('bulk actions in Contas a Receber: gross, ISS and net in the preview, received accounts kept, plans numbered again', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const bulk = (body) => f.request('/receivables/bulk', 'POST', body, { Authorization: `Bearer ${token}` })
    const received = (finalCents, issCents = 0, date = '2026-11-05') => ({ date, method: 'pix', interestCents: 0, discountCents: 0, issCents, finalCents, bankName: 'Banco Teste', receipts: [] })
    const row = (id, extra) => ({ id, clientId: '1', customerName: 'Cliente Alfa', classificationId: 'r1', classificationName: 'Receita de serviços', description: id, documentNumber: '', issueDate: '2026-11-01', dueDate: '2026-12-01', kind: 'single', valueCents: 10000, issCents: 0, attachments: [], ...extra })
    await f.mutateStore((store) => {
      store.classifications = [{ id: 'r1', name: 'Receita de serviços', dreLine: 'gross_revenue' }, { id: 'r2', name: 'Receita de contratos', dreLine: 'gross_revenue' }, { id: 'c1', name: 'Despesa' }]
      store.receivables = [
        row('REC-000001', { issCents: 500 }),
        row('REC-000002', { kind: 'installment', groupId: 'plano', installmentNumber: 1, installmentCount: 3, originalTotalCents: 30000, issCents: 300 }),
        row('REC-000003', { kind: 'installment', groupId: 'plano', installmentNumber: 2, installmentCount: 3, originalTotalCents: 30000, dueDate: '2027-01-01' }),
        row('REC-000004', { kind: 'installment', groupId: 'plano', installmentNumber: 3, installmentCount: 3, originalTotalCents: 30000, dueDate: '2027-02-01' }),
        row('REC-000005', { receipt: received(9500, 500) }),
        row('REC-000006', { treasury: true, receipt: received(10000) }),
        row('REC-000007', { valueCents: 6000, partialPaidCents: 4000, partialIssCents: 0, partialIds: ['REC-000008'], receipt: received(6000, 0, '2026-11-10') }),
        row('REC-000008', { valueCents: 4000, partialOf: 'REC-000007', receipt: received(4000, 0, '2026-11-03') }),
      ]
    })
    const ids = (...numbers) => numbers.map((number) => `REC-${String(number).padStart(6, '0')}`)
    const preview = async (body) => { const response = await bulk({ ...body, preview: true }); assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data.preview }

    const deletion = await preview({ action: 'delete', ids: ids(1, 2, 3, 5) })
    assert.deepEqual([deletion.count, deletion.amounts], [3, { grossCents: 30000, issCents: 800, netCents: 29200 }])
    assert.deepEqual(deletion.blocked.map((item) => [item.id, item.name, item.reason]), [['REC-000005', 'Cliente Alfa', 'Conta com recebimento: preserve o histórico.']])
    assert.ok(deletion.facts.includes('Tipo: Recebimento parcelado (2), Parcela única (1)'), deletion.facts.join(' | '))
    assert.equal((await bulk({ action: 'delete', ids: ids(1, 2, 3, 5), token: deletion.token })).data.count, 3)
    let store = await f.mutateStore((current) => structuredClone(current))
    const last = store.receivables.find((item) => item.id === 'REC-000004')
    assert.deepEqual([last.installmentNumber, last.installmentCount, last.originalTotalCents], [1, 1, 10000])
    assert.ok(store.receivableEvents.filter((item) => item.type === 'deleted').every((item) => item.details.bulk && item.details.text === 'Exclusão em massa (3 contas)'))

    const classify = await preview({ action: 'classify', ids: ids(4, 5, 6), classificationId: 'r2' })
    assert.deepEqual([classify.ids, classify.blocked.map((item) => item.reason)], [ids(4), ['Conta recebida: desfaça o recebimento antes de alterar a classificação.', 'Lançamento da Tesouraria: altere na conta.']])
    assert.equal((await bulk({ action: 'classify', ids: ids(4), classificationId: 'c1', preview: true })).status, 400, 'an expense classification does not fit money in')
    assert.equal((await bulk({ action: 'classify', ids: ids(4, 5, 6), classificationId: 'r2', token: classify.token })).data.count, 1)
    assert.equal((await f.mutateStore((current) => structuredClone(current))).receivables.find((item) => item.id === 'REC-000004').classificationId, 'r2')

    const reason = 'Recebimentos lançados em duplicidade'
    assert.deepEqual((await preview({ action: 'reverse', ids: ids(8), reason })).blocked.map((item) => item.reason), ['Recebimento parcial de REC-000007: desfaça antes o recebimento final de REC-000007.'])
    const reverse = await preview({ action: 'reverse', ids: ids(5, 7, 8), reason })
    assert.deepEqual([reverse.ids, reverse.amounts], [ids(5, 7, 8), { grossCents: 20000, issCents: 500, netCents: 19500 }])
    assert.equal((await bulk({ action: 'reverse', ids: ids(5, 7, 8), reason, token: reverse.token })).status, 200)
    store = await f.mutateStore((current) => structuredClone(current))
    const parent = store.receivables.find((item) => item.id === 'REC-000007')
    assert.deepEqual([parent.receipt, parent.valueCents, parent.partialPaidCents, store.receivables.some((item) => item.id === 'REC-000008'), store.receivables.find((item) => item.id === 'REC-000005').receipt], [null, 10000, undefined, false, null])
    assert.deepEqual(store.receivableEvents.filter((item) => item.type === 'reversed').map((item) => [item.accountId, item.details.bulk]), [['REC-000005', true], ['REC-000007', true], ['REC-000008', true]])
    // The bulk receipt of before keeps working.
    assert.equal((await bulk({ action: 'receive', ids: ids(4), date: todayBahia(), method: 'pix' })).status, 200)
  } finally { await f.close() }
})
