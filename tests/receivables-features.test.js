import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'
import { filterReceivables } from '../server/receivables.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const day = (offset) => new Date(Date.parse(todayBahia()) + offset * 86400000).toISOString().slice(0, 10)

test('receivables search by value as typed in Brazil and by the payer CPF/CNPJ', () => {
  const rows = [{ id: 'REC-000001', customerName: 'Nestlé', customerDocument: '08334818000152', valueCents: 150000, dueDate: '2026-11-01' }, { id: 'REC-000002', customerName: 'Vipal', customerDocument: '07857217000161', valueCents: 99, dueDate: '2026-11-01' }]
  const ids = (search) => filterReceivables(rows, { search, status: 'all' }).map((row) => row.id)
  assert.deepEqual(ids('1.500,00'), ['REC-000001']); assert.deepEqual(ids('1500.00'), ['REC-000001'])
  assert.deepEqual(ids('08.334.818/0001-52'), ['REC-000001']); assert.deepEqual(ids('07857217'), ['REC-000002'])
  assert.deepEqual(ids('nestle'), ['REC-000001'])
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
    assert.equal((await request('/receivables', 'POST', { ...base, value: '1500', dueDate: shiftMonth(todayBahia(), 1), kind: 'recurring', recurrence: 'monthly', ahead: 25 })).status, 400)
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
