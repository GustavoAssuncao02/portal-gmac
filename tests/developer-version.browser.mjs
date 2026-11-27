import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

// Desenvolvedor › Usuários online: the Versão of each browser, "desatualizada" when it is not the published build and
// "N pessoas e N tablets em versão antiga" in the heading; "Diagnóstico de uma OS" downloads the file of the code typed.
// The API of the screen is answered here (server/developer.js has its own tests in developer.test.js).
const env = { DEMO_ADMIN_CPF: '02427847550', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Dev' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Bahia', acceptDownloads: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const at = Date.now()
const person = (name, role, version, outdated, extra = {}) => ({ key: `${role}:${name}`, name, role, tabs: 1, since: at - 600000, lastAt: at - 30000, ip: '10.0.0.5', device: 'Chrome 131 · Windows', requests: 12, version, build: version ? `build-${version}` : null, online: true, outdated, ...extra })
const overview = {
  generatedAt: at, version: { version: '1.0.26', date: '2026-11-26' },
  online: {
    people: [person('Ana Financeiro', 'admin', '1.0.26', false), person('Bruno Compras', 'staff', '1.0.25', true), person('Operador (tablet)', 'operator', null, true, { device: 'Chrome 120 · Android (tablet)' })],
    online: 2, tablets: 1, connections: 3, rule: 'Online: com o portal aberto e visível (conexão ao vivo) ou com atividade nos últimos 5 minutos.', build: 'build-1.0.26', outdated: { people: 1, tablets: 1 },
  },
  logs: { day: { error: 0, warn: 2, info: 5, saved: 7, oldest: at - 86400000, bySource: {} }, hour: { error: 0, warn: 1, info: 1, bySource: {} } },
  traffic: { minutes: 60, total: 40, perMinute: 0.7, clientErrors: 1, serverErrors: 0, averageMs: 20, p95Ms: 80, slow: 0, busiest: [], slowest: [], failing: [] },
  server: { startedAt: at - 3600000, uptimeSeconds: 3600, node: 'v22.0.0', platform: 'Linux', hostname: 'teste', pid: 1, cpus: 2, loadAverage: [0.1, 0.1, 0.1], memory: { rss: 1e8, heapUsed: 5e7, heapTotal: 8e7 }, systemMemory: { free: 1e9, total: 4e9 }, timeZone: 'America/Bahia' },
  config: { environment: 'teste', host: '127.0.0.1', port: 3002, database: 'portal', smtp: false, turnstile: false, testLogin: false, apiRateLimit: 1000, trustProxy: 'loopback', corsOrigins: 0, quotesAllowedOrigins: 0, fiscalCatalogSync: false, supportTicketEmails: false, openOfferDefaultCpfs: false },
  database: { connected: false, error: { message: 'Sem banco no teste' } },
  storage: { dataDirectory: '/tmp/teste', dataDirConfigured: false, backups: { count: 0 }, attachments: [] },
  data: { collections: [{ name: 'orders', items: 3 }], bytes: 2048, openTickets: 0 },
}
const diagnosed = []
try {
  await page.route('**/api/developer/overview*', (route) => route.fulfill({ json: overview }))
  await page.route('**/api/developer/logs*', (route) => route.fulfill({ json: { items: [], more: false } }))
  await page.route('**/api/developer/updates*', (route) => route.fulfill({ json: { items: [], automatic: false } }))
  await page.route('**/api/developer/diagnostics/*', (route) => {
    const code = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop())
    diagnosed.push(code)
    if (code !== 'OS-2026-0007') return route.fulfill({ status: 404, json: { message: `${code} não encontrada.` } })
    return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="diagnostico-${code}-2026-11-26-1500.json"` }, body: JSON.stringify({ diagnostico: { codigo: code } }) })
  })
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Desenvolvedor', exact: true }).click()
  const online = page.locator('section[aria-labelledby="developer-online-title"]')
  await online.locator('tbody tr').first().waitFor()
  assert.equal(await online.locator('.developer-outdated-count').innerText(), '1 pessoa e 1 tablet em versão antiga')
  assert.ok((await online.locator('thead th').allInnerTexts()).includes('Versão'))
  const versions = await online.locator('td[data-label="Versão"]').evaluateAll((cells) => cells.map((cell) => [cell.firstChild.firstChild.textContent, Boolean(cell.querySelector('.developer-outdated'))]))
  assert.deepEqual(versions, [['1.0.26', false], ['1.0.25', true], ['—', true]])
  await page.screenshot({ path: 'test-results/developer-version.png', fullPage: true })

  // Diagnóstico de uma OS: the code is checked here, then the file comes with its name.
  const code = page.getByLabel('Diagnóstico de uma OS', { exact: true })
  await code.fill('0007')
  await page.getByRole('button', { name: 'Exportar diagnóstico', exact: true }).click()
  await page.getByText('Informe o código da OS, por exemplo OS-2026-0001.', { exact: true }).waitFor()
  assert.deepEqual(diagnosed, [])
  await code.fill('os-2026-0007')
  const download = page.waitForEvent('download')
  await code.press('Enter')
  assert.equal((await download).suggestedFilename(), 'diagnostico-OS-2026-0007-2026-11-26-1500.json')
  await code.fill('OS-2026-9999')
  await page.getByRole('button', { name: 'Exportar diagnóstico', exact: true }).click()
  await page.getByText('OS-2026-9999 não encontrada.', { exact: true }).waitFor()
  assert.deepEqual(diagnosed, ['OS-2026-0007', 'OS-2026-9999'])

  // Narrow screens.
  for (const width of [1004, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await online.waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal scroll at ${width}`)
    await page.screenshot({ path: `test-results/developer-version-${width}.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log('Developer version passed: Versão column, "desatualizada" badges, "1 pessoa e 1 tablet em versão antiga", Diagnóstico de uma OS checks the code, downloads the file and shows the 404 message, narrow screens.')
} catch (error) {
  await page.screenshot({ path: 'test-results/developer-version-failure.png', fullPage: true })
  throw error
} finally { await browser.close(); await fixture.close() }
