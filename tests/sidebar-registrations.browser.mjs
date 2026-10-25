import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'test-menu', DEMO_ADMIN_NAME: 'Gustavo' } })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const sidebar = page.locator('.sidebar')
const group = sidebar.getByRole('button', { name: 'Cadastros', exact: true })
const members = ['Fornecedores', 'Administradores', 'Funcion\u00e1rios', 'Setores', 'Clientes', 'Bancos', 'Raz\u00f5es de pausas']
const navigate = (name) => sidebar.getByRole('button', { name: name === 'Dashboard' ? 'In\u00edcio' : name, exact: true }).click()

try {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill('12345678901')
  await page.getByLabel('Senha', { exact: true }).fill('test-menu')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.getByRole('heading', { name: 'Bem-vindo, Gustavo', exact: true }).waitFor()
  // The groups of the side menu start closed; one click opens them.
  assert.equal(await group.getAttribute('aria-expanded'), 'false')
  await group.click()
  assert.equal(await group.getAttribute('aria-expanded'), 'true')
  assert.deepEqual(await sidebar.locator('#sidebar-cadastros-menu .nav-item').allTextContents(), members)
  for (const name of members) {
    assert.equal(await sidebar.getByRole('button', { name, exact: true }).count(), 1)
    assert.equal(await sidebar.locator('.sidebar-nav > button').filter({ hasText: name }).count(), 0)
    await navigate(name)
    await page.getByRole('tab', { name, exact: true }).waitFor()
    assert.equal(await group.getAttribute('aria-expanded'), 'true')
    assert.equal(await sidebar.locator('#sidebar-cadastros-menu .nav-item--active').getAttribute('aria-label'), name)
  }
  await navigate('Dashboard')
  assert.ok((await sidebar.boundingBox()).width <= 185, 'The submenu does not widen the existing sidebar')
  await page.screenshot({ path: 'test-results/sidebar-cadastros-desktop.png' })
  await group.click()
  assert.equal(await group.getAttribute('aria-expanded'), 'false')
  for (const name of members) assert.equal(await sidebar.getByRole('button', { name, exact: true }).count(), 0)
  await navigate('M\u00e1quinas')
  assert.equal(await group.getAttribute('aria-expanded'), 'false')
  await page.reload()
  await page.getByRole('heading', { name: 'M\u00e1quinas', exact: true }).waitFor()
  assert.equal(await group.getAttribute('aria-expanded'), 'false')
  await page.getByRole('tab', { name: 'Clientes', exact: true }).click()
  await page.getByRole('heading', { name: 'Clientes', exact: true }).waitFor()
  assert.equal(await group.getAttribute('aria-expanded'), 'true')
  await navigate('Dashboard')
  await sidebar.getByRole('button', { name: 'Recolher menu lateral', exact: true }).click()
  await group.click()
  await group.press('Enter')
  assert.equal(await group.getAttribute('aria-expanded'), 'true')
  const submenu = await sidebar.locator('#sidebar-cadastros-menu').boundingBox()
  const width = await sidebar.boundingBox()
  assert.ok(submenu.x + submenu.width <= width.x + width.width + 1)
  await navigate('Fornecedores')
  await page.getByRole('tab', { name: 'Fornecedores', exact: true }).waitFor()
  await navigate('Dashboard')
  await sidebar.getByRole('button', { name: 'Expandir menu lateral', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Abrir menu de navegação', exact: true }).click()
  await page.screenshot({ path: 'test-results/sidebar-cadastros-mobile.png' })
  for (const name of members) {
    const button = await sidebar.getByRole('button', { name, exact: true }).boundingBox()
    const icon = await sidebar.getByRole('button', { name, exact: true }).locator('.nav-icon').boundingBox()
    assert.ok(icon.x >= button.x && icon.x + icon.width <= button.x + button.width)
  }
  await group.click()
  assert.equal(await group.getAttribute('aria-expanded'), 'false')
  assert.deepEqual(errors, [])
  console.log('Cadastros passed: exactly seven ordered entries, routes/tabs, active highlight, toggle persistence, collapsed sidebar, keyboard and mobile.')
} catch (error) {
  await page.screenshot({ path: 'test-results/sidebar-cadastros-failure.png' })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
