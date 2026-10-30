import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Teste' }
const person = (index, fields = {}) => ({ name: `Funcionário ${index}`, birthDate: '1990-01-01', cpf: `0000000000${index}`, email: `funcionario${index}@example.invalid`, identification: `00${index}`, ...fields })

async function orderFor(fixture) {
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  return (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
}

test('operators get a private, unique 4-digit code and identify with it on the shared operator account', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
    assert.equal((await fixture.request('/employees', 'POST', person(1))).status, 401, 'registering requires an administrator')
    const ana = await fixture.adminRequest('/employees', 'POST', person(1), fixture.admin)
    assert.equal(ana.status, 201)
    assert.equal(ana.data.item.type, 'operator')
    assert.match(ana.data.item.accessCode, /^\d{4}$/, 'a missing code is generated')
    assert.equal(ana.data.item.passwordHash, undefined)
    const bruno = await fixture.adminRequest('/employees', 'POST', person(2, { accessCode: '4827' }), fixture.admin)
    assert.equal(bruno.data.item.accessCode, '4827')
    assert.equal((await fixture.adminRequest('/employees', 'POST', person(3, { accessCode: '4827' }), fixture.admin)).status, 409)
    assert.equal((await fixture.adminRequest('/employees', 'POST', person(3, { accessCode: '12a4' }), fixture.admin)).status, 400)
    const withoutIdentification = await fixture.adminRequest('/employees', 'POST', person(6, { identification: '' }), fixture.admin)
    assert.equal(withoutIdentification.status, 201, 'operators only need the access code')
    assert.equal(withoutIdentification.data.item.identification, null)

    // The employee registration (CPF, e-mail, birth date and codes) is never public.
    assert.equal((await fixture.request('/employees')).status, 401, 'the employee list requires an administrator')
    assert.equal((await fixture.request('/employees', 'GET', undefined, operator)).status, 401, 'not even the operator account lists the employees')
    assert.ok((await fixture.adminRequest('/employees')).data.items.every((item) => item.passwordHash === undefined), 'the password is never sent')
    const adminList = (await fixture.adminRequest('/employees', 'GET', undefined, fixture.admin)).data.items
    assert.equal(adminList.find((item) => item.id === bruno.data.item.id).accessCode, '4827')

    const changed = await fixture.adminRequest(`/employees/${bruno.data.item.id}`, 'PUT', person(2, { accessCode: '5555' }), fixture.admin)
    assert.equal(changed.data.item.accessCode, '5555')
    assert.equal((await fixture.adminRequest(`/employees/${bruno.data.item.id}`, 'PUT', person(2, { accessCode: ana.data.item.accessCode }), fixture.admin)).status, 409)
    assert.equal((await fixture.request(`/employees/${bruno.data.item.id}`, 'PUT', person(2))).status, 401, 'editing requires an administrator')
    assert.equal((await fixture.request(`/employees/${bruno.data.item.id}`, 'DELETE')).status, 401)

    assert.equal((await fixture.request('/operations/operator/identify', 'POST', { code: '5555' })).status, 401)
    assert.equal((await fixture.request('/operations/operator/identify', 'POST', { code: '4827' }, operator)).status, 404, 'the old code no longer works')
    assert.equal((await fixture.request('/operations/operator/identify', 'POST', { code: '55' }, operator)).status, 400)
    const identified = await fixture.request('/operations/operator/identify', 'POST', { code: '5555' }, operator)
    assert.equal(identified.status, 200)
    assert.deepEqual(identified.data.employee, { id: bruno.data.item.id, name: 'Funcionário 2', identification: '002' })

    const order = await orderFor(fixture)
    const started = await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: identified.data.employee.id }, operator)
    assert.equal(started.status, 200)
    assert.equal(started.data.session.employeeName, 'Funcionário 2')
  } finally {
    await fixture.close()
  }
})

