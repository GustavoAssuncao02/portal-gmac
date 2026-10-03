import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { createWorkflowFixture } from './workflowFixture.js'
import { cents, makeInstallments, shiftMonth, filterPayables, todayBahia, payableStatus } from '../server/payableRules.js'
import { payableAnalytics } from '../src/payableAnalytics.js'

test('currency is exact; monthly installments clamp days without drifting and preserve the total', () => {
  assert.equal(cents('0.29'), 29); assert.equal(cents('100.01'), 10001)
  for (const invalid of ['1.001', '-1', '1e2', 'NaN', '']) assert.throws(() => cents(invalid))
  assert.equal(shiftMonth('2028-01-31', 1), '2028-02-29')
  assert.equal(shiftMonth('2027-01-31', 2), '2027-03-31')
  assert.deepEqual(makeInstallments(10001, '2027-01-31', 3), [{ valueCents: 3334, dueDate: '2027-01-31' }, { valueCents: 3334, dueDate: '2027-02-28' }, { valueCents: 3333, dueDate: '2027-03-31' }])
  assert.equal(payableStatus({ dueDate: '2026-10-03' }, '2026-10-03'), 'pending')
  assert.equal(payableStatus({ dueDate: '2026-10-02' }, '2026-10-03'), 'overdue')
})
test('filters and BI include deactivated paid accounts, actual paid values, due periods and payment months', () => {
  const rows = [{ id: 'PAG-000001', supplierName: 'Água', supplierId: '1', classificationId: 'a', classificationName: 'Energia', description: 'Energia', documentNumber: 'NF123', dueDate: '2026-10-01', valueCents: 10000, inactive: true, payment: { date: '2026-09-29', finalCents: 10500, interestCents: 500, discountCents: 0 } }, { id: 'PAG-000002', supplierId: '1', supplierName: 'Água', classificationId: 'a', classificationName: 'Energia', dueDate: '2026-10-05', valueCents: 20000 }]
  assert.equal(filterPayables(rows, {}).length, 1)
  assert.equal(filterPayables(rows, { status: 'inactive', search: 'agua' }).length, 1)
  assert.equal(filterPayables(rows, { status: 'all', search: 'nf123' }).length, 1)
  const result = payableAnalytics(rows, { start: '2026-10-01', end: '2026-10-31' }, '2026-10-03')
  assert.equal(result.metrics.total.value, 30500); assert.equal(result.metrics.paid.value, 10500); assert.equal(result.metrics.interest.value, 500)
  assert.equal(result.metrics.soon.value, 20000); assert.equal(result.months[0].id, '2026-09')
  assert.equal(payableAnalytics(rows, { supplierId: 'missing' }).metrics.total.value, 0)
})
test('payables enforce payment locks, duplicates, installments, recurrence, audit, files, bulk and exports', async () => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    assert.equal((await f.request('/payables')).status, 401)
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const headers = { Authorization: `Bearer ${token}` }
    const request = (route, method, body) => f.request(route, method, body, headers)
    const supplier = (await request('/suppliers', 'POST', { name: 'Fornecedor teste', document: '12345678000190', email: 'supplier@example.invalid', phone: '71999999999' })).data.item
    const category = (await request('/classifications', 'POST', { name: 'Energia' })).data.item
    const draft = { supplierId: supplier.id, classificationId: category.id, description: 'Compra', documentNumber: 'NF001', issueDate: todayBahia(), value: '100.01', dueDate: '2027-01-31', kind: 'normal' }
    assert.equal((await request('/payables', 'POST', { ...draft, supplierId: 'missing' })).status, 400)
    assert.equal((await request('/payables', 'POST', { ...draft, issueDate: '2026-02-30' })).status, 400)
    const created = await request('/payables', 'POST', draft); assert.equal(created.status, 201)
    const row = created.data.items[0]; assert.equal(row.id, 'PAG-000001')
    assert.equal((await request('/payables', 'POST', draft)).status, 409)
    const concurrent = await Promise.all([request('/payables', 'POST', { ...draft, value: '50' }), request('/payables', 'POST', { ...draft, value: '50' })]); assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409])
    const file = Buffer.from('proof')
    async function upload(route) { const response = await fetch(`${f.url}/api${route}?name=test.pdf&type=application/pdf`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: file }); return { status: response.status, data: await response.json() } }
    const attachment = await upload(`/payables/${row.id}/files`); assert.equal(attachment.status, 201)
    assert.equal((await fetch(`${f.url}/api/payables/${row.id}/files/${attachment.data.item.id}`, { headers })).status, 200)
    const removable = await upload(`/payables/${row.id}/files`)
    assert.equal((await request(`/payables/${row.id}/files/${removable.data.item.id}`, 'DELETE')).status, 200)
    const pay = { date: todayBahia(), method: 'pix', interest: '10', note: 'Observacao testada' }
    assert.equal((await request(`/payables/${row.id}/pay`, 'POST', { ...pay, date: '2099-12-01' })).status, 400)
    assert.equal((await request(`/payables/${row.id}/pay`, 'POST', { ...pay, discount: '1' })).status, 400)
    const receipt = await upload('/payables/uploads')
    assert.equal((await request(`/payables/${row.id}/pay`, 'POST', { ...pay, fileIds: [receipt.data.item.id] })).status, 200)
    let detail = (await request(`/payables/${row.id}`)).data
    assert.equal(detail.item.payment.finalCents, 11001); assert.equal(detail.item.payment.receipts.length, 1)
    assert.equal((await request(`/payables/${row.id}`, 'PUT', draft)).status, 409)
    assert.equal((await upload(`/payables/${row.id}/files`)).status, 409)
    assert.equal((await request(`/payables/${row.id}/files/${attachment.data.item.id}`, 'DELETE')).status, 409)
    assert.equal((await request(`/payables/${row.id}/pay`, 'POST', pay)).status, 409)
    assert.equal((await request(`/payables/${row.id}`, 'DELETE')).status, 409)
    await request(`/payables/${row.id}/activation`, 'POST', { inactive: true }); assert.equal((await request(`/payables/${row.id}`)).data.item.inactive, true)
    assert.equal((await request(`/payables/${row.id}/reverse`, 'POST', { reason: 'Correção da baixa' })).status, 409)
    await request(`/payables/${row.id}/activation`, 'POST', { inactive: false })
    assert.equal((await request(`/payables/${row.id}/reverse`, 'POST', { reason: 'curto' })).status, 400)
    await request(`/payables/${row.id}/reverse`, 'POST', { reason: 'Pagamento registrado por engano' })
    assert.equal((await request(`/payables/${row.id}`)).data.item.status, 'pending')
    assert.equal((await request(`/payables/${row.id}/activation`, 'POST', { inactive: true })).status, 400)
    assert.equal((await request(`/payables/${row.id}`, 'DELETE')).status, 409)
    assert.equal((await request(`/payables/${row.id}`, 'PUT', { ...draft, dueDate: '2020-01-01' })).status, 200)
    await request(`/payables/${row.id}/pay`, 'POST', { date: todayBahia(), method: 'boleto', discount: '5' })
    await request(`/payables/${row.id}/reverse`, 'POST', { reason: 'Estorno para corrigir conta' })
    assert.equal((await request(`/payables/${row.id}`)).data.item.status, 'overdue')
    const parcelDraft = { ...draft, value: '300', dueDate: '2027-04-30', kind: 'installment', count: 3 }
    assert.equal((await request('/payables', 'POST', { ...parcelDraft, installments: [{ value: '1', dueDate: '2027-04-30' }] })).status, 400)
    const parts = (await request('/payables', 'POST', parcelDraft)).data.items
    assert.equal(parts.length, 3); assert.equal(parts[1].dueDate, '2027-05-30')
    assert.equal((await request(`/payables/${parts[0].id}`, 'PUT', { ...parcelDraft, count: 2 })).status, 200)
    const updated = (await request(`/payables/${parts[0].id}`)).data.siblings
    assert.equal(updated.length, 2); assert.equal(updated[0].valueCents, 15000)
    await request(`/payables/${parts[0].id}/pay`, 'POST', { date: todayBahia(), method: 'card' })
    assert.equal((await request(`/payables/${updated[1].id}`)).data.item.payment, null)
    assert.equal((await request(`/payables/${updated[1].id}`, 'PUT', { ...parcelDraft, count: 4, dueDate: updated[1].dueDate })).status, 409)
    assert.equal((await request(`/payables/${updated[1].id}`, 'PUT', { ...parcelDraft, count: 2, dueDate: updated[1].dueDate, description: 'Informacao corrigida', installments: updated.map((r) => ({ value: (r.valueCents / 100).toFixed(2), dueDate: r.dueDate })) })).status, 200)
    const recurDraft = { ...draft, value: '80', dueDate: '2027-01-30', kind: 'recurring', recurrence: 'monthly' }
    assert.equal((await request('/payables', 'POST', { ...recurDraft, count: 2 })).status, 400)
    const recur = (await request('/payables', 'POST', recurDraft)).data.items[0]
    assert.equal((await request('/payables', 'POST', { ...recurDraft, dueDate: '2027-02-28', previousId: recur.id })).status, 400)
    await request(`/payables/${recur.id}/pay`, 'POST', { date: todayBahia(), method: 'pix' })
    const before = (await request('/payables')).data.items.length
    assert.equal((await request('/payables')).data.items.length, before)
    const next = (await request('/payables', 'POST', { ...recurDraft, dueDate: '2027-02-28', previousId: recur.id })).data.items[0]
    assert.equal(next.previousId, recur.id)
    assert.ok((await request(`/payables/${next.id}`)).data.history.some((e) => e.details?.text === `Criada a partir de ${recur.id}`))
    const open = (await request('/payables', 'POST', { ...draft, value: '15', dueDate: todayBahia() })).data.items[0]
    const open2 = (await request('/payables', 'POST', { ...draft, value: '20', dueDate: shiftMonth(todayBahia(), 1) })).data.items[0]
    const threeDays = new Date(Date.parse(todayBahia()) + 3 * 86400000).toISOString().slice(0, 10)
    const soon = (await request('/payables', 'POST', { ...draft, value: '18', dueDate: threeDays })).data.items[0]
    assert.equal((await request('/payables/bulk', 'POST', { action: 'pay', ids: [open.id, recur.id], date: todayBahia(), method: 'pix' })).status, 409)
    assert.equal((await request(`/payables/${open.id}`)).data.item.payment, null)
    assert.equal((await request('/payables/bulk', 'POST', { action: 'pay', ids: [open.id, open2.id], date: todayBahia(), method: 'pix', interest: '1' })).status, 400)
    const notices = (await request('/payables/notifications')).data.items
    assert.ok(notices.some((n) => n.accountId === open.id && n.days === 0))
    assert.ok(notices.some((n) => n.accountId === soon.id && n.days === 3))
    assert.equal((await request('/payables/bulk', 'POST', { action: 'pay', ids: [open.id, open2.id], date: todayBahia(), method: 'pix', fileIds: ['not-allowed'] })).status, 400)
    assert.equal((await request('/payables/notifications')).data.items.filter((n) => n.accountId === open.id).length, 1)
    await request('/payables/bulk', 'POST', { action: 'pay', ids: [open.id, open2.id], date: todayBahia(), method: 'pix' })
    await request('/payables/bulk', 'POST', { action: 'deactivate', ids: [open.id, open2.id] })
    assert.ok(!(await request('/payables/notifications')).data.items.some((n) => n.accountId === open.id))
    assert.equal((await request(`/classifications/${category.id}`, 'DELETE')).status, 409)
    assert.equal((await request(`/suppliers/${supplier.id}`, 'DELETE')).status, 409)
    await request(`/classifications/${category.id}`, 'PUT', { name: category.name, inactive: true })
    assert.equal((await request('/payables', 'POST', { ...draft, value: '12' })).status, 400)
    await request(`/classifications/${category.id}`, 'PUT', { name: category.name, inactive: false })
    const mistaken = (await request('/payables', 'POST', { ...draft, value: '12' })).data.items[0]
    assert.equal((await request(`/payables/${mistaken.id}`, 'DELETE')).status, 200)
    const convert = (await request('/payables', 'POST', { ...draft, value: '90', dueDate: '2027-07-02' })).data.items[0]
    assert.equal((await request(`/payables/${convert.id}`, 'PUT', { ...draft, value: '90', dueDate: '2027-07-02', kind: 'installment', count: 2 })).status, 200)
    assert.equal((await request(`/payables/${convert.id}`)).data.siblings.length, 2)
    const history = (await request('/payables/history')).data.items
    for (const type of ['created', 'edited', 'paid', 'reversed', 'deleted', 'deactivated', 'reactivated', 'attachment_added', 'attachment_removed']) assert.ok(history.some((e) => e.type === type), type)
    assert.ok(history.filter((e) => e.type !== 'status_changed').every((e) => e.userName === 'Gustavo'))
    for (const format of ['pdf', 'xlsx']) {
      const response = await fetch(`${f.url}/api/payables/export`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ format, id: recur.id }) })
      assert.equal(response.status, 200); const buffer = Buffer.from(await response.arrayBuffer())
      if (format === 'pdf') assert.equal(buffer.subarray(0, 4).toString(), '%PDF')
      else { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer); assert.equal(workbook.worksheets[0].getCell('A2').value, recur.id); assert.ok(workbook.worksheets.length >= 3) }
    }
    const exported = await fetch(`${f.url}/api/payables/export`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'xlsx', filters: { status: 'inactive', search: open.id } }) })
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer())); assert.equal(workbook.worksheets[0].rowCount, 2); assert.ok(workbook.worksheets[0].getCell('C2').value.endsWith('(D)'))
  } finally { await f.close() }
})
