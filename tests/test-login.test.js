import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import createLoginRouter, { testLoginEnabled } from '../server/authLogin.js'
import { requireAdmin } from '../server/accounts.js'
import { requireOperator } from '../server/operatorAuth.js'
import { createLoginThrottle } from '../server/loginThrottle.js'
import { configureStore } from '../server/store.js'
import { createTestDatabase } from './workflowFixture.js'

// `throttles` replaces the limits of the router (with a clock of the test); `ip` is the address of the request, as the
// hosting balancer sends it.
async function fixture(t, env, users = [{ id: 7, name: 'Gustavo', cpf: '12345678901' }], throttles = {}) {
  const app = express()
  app.set('trust proxy', true)
  app.use(express.json())
  app.use('/api', createLoginRouter({
    admins: async () => users.filter((user) => user.role !== 'staff'),
    accountByCpf: async (cpf) => users.find((user) => user.cpf === cpf) || null,
    authenticate: async (cpf, password) => password === 'correct-password' ? users.find((user) => user.cpf === cpf) : null,
  }, env, undefined, throttles))
  app.get('/api/admin-only', requireAdmin, (request, response) => response.json({ id: request.adminId, name: request.adminName }))
  app.get('/api/operator-only', requireOperator, (_request, response) => response.json({ ok: true }))
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)) })
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() }))
  return async (path, body, token, ip) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ip ? { 'X-Forwarded-For': ip } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, data: await response.json() }
  }
}

// The test portal of this computer: the API and the database on it, as in the local .env.
const local = { API_HOST: '127.0.0.1', DB_HOST: '127.0.0.1' }
const testMode = { ...local, TEST_LOGIN_ENABLED: 'true' }

test('temporary login requires explicit opt-in and is always disabled in production', () => {
  assert.equal(testLoginEnabled({}), false)
  assert.equal(testLoginEnabled({ ...local, TEST_LOGIN_ENABLED: 'false' }), false)
  assert.equal(testLoginEnabled(testMode), true)
  assert.equal(testLoginEnabled({ ...testMode, NODE_ENV: 'production' }), false)
  // Hosting panels keep what was typed.
  assert.equal(testLoginEnabled({ ...local, TEST_LOGIN_ENABLED: 'True', NODE_ENV: 'Development' }), true)
  assert.equal(testLoginEnabled({ ...local, TEST_LOGIN_ENABLED: 'TRUE', NODE_ENV: 'Production' }), false)
  // Only "true" switches it on.
  for (const value of ['1', 'yes', 'on', 'sim', 'verdadeiro']) assert.equal(testLoginEnabled({ ...local, TEST_LOGIN_ENABLED: value }), false, value)
  // Without API_HOST the API listens on 127.0.0.1 (index.js); other names of this computer count too.
  for (const env of [{ DB_HOST: 'localhost' }, { API_HOST: 'localhost', DB_HOST: '::1' }, { API_HOST: '::1', DB_HOST: '127.0.0.1' }, { API_HOST: '[::1]', DB_HOST: 'LOCALHOST' }]) {
    assert.equal(testLoginEnabled({ ...env, TEST_LOGIN_ENABLED: 'true' }), true, JSON.stringify(env))
  }
})

test('a published portal always asks for the password, even with NODE_ENV missing or mistyped', () => {
  // The hosting listens on the network (API_HOST=0.0.0.0) and reads its own MySQL node: whatever NODE_ENV says, the
  // passwordless access stays off. A missing database setting keeps it off too.
  for (const env of [
    { API_HOST: '0.0.0.0', DB_HOST: '10.100.0.12' },
    { API_HOST: '0.0.0.0', DB_HOST: '10.100.0.12', NODE_ENV: '' },
    { API_HOST: '0.0.0.0', DB_HOST: '10.100.0.12', NODE_ENV: 'producao' },
    { API_HOST: '0.0.0.0', DB_HOST: '10.100.0.12', NODE_ENV: 'development' },
    { API_HOST: '0.0.0.0', DB_HOST: '127.0.0.1' },
    { API_HOST: '::', DB_HOST: '127.0.0.1' },
    { API_HOST: '192.168.1.100', DB_HOST: 'localhost' },
    { API_HOST: '127.0.0.1', DB_HOST: '10.100.0.12' },
    { API_HOST: '127.0.0.1', DB_HOST: 'node1234-env-2648028.ce.br.saveincloud.net.br' },
    { API_HOST: '127.0.0.1', DB_HOST: '127.0.0.1.example.com' },
    { API_HOST: '127.0.0.1' },
    { API_HOST: '127.0.0.1', DB_HOST: '' },
  ]) assert.equal(testLoginEnabled({ ...env, TEST_LOGIN_ENABLED: 'true' }), false, JSON.stringify(env))
})

