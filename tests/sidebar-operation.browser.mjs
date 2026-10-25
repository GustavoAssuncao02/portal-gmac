import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

// "Operação" groups the daily screens: it starts open, sits between Cadastros and Gestão Financeira, and once closed stays
// closed for the session until one of its screens is opened again.
const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'test-menu', DEMO_ADMIN_NAME: 'Gustavo' } })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const sidebar = page.locator('.sidebar')
const group = sidebar.getByRole('button', { name: 'Operação', exact: true })
const submenu = sidebar.locator('#sidebar-operation-menu')
const members = ['Serviços em andamento', 'Serviços concluídos', 'Ofertas e serviços', 'Planejamento']
const navigate = (name) => sidebar.getByRole('button', { name, exact: true }).click()
const active = () => submenu.locator('.nav-item--active').getAttribute('aria-label')
try {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill('12345678901')
  await page.getByLabel('Senha', { exact: true }).fill('test-menu')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.getByRole('heading', { name: 'Bem-vindo, Gustavo', exact: true }).waitFor()
  assert.equal(await group.getAttribute('aria-expanded'), 'true', 'Operação starts open')
  assert.deepEqual(await submenu.locator('.nav-item').allTextContents(), members)
  const order = await sidebar.locator('.sidebar-nav-group-toggle').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))
  assert.deepEqual(order, ['Cadastros', 'Operação', 'Gestão Financeira'])
  for (const name of members) {
    assert.equal(await sidebar.getByRole('button', { name, exact: true }).count(), 1)
    await navigate(name)
    await page.waitForFunction((name) => document.querySelector('#sidebar-operation-menu .nav-item--active')?.getAttribute('aria-label') === name, name)
    assert.equal(await active(), name)
  }
  await group.click()
  assert.equal(await group.getAttribute('aria-expanded'), 'false')
  assert.ok((await group.getAttribute('class')).includes('nav-item--active'), 'the closed group shows that the current screen is inside it')
  await navigate('Início')
  await page.reload()
  await page.getByRole('heading', { name: 'Bem-vindo, Gustavo', exact: true }).waitFor()
  assert.equal(await group.getAttribute('aria-expanded'), 'false', 'closing is kept for the session')
  for (const name of members) assert.equal(await sidebar.getByRole('button', { name, exact: true }).count(), 0)
  await page.getByRole('tab', { name: 'Serviços em andamento', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-controls="sidebar-operation-menu"]')?.getAttribute('aria-expanded') === 'true')
  assert.equal(await active(), 'Serviços em andamento')
  await navigate('Início')
  await page.screenshot({ path: 'test-results/sidebar-operation-desktop.png' })
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const opener = page.getByRole('button', { name: 'Abrir menu de navegação', exact: true })
    if (width <= 760 && await opener.getAttribute('aria-expanded') === 'false') await opener.click()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no overflow`)
    for (const name of ['Operação', ...members]) {
      const button = sidebar.getByRole('button', { name, exact: true })
      const bounds = await button.boundingBox(), icon = await button.locator('.nav-icon').boundingBox()
      assert.ok(icon.x >= bounds.x && icon.x + icon.width <= bounds.x + bounds.width, `${width}: ${name} icon inside`)
    }
    await page.screenshot({ path: `test-results/sidebar-operation-${width}.png` })
  }
  await group.press(' ')
  assert.equal(await group.getAttribute('aria-expanded'), 'false')
  assert.deepEqual(errors, [])
  console.log('Operation sidebar passed: starts open, three ordered entries between Cadastros and Gestão Financeira, routes, session state, tab auto-open, keyboard and mobile.')
} catch (error) {
  await page.screenshot({ path: 'test-results/sidebar-operation-failure.png' })
  throw error
} finally { await browser.close(); await fixture.close() }
