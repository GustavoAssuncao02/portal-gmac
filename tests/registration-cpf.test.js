import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'

// Clients and suppliers can be people (CPF) as well as companies (CNPJ); e-mail is optional for both.
test('clients and suppliers are registered with CPF or CNPJ', async (t) => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const request = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  const person = await request('/clients', 'POST', { name: 'Maria Cliente', documentType: 'cpf', document: '529.982.247-25' })
  assert.equal(person.status, 200)
  assert.deepEqual([person.data.item.documentType, person.data.item.document, person.data.item.email], ['cpf', '52998224725', null])
  assert.equal((await request('/clients', 'POST', { name: 'Outra pessoa', documentType: 'cpf', document: '123' })).status, 400)
  assert.equal((await request('/clients', 'POST', { name: 'CPF como CNPJ', documentType: 'cnpj', document: '52998224725' })).status, 400, 'the type must match the number of digits')
  const supplier = await request('/suppliers', 'POST', { name: 'João Fornecedor', document: '529.982.247-25' })
  assert.equal(supplier.status, 200)
  assert.equal(supplier.data.item.document, '52998224725')
  assert.equal((await request('/suppliers', 'POST', { name: 'Empresa', document: '11.222.333/0001-81' })).status, 200)
  assert.equal((await request('/suppliers', 'POST', { name: 'Curto', document: '1234' })).status, 400)
})
