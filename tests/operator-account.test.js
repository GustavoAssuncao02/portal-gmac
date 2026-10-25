import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWorkflowFixture } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }

test('operator account: set by administrators with a reason, kept in the history, the new password ends old sessions', async (t) => {
  const previous = { username: process.env.OPERATOR_USERNAME, password: process.env.OPERATOR_PASSWORD }
  process.env.OPERATOR_USERNAME = '11122233344'
  process.env.OPERATOR_PASSWORD = 'senha-inicial'
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(async () => {
    await fixture.close()
    for (const [key, value] of [['OPERATOR_USERNAME', previous.username], ['OPERATOR_PASSWORD', previous.password]]) value === undefined ? delete process.env[key] : process.env[key] = value
  })
  const { operatorLoginMatches } = await import(pathToFileURL(path.join(fixture.directory, 'operatorAccount.js')))
  const { issueOperatorToken } = await import(pathToFileURL(path.join(fixture.directory, 'operatorAuth.js')))
  const admin = { Authorization: `Bearer ${(await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token}` }
  const request = (route, method, body) => fixture.request(route, method, body, admin)

  let account = (await request('/operator-account')).data
  assert.deepEqual([account.username, account.source, account.passwordChangedAt, account.history], ['11122233344', 'env', null, []], 'until the first change the .env login applies')
  assert.equal(await operatorLoginMatches('11122233344', 'senha-inicial'), true)
  assert.equal((await fixture.request('/operator-account')).status, 401)
  assert.equal((await request('/operator-account', 'PUT', { username: '11122233344', password: 'nova-senha', reason: 'curta' })).status, 400, 'the reason is required')
  assert.equal((await request('/operator-account', 'PUT', { username: '11122233344', reason: 'Somente o usuário, sem senha' })).status, 400, 'the first change defines the password')
  assert.equal((await request('/operator-account', 'PUT', { username: '1112223', password: 'nova-senha', reason: 'Usuário com dígitos de menos' })).status, 400)

  const oldToken = { Authorization: `Bearer ${issueOperatorToken()}` }
  assert.equal((await fixture.request('/operations/operator/orders', 'GET', undefined, oldToken)).status, 200)
  account = (await request('/operator-account', 'PUT', { username: '111.222.333-44', password: 'nova-senha', reason: 'Troca periódica da senha do tablet' })).data
  assert.equal(account.source, 'database')
  assert.ok(account.passwordChangedAt)
  assert.deepEqual(account.history.map((row) => [row.userName, row.reason, row.changes]), [['Gustavo', 'Troca periódica da senha do tablet', ['password']]])
  assert.equal(await operatorLoginMatches('11122233344', 'senha-inicial'), false, 'the .env password no longer works')
  assert.equal(await operatorLoginMatches('11122233344', 'nova-senha'), true)
  assert.equal((await fixture.request('/operations/operator/orders', 'GET', undefined, oldToken)).status, 401, 'tablets logged in with the old password sign in again')
  assert.equal((await fixture.request('/operations/operator/orders', 'GET', undefined, { Authorization: `Bearer ${issueOperatorToken()}` })).status, 200)

  const moved = (await request('/operator-account', 'PUT', { username: '99988877766', reason: 'Usuário novo para o tablet da pintura' })).data
  assert.deepEqual([moved.history[0].changes, moved.history[0].usernameBefore, moved.history[0].usernameAfter], [['username'], '11122233344', '99988877766'])
  assert.equal(moved.passwordChangedAt, account.passwordChangedAt, 'changing only the user keeps the date of the password')
  assert.equal(await operatorLoginMatches('99988877766', 'nova-senha'), true, 'the password is kept')
  assert.equal((await fixture.request('/operations/operator/orders', 'GET', undefined, { Authorization: `Bearer ${issueOperatorToken()}` })).status, 200, 'a new user alone does not end the sessions')
  assert.equal((await request('/operator-account', 'PUT', { username: '99988877766', reason: 'Nada mudou de verdade aqui' })).status, 400)

  const staff = (await request('/employees', 'POST', { name: 'Clara Adm', cpf: '00000000009', type: 'administrative', password: 'clara123' })).data.item
  const staffAuth = { Authorization: `Bearer ${(await fixture.request('/auth/login', 'POST', { cpf: staff.cpf, password: 'clara123' })).data.token}` }
  assert.equal((await fixture.request('/operator-account', 'GET', undefined, staffAuth)).status, 403, 'administrative employees do not manage the operator access')
})
