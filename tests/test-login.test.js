import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import createLoginRouter, { testLoginEnabled } from '../server/authLogin.js'
import { requireAdmin } from '../server/accounts.js'
import { requireOperator } from '../server/operatorAuth.js'

async function fixture(t, env, users = [{ id: 7, name: 'Gustavo', cpf: '12345678901' }]) {
  const app = express()
  app.use(express.json())
  app.use('/api', createLoginRouter({
    admins: async () => users,
    authenticate: async (cpf, password) => password === 'correct-password' ? users.find((user) => user.cpf === cpf) : null,
  }, env))
  app.get('/api/admin-only', requireAdmin, (request, response) => response.json({ id: request.adminId, name: request.adminName }))
  app.get('/api/operator-only', requireOperator, (_request, response) => response.json({ ok: true }))
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)) })
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() }))
  return async (path, body, token) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, data: await response.json() }
  }
}

test('temporary login requires explicit opt-in and is always disabled in production', () => {
  assert.equal(testLoginEnabled({}), false)
  assert.equal(testLoginEnabled({ TEST_LOGIN_ENABLED: 'false' }), false)
  assert.equal(testLoginEnabled({ TEST_LOGIN_ENABLED: 'true' }), true)
  assert.equal(testLoginEnabled({ TEST_LOGIN_ENABLED: 'true', NODE_ENV: 'production' }), false)
})

test('empty credentials issue genuine sessions for the correct role in test mode', async (t) => {
  const request = await fixture(t, { TEST_LOGIN_ENABLED: 'true', DEMO_ADMIN_CPF: '12345678901' }, [
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

test('disabling test mode restores credential checks, including in production', async (t) => {
  for (const env of [{}, { TEST_LOGIN_ENABLED: 'false' }, { TEST_LOGIN_ENABLED: 'true', NODE_ENV: 'production' }]) {
    const request = await fixture(t, env)
    assert.equal((await request('/auth/config')).data.testLoginEnabled, false)
    assert.equal((await request('/auth/login', {})).status, 400)
    assert.equal((await request('/auth/operator-login', {})).status, 400)
    assert.equal((await request('/auth/login', { cpf: '12345678901', password: 'wrong' })).status, 401)
    assert.equal((await request('/auth/login', { cpf: '12345678901', password: 'correct-password' })).status, 200)
  }
})

test('test mode does not create an administrator when none is registered', async (t) => {
  const request = await fixture(t, { TEST_LOGIN_ENABLED: 'true' }, [])
  assert.equal((await request('/auth/login', {})).status, 503)
})
