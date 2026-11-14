import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'

// Ticket TCK-0001 (2026-11-13): a payable settled by a bank reconciliation, then reversed by undoing it, could not be
// deleted ("Conta com pagamento") nor deactivated (it is not paid any more). Only a payment the account has now blocks it.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }

test('an account whose payment or receipt was reversed can be deleted; a paid one still cannot', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const request = (route, method, body) => f.request(route, method, body, { Authorization: `Bearer ${token}` })
    const reason = 'Lançamento era de outra conta'

    const supplier = (await request('/suppliers', 'POST', { name: 'Fornecedor teste', document: '12345678000190', email: 'supplier@example.invalid', phone: '71999999999' })).data.item
    const category = (await request('/classifications', 'POST', { name: 'Serviços' })).data.item
    const draft = { supplierId: supplier.id, classificationId: category.id, description: 'Serviço', documentNumber: 'NF 640', issueDate: todayBahia(), value: '1500', dueDate: todayBahia(), kind: 'normal' }
    const payable = (await request('/payables', 'POST', draft)).data.items[0]
    assert.equal((await request(`/payables/${payable.id}/pay`, 'POST', { date: todayBahia(), method: 'pix' })).status, 200)
    let detail = (await request(`/payables/${payable.id}`)).data
    assert.deepEqual([detail.canDelete, (await request(`/payables/${payable.id}`, 'DELETE')).status], [false, 409], 'paid: deactivate it instead')
    assert.equal((await request(`/payables/${payable.id}/reverse`, 'POST', { reason })).status, 200)
    detail = (await request(`/payables/${payable.id}`)).data
    assert.equal(detail.canDelete, true, 'reversed: open again, it can be deleted')
    assert.equal((await request(`/payables/${payable.id}`, 'DELETE')).status, 200)
    const history = (await request('/payables/history')).data.items.filter((item) => item.accountId === payable.id).map((item) => item.type)
    for (const type of ['paid', 'reversed', 'deleted']) assert.ok(history.includes(type), `the history keeps "${type}"`)

    const base = { customerName: 'Cliente teste', customerDocument: '08334818000152', description: 'Serviço', documentNumber: 'NF 641', value: '900', dueDate: todayBahia(), kind: 'single' }
    const receivable = (await request('/receivables', 'POST', base)).data.items[0]
    assert.equal((await request(`/receivables/${receivable.id}/receive`, 'POST', { date: todayBahia(), method: 'pix' })).status, 200)
    assert.equal((await request(`/receivables/${receivable.id}`)).data.canDelete, false)
    assert.equal((await request(`/receivables/${receivable.id}/reverse`, 'POST', { reason })).status, 200)
    assert.equal((await request(`/receivables/${receivable.id}`)).data.canDelete, true)
    assert.equal((await request(`/receivables/${receivable.id}`, 'DELETE')).status, 200)
  } finally {
    await f.close()
  }
})
