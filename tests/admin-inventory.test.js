import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { adminNoticeRow } from '../server/adminInventory.js'
import { inventorySignal } from '../server/notificationEvents.js'

// Estoque Administrativo (2026-11-14): office supplies in their own tables. Same entries and average price as the factory
// stock, plus the "baixa" typed on the screen (nothing consumes it automatically), with who registered each movement.
test('the administrative stock registers, averages entries, takes exits down to zero and stays apart from the factory stock', async () => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const admin = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
    assert.equal((await fixture.request('/admin-inventory')).status, 401)
    assert.equal((await admin('/admin-inventory', 'POST', { name: 'Papel higiênico', unit: 'un', quantity: 10, icon: 'sheet' })).status, 400, 'factory icons are not office icons')
    assert.equal((await admin('/admin-inventory', 'POST', { name: 'Papel higiênico', unit: 'un', quantity: 1.5, icon: 'hygiene' })).status, 400, 'units are whole')
    const created = await admin('/admin-inventory', 'POST', { name: 'Papel higiênico', unit: 'un', quantity: 10, minimum: 4, unitPrice: 2.5, icon: 'hygiene' })
    assert.equal(created.status, 201)
    const id = created.data.id
    const item = async () => (await admin('/admin-inventory')).data.items.find((row) => row.id === id)
    assert.deepEqual([Number((await item()).quantity), (await item()).icon, (await item()).history[0].type], [10, 'hygiene', 'creation'])

    const move = (body) => admin(`/admin-inventory/${id}/movements`, 'POST', body)
    assert.equal((await move({ type: 'entry', quantity: 5, unitPrice: 4 })).status, 201)
    assert.equal(Number((await item()).unitPrice), 3, 'average price: (10 × 2,50 + 5 × 4,00) / 15')
    assert.equal((await move({ type: 'exit', quantity: 12, destination: 'Banheiro da produção', notes: 'Reposição semanal' })).status, 201)
    assert.equal((await move({ type: 'exit', quantity: 4 })).status, 409, 'no exit above the balance')
    assert.equal((await move({ type: 'exit', quantity: 0.5 })).status, 400)
    assert.equal((await move({ type: 'exit', quantity: 3 })).status, 201, 'down to zero')
    const after = await item()
    assert.equal(Number(after.quantity), 0)
    const exit = after.history.find((row) => row.type === 'exit')
    assert.deepEqual([Number(exit.quantity), exit.destination, exit.notes, Number(exit.balance), exit.userName], [12, 'Banheiro da produção', 'Reposição semanal', 3, 'Gustavo'])
    const history = (await admin(`/admin-inventory/${id}/history`)).data.history
    assert.deepEqual(history.map((row) => row.type), ['exit', 'exit', 'entry', 'creation'])

    assert.equal((await admin(`/admin-inventory/${id}`, 'PATCH', { name: 'Papel higiênico folha dupla', unit: 'un', minimum: 6, unitPrice: 3, icon: 'cleaning' })).status, 200)
    assert.deepEqual([(await item()).name, (await item()).icon], ['Papel higiênico folha dupla', 'cleaning'])
    assert.ok(!(await admin('/inventory')).data.items.some((row) => row.name.startsWith('Papel higiênico')), 'never in the factory stock')
    assert.equal((await admin(`/admin-inventory/${id}`, 'DELETE')).status, 204)
    assert.equal(await item(), undefined)
  } finally {
    await fixture.close()
  }
})

test('a low administrative stock rings the same bell with its own title', () => {
  const store = { notificationInventoryInitialized: true }
  inventorySignal(store, adminNoticeRow({ id: 3, name: 'Caneta azul', unit: 'un', quantity: 2, minimum: 5 }))
  inventorySignal(store, { id: 3, name: 'Chapa', unit: 'kg', quantity: 1, minimum: 5 })
  const [factory, office] = [...store.operationalNotifications].sort((a, b) => String(a.materialId).localeCompare(String(b.materialId)))
  assert.deepEqual([office.title, office.admin, office.materialId], ['Estoque administrativo baixo', true, 'admin-3'])
  assert.deepEqual([factory.title, factory.admin, factory.materialId], ['Estoque baixo', undefined, 3])
})
