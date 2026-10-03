import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { populatePayables } from '../scripts/seed-payables.mjs'
import { todayBahia } from '../server/payableRules.js'

test('demo creates 120 valid payables in the requested months, preserves existing data and is idempotent', async () => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const login = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data
    const headers = { Authorization: `Bearer ${login.token}` }
    const request = async (route, method, body) => { const result = await fixture.request(route, method, body, headers); assert.ok(result.status < 400, `${route}: ${result.data.message}`); return result.data }
    const existingSupplier = (await request('/suppliers', 'POST', { name: 'Fornecedor existente', document: '12345678000190' })).item
    const existingClass = (await request('/classifications', 'POST', { name: 'Original' })).item
    const existingAccount = (await request('/payables', 'POST', { supplierId: existingSupplier.id, classificationId: existingClass.id, issueDate: '2026-09-01', dueDate: '2026-12-01', value: '123', kind: 'normal', description: 'Preservar', documentNumber: 'ORIGINAL' })).items[0]
    await fixture.mutateStore((store) => { store.offers.push({ id: 'original-offer', name: 'Preservar' }); store.orders.push({ code: 'original-order', quantity: 7 }) })
    const summary = await populatePayables(request)
    assert.equal(summary.created, 120); assert.equal(summary.totalDemo, 120)
    assert.deepEqual(summary.months, { '2026-09': 30, '2026-10': 30, '2026-11': 30, '2026-12': 30 })
    const data = await request('/payables')
    assert.equal(data.items.length, 121); assert.equal(data.suppliers.length, 11); assert.equal(data.classifications.length, 11)
    assert.equal(data.items.find((r) => r.id === existingAccount.id).valueCents, 12300)
    const demo = data.items.filter((r) => r.documentNumber.startsWith('DEMO-CP-2026'))
    assert.ok(demo.every((r) => r.dueDate >= '2026-09-01' && r.dueDate <= '2026-12-30'))
    assert.equal(new Set(demo.map((r) => `${r.supplierId}:${r.valueCents}:${r.dueDate}`)).size, 120)
    assert.ok(demo.filter((r) => r.payment).every((r) => r.payment.date <= todayBahia()))
    assert.equal(demo.filter((r) => r.kind === 'installment').length, 24)
    for (const groupId of new Set(demo.filter((r) => r.groupId).map((r) => r.groupId))) { const parts = demo.filter((r) => r.groupId === groupId); assert.equal(parts.reduce((sum, r) => sum + r.valueCents, 0), parts[0].originalTotalCents) }
    assert.equal((await populatePayables(request)).created, 0)
    assert.equal((await request('/payables')).items.length, 121)
    assert.deepEqual((await request('/offers')).items, [{ id: 'original-offer', name: 'Preservar' }])
    assert.deepEqual((await request('/orders')).items, [{ code: 'original-order', quantity: 7 }])
    assert.equal((await request('/auth/session')).user.name, 'Gustavo')
    assert.equal((await request('/auth/session')).user.passwordHash, undefined)
    await request('/auth/logout', 'POST')
    assert.equal((await fixture.request('/auth/session', 'GET', undefined, headers)).status, 401)
  } finally { await fixture.close() }
})
