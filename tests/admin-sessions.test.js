import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createWorkflowFixture } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const hash = (token) => createHash('sha256').update(token).digest('hex')

// Administrator logins live in the database: restarting the API (the memory rebuilt from the table) keeps them, the
// table holds only a hash of each token, and a new password ends them there as well.
test('administrator logins survive a restart of the API and a new password ends them', async (t) => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  const { loadAdminSessions } = await fixture.serverModule('accounts.js')
  const { storePool } = await fixture.serverModule('store.js')
  const tokens = async () => (await storePool().query('SELECT token_hash FROM admin_sessions'))[0].map((row) => row.token_hash)
  const signedIn = async (token) => (await fixture.request('/account/notifications', 'GET', undefined, { Authorization: `Bearer ${token}` })).status === 200

  const { token } = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data
  assert.ok((await tokens()).includes(hash(token)), 'the login is in the database')
  assert.ok(!(await tokens()).includes(token), 'only a hash of the token is stored')

  // A restart: the open sessions come back from the database, with the name of who signed in.
  assert.ok(await loadAdminSessions() >= 1)
  assert.equal(await signedIn(token), true, 'still signed in after the restart')
  assert.equal((await storePool().query('SELECT user_name FROM admin_sessions WHERE token_hash = ?', [hash(token)]))[0][0].user_name, env.DEMO_ADMIN_NAME)

  // Without its row, the session does not come back on the next restart.
  const other = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  await storePool().query('DELETE FROM admin_sessions WHERE token_hash = ?', [hash(other)])
  await loadAdminSessions()
  assert.equal(await signedIn(other), false)
  assert.equal(await signedIn(token), true)

  // A new password ends the sessions already open, in the database as well; the one returned with it goes on.
  const changed = await fixture.request('/account', 'PATCH', { name: env.DEMO_ADMIN_NAME, currentPassword: env.DEMO_ADMIN_PASSWORD, password: 'nova-senha-123' }, { Authorization: `Bearer ${token}` })
  assert.equal(changed.status, 200, changed.data?.message)
  assert.equal(await signedIn(token), false)
  assert.deepEqual(await tokens(), [hash(changed.data.token)])
  await loadAdminSessions()
  assert.equal(await signedIn(changed.data.token), true)
  assert.equal(await signedIn(token), false)
})

// The current password asked in Configurações is a password check too: a session left open could try passwords there.
test('the current password in Configurações cannot be guessed: 5 wrong ones per hour, then a pause', async (t) => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  const session = { Authorization: `Bearer ${(await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token}` }
  const save = (currentPassword) => fixture.request('/account', 'PATCH', { name: env.DEMO_ADMIN_NAME, currentPassword }, session)
  for (let i = 0; i < 4; i += 1) assert.equal((await save('errada1')).status, 403)
  assert.equal((await save(env.DEMO_ADMIN_PASSWORD)).status, 200, 'a few typos do not get in the way, and the right one clears the count')
  for (let i = 0; i < 5; i += 1) assert.equal((await save('errada1')).data.message, 'Senha atual incorreta.')
  const held = await save(env.DEMO_ADMIN_PASSWORD)
  assert.equal(held.status, 429, 'even the right one waits')
  assert.match(held.data.message, /^Muitas tentativas com a senha atual errada\. Aguarde 60 minutos/)
})
