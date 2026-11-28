import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

// Desenvolvedor › Usuários online: the Versão of each browser, "desatualizada" when it is not the published build and
// "N pessoas e N tablets em versão antiga" in the heading; "Diagnóstico de uma OS" downloads the file of the code typed.
// The API of the screen is answered here (server/developer.js has its own tests in developer.test.js).
const env = { DEMO_ADMIN_CPF: '02427847550', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Dev' }
const fixture = await createWorkflowFixture({ accountsEnv: env, developerRoutes: true })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Bahia', acceptDownloads: true })
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
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
  logs: { day: { error: 2, warn: 1, info: 5, saved: 8, oldest: at - 86400000, bySource: {} }, hour: { error: 1, warn: 1, info: 1, bySource: {} } },
  logWindow: { since: at - 86400000, until: at, through: '104' },
  traffic: { minutes: 60, total: 40, perMinute: 0.7, clientErrors: 1, serverErrors: 0, averageMs: 20, p95Ms: 80, slow: 0, busiest: [], slowest: [], failing: [] },
  server: { startedAt: at - 3600000, uptimeSeconds: 3600, node: 'v22.0.0', platform: 'Linux', hostname: 'teste', pid: 1, cpus: 2, loadAverage: [0.1, 0.1, 0.1], memory: { rss: 1e8, heapUsed: 5e7, heapTotal: 8e7 }, systemMemory: { free: 1e9, total: 4e9 }, timeZone: 'America/Bahia' },
  config: { environment: 'teste', host: '127.0.0.1', port: 3002, database: 'portal', smtp: false, turnstile: false, testLogin: false, apiRateLimit: 1000, trustProxy: 'loopback', corsOrigins: 0, quotesAllowedOrigins: 0, fiscalCatalogSync: false, supportTicketEmails: false, openOfferDefaultCpfs: false },
  database: { connected: false, error: { message: 'Sem banco no teste' } },
  storage: { dataDirectory: '/tmp/teste', dataDirConfigured: false, backups: { count: 0 }, attachments: [] },
  data: { collections: [{ name: 'orders', items: 3 }], bytes: 2048, openTickets: 0 },
}
overview.users = { historyAvailable: true, people: [
  { ...overview.online.people[0], lastLoginAt: at - 2 * 3600000, lastLoginActiveMs: 23 * 60000, usage24hMs: 75 * 60000, logins24h: 2, email: 'ana@example.invalid', lastActivityAt: at - 2000 },
  ...overview.online.people.slice(1),
  { key: 'staff:offline', name: 'Júlia Projetos', role: 'staff', online: false, tabs: 0 },
] }
const diagnosed = []
const metricLogQueries = []
const recentRequest = { at: at - 500, method: 'GET', route: '/api/ordens-em-teste', status: 503, ms: 321 }
const firstError = { id: '104', at: at - 1000, level: 'error', source: 'request', message: 'Falha na consulta de teste', user: 'Dev', details: { status: 503, stack: 'Erro: conexão de teste' } }
const secondError = { id: '101', at: at - 7200000, level: 'error', source: 'server', message: 'Falha anterior de teste', details: null }
const warning = { id: '102', at: at - 2000, level: 'warn', source: 'server', message: 'Aviso de teste', details: null }
try {
  await page.route('**/api/developer/overview*', (route) => route.fulfill({ json: overview }))
  await page.route('**/api/developer/logs*', (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.has('until')) metricLogQueries.push(Object.fromEntries(params))
    if (params.get('level') === 'error') return route.fulfill({ json: params.has('before') ? { items: [secondError], more: false } : { items: [firstError], more: true } })
    return route.fulfill({ json: { items: params.get('level') === 'warn' ? [warning] : [], more: false } })
  })
  await page.route('**/api/developer/requests?until=*', (route) => route.fulfill({ json: { items: [recentRequest] } }))
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
  await online.getByRole('heading', { name: 'Usuários', exact: true }).waitFor()
  assert.equal(await online.locator('.developer-outdated-count').innerText(), '1 pessoa e 1 tablet em versão antiga')
  assert.ok((await online.locator('thead th').allInnerTexts()).includes('Versão'))
  const versions = await online.locator('td[data-label="Versão"]').evaluateAll((cells) => cells.map((cell) => [cell.firstChild.firstChild.textContent, Boolean(cell.querySelector('.developer-outdated'))]))
  assert.deepEqual(versions, [['1.0.26', false], ['1.0.25', true], ['—', true], ['—', false]])
  const ana = online.getByRole('row', { name: /Ana Financeiro/ })
  await ana.getByText('23 min', { exact: true }).waitFor()
  await ana.getByText('1 h 15 min', { exact: true }).waitFor()
  await ana.getByRole('button', { name: 'Ana Financeiro', exact: true }).click()
  const details = page.getByRole('dialog', { name: 'Ana Financeiro', exact: true })
  await details.getByText('ana@example.invalid', { exact: true }).waitFor()
  await details.getByText('Conexões ao vivo', { exact: true }).waitFor()
  await details.getByRole('button', { name: 'Fechar', exact: true }).click()
  await online.getByRole('button', { name: 'Offline', exact: true }).click()
  await online.getByRole('searchbox').fill('julia')
  await online.getByRole('button', { name: 'Júlia Projetos', exact: true }).waitFor()
  assert.equal(await online.locator('tbody tr').count(), 1)
  await online.getByRole('searchbox').clear()
  await online.getByRole('button', { name: 'Todos', exact: true }).click()
  const metrics = page.locator('.developer-metrics')
  const openMetric = async (title) => {
    await metrics.getByRole('button', { name: title }).click()
    const dialog = page.getByRole('dialog', { name: title, exact: true })
    await dialog.waitFor()
    return dialog
  }
  const closeMetric = async (dialog) => {
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
  }
  const copyMetric = async (dialog) => {
    await dialog.getByRole('button', { name: 'Copiar JSON', exact: true }).click()
    await dialog.getByText('JSON copiado para a área de transferência.', { exact: true }).waitFor()
    return JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))
  }

  const errorDialog = await openMetric('Erros (24 h)')
  await errorDialog.getByRole('button', { name: /Falha na consulta de teste/ }).click()
  await errorDialog.getByText('Erro: conexão de teste', { exact: true }).waitFor()
  await errorDialog.getByText('1 de 2 registros carregados.', { exact: false }).waitFor()
  assert.deepEqual((await copyMetric(errorDialog)).registros, [firstError])
  await errorDialog.getByRole('button', { name: 'Carregar mais', exact: true }).click()
  await errorDialog.getByText(secondError.message, { exact: true }).waitFor()
  const exportedErrors = await copyMetric(errorDialog)
  assert.equal(exportedErrors.total, 2)
  assert.deepEqual(exportedErrors.registros, [firstError, secondError])
  assert.deepEqual(metricLogQueries.map(({ level, until, through, before }) => [level, until, through, before]), [['error', String(at), '104', undefined], ['error', String(at), '104', '104']])
  const metricDownload = page.waitForEvent('download')
  await errorDialog.getByRole('button', { name: 'Baixar JSON', exact: true }).click()
  const file = await metricDownload
  assert.match(file.suggestedFilename(), /\.json$/)
  assert.deepEqual(JSON.parse(await readFile(await file.path(), 'utf8')), exportedErrors)
  await page.keyboard.press('Escape')
  await errorDialog.waitFor({ state: 'detached' })

  const cases = [
    ['Avisos (24 h)', warning.message, (data) => assert.deepEqual(data.registros, [warning])],
    ['Usuários online', 'Ana Financeiro', (data) => assert.equal(data.pessoasOnline, 2)],
    ['Requisições (60 min)', recentRequest.route, (data) => assert.deepEqual(data.registros, [recentRequest])],
    ['Servidor no ar', 'Node.js', (data) => assert.equal(data.servidor.node, overview.server.node)],
    ['Banco de dados', 'Sem banco no teste', (data) => assert.equal(data.banco.connected, false)],
  ]
  for (const [title, message, verify] of cases) {
    const dialog = await openMetric(title)
    await dialog.getByText(message, { exact: true }).waitFor()
    verify(await copyMetric(dialog))
    await closeMetric(dialog)
  }
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
  const mobileMetric = await openMetric('Avisos (24 h)')
  await mobileMetric.getByText(warning.message, { exact: true }).waitFor()
  assert.ok(await mobileMetric.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth))
  await closeMetric(mobileMetric)
  await page.unroute('**/api/developer/overview*')
  await page.bringToFront()
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
  const own = online.getByRole('row', { name: /Dev/ })
  await own.waitFor()
  assert.notEqual(await own.locator('td[data-label="Último login"]').innerText(), 'Sem registro')
  const savedSample = page.waitForResponse((response) => response.url().endsWith('/api/auth/activity') && response.status() === 204)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await savedSample
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.developer-online-table tbody tr')].some((row) => row.querySelector('button')?.textContent === 'Dev' && row.querySelector('[data-label="Uso em 24 h"]').textContent !== 'Sem medição'))
  assert.deepEqual(errors, [])
  console.log('Desenvolvedor: seis cartões, paginação, área de transferência, download JSON, usuários, atividade e diagnóstico da OS conferidos.')
} catch (error) {
  await page.screenshot({ path: 'test-results/developer-version-failure.png', fullPage: true })
  throw error
} finally { await browser.close(); await fixture.close() }
