import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { releaseNotes } from '../src/releaseNotes.js'

// Every request to the API says the version of the portal open in the browser (X-Portal-Version: the build of
// dist/version.json; X-Portal-Release: "1.0.NN"). A session the API refuses (401) takes the portal back to the login,
// which stops the screens from asking again; an old request after a new login, or a wrong password, does not.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 800 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const requests = []
page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push({ path: new URL(request.url()).pathname, headers: request.headers() }) })
const build = JSON.parse(await readFile(new URL('../dist/version.json', import.meta.url), 'utf8')).version
const login = async (password = env.DEMO_ADMIN_PASSWORD) => {
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
}
try {
  await page.goto(fixture.url)
  // A wrong password is a refusal of the login, not of a session: the message of the login stays.
  await login('senha-errada')
  await page.getByText(/CPF ou senha inválidos/).waitFor()
  await login()
  await page.locator('.admin-home-main').waitFor()
  const token = await page.evaluate(() => sessionStorage.getItem('gmac-admin-token'))
  // The version goes with every request of the portal.
  const signed = requests.filter((item) => item.headers.authorization)
  assert.ok(signed.length > 0)
  assert.ok(signed.every((item) => item.headers['x-portal-version'] === build && item.headers['x-portal-release'] === releaseNotes[0].version), 'every request says the build and the release')

  // The session ends on the server (as when it expires): the next request takes the portal back to the login.
  assert.equal((await fixture.request('/auth/logout', 'POST', undefined, { Authorization: `Bearer ${token}` })).status, 200)
  await page.locator('.sidebar').getByRole('button', { name: 'Cadastros', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Clientes', exact: true }).click()
  await page.getByRole('heading', { name: 'Entrar no sistema', exact: true }).waitFor()
  await page.getByText('Sua sessão expirou. Entre novamente.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => sessionStorage.getItem('gmac-admin-token')), null)
  await page.screenshot({ path: 'test-results/session-expired.png' })
  // Nothing asks with the old session any more.
  const before = requests.length
  await page.waitForTimeout(2500)
  assert.equal(requests.slice(before).filter((item) => item.headers.authorization === `Bearer ${token}`).length, 0, 'no request with the ended session')

  // A new login works; a late answer for the old session does not take the new one out.
  await login()
  await page.locator('.admin-home-main').waitFor()
  assert.equal(await page.evaluate(async (old) => (await fetch('/api/notifications', { headers: { Authorization: `Bearer ${old}` } })).status, token), 401)
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.admin-home-main').count(), 1, 'still in the portal')
  assert.ok(await page.evaluate(() => Boolean(sessionStorage.getItem('gmac-admin-token'))))
  assert.deepEqual(errors, [])
  console.log('Session expired passed: every request sends X-Portal-Version and X-Portal-Release, an ended session goes back to the login with "Sua sessão expirou" and stops asking, a wrong password and a late answer of an old session do not.')
} catch (error) {
  await page.screenshot({ path: 'test-results/session-expired-failure.png', fullPage: true })
  throw error
} finally { await browser.close(); await fixture.close() }