test('administrative employees sign in with CPF and password and use everything except the Gestão Financeira screens', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    assert.equal((await fixture.adminRequest('/employees', 'POST', person(4, { type: 'administrative' }), fixture.admin)).status, 400, 'a password is required')
    const created = await fixture.adminRequest('/employees', 'POST', person(4, { type: 'administrative', password: 'senha123', accessCode: '1111', identification: '' }), fixture.admin)
    assert.equal(created.status, 201, 'no 3-digit identification is required')
    assert.equal(created.data.item.identification, null)
    assert.equal((await fixture.adminRequest('/employees', 'POST', person(5, { type: 'administrative', password: 'senha123', identification: '' }), fixture.admin)).status, 201, 'several administrative employees without identification')
    assert.equal(created.data.item.accessCode, undefined, 'administrative employees have no operator code')
    const employee = created.data.item
    const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
    assert.equal((await fixture.request('/operations/operator/identify', 'POST', { code: '1111' }, operator)).status, 404)
    const order = await orderFor(fixture)
    assert.equal((await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: employee.id }, operator)).status, 400, 'only operators start work')

    assert.equal((await fixture.request('/auth/login', 'POST', { cpf: employee.cpf, password: 'errada1' })).status, 401)
    const login = await fixture.request('/auth/login', 'POST', { cpf: employee.cpf, password: 'senha123' })
    assert.equal(login.status, 200)
    assert.equal(login.data.user.role, 'staff')
    assert.equal(login.data.user.name, 'Funcionário 4')
    const staff = { Authorization: `Bearer ${login.data.token}` }
    assert.equal((await fixture.request('/auth/session', 'GET', undefined, staff)).data.user.role, 'staff')
    const admin = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data
    assert.equal(admin.user.role, 'admin')

    for (const route of ['/receivables', '/receivables/history', '/payables/history', '/payables/order-costs', '/classifications', '/account-groups', '/dre', '/dre-adjustments', '/bank-statements', '/ai-reconciliations']) {
      const result = await fixture.request(route, 'GET', undefined, staff)
      assert.equal(result.status, 403, route)
      assert.equal(result.data.message, 'Seu acesso não inclui a Gestão Financeira.')
    }
    const payables = await fixture.request('/payables', 'GET', undefined, staff)
    assert.equal(payables.status, 200, 'suppliers and the stock purchase form still load their registers')
    assert.deepEqual(payables.data.items, [])
    for (const route of ['/suppliers', `/payables/order-costs/${order.code}`, `/receivables/order/${order.code}`, '/admins', '/employees', '/notifications', '/account/appearance']) {
      assert.equal((await fixture.request(route, 'GET', undefined, staff)).status, 200, route)
    }
    assert.ok((await fixture.request('/notifications', 'GET', undefined, staff)).data.items.every((item) => !['payable', 'receivable'].includes(item.type)))

    const renamed = await fixture.request('/account', 'PATCH', { name: 'Funcionária Quatro', currentPassword: 'senha123' }, staff)
    assert.equal(renamed.status, 200)
    assert.equal(renamed.data.user.role, 'staff')
    const session = { Authorization: `Bearer ${renamed.data.token}` }
    assert.equal((await fixture.adminRequest('/employees', 'GET', undefined, fixture.admin)).data.items.find((item) => item.id === employee.id).name, 'Funcionária Quatro')

    assert.equal((await fixture.adminRequest(`/employees/${employee.id}`, 'DELETE', undefined, session)).status, 409, 'nobody deletes their own account')
    const demoted = await fixture.adminRequest(`/employees/${employee.id}`, 'PUT', person(4, { type: 'operator' }), fixture.admin)
    assert.equal(demoted.status, 200)
    assert.match(demoted.data.item.accessCode, /^\d{4}$/)
    assert.equal((await fixture.request('/auth/session', 'GET', undefined, session)).status, 401, 'a change of type ends the open session')
    assert.equal((await fixture.request('/auth/login', 'POST', { cpf: employee.cpf, password: 'senha123' })).status, 401)

    const promoted = await fixture.adminRequest(`/employees/${employee.id}`, 'PUT', person(4, { type: 'administrative' }), fixture.admin)
    assert.equal(promoted.status, 400, 'becoming administrative requires a password')
  } finally {
    await fixture.close()
  }
})

