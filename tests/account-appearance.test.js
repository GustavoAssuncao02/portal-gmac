import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { appearanceSettings } from '../server/accounts.js'

test('appearance defaults to light, is authenticated, validates themes and persists by account without changing notification preferences', async (t) => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123' }
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  const login = async (cpf, password) => (await fixture.request('/auth/login', 'POST', { cpf, password })).data.token
  const headers = { Authorization: `Bearer ${await login(env.DEMO_ADMIN_CPF, env.DEMO_ADMIN_PASSWORD)}` }
  const route = '/account/appearance'
  assert.equal((await fixture.request(route)).status, 401)
  assert.equal((await fixture.request(route, 'PATCH', { theme: 'dark' }, { Authorization: `Bearer ${fixture.operatorToken}` })).status, 401)
  assert.deepEqual((await fixture.request(route, 'GET', undefined, headers)).data.settings, { theme: 'light' })
  assert.equal((await fixture.request(route, 'PATCH', { theme: 'auto' }, headers)).status, 400)
  await fixture.request('/account/notifications', 'PATCH', { payableReminderDays: 7 }, headers)
  assert.deepEqual((await fixture.request(route, 'PATCH', { theme: 'dark' }, headers)).data.settings, { theme: 'dark' })
  assert.equal((await fixture.request('/account/notifications', 'GET', undefined, headers)).data.settings.payableReminderDays, 7)
  await fixture.request('/auth/logout', 'POST', {}, headers)
  assert.equal((await fixture.request(route, 'GET', undefined, headers)).status, 401)
  const renewed = { Authorization: `Bearer ${await login(env.DEMO_ADMIN_CPF, env.DEMO_ADMIN_PASSWORD)}` }
  assert.equal((await fixture.request(route, 'GET', undefined, renewed)).data.settings.theme, 'dark')
  const other = await fixture.request('/admins', 'POST', { name: 'Outro Admin', cpf: '00000000001', email: 'outro@example.invalid', birthDate: '1990-01-01', password: 'teste123' }, renewed)
  assert.equal(other.status, 200)
  const different = { Authorization: `Bearer ${await login('00000000001', 'teste123')}` }
  assert.equal((await fixture.request(route, 'GET', undefined, different)).data.settings.theme, 'light')
  await fixture.request(route, 'PATCH', { theme: 'light' }, different)
  assert.equal((await fixture.request(route, 'GET', undefined, renewed)).data.settings.theme, 'dark')
})

test('old accounts and invalid stored appearance values never automatically select dark mode', () => {
  assert.deepEqual(appearanceSettings({}, 1), { theme: 'light' })
  assert.deepEqual(appearanceSettings({ adminAppearancePreferences: [{ userId: 1, theme: 'system' }] }, 1), { theme: 'light' })
  assert.deepEqual(appearanceSettings({ adminAppearancePreferences: [{ userId: '1', theme: 'dark' }] }, 1), { theme: 'dark' })
  assert.deepEqual(appearanceSettings({ adminAppearancePreferences: [{ userId: 2, theme: 'dark' }] }, 1), { theme: 'light' })
})
