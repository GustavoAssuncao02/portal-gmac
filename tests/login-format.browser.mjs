import 'dotenv/config'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const browser = await chromium.launch({ headless: true })
const frontend = 'http://localhost:5174'
const api = 'http://localhost:3002'
const errors = []
await mkdir('test-results', { recursive: true })

try {
  for (const [role, route, key, username, password] of [
    ['Administrativo', '/api/auth/login', 'cpf', process.env.DEMO_ADMIN_CPF, process.env.DEMO_ADMIN_PASSWORD],
    ['Operador', '/api/auth/operator-login', 'username', process.env.OPERATOR_USERNAME, process.env.OPERATOR_PASSWORD],
  ]) {
    const digits = String(username || '').replace(/\D/g, '')
    assert.match(digits, /^\d{11}$/, `${role} fixture requires eleven digits`)
    assert.ok(password, `${role} fixture requires a configured password`)
    for (const invalid of ['123', '123456789012', '123.456.789-01', 'abcdefghijk', 12345678901]) {
      const response = await fetch(`${api}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: invalid, password }) })
      assert.equal(response.status, 400, `${role} rejects an invalid login format`)
    }
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
    try {
      const page = await context.newPage()
      page.on('pageerror', (error) => errors.push(error.message))
      const submissions = []
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === route) submissions.push(request.postDataJSON())
      })
      await page.goto(frontend)
      await page.getByRole('button', { name: role, exact: true }).click()
      const field = page.locator(role === 'Administrativo' ? '#cpf' : '#operator-username')
      assert.equal(await field.getAttribute('inputmode'), 'numeric')
      assert.equal(await field.getAttribute('placeholder'), '00000000000')
      await field.fill('123.456.789-01')
      assert.equal(await field.inputValue(), '12345678901')
      await field.fill('abc123456789012345')
      assert.equal(await field.inputValue(), '12345678901')
      await field.fill('1234567890')
      await page.locator('#password').fill(password)
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
      assert.equal(await field.evaluate((element) => element.validity.valid), false)
      assert.equal(submissions.length, 0)
      await field.fill(digits)
      for (const [name, width, height] of [['desktop', 1366, 768], ['mobile', 390, 844]]) {
        await page.setViewportSize({ width, height })
        await page.screenshot({ path: `test-results/login-${role.toLowerCase()}-${name}.png`, fullPage: true })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      }
      const loginResponse = page.waitForResponse((response) => new URL(response.url()).pathname === route)
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
      assert.equal((await loginResponse).status(), 200)
      await page.locator(role === 'Administrativo' ? '.dashboard-shell' : '.operator-app').waitFor()
      assert.equal(submissions.length, 1)
      assert.equal(submissions[0][key], digits)
    } finally {
      await context.close()
    }
  }
  assert.deepEqual(errors, [])
  console.log('Both logins passed: eleven unformatted digits, formatted input normalization, length validation, API rejection of invalid formats, successful real authentication, and desktop/mobile layout.')
} finally {
  await browser.close()
}
