import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }

// A finished OS (already confirmed in the panel), created through the same routes the portal uses.
async function finishedOrder(f, service) {
  const offer = (await f.adminRequest('/offers', 'POST', { ...offerDraft, service })).data.item
  await f.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cut-bend'], kind: 'service' })
  await f.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 1000 } })
  const order = (await f.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const current = (await f.request('/operations/orders', 'GET', undefined, f.admin)).data.items.find((item) => item.code === order.code)
  await f.mutateStore((store) => { store.orders.find((item) => item.code === order.code).operation = { ...current.operation, status: 'completed', startedAt: '2026-10-01T10:00:00Z', completedAt: '2026-10-02T10:00:00Z', completionAcknowledgedAt: '2026-10-02T11:00:00Z' } })
  return order
}

test('reopening an OS asks what to do with its accounts receivable: keep them (the default) or delete them, as the user chooses', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const request = (route, method, body) => f.request(route, method, body, { Authorization: `Bearer ${token}` })
    const reopen = (order, body) => request(`/operations/orders/${order.code}/reopen`, 'POST', body)
    const status = async (order) => (await f.request('/operations/orders', 'GET', undefined, f.admin)).data.items.find((item) => item.code === order.code).operation.status
    const linked = async (order) => (await request(`/receivables/order/${order.code}`)).data
    const dueDate = shiftMonth(todayBahia(), 1)

    // Kept, by the answer or by omission: the account stays where it is.
    const kept = await finishedOrder(f, 'OS mantida')
    const scheduled = (await request('/receivables', 'POST', { orderCode: kept.code, value: '1000', dueDate })).data.item
    assert.equal((await linked(kept)).deleteBlock, null)
    assert.equal((await reopen(kept, { receivables: 'maybe' })).status, 400, 'only keep or delete')
    assert.equal(await status(kept), 'completed', 'a rejected answer changes nothing')
    const keptResult = await reopen(kept, { receivables: 'keep' })
    assert.equal(keptResult.status, 200, JSON.stringify(keptResult.data))
    assert.deepEqual((await linked(kept)).items.map((row) => row.id), [scheduled.id])
    assert.deepEqual(keptResult.data.event.removedReceivables, [])
    const omitted = await finishedOrder(f, 'OS sem resposta')
    const omittedRow = (await request('/receivables', 'POST', { orderCode: omitted.code, value: '1000', dueDate })).data.item
    assert.equal((await reopen(omitted, {})).status, 200)
    assert.deepEqual((await linked(omitted)).items.map((row) => row.id), [omittedRow.id])

    // Deleted: the account leaves Contas a Receber, the OS is reopened and both histories say so.
    const removed = await finishedOrder(f, 'OS com conta excluída')
    const row = (await request('/receivables', 'POST', { orderCode: removed.code, value: '1000', dueDate })).data.item
    const result = await reopen(removed, { receivables: 'delete' })
    assert.equal(result.status, 200, JSON.stringify(result.data))
    assert.equal(await status(removed), 'paused')
    assert.deepEqual(result.data.event.removedReceivables, [row.id])
    assert.match(result.data.event.details, new RegExp(`Contas a receber excluídas: ${row.id}`))
    assert.deepEqual((await linked(removed)).items, [])
    assert.equal((await request(`/receivables/${row.id}`)).status, 404)
    const history = (await request('/receivables/history')).data.items.filter((event) => event.accountId === row.id)
    assert.deepEqual(history.map((event) => event.type), ['deleted', 'created'])
    assert.equal(history[0].details.text, `Excluída ao reabrir a ${removed.code}`)
    assert.equal((await reopen(removed, { receivables: 'delete' })).status, 409, 'only a finished OS can be reopened')

    // The whole installment plan goes together.
    const plan = await finishedOrder(f, 'OS parcelada')
    const parts = (await request('/receivables', 'POST', { orderCode: plan.code, value: '3000', dueDate, kind: 'installment', count: 3 })).data.items
    assert.equal(parts.length, 3)
    assert.equal((await reopen(plan, { receivables: 'delete' })).status, 200)
    assert.deepEqual((await linked(plan)).items, [])
    assert.deepEqual((await request('/receivables')).data.items.filter((item) => item.orderCode === plan.code), [])

    // Money already received in Tesouraria for the OS is removed too when the user says so.
    const cash = await finishedOrder(f, 'OS recebida na hora')
    const entry = await request('/receivables', 'POST', { orderCode: cash.code, treasury: true, value: '1000', received: '1020', date: todayBahia(), method: 'pix' })
    assert.equal(entry.status, 201, JSON.stringify(entry.data))
    assert.equal((await linked(cash)).deleteBlock, null)
    assert.equal((await reopen(cash, { receivables: 'delete' })).status, 200)
    assert.deepEqual((await linked(cash)).items, [])

    // An account with a receipt history cannot be deleted: the OS stays finished unless the user keeps the account.
    const received = await finishedOrder(f, 'OS com recebimento')
    const receivedRow = (await request('/receivables', 'POST', { orderCode: received.code, value: '1000', dueDate })).data.item
    assert.equal((await request(`/receivables/${receivedRow.id}/receive`, 'POST', { date: todayBahia(), method: 'pix' })).status, 200)
    assert.match((await linked(received)).deleteBlock, /preserve o histórico/)
    const blocked = await reopen(received, { receivables: 'delete' })
    assert.equal(blocked.status, 409)
    assert.match(blocked.data.message, new RegExp(`Não foi possível excluir ${receivedRow.id}`))
    assert.equal(await status(received), 'completed', 'a blocked deletion does not reopen the OS')
    assert.equal((await linked(received)).items.length, 1)
    assert.equal((await reopen(received, { receivables: 'keep' })).status, 200)
    assert.equal(await status(received), 'paused')
    assert.equal((await linked(received)).items.length, 1)
  } finally { await f.close() }
})
