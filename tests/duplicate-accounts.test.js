import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia, shiftMonth, accountList } from '../server/payableRules.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }

test('account lists read naturally in the duplicate warning', () => {
  assert.equal(accountList(['PAG-000012']), 'PAG-000012')
  assert.equal(accountList(['PAG-000012', 'PAG-000015']), 'PAG-000012 e PAG-000015')
  assert.equal(accountList(['A', 'B', 'C', 'D', 'E']), 'A, B, C e mais 2')
})

// TCK-0007: same supplier/client, value and date warns naming the account, and posts after the user confirms.
test('a possible duplicate account warns with the account found and is posted after confirmation', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const headers = { Authorization: `Bearer ${token}` }
    const request = (route, method, body) => f.request(route, method, body, headers)
    const supplier = (await request('/suppliers', 'POST', { name: 'Prefeitura teste', document: '12345678000190' })).data.item
    const category = (await request('/classifications', 'POST', { name: 'Taxas' })).data.item
    const dueDate = shiftMonth(todayBahia(), 1)
    const draft = { supplierId: supplier.id, classificationId: category.id, description: 'TFF usinagem', documentNumber: 'TFF 2026', issueDate: todayBahia(), value: '2656.56', dueDate, kind: 'normal' }

    const first = (await request('/payables', 'POST', draft)).data.items[0]
    const refused = await request('/payables', 'POST', { ...draft, description: 'TFF caldeiraria' })
    assert.equal(refused.status, 409)
    assert.equal(refused.data.message, `Possível conta duplicada: ${first.id} já está cadastrada com o mesmo fornecedor, valor e vencimento.`)
    assert.equal(refused.data.duplicate, true)
    assert.deepEqual(refused.data.matches.map((row) => [row.id, row.name, row.valueCents, row.dueDate, row.description, row.status]), [[first.id, 'Prefeitura teste', 265656, dueDate, 'TFF usinagem', 'pending']])
    assert.equal((await request('/payables')).data.items.length, 1, 'nothing is posted without the confirmation')

    const accepted = await request('/payables', 'POST', { ...draft, description: 'TFF caldeiraria', allowDuplicate: true })
    assert.equal(accepted.status, 201)
    const second = accepted.data.items[0]
    const history = (await request(`/payables/${second.id}`)).data.history
    assert.match(history.find((row) => row.type === 'created').details.text, new RegExp(`Possível duplicidade com ${first.id} .* confirmada pelo usuário`))

    // The pair accepted does not block other accounts, nor an edit that keeps supplier, value and due date.
    assert.equal((await request('/payables', 'POST', { ...draft, value: '10' })).status, 201)
    assert.equal((await request(`/payables/${second.id}`, 'PUT', { ...draft, description: 'TFF caldeiraria (corrigida)' })).status, 200)
    // Two equal ones already: the next warning names both.
    const third = await request('/payables', 'POST', draft)
    assert.equal(third.status, 409); assert.match(third.data.message, new RegExp(`${first.id} e ${second.id} já estão cadastradas`))
    // An edit that becomes equal to another account warns too, and saves after the confirmation.
    const other = (await request('/payables', 'POST', { ...draft, value: '20' })).data.items[0]
    const edited = await request(`/payables/${other.id}`, 'PUT', draft)
    assert.equal(edited.status, 409); assert.equal(edited.data.matches.length, 2)
    assert.equal((await request(`/payables/${other.id}`, 'PUT', { ...draft, allowDuplicate: true })).status, 200)

    // Contas a Receber: same client, value and expected date.
    const receivable = { customerName: 'Nestlé Nordeste', description: 'Serviço', value: '1500', dueDate, kind: 'single' }
    const firstReceivable = (await request('/receivables', 'POST', receivable)).data.item
    const refusedReceivable = await request('/receivables', 'POST', { ...receivable, customerName: 'NESTLÉ NORDESTE' })
    assert.equal(refusedReceivable.status, 409)
    assert.equal(refusedReceivable.data.message, `Possível conta duplicada: ${firstReceivable.id} já está cadastrada com o mesmo cliente, valor e data prevista.`)
    assert.equal(refusedReceivable.data.matches[0].id, firstReceivable.id)
    const acceptedReceivable = await request('/receivables', 'POST', { ...receivable, allowDuplicate: true })
    assert.equal(acceptedReceivable.status, 201)
    const receivableHistory = (await request(`/receivables/${acceptedReceivable.data.item.id}`)).data.history
    assert.match(receivableHistory.find((row) => row.type === 'created').details.text, /confirmada pelo usuário/)
    assert.equal((await request(`/receivables/${acceptedReceivable.data.item.id}`, 'PUT', { ...receivable, description: 'Serviço extra' })).status, 200, 'an edit that keeps client, value and date is not warned again')
  } finally { await f.close() }
})
