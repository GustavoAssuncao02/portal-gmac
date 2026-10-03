import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const bell = () => page.getByRole('button', { name: 'Notifica\u00e7\u00f5es', exact: true })
const close = () => page.getByRole('button', { name: 'Fechar notifica\u00e7\u00f5es', exact: true }).click()
const badge = () => page.locator('.notifications-count')
const waitNoBadge = () => page.waitForFunction(() => !document.querySelector('.notifications-count'))
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const request = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  const supplier = (await request('/suppliers', 'POST', { name: 'Fornecedor teste', document: '12345678000190' })).data.item
  const classification = (await request('/classifications', 'POST', { name: 'Energia' })).data.item
  const draft = { supplierId: supplier.id, classificationId: classification.id, description: 'Conta com aviso', issueDate: todayBahia(), dueDate: todayBahia(), kind: 'normal' }
  for (const value of ['10', '20']) await request('/payables', 'POST', { ...draft, value })
  await page.clock.install()
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await badge().waitFor()
  assert.equal(await badge().innerText(), '2')
  let release
  const gate = new Promise((resolve) => { release = resolve })
  await page.route('**/api/payables/notifications/read-all', async (route) => { await gate; await route.continue() })
  await bell().click()
  await waitNoBadge()
  assert.equal(await page.locator('.notifications-payables button').count(), 2)
  await close()
  const acknowledgement = page.waitForResponse((response) => response.url().endsWith('/notifications/read-all') && response.status() === 200)
  release(); await acknowledgement
  await waitNoBadge()
  await page.unroute('**/api/payables/notifications/read-all')
  assert.equal((await request('/payables/notifications')).data.items.filter((item) => !item.readAt).length, 0)
  let loaded = page.waitForResponse((response) => response.url().endsWith('/notifications') && response.status() === 200)
  await page.reload()
  await bell().waitFor()
  await loaded
  assert.equal(await badge().count(), 0)
  await bell().click()
  await page.locator('.notifications-payables').waitFor()
  assert.equal(await page.locator('.notifications-payables button').count(), 2)
  await page.locator('.notifications-popup').screenshot({ path: 'test-results/notifications-read-open.png' })
  await page.locator('.notifications-payables button').first().click()
  await page.getByRole('dialog').getByRole('heading', { name: 'Dados principais', exact: true }).waitFor()
  await waitNoBadge()
  await page.getByRole('button', { name: 'Fechar janela', exact: true }).click()
  await request('/payables', 'POST', { ...draft, value: '30' })
  await page.clock.runFor(31000)
  await badge().waitFor()
  assert.equal(await badge().innerText(), '1')
  await page.route('**/api/payables/notifications/read-all', (route) => route.fulfill({ status: 503, json: { message: 'Indisponivel' } }))
  await bell().click()
  await page.locator('.notifications-error').waitFor()
  await close()
  await badge().waitFor()
  assert.equal(await badge().innerText(), '1')
  await page.unroute('**/api/payables/notifications/read-all')
  await bell().click()
  await page.waitForFunction(() => document.querySelectorAll('.notifications-payables button').length === 3 && !document.querySelector('.notifications-error'))
  await close(); await waitNoBadge()
  loaded = page.waitForResponse((response) => response.url().endsWith('/notifications') && response.status() === 200)
  await page.reload(); await bell().waitFor()
  await loaded
  assert.equal(await badge().count(), 0)
  assert.deepEqual(errors, [])
  console.log('Notifications passed: opening hides badge immediately, automatic reads persist on close/reload/navigation, new alerts count separately, failures retry without false acknowledgement.')
} finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await browser.close(); await fixture.close() }
