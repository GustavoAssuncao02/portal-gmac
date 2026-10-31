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
    const second = await fixture.adminRequest('/employees', 'POST', person(5, { type: 'administrative', password: 'senha123', identification: '' }), fixture.admin)
    assert.equal(second.status, 201, 'several administrative employees without identification')
    const other = second.data.item
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

    // Express matches routes without regard to case, so an upper-case address must be blocked too.
    for (const route of ['/receivables', '/receivables/history', '/payables/history', '/payables/order-costs', '/classifications', '/account-groups', '/dre', '/dre-adjustments', '/bank-statements', '/ai-reconciliations', '/Payables/history', '/DRE', '/Receivables', '/Bank-Statements', '/Classifications', '/PAYABLES/BATCH']) {
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

    // Seeing the administrators is not managing them: creating one, or setting the password or e-mail of one, would let
    // the employee sign in as administrator.
    const target = (await fixture.adminRequest('/admins', 'POST', { name: 'Admin Alvo', birthDate: '1990-01-01', cpf: '00000000009', email: 'alvo@example.invalid', password: 'original1' }, fixture.admin)).data.item
    const targetFields = { name: target.name, birthDate: '1990-01-01', cpf: target.cpf, email: target.email }
    for (const [method, route, body] of [['POST', '/admins', { name: 'Invasor', birthDate: '1990-01-01', cpf: '00000000008', email: 'invasor@example.invalid', password: 'invasor1' }], ['PUT', `/admins/${target.id}`, { ...targetFields, password: 'tomada12' }], ['PUT', `/admins/${target.id}`, { ...targetFields, email: 'invasor@example.invalid' }], ['DELETE', `/admins/${target.id}`]]) {
      const result = await fixture.request(route, method, body, staff)
      assert.equal(result.status, 403, `${method} ${route}`)
      assert.equal(result.data.message, 'Somente administradores criam, alteram ou excluem administradores.')
    }
    assert.equal((await fixture.request('/auth/login', 'POST', { cpf: '00000000008', password: 'invasor1' })).status, 401, 'no administrator was created')
    assert.equal((await fixture.request('/auth/login', 'POST', { cpf: target.cpf, password: 'tomada12' })).status, 401, 'the password was not changed')
    assert.equal((await fixture.adminRequest('/admins', 'GET', undefined, fixture.admin)).data.items.find((item) => item.id === target.id).email, 'alvo@example.invalid', 'nor the e-mail')
    assert.equal((await fixture.request('/auth/login', 'POST', { cpf: target.cpf, password: 'original1' })).data.user.role, 'admin')
    assert.equal((await fixture.adminRequest(`/admins/${target.id}`, 'PUT', { ...targetFields, name: 'Admin Renomeado' }, fixture.admin)).status, 200, 'an administrator still edits administrators')
    // Without an administrator session the list of administrators has only who they are: no CPF, e-mail or birth date.
    assert.deepEqual((await fixture.request('/admins', 'GET', undefined, staff)).data.items.find((item) => item.id === target.id), { id: target.id, name: 'Admin Renomeado' })
    assert.equal((await fixture.adminRequest('/admins', 'GET', undefined, fixture.admin)).data.items.find((item) => item.id === target.id).cpf, target.cpf)

    // The employee registers and edits operators, but not the employees who sign in to the portal: setting the password of
    // another one, or giving portal access to an operator, would let them sign in as someone else.
    const registered = await fixture.request('/employees', 'POST', person(6, { accessCode: '6666' }), staff)
    assert.equal(registered.status, 201, 'operators are still registered by administrative employees')
    assert.equal((await fixture.request(`/employees/${registered.data.item.id}`, 'PUT', person(6, { accessCode: '6767' }), staff)).data.item.accessCode, '6767')
    for (const [method, route, body] of [['POST', '/employees', person(3, { type: 'administrative', password: 'senha123' })], ['POST', '/employees', person(3, { type: 'both', accessCode: '3333', password: 'senha123' })], ['PUT', `/employees/${registered.data.item.id}`, person(6, { type: 'both', accessCode: '6767', password: 'senha123' })], ['PUT', `/employees/${other.id}`, person(5, { type: 'administrative', password: 'tomada12' })], ['PATCH', `/employees/${other.id}/active`, { active: false }], ['DELETE', `/employees/${other.id}`]]) {
      const result = await fixture.request(route, method, body, staff)
      assert.equal(result.status, 403, `${method} ${route}`)
      assert.equal(result.data.message, 'Somente administradores cadastram, alteram, desativam ou excluem funcionários administrativos.')
    }
    assert.equal((await fixture.request('/auth/login', 'POST', { cpf: person(6).cpf, password: 'senha123' })).status, 401, 'the operator got no portal access')
    assert.equal((await fixture.request('/auth/login', 'POST', { cpf: other.cpf, password: 'senha123' })).status, 200, 'the other employee keeps the password and stays active')
    assert.equal((await fixture.adminRequest(`/employees/${other.id}`, 'PUT', person(5, { type: 'administrative', password: 'nova1234' }), fixture.admin)).status, 200, 'an administrator still manages them')

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

test('the 4-digit code cannot be guessed: 20 codes that identify nobody in 10 minutes hold the address', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
    const identify = (code) => fixture.request('/operations/operator/identify', 'POST', { code }, operator)
    await fixture.adminRequest('/employees', 'POST', person(1, { accessCode: '4321' }), fixture.admin)
    // A typo on the tablet still just asks to check the digits, and the right code goes in.
    assert.equal((await identify('4312')).status, 404)
    assert.equal((await identify('4321')).status, 200)
    assert.equal((await identify('12')).status, 400, 'an incomplete code is not a guess')
    for (let code = 0; code < 19; code += 1) assert.equal((await identify(String(code).padStart(4, '0'))).status, 404)
    const held = await identify('4321')
    assert.equal(held.status, 429, 'after 20 wrong codes even the right one waits')
    assert.match(held.data.message, /^Muitos códigos errados\. Aguarde 10 minutos/)
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
