import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'test-menu', DEMO_ADMIN_NAME: 'Gustavo' } })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const sidebar = page.locator('.sidebar')
const group = sidebar.getByRole('button', { name: 'Gest\u00e3o Financeira', exact: true })
const submenu = sidebar.locator('#sidebar-finance-menu')
const registrations = sidebar.getByRole('button', { name: 'Cadastros', exact: true })
const members = ['Contas a Pagar', 'Business Intelligence', 'Classifica\u00e7\u00f5es']
const navigate = (name) => sidebar.getByRole('button', { name, exact: true }).click()
try {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill('12345678901')
  await page.getByLabel('Senha', { exact: true }).fill('test-menu')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.getByRole('heading', { name: 'Bem-vindo, Gustavo', exact: true }).waitFor()
  assert.equal(await group.getAttribute('aria-expanded'), 'true')
  assert.deepEqual(await submenu.locator('.nav-item').allTextContents(), members)
  for (const name of members) {
    assert.equal(await sidebar.getByRole('button', { name, exact: true }).count(), 1)
    assert.equal(await sidebar.locator('.sidebar-nav > button').filter({ hasText: name }).count(), 0)
    await navigate(name)
    await page.getByRole('heading', { name, exact: true }).waitFor()
    assert.equal(await submenu.locator('.nav-item--active').getAttribute('aria-label'), name)
    assert.equal(await group.getAttribute('aria-expanded'), 'true')
  }
  await group.click()
  assert.equal(await group.getAttribute('aria-expanded'), 'false')
  assert.ok((await group.getAttribute('class')).includes('nav-item--active'))
  await navigate('In\u00edcio')
  assert.equal(await group.getAttribute('aria-expanded'), 'false')
  assert.equal(await registrations.getAttribute('aria-expanded'), 'true')
  await page.reload()
  await page.getByRole('heading', { name: 'Bem-vindo, Gustavo', exact: true }).waitFor()
  assert.equal(await group.getAttribute('aria-expanded'), 'false')
  for (const name of members) assert.equal(await sidebar.getByRole('button', { name, exact: true }).count(), 0)
  await page.getByRole('tab', { name: 'Business Intelligence', exact: true }).click()
  await page.getByRole('heading', { name: 'Business Intelligence', exact: true }).waitFor()
  assert.equal(await group.getAttribute('aria-expanded'), 'true')
  await navigate('In\u00edcio')
  await group.click()
  await page.locator('.home-payable--today').click()
  await page.getByRole('heading', { name: 'Contas a Pagar', exact: true }).waitFor()
  assert.equal(await group.getAttribute('aria-expanded'), 'true')
  await navigate('In\u00edcio')
  await page.screenshot({ path: 'test-results/sidebar-financial-desktop.png' })
  await sidebar.getByRole('button', { name: 'Recolher menu lateral', exact: true }).click()
  await group.click()
  await group.press('Enter')
  assert.equal(await group.getAttribute('aria-expanded'), 'true')
  assert.ok((await submenu.boundingBox()).width <= (await sidebar.boundingBox()).width)
  await navigate('Classifica\u00e7\u00f5es')
  await navigate('In\u00edcio')
  await sidebar.getByRole('button', { name: 'Expandir menu lateral', exact: true }).click()
  for (const width of [1366, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const opener = page.getByRole('button', { name: 'Abrir menu de navegação', exact: true })
    if (width <= 760 && await opener.getAttribute('aria-expanded') === 'false') await opener.click()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no overflow`)
    for (const name of ['Gest\u00e3o Financeira', ...members]) {
      const button = sidebar.getByRole('button', { name, exact: true })
      const bounds = await button.boundingBox()
      const icon = await button.locator('.nav-icon').boundingBox()
      assert.ok(icon.x >= bounds.x && icon.x + icon.width <= bounds.x + bounds.width)
    }
    await page.screenshot({ path: `test-results/sidebar-financial-${width}.png` })
  }
  await group.press(' ')
  assert.equal(await group.getAttribute('aria-expanded'), 'false')
  assert.deepEqual(errors, [])
  console.log('Financial sidebar passed: three ordered entries, routes/tabs, independent groups, toggle persistence, active auto-open, home shortcuts, collapsed sidebar, keyboard and mobile.')
} catch (error) {
  await page.screenshot({ path: 'test-results/sidebar-financial-failure.png' })
  throw error
} finally { await browser.close(); await fixture.close() }
