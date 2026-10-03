import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, timezoneId: 'America/Bahia' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

const orders = [
  ['OS-01', 'Dentro do prazo', '2026-10-01T12:00:00-03:00', '2026-10-05', '3 dias'],
  ['OS-02', 'Pr\u00f3ximo do prazo', '2026-09-22T12:00:00-03:00', '2026-10-03', '1 dia'],
  ['OS-03', 'Em cima do prazo', '2026-09-20T12:00:00-03:00', '2026-10-02', '12 h'],
  ['OS-04', 'Atrasado', '2026-09-20T12:00:00-03:00', '2026-10-01', '12 h de atraso'],
].map(([code, status, createdAt, deadline, remaining]) => ({ code, expectedStatus: status, expectedRemaining: remaining, createdAt, deadline, requestedAt: createdAt, service: `Projeto ${code}`, company: 'Cliente de teste', labelNumber: code, quantity: 10, operation: { status: 'waiting', accumulatedMs: 3600000, activeSession: null, progress: 0, stages: [{ key: 'cutting', name: 'Corte' }], stageCounts: { cutting: 0 } } }))

try {
  await mkdir('test-results', { recursive: true })
  const now = new Date('2026-10-02T12:00:00-03:00')
  await page.clock.install({ time: now })
  await page.clock.pauseAt(now)
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const payload = pathname === '/api/operations/orders' ? { items: orders } : pathname === '/api/offers' ? { items: [] } : { message: 'O banco de dados ainda n\u00e3o est\u00e1 configurado.' }
    await route.fulfill({ status: pathname === '/api/auth/login' ? 503 : 200, json: payload })
  })
  await page.goto(process.env.PREVIEW_URL || 'http://localhost:5174/')
  await page.getByLabel('CPF', { exact: true }).fill('12345678901')
  await page.getByLabel('Senha', { exact: true }).fill('teste')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Servi\u00e7os em andamento', exact: true }).click()
  await page.getByRole('heading', { name: 'Painel de servi\u00e7os em andamento' }).waitFor()
  const headings = await page.locator('.admin-os-table th').allTextContents()
  assert.equal(headings[headings.indexOf('Tempo ativo') + 1], 'Tempo restante')
  const rows = page.locator('.admin-os-table tbody tr')
  assert.equal(await rows.count(), 4)
  for (const order of orders) {
    const row = rows.filter({ hasText: order.code })
    assert.equal(await row.locator('.admin-os-status').innerText(), order.expectedStatus)
    assert.equal(await row.locator('.admin-os-remaining').innerText(), order.expectedRemaining)
  }
  const colorValues = await page.locator('.admin-os-status').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color))
  assert.equal(new Set(colorValues).size, 4)
  await page.screenshot({ path: 'test-results/service-deadline-desktop.png', fullPage: true })
  for (const order of orders) {
    await page.locator('.deadline-filters').getByRole('button', { name: order.expectedStatus }).click()
    assert.equal(await rows.count(), 1)
    assert.match(await rows.innerText(), new RegExp(order.code))
  }
  await page.locator('.deadline-filters').getByRole('button', { name: 'Todos' }).click()
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.screenshot({ path: 'test-results/service-deadline-notebook.png', fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  assert.deepEqual(errors, [])
  console.log('Service deadline browser checks passed: column order, days/hours, four statuses/colors, and matching filters.')
} catch (error) {
  await page.screenshot({ path: 'test-results/service-deadline-failure.png', fullPage: true })
  throw error
} finally {
  await context.close()
  await browser.close()
}
