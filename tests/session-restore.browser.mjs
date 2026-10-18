import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, timezoneId: 'America/Bahia' })
const errors = []; page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  const token = await page.evaluate(() => sessionStorage.getItem('gmac-admin-token'))
  // Contas a Pagar is inside the "Gestão Financeira" group, which starts closed.
  await page.locator('.sidebar').getByRole('button', { name: 'Gestão Financeira', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Contas a Pagar', exact: true }).click()
  await page.getByRole('heading', { name: 'Contas a Pagar', exact: true }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: 'Contas a Pagar', exact: true }).waitFor()
  assert.equal(await page.locator('.account-copy strong').innerText(), 'Gustavo')
  assert.equal(await page.evaluate(() => sessionStorage.getItem('gmac-admin-token')), token)
  for (const [width, height] of [[1366, 768], [1280, 720], [1024, 600], [975, 568]]) {
    await page.setViewportSize({ width, height })
    await page.getByRole('button', { name: 'Nova conta a pagar', exact: true }).click()
    const modal = page.locator('dialog[open]')
    assert.ok(await modal.locator('.payable-modal-body').evaluate((el) => el.scrollHeight <= el.clientHeight + 1), `Normal form fits without scrolling at ${width}x${height}`)
    assert.ok(await modal.locator('.payable-modal-body').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `Normal form fits horizontally at ${width}x${height}`)
    assert.ok(await modal.locator('footer').evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight))
    await page.screenshot({ path: `test-results/payable-compact-${width}.png`, fullPage: true })
    await modal.getByRole('button', { name: 'Fechar janela', exact: true }).click()
  }
  await page.route('**/api/auth/session', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Indisponivel' }) }))
  await page.reload(); await page.getByRole('button', { name: 'Tentar novamente', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => sessionStorage.getItem('gmac-admin-token')), token)
  await page.unroute('**/api/auth/session')
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click(); await page.getByRole('heading', { name: 'Contas a Pagar', exact: true }).waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Sair', exact: true }).click(); await page.getByRole('heading', { name: 'Entrar no sistema', exact: true }).waitFor()
  await page.reload(); await page.getByRole('heading', { name: 'Entrar no sistema', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => sessionStorage.getItem('gmac-admin-token')), null)
  await page.evaluate(() => sessionStorage.setItem('gmac-admin-token', 'invalid-or-expired'))
  await page.reload(); await page.getByRole('heading', { name: 'Entrar no sistema', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => sessionStorage.getItem('gmac-admin-token')), null)
  assert.deepEqual(errors, [])
  console.log('Session restoration passed: verified user and workspace survive reload, offline retry keeps credentials, logout and invalid tokens return to login; compact form fits four desktop sizes.')
} finally { await browser.close(); await fixture.close() }
