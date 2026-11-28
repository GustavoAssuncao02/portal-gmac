import assert from 'node:assert/strict'
import test from 'node:test'
import { createUserActivity, sharedOperatorKey, summarizeUserActivity } from '../server/userActivity.js'
import { createTestDatabase, createWorkflowFixture } from './workflowFixture.js'

const DAY = 24 * 60 * 60 * 1000

test('activity uses a rolling 24-hour window and counts overlapping accounts sessions once', () => {
  const now = Date.UTC(2026, 10, 28, 15), start = now - DAY
  const rows = [{ loginId: 'old', loginAt: start - 10000, lastSeenAt: start + 20000, activity: [[start - 8000, start + 20000]] },
    { loginId: 'fresh', loginAt: now - 90000, lastSeenAt: now - 20000, activity: [[now - 80000, now - 50000], [now - 47000, now - 20000]] },
    { loginId: 'fresh', loginAt: now - 90000, lastSeenAt: now - 10000, activity: [[now - 60000, now - 10000]], ip: '127.0.0.1' }]
  const result = summarizeUserActivity(rows, now)
  assert.equal(result.lastLoginAt, now - 90000)
  assert.equal(result.lastLoginActiveMs, 70000)
  assert.equal(result.usage24hMs, 90000)
  assert.equal(result.logins24h, 1)
  assert.equal(result.lastActivityAt, now - 10000)
  assert.equal(result.lastConnection.ip, '127.0.0.1')
  assert.equal(summarizeUserActivity([{ ...rows[0], loginAt: null }], now).lastLoginAt, null, 'a session opened before tracking does not fabricate a login')
})

test('login and activity are persisted, renewals preserve the login, and cleanup keeps the latest login', async (t) => {
  const db = await createTestDatabase('gmac_test_user_activity')
  t.after(() => db.drop())
  let now = Date.UTC(2026, 10, 28, 15)
  const loginAt = now
  const user = { id: 'staff-4', role: 'staff' }
  const key = `staff:${user.id}`
  const request = { ip: '127.0.0.1', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0 Safari/537.36', 'x-portal-release': '1.0.28' } }
  const service = () => createUserActivity(db.pool, { now: () => now })
  const activity = service()
  const heartbeat = (token, durationMs, isOperator = false) => activity.heartbeat({ ...request, body: { durationMs, ageMs: 0 }, ...(isOperator ? { operatorToken: token } : { adminId: user.id, adminRole: user.role, adminToken: token }) }, { status: (code) => { assert.equal(code, 204); return { end() {} } } })

  await activity.register(request, 'first-test-token', user)
  now += 20000
  await heartbeat('first-test-token', 30000)
  await activity.register(request, 'renewed-test-token', user, 'first-test-token')
  now += 20000
  await Promise.all([heartbeat('renewed-test-token', 25000), heartbeat('renewed-test-token', 10000), heartbeat('renewed-test-token', 60000)])
  let data = (await service().read([key])).get(key)
  assert.equal(data.lastLoginAt, loginAt)
  assert.equal(data.logins24h, 1)
  assert.equal(data.lastLoginActiveMs, 40000)
  assert.equal(data.usage24hMs, 40000)
  assert.equal(data.lastConnection.device, 'Chrome 131 · Windows')

  now += 10000
  await activity.register(request, 'tablet-test-token')
  await heartbeat('preexisting-tablet-token', 10000, true)
  assert.equal((await service().read([sharedOperatorKey])).get(sharedOperatorKey).logins24h, 1)

  now += 3 * DAY
  await activity.prune()
  data = (await service().read([key])).get(key)
  assert.equal(data.lastLoginActiveMs, 40000)
  assert.equal(data.usage24hMs, 0)
  assert.equal(data.logins24h, 0)
  const [rows] = await db.pool.query('SELECT session_id FROM developer_user_sessions WHERE account_key = ?', [key])
  assert.ok(rows.every((item) => /^[0-9a-f]{64}$/.test(item.session_id)))
})

test('the developer directory includes registered accounts without presence and keeps usage private', async (t) => {
  const env = { DEMO_ADMIN_CPF: '02427847550', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Dev' }
  const fixture = await createWorkflowFixture({ accountsEnv: env, developerRoutes: true })
  t.after(() => fixture.close())
  const cpf = '52998224725'
  assert.equal((await fixture.adminRequest('/admins', 'POST', { cpf, name: 'Financeiro', password: 'teste123', email: 'financeiro@example.invalid', birthDate: '1990-01-01' })).status, 200)
  assert.equal((await fixture.request('/auth/activity', 'POST', { durationMs: 1000, ageMs: 0 })).status, 401)
  const response = await fixture.adminRequest('/developer/overview')
  const idle = response.data.users.people.find((person) => person.name === 'Financeiro')
  assert.equal(idle.online, false)
  assert.equal(idle.lastLoginAt, null)
  assert.equal(idle.usage24hMs, null)
  assert.equal(idle.email, 'financeiro@example.invalid')
  assert.equal(idle.cpf, undefined)

  const { data: { token } } = await fixture.request('/auth/login', 'POST', { cpf, password: 'teste123' })
  const auth = { Authorization: `Bearer ${token}` }
  assert.equal((await fixture.request('/developer/overview', 'GET', undefined, auth)).status, 403)
  assert.equal((await fixture.request('/auth/activity', 'POST', { durationMs: 1000, ageMs: 0 }, auth)).status, 204)
  const tracked = (await fixture.adminRequest('/developer/overview')).data.users.people.find((person) => person.name === 'Financeiro')
  assert.ok(tracked.lastLoginAt > 0)
  assert.equal(tracked.logins24h, 1)
  assert.ok(tracked.usage24hMs > 0 && tracked.usage24hMs <= 1000)
  assert.equal((await fixture.adminRequest('/developer/export')).data.system.users, undefined)
})