test('empty credentials issue genuine sessions for the correct role in test mode', async (t) => {
  const request = await fixture(t, { ...testMode, DEMO_ADMIN_CPF: '12345678901' }, [
    { id: 1, name: 'Outro administrador', cpf: '00000000001' },
    { id: 7, name: 'Gustavo', cpf: '12345678901' },
  ])
  assert.equal((await request('/auth/config')).data.testLoginEnabled, true)
  const admin = await request('/auth/login', { cpf: '', password: '' })
  assert.equal(admin.status, 200)
  assert.equal(admin.data.user.name, 'Gustavo')
  assert.equal((await request('/admin-only', undefined, admin.data.token)).status, 200)
  assert.equal((await request('/operator-only', undefined, admin.data.token)).status, 401)
  const operator = await request('/auth/operator-login', { username: '', password: '' })
  assert.equal(operator.status, 200)
  assert.equal((await request('/operator-only', undefined, operator.data.token)).status, 200)
  assert.equal((await request('/admin-only', undefined, operator.data.token)).status, 401)
  assert.equal((await request('/admin-only')).status, 401)
})

test('in test mode the CPF chooses the profile without password: administrator or administrative employee', async (t) => {
  const request = await fixture(t, testMode, [
    { id: 0, name: 'GMAC', cpf: '00000000000', role: 'admin' },
    { id: 'employee-21', name: 'Teste Administrativo', cpf: '11111111111', role: 'staff' },
  ])
  const admin = await request('/auth/login', { cpf: '00000000000', password: '' })
  assert.deepEqual([admin.status, admin.data.user.name, admin.data.user.role], [200, 'GMAC', 'admin'])
  const staff = await request('/auth/login', { cpf: '111.111.111-11', password: '' })
  assert.deepEqual([staff.status, staff.data.user.name, staff.data.user.role], [200, 'Teste Administrativo', 'staff'])
  assert.equal((await request('/admin-only', undefined, staff.data.token)).data.id, 'employee-21')
  const unknown = await request('/auth/login', { cpf: '22222222222', password: '' })
  assert.equal(unknown.status, 401)
  assert.match(unknown.data.message, /Nenhum administrador ou funcionário administrativo com este CPF/)
})

test('disabling test mode restores credential checks, including in production', async (t) => {
  // The last two are a published portal with the switch left on and NODE_ENV missing or mistyped.
  for (const env of [{}, { ...local, TEST_LOGIN_ENABLED: 'false' }, { ...testMode, NODE_ENV: 'production' }, { TEST_LOGIN_ENABLED: 'true', API_HOST: '0.0.0.0', DB_HOST: '10.100.0.12' }, { TEST_LOGIN_ENABLED: 'true', API_HOST: '0.0.0.0', DB_HOST: '10.100.0.12', NODE_ENV: 'producao' }]) {
    const request = await fixture(t, env)
    assert.equal((await request('/auth/config')).data.testLoginEnabled, false)
    assert.equal((await request('/auth/login', {})).status, 400)
    assert.equal((await request('/auth/operator-login', {})).status, 400)
    assert.equal((await request('/auth/login', { cpf: '12345678901', password: 'wrong' })).status, 401)
    assert.equal((await request('/auth/login', { cpf: '12345678901', password: 'correct-password' })).status, 200)
  }
})

test('test mode does not create an administrator when none is registered', async (t) => {
  const request = await fixture(t, testMode, [])
  assert.equal((await request('/auth/login', {})).status, 503)
})

test('wrong passwords are limited: five tries, then a temporary block; a correct login clears the count', async (t) => {
  const request = await fixture(t, {})
  const wrong = () => request('/auth/login', { cpf: '12345678901', password: 'nope' })
  assert.equal((await wrong()).data.attemptsRemaining, 4)
  assert.equal((await wrong()).data.attemptsRemaining, 3)
  // After the third wrong password, two tries remain — this is what the screen warns about in red.
  assert.equal((await wrong()).data.attemptsRemaining, 2)
  assert.equal((await wrong()).data.attemptsRemaining, 1)
  const fifth = await wrong()
  assert.equal(fifth.status, 401)
  assert.equal(fifth.data.attemptsRemaining, 0)
  const sixth = await wrong()
  assert.equal(sixth.status, 429)
  assert.match(sixth.data.message, /Muitas tentativas/)
  // The correct password is blocked while the window is open.
  assert.equal((await request('/auth/login', { cpf: '12345678901', password: 'correct-password' })).status, 429)
})

