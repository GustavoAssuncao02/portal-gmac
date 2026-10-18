import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
// Cadastros and Gestão Financeira are menu groups that may start collapsed.
const nav = async (name) => {
  const item = page.locator('.sidebar').getByRole('button', { name, exact: true })
  if (!await item.isVisible()) await page.locator('.sidebar').getByRole('button', { name: ['Fornecedores', 'Administradores', 'Funcionários', 'Clientes'].includes(name) ? 'Cadastros' : 'Gestão Financeira', exact: true }).click()
  await item.click()
}
const home = page.locator('.admin-home-main')
const metric = (key) => home.locator(`.home-payable--${key}`)
const waitLoaded = () => page.waitForFunction(() => document.querySelector('.home-payable') && !document.querySelector('.home-payable').disabled)
const rowDescriptions = () => page.locator('.payable-table tbody tr').locator('td').allTextContents()
let failPayables = false
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const auth = { Authorization: `Bearer ${token}` }
  const request = (route, method, body) => fixture.request(route, method, body, auth)
  const supplier = (await request('/suppliers', 'POST', { name: 'Fornecedor teste', document: '12345678000190' })).data.item
  const classification = (await request('/classifications', 'POST', { name: 'Despesas industriais' })).data.item
  const accounts = []
  for (const [description, dueDate, value] of [['Vencida teste', '2026-10-02', '100'], ['Hoje teste', '2026-10-03', '200'], ['Amanha teste', '2026-10-04', '300'], ['Setimo dia teste', '2026-10-10', '400'], ['Depois teste', '2026-10-11', '500'], ['Paga teste', '2026-10-03', '600'], ['Desativada teste', '2026-10-02', '700']]) {
    const result = await request('/payables', 'POST', { supplierId: supplier.id, classificationId: classification.id, description, issueDate: '2026-09-01', dueDate, value, kind: 'normal' })
    assert.equal(result.status, 201)
    accounts.push(result.data.items[0])
  }
  await fixture.mutateStore((store) => {
    store.payables.find((item) => item.id === accounts[5].id).payment = { date: '2026-10-03', method: 'Pix', finalCents: 60000, interestCents: 0, discountCents: 0 }
    store.payables.find((item) => item.id === accounts[6].id).inactive = true
  })
  await page.route('**/api/payables', async (route) => {
    if (failPayables) await route.fulfill({ status: 503, json: { message: 'Falha de teste' } })
    else await route.continue()
  })
  await page.clock.install({ time: new Date('2026-10-03T12:00:00-03:00') })
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await waitLoaded()
  assert.equal(await page.getByRole('tab', { name: 'In\u00edcio', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByRole('tab', { name: 'Dashboard', exact: true }).count(), 0)
  await page.evaluate(() => {
    const workspace = JSON.parse(sessionStorage.getItem('gmac-admin-workspace'))
    workspace.activeNav = 'Dashboard'
    workspace.tabs = ['Dashboard', 'Contas a Pagar']
    sessionStorage.setItem('gmac-admin-workspace', JSON.stringify(workspace))
  })
  await page.reload()
  await waitLoaded()
  assert.deepEqual(await page.getByRole('tab').allTextContents(), ['In\u00edcio', 'Contas a Pagar'])
  const amounts = { open: '1.500,00', overdue: '100,00', today: '200,00', upcoming: '700,00' }
  const counts = { open: '5 contas', overdue: '1 conta', today: '1 conta', upcoming: '2 contas' }
  for (const key of Object.keys(amounts)) {
    assert.ok((await metric(key).locator('strong').innerText()).includes(amounts[key]))
    assert.equal(await metric(key).locator('small').innerText(), counts[key])
  }
  await page.screenshot({ path: 'test-results/home-payables-desktop.png', fullPage: true })
  const expected = { open: ['Vencida teste', 'Hoje teste', 'Amanha teste', 'Setimo dia teste', 'Depois teste'], overdue: ['Vencida teste'], today: ['Hoje teste'], upcoming: ['Amanha teste', 'Setimo dia teste'] }
  for (const [key, descriptions] of Object.entries(expected)) {
    await metric(key).click()
    await page.getByRole('heading', { name: 'Contas a Pagar', exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelectorAll('.payable-table tbody tr td').length > 1)
    assert.equal(await page.locator('.payable-table tbody tr').count(), descriptions.length)
    const cells = await rowDescriptions()
    for (const description of descriptions) assert.ok(cells.includes(description), `${key}: ${description}`)
    assert.ok(!cells.includes('Paga teste') && !cells.includes('Desativada teste'))
    if (['today', 'upcoming'].includes(key)) {
      assert.equal(await page.getByLabel('Vencimento inicial', { exact: true }).inputValue(), key === 'today' ? '2026-10-03' : '2026-10-04')
      assert.equal(await page.getByLabel('Vencimento final', { exact: true }).inputValue(), key === 'today' ? '2026-10-03' : '2026-10-10')
    }
    await nav('In\u00edcio')
    await waitLoaded()
  }
  await metric('today').click()
  await page.getByRole('heading', { name: 'Contas a Pagar', exact: true }).waitFor()
  await nav('Contas a Pagar')
  await page.waitForFunction(() => document.querySelectorAll('.payable-table tbody tr').length === 5)
  assert.equal(await page.getByLabel('Vencimento inicial', { exact: true }).count(), 0)
  await nav('In\u00edcio')
  await waitLoaded()
  await fixture.mutateStore((store) => { store.payables.find((item) => item.id === accounts[2].id).payment = { date: '2026-10-03', finalCents: 30000, interestCents: 0, discountCents: 0 } })
  await page.clock.fastForward(30000)
  await page.waitForFunction(() => document.querySelector('.home-payable--open strong').textContent.includes('1.200,00'))
  assert.ok((await metric('upcoming').locator('strong').innerText()).includes('400,00'))
  failPayables = true
  await home.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await home.getByRole('alert').filter({ hasText: 'resumos de contas a pagar' }).waitFor()
  assert.ok((await metric('open').locator('strong').innerText()).includes('1.200,00'))
  assert.ok((await metric('open').locator('small').innerText()).includes('Dados n\u00e3o atualizados'))
  await page.reload()
  await waitLoaded()
  assert.equal(await metric('open').locator('strong').innerText(), '\u2014')
  assert.equal(await metric('open').locator('small').innerText(), 'Indispon\u00edvel')
  failPayables = false
  await home.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.home-payable--open strong').textContent.includes('1.200,00') && !document.querySelector('.home-payables-error'))
  for (const width of [1600, 1050, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no page overflow`)
    assert.ok(await home.locator('.home-payable strong, .home-payable-heading > span').evaluateAll((elements) => elements.every((item) => item.scrollWidth <= item.clientWidth)), `${width}: amounts and labels fit`)
    assert.ok(await home.locator('*').evaluateAll((elements) => elements.every((item) => getComputedStyle(item).animationName === 'none' && getComputedStyle(item).transitionDuration === '0s')))
    await page.screenshot({ path: `test-results/home-payables-${width}.png`, fullPage: true })
  }
  await fixture.mutateStore((store) => { store.payables = [] })
  await home.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.home-payable--open small').textContent === '0 contas')
  assert.ok((await metric('open').locator('strong').innerText()).includes('0,00'))
  assert.deepEqual(errors, [])
  console.log('Home payables passed: Inicio rename/legacy tabs, real totals, four filtered shortcuts, manual reset, 30-second refresh, paid/inactive exclusions, errors/retry/empty state and responsive layouts.')
} catch (error) {
  await page.screenshot({ path: 'test-results/home-payables-failure.png', fullPage: true })
  throw error
} finally { await browser.close(); await fixture.close() }