test('starting the portal gives every operator already registered a unique code', async () => {
  const fixture = await createWorkflowFixture()
  try {
    await fixture.mutateStore((store) => {
      store.employees = [
        { id: 'a', name: 'Ana', identification: '001' },
        { id: 'b', name: 'Bruno', identification: '002', type: 'operator', accessCode: '1234' },
        { id: 'c', name: 'Carla', identification: '003', type: 'administrative', passwordHash: 'hash' },
        { id: 'd', name: 'Davi', identification: '004', type: 'operator' },
      ]
    })
    const { ensureEmployeeAccess } = await import(pathToFileURL(path.join(fixture.directory, 'employeeAccess.js')))
    await ensureEmployeeAccess(null)
    const employees = await fixture.mutateStore((store) => structuredClone(store.employees))
    const codes = employees.map((item) => item.accessCode)
    assert.deepEqual(employees.map((item) => item.type), ['operator', 'operator', 'administrative', 'operator'])
    assert.equal(codes[1], '1234', 'existing codes are kept')
    assert.equal(codes[2], undefined)
    assert.ok([codes[0], codes[3]].every((code) => /^\d{4}$/.test(code)))
    assert.equal(new Set(codes.filter(Boolean)).size, 3)
  } finally {
    await fixture.close()
  }
})

test('an employee can be operator and administrative at once: 4-digit code on the tablet and CPF and password in the portal', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
    assert.equal((await fixture.adminRequest('/employees', 'POST', person(7, { type: 'both', accessCode: '7777' }), fixture.admin)).status, 400, 'the office side needs a password')
    assert.equal((await fixture.adminRequest('/employees', 'POST', person(7, { type: 'both', accessCode: '7777', password: 'senha123', email: '' }), fixture.admin)).status, 400, 'and an e-mail for "Esqueci minha senha"')
    const created = await fixture.adminRequest('/employees', 'POST', person(7, { type: 'both', accessCode: '7777', password: 'senha123' }), fixture.admin)
    assert.equal(created.status, 201)
    assert.equal(created.data.item.type, 'both')
    assert.equal(created.data.item.accessCode, '7777')
    assert.equal(created.data.item.passwordHash, undefined)

    const identified = await fixture.request('/operations/operator/identify', 'POST', { code: '7777' }, operator)
    assert.equal(identified.status, 200, 'identifies on the shared operator account')
    const login = await fixture.request('/auth/login', 'POST', { cpf: person(7).cpf, password: 'senha123' })
    assert.equal(login.status, 200, 'and signs in to the administrative portal')
    assert.equal(login.data.user.role, 'staff')

    // Editing without a new password keeps it; dropping the office side ends the portal access but keeps the code.
    const kept = await fixture.adminRequest(`/employees/${created.data.item.id}`, 'PUT', person(7, { type: 'both', accessCode: '7777' }), fixture.admin)
    assert.equal(kept.status, 200)
    assert.equal((await fixture.request('/auth/login', 'POST', { cpf: person(7).cpf, password: 'senha123' })).status, 200)
    const onlyOperator = await fixture.adminRequest(`/employees/${created.data.item.id}`, 'PUT', person(7, { type: 'operator', accessCode: '7777' }), fixture.admin)
    assert.equal(onlyOperator.data.item.type, 'operator')
    assert.equal((await fixture.request('/auth/login', 'POST', { cpf: person(7).cpf, password: 'senha123' })).status, 401)
    assert.equal((await fixture.request('/operations/operator/identify', 'POST', { code: '7777' }, operator)).status, 200)
  } finally {
    await fixture.close()
  }
})
