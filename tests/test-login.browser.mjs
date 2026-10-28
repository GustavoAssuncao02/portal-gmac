import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.TEST_BASE_URL || 'http://localhost:5174'
const browser = await chromium.launch({ headless: true })
try {
  for (const role of ['Administrativo', 'Operador']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    // The live-server smoke test must not change business data.
    await page.route('**/api/**', (route) => {
      if (!['GET', 'HEAD'].includes(route.request().method()) && !route.request().url().includes('/api/auth/')) return route.abort()
      return route.continue()
    })
    let configAttempts = 0
    await page.route('**/api/auth/config', (route) => {
      configAttempts++
      if (configAttempts <= 2) return route.fulfill({ status: 503, json: { message: 'Backend iniciando.' } })
      return route.continue()
    })
    const failedConfig = page.waitForResponse((response) => response.url().endsWith('/api/auth/config') && response.status() === 503)
    await page.goto(base)
    await failedConfig
    await page.getByRole('button', { name: role, exact: true }).click()
    assert.equal(await page.locator('form').evaluate((form) => form.noValidate), true)
    assert.equal(await page.getByLabel('Senha', { exact: true }).evaluate((input) => input.required), false)
    await page.getByText('Ambiente de teste: acesso sem senha.', { exact: true }).waitFor()
    assert.ok(configAttempts >= 3, 'Failed configuration requests must be retried')
    await page.getByRole('button', { name: role, exact: true }).click()
    const username = role === 'Administrativo' ? 'CPF' : 'Usuário compartilhado'
    assert.equal(await page.getByLabel(username, { exact: true }).inputValue(), '')
    assert.equal(await page.getByLabel('Senha', { exact: true }).inputValue(), '')
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    const screen = role === 'Administrativo' ? page.locator('.admin-home-main') : page.getByRole('heading', { name: 'Projetos em andamento', exact: true })
    await screen.waitFor({ timeout: 30000 })
    await page.reload()
    await screen.waitFor({ timeout: 30000 })
    assert.deepEqual(errors, [])
    console.log(`${role}: falha inicial da API recuperada, login vazio e restauracao da sessao verificados`)
    await context.close()
  }
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.route('**/api/auth/config', (route) => route.fulfill({ json: { testLoginEnabled: false } }))
  await page.goto(base)
  await page.getByText('Informe seu CPF e senha para acessar.', { exact: true }).waitFor()
  assert.equal(await page.locator('form').evaluate((form) => form.checkValidity()), false)
  await page.getByRole('button', { name: 'Operador', exact: true }).click()
  assert.equal(await page.locator('form').evaluate((form) => form.checkValidity()), false)
  await context.close()
  console.log('Modo normal: campos obrigatorios preservados')
} finally {
  await browser.close()
}
