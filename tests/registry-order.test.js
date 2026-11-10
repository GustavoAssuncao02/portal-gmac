import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { byName } from '../server/byName.js'

const names = (rows) => rows.map((row) => row.name)
const sorted = (rows) => names([...rows].sort(byName))

test('names are compared ignoring accents and capitals, with numbers in order', () => {
  const rows = [{ name: 'Torno 10' }, { name: 'zeta' }, { name: 'Ágil' }, { name: 'Torno 2' }, { name: 'abc' }]
  assert.deepEqual(sorted(rows), ['abc', 'Ágil', 'Torno 2', 'Torno 10', 'zeta'])
})

// The store keeps registries in the order they were created, so a new supplier, machine or labor service used to show
// at the end of the lists (the supplier field of a new payable, for instance). The lists now come by name.
test('suppliers, machines and labor services registered later still come in alphabetical order', async (t) => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const request = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  for (const [name, document] of [['ZETA FERRAMENTAS LTDA', '11222333000181'], ['ALFA METAIS LTDA', '11444777000161'], ['Mercado Pago Instituicao de Pag', '19131243000197']]) {
    assert.ok((await request('/suppliers', 'POST', { name, document })).status < 300, name)
  }
  for (const name of ['Torno 10', 'Torno 2', 'Centro de Usinagem']) assert.ok((await request('/machines', 'POST', { name, sectors: ['Usinagem'], hourlyRate: 10 })).status < 300, name)
  for (const name of ['Serviço de Zincagem', 'Serviço de Acabamento']) assert.ok((await request('/labor-services', 'POST', { name, hourlyRate: 10 })).status < 300, name)

  const suppliers = (await request('/suppliers')).data.items
  assert.deepEqual(names(suppliers), sorted(suppliers))
  assert.deepEqual(names(suppliers), ['ALFA METAIS LTDA', 'Mercado Pago Instituicao de Pag', 'ZETA FERRAMENTAS LTDA'])
  assert.deepEqual(names((await request('/payables')).data.suppliers), names(suppliers), 'the supplier field of Contas a Pagar')

  const machines = (await request('/machines')).data.items
  assert.deepEqual(names(machines), sorted(machines))
  assert.ok(names(machines).indexOf('Torno 2') < names(machines).indexOf('Torno 10'))
  const services = (await request('/labor-services')).data.items
  assert.deepEqual(names(services), sorted(services))

  const resources = (await request('/planning')).data.resources
  for (const type of ['machine', 'labor-service']) {
    const rows = resources.filter((row) => row.type === type)
    assert.deepEqual(names(rows), sorted(rows), `planning ${type}`)
  }
})
