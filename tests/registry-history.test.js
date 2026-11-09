import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }

test('Cadastros keep who created, changed or deleted each registration, with the fields before and after', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const headers = { Authorization: `Bearer ${token}` }
    const request = (route, method, body) => f.request(route, method, body, headers)
    const history = async (registry, id) => (await request(`/registry-history/${registry}/${encodeURIComponent(id)}`)).data.items
    const changes = (event) => Object.fromEntries(event.changes.map((change) => [change.field, `${change.before} -> ${change.after}`]))

    assert.equal((await f.request('/registry-history/sectors/x')).status, 401)
    assert.equal((await request('/registry-history/unknown/x')).status, 404)

    // Setores: created and renamed; the newest change comes first.
    const sector = (await request('/sectors', 'POST', { name: 'Solda' })).data.item
    await request(`/sectors/${sector.id}`, 'PUT', { name: 'Soldagem' })
    let items = await history('sectors', sector.id)
    assert.deepEqual(items.map((event) => event.type), ['edited', 'created'])
    assert.equal(items[0].userName, 'Gustavo')
    assert.deepEqual(changes(items[0]), { name: 'Solda -> Soldagem' })
    // Saving without changing anything adds nothing.
    await request(`/sectors/${sector.id}`, 'PUT', { name: 'Soldagem' })
    assert.equal((await history('sectors', sector.id)).length, 2)

    // Bancos: the history stays after the bank is deleted.
    const bank = (await request('/banks', 'POST', { name: '341 - Itaú', agency: '0443', account: '1234-5' })).data.item
    await request(`/banks/${bank.id}`, 'PUT', { name: '341 - Itaú', agency: '0443', account: '9876-5' })
    assert.equal((await request(`/banks/${bank.id}`, 'DELETE')).status, 204)
    items = await history('banks', bank.id)
    assert.deepEqual(items.map((event) => event.type), ['deleted', 'edited', 'created'])
    assert.deepEqual(changes(items[1]), { account: '1234-5 -> 9876-5' })

    // Clientes and Solicitantes: the requester's client shows by name.
    const client = (await request('/clients', 'POST', { name: 'Cliente Histórico', documentType: 'cnpj', document: '11222333000181', email: '' })).data.item
    await request(`/clients/${client.id}`, 'PUT', { name: 'Cliente Histórico', documentType: 'cnpj', document: '11222333000181', email: 'compras@example.invalid', notes: 'Nome fantasia: CH' })
    assert.deepEqual(changes((await history('clients', client.id))[0]), { email: ' -> compras@example.invalid', notes: ' -> Nome fantasia: CH' })
    const requester = (await request('/requesters', 'POST', { name: 'Ana', clientId: String(client.id) })).data.item
    items = await history('requesters', requester.id)
    assert.equal(items[0].type, 'created')
    assert.equal(changes(items[0]).client, ' -> Cliente Histórico')

    // Administradores: a new password shows only as changed, never its value; their history is for administrators.
    const admin = (await request('/admins', 'POST', { name: 'Maria', cpf: '52998224725', email: 'maria@example.invalid', birthDate: '1990-01-02', password: 'segredo1' })).data.item
    await request(`/admins/${admin.id}`, 'PUT', { name: 'Maria Souza', cpf: '52998224725', email: 'maria@example.invalid', birthDate: '1990-01-02', password: 'segredo2' })
    items = await history('admins', admin.id)
    assert.deepEqual(changes(items[0]), { name: 'Maria -> Maria Souza', password: ' -> ' })
    assert.ok(!JSON.stringify(items).includes('segredo'))

    // Fornecedores: read from the events Contas a Pagar already keeps.
    const supplier = (await request('/suppliers', 'POST', { name: 'Fornecedor A', document: '12345678000190', email: '', phone: '' })).data.item
    await request(`/suppliers/${supplier.id}`, 'PUT', { name: 'Fornecedor A', document: '12345678000190', email: '', phone: '71999999999' })
    await request(`/suppliers/${supplier.id}`, 'PUT', { name: 'Fornecedor A', document: '12345678000190', email: 'a@example.invalid', phone: '71999999999' })
    items = await history('suppliers', supplier.id)
    assert.deepEqual(items.map((event) => event.type), ['edited', 'edited', 'created'])
    // Each event shows the supplier as it was then, not as it is now.
    assert.deepEqual(changes(items[0]), { email: ' -> a@example.invalid' })
    assert.deepEqual(changes(items[1]), { phone: ' -> 71999999999' })
    assert.equal(changes(items[2]).phone, undefined)
    assert.equal(changes(items[2]).email, undefined)
  } finally {
    await f.close()
  }
})
