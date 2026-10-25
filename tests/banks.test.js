import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia, filterPayables } from '../server/payableRules.js'
import { filterReceivables } from '../server/receivables.js'
import { treasuryMovements, filterMovements } from '../src/treasuryMovements.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }

test('banks: registry with branch and account; every settlement records the bank once banks exist', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const request = (route, method, body) => f.request(route, method, body, { Authorization: `Bearer ${token}` })
    const today = todayBahia()
    const supplier = (await request('/suppliers', 'POST', { name: 'Fornecedor', document: '12345678000190' })).data.item
    const category = (await request('/classifications', 'POST', { name: 'Energia' })).data.item
    const bill = async (value) => (await request('/payables', 'POST', { supplierId: supplier.id, classificationId: category.id, description: 'Compra', issueDate: today, dueDate: '2027-01-31', kind: 'normal', value })).data.items[0]
    const receivable = async (value) => (await request('/receivables', 'POST', { customerName: `Cliente ${value}`, issueDate: today, dueDate: '2027-01-31', value })).data.item

    // Before any bank is registered the settlements work as before, without a bank.
    const legacy = await bill('10')
    const paidWithout = (await request(`/payables/${legacy.id}/pay`, 'POST', { date: today, method: 'pix' })).data.item
    assert.equal(paidWithout.payment.bankId, undefined)

    assert.equal((await f.request('/banks')).status, 401)
    const itau = (await request('/banks', 'POST', { name: 'Itaú', agency: '0443', account: '98840-7' })).data.item
    assert.deepEqual([itau.name, itau.agency, itau.account], ['Itaú', '0443', '98840-7'])
    assert.equal((await request('/banks', 'POST', { name: 'itaú', agency: '0443', account: '98840-7' })).status, 409, 'the same account twice')
    const itauOther = (await request('/banks', 'POST', { name: 'Itaú', agency: '0443', account: '11111-1' })).data.item
    assert.ok(itauOther.id, 'the same bank may have another account')
    const sicoob = (await request('/banks', 'POST', { name: 'Sicoob', agency: '3025', account: '1234-5' })).data.item

    const one = await bill('100'), two = await bill('50'), three = await bill('25')
    assert.equal((await request(`/payables/${one.id}/pay`, 'POST', { date: today, method: 'pix' })).status, 400, 'the bank is required')
    assert.equal((await request(`/payables/${one.id}/pay`, 'POST', { date: today, method: 'pix', bankId: 'outro' })).status, 400)
    const paid = (await request(`/payables/${one.id}/pay`, 'POST', { date: today, method: 'pix', bankId: itau.id })).data.item
    assert.deepEqual([paid.payment.bankId, paid.payment.bankName], [itau.id, 'Itaú · Ag. 0443 · C/C 98840-7'])
    assert.equal((await request('/payables/bulk', 'POST', { action: 'pay', ids: [two.id], date: today, method: 'pix' })).status, 400)
    assert.equal((await request('/payables/bulk', 'POST', { action: 'pay', ids: [two.id], date: today, method: 'pix', bankId: sicoob.id })).data.items[0].payment.bankId, sicoob.id)
    await request('/payables/batch/items', 'POST', { ids: [three.id] })
    assert.equal((await request('/payables/batch/settle', 'POST', { date: today, method: 'pix' })).status, 400)
    assert.equal((await request('/payables/batch/settle', 'POST', { date: today, method: 'pix', bankId: itau.id })).status, 200)
    const exit = (await request('/payables', 'POST', { treasury: true, supplierId: supplier.id, classificationId: category.id, description: 'Saída', value: '30', date: today, method: 'cash', bankId: itauOther.id })).data.items[0]
    assert.equal(exit.payment.bankId, itauOther.id, 'Tesouraria records the bank as well')
    assert.equal((await request('/payables', 'POST', { treasury: true, supplierId: supplier.id, classificationId: category.id, description: 'Saída', value: '30', date: today, method: 'cash' })).status, 400)

    const r1 = await receivable('200'), r2 = await receivable('80')
    assert.equal((await request(`/receivables/${r1.id}/receive`, 'POST', { date: today, method: 'pix' })).status, 400)
    assert.equal((await request(`/receivables/${r1.id}/receive`, 'POST', { date: today, method: 'pix', bankId: sicoob.id })).data.item.receipt.bankName, 'Sicoob · Ag. 3025 · C/C 1234-5')
    assert.equal((await request('/receivables/bulk', 'POST', { action: 'receive', ids: [r2.id], date: today, method: 'pix', bankId: itau.id })).data.items[0].receipt.bankId, itau.id)
    const entry = (await request('/receivables', 'POST', { treasury: true, customerName: 'Balcão', value: '15', date: today, method: 'cash', bankId: sicoob.id })).data.item
    assert.equal(entry.receipt.bankId, sicoob.id)

    // Filters: a bank lists the accounts settled with it, whatever the situation filter.
    const payables = (await request('/payables')).data.items, receivables = (await request('/receivables')).data.items
    assert.deepEqual(filterPayables(payables, { bankId: itau.id }).map((row) => row.id).sort(), [one.id, three.id].sort())
    assert.deepEqual(filterReceivables(receivables, { bankId: sicoob.id }).map((row) => row.id).sort(), [r1.id, entry.id].sort())
    const movements = treasuryMovements(payables, receivables)
    assert.deepEqual(filterMovements(movements, { bankId: itauOther.id }).map((row) => [row.id, row.bankName]), [[exit.id, 'Itaú · Ag. 0443 · C/C 11111-1']])

    const banks = (await request('/banks')).data.items
    assert.equal(banks.find((bank) => bank.id === itau.id).settlements, 3)
    assert.equal((await request(`/banks/${itau.id}`, 'DELETE')).status, 409, 'a bank with settlements stays')
    const unused = (await request('/banks', 'POST', { name: 'Caixa interno' })).data.item
    assert.equal((await request(`/banks/${unused.id}`, 'DELETE')).status, 204)
  } finally { await f.close() }
})