test('a correct password within the limit resets the counter for that CPF', async (t) => {
  const request = await fixture(t, {})
  await request('/auth/login', { cpf: '12345678901', password: 'nope' })
  await request('/auth/login', { cpf: '12345678901', password: 'nope' })
  assert.equal((await request('/auth/login', { cpf: '12345678901', password: 'correct-password' })).status, 200)
  // Cleared: four fresh wrong tries still leave one (would be blocked if the earlier two had stuck).
  for (let i = 0; i < 4; i += 1) await request('/auth/login', { cpf: '12345678901', password: 'nope' })
  assert.equal((await request('/auth/login', { cpf: '12345678901', password: 'correct-password' })).status, 200)
})

test('one address cannot spread wrong passwords over many CPFs, and that never locks the accounts elsewhere', async (t) => {
  let clock = Date.now()
  const users = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, name: `Pessoa ${index + 1}`, cpf: `1000000000${index}` }))
  const request = await fixture(t, {}, users, { origins: createLoginThrottle({ limit: 30, now: () => clock }) })
  const attacker = '203.0.113.10'
  // 5 wrong passwords on each of 6 CPFs: every pair stays within its own limit, but the address reaches 30.
  for (const user of users.slice(0, 6)) for (let i = 0; i < 5; i += 1) assert.equal((await request('/auth/login', { cpf: user.cpf, password: 'nope' }, undefined, attacker)).status, 401)
  const held = await request('/auth/login', { cpf: users[7].cpf, password: 'nope' }, undefined, attacker)
  assert.equal(held.status, 429, 'a new CPF from the same address waits')
  assert.match(held.data.message, /^Muitas tentativas de senha\. Aguarde 60 minutos/)
  assert.equal((await request('/auth/login', { cpf: users[7].cpf, password: 'correct-password' }, undefined, attacker)).status, 429, 'even the right password waits at that address')
  // The accounts are not locked: from another address their owners sign in.
  assert.equal((await request('/auth/login', { cpf: users[0].cpf, password: 'correct-password' }, undefined, '198.51.100.7')).status, 200)
  // An office where people mistype now and then stays far from the limit, and sees the same warnings as before.
  const office = '198.51.100.20'
  assert.deepEqual([await request('/auth/login', { cpf: users[6].cpf, password: 'nope' }, undefined, office), await request('/auth/login', { cpf: users[6].cpf, password: 'nope' }, undefined, office), await request('/auth/login', { cpf: users[6].cpf, password: 'nope' }, undefined, office)].map((result) => result.data.attemptsRemaining), [4, 3, 2])
  clock += 60 * 60 * 1000 + 1000
  assert.equal((await request('/auth/login', { cpf: users[7].cpf, password: 'correct-password' }, undefined, attacker)).status, 200, 'the hold ends with the hour')
})

// The shared operator account had no limit at all. The account is read from the store (the .env login applies until an
// administrator changes it), so this test has a database of its own.
test('the shared operator account: 10 wrong passwords in 15 minutes from one address hold it, even with the right one', async (t) => {
  const database = await createTestDatabase('gmac_test_operator_login')
  t.after(() => database.drop())
  await configureStore(database.pool)
  const previous = { username: process.env.OPERATOR_USERNAME, password: process.env.OPERATOR_PASSWORD }
  Object.assign(process.env, { OPERATOR_USERNAME: '11122233344', OPERATOR_PASSWORD: 'senha-certa' })
  t.after(() => { for (const [key, value] of [['OPERATOR_USERNAME', previous.username], ['OPERATOR_PASSWORD', previous.password]]) value === undefined ? delete process.env[key] : process.env[key] = value })
  let clock = Date.now()
  const request = await fixture(t, {}, undefined, { operators: createLoginThrottle({ limit: 10, windowMs: 15 * 60000, now: () => clock }) })
  const factory = '203.0.113.50'
  const login = (password, ip = factory) => request('/auth/operator-login', { username: '11122233344', password }, undefined, ip)

  // A few typos on the tablets do not get in the way, and the right password clears the count.
  for (let i = 0; i < 3; i += 1) assert.equal((await login('errada')).status, 401)
  assert.equal((await login('senha-certa')).status, 200)
  for (let i = 0; i < 10; i += 1) assert.equal((await login('errada')).status, 401, `wrong password ${i + 1}`)
  const held = await login('errada')
  assert.equal(held.status, 429)
  assert.match(held.data.message, /^Muitas tentativas de senha\. Aguarde 15 minutos/)
  assert.equal((await login('senha-certa')).status, 429, 'even the right password waits at that address')
  assert.equal((await login('senha-certa', '198.51.100.9')).status, 200, 'another address is not held')
  clock += 15 * 60000 + 1000
  const back = await login('senha-certa')
  assert.equal(back.status, 200, 'the hold ends with the window')
  assert.equal((await request('/operator-only', undefined, back.data.token)).status, 200)
})
