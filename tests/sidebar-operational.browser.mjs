import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

// "Gestão Operacional" groups Máquinas, Serviços, Etapas, Estoque and Pedidos de material right below Início;
// Estoque Administrativo comes right below the group, outside it (2026-11-14). Like
// Cadastros and Gestão Financeira it starts closed, opens with any of its screens and keeps its state for the session.
// Administrative employees see it too, and the ticket form asks for its screen like the other groups.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'test-menu', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const sidebar = page.locator('.sidebar')
const group = sidebar.getByRole('button', { name: 'Gestão Operacional', exact: true })
const submenu = sidebar.locator('#sidebar-operational-menu')
const members = ['Máquinas', 'Serviços', 'Etapas', 'Estoque', 'Pedidos de material']
const navigate = (name) => sidebar.getByRole('button', { name, exact: true }).click()
const signIn = async (cpf, password) => {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(cpf)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
}
await mkdir('test-results', { recursive: true })

try {
  await signIn(env.DEMO_ADMIN_CPF, env.DEMO_ADMIN_PASSWORD)
  // Right below Início, before the calculator and the other groups; closed at first.
  const top = await sidebar.locator('.sidebar-nav > .nav-item, .sidebar-nav > .sidebar-nav-group > .sidebar-nav-group-toggle').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')))
  assert.deepEqual(top.slice(0, 4), ['Início', 'Gestão Operacional', 'Estoque Administrativo', 'Calculadora de pesos e medidas'])
  assert.deepEqual(await sidebar.locator('.sidebar-nav-group-toggle').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label'))), ['Gestão Operacional', 'Cadastros', 'Operação', 'Gestão Financeira'])
  assert.equal(await group.getAttribute('aria-expanded'), 'false')
  for (const name of members) assert.equal(await sidebar.getByRole('button', { name, exact: true }).count(), 0, `${name} is inside the closed group`)
  await page.screenshot({ path: 'test-results/sidebar-operational-closed.png' })

  await group.click()
  assert.equal(await group.getAttribute('aria-expanded'), 'true')
  assert.deepEqual(await submenu.locator('.nav-item').allTextContents(), members)
  for (const name of members) {
    await navigate(name)
    await page.getByRole('tab', { name, exact: true }).waitFor()
    assert.equal(await submenu.locator('.nav-item--active').getAttribute('aria-label'), name)
  }
  await page.screenshot({ path: 'test-results/sidebar-operational-open.png' })
  await group.click()
  assert.equal(await group.getAttribute('aria-expanded'), 'false')
  assert.ok((await group.getAttribute('class')).includes('nav-item--active'), 'the closed group shows that the current screen is inside it')

  // Closed stays closed for the session; a tab of one of its screens opens it again.
  await navigate('Início')
  await page.reload()
  await page.locator('.admin-home-main').waitFor()
  assert.equal(await group.getAttribute('aria-expanded'), 'false')
  await page.getByRole('tab', { name: 'Estoque', exact: true }).click()
  await page.getByRole('heading', { name: 'Estoque', exact: true }).waitFor()
  assert.equal(await group.getAttribute('aria-expanded'), 'true')

  // Phone: the group and its screens fit the menu.
  await navigate('Início')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Abrir menu de navegação', exact: true }).click()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no overflow')
  for (const name of ['Gestão Operacional', ...members]) {
    const button = sidebar.getByRole('button', { name, exact: true })
    const bounds = await button.boundingBox(), icon = await button.locator('.nav-icon').boundingBox()
    assert.ok(icon.x >= bounds.x && icon.x + icon.width <= bounds.x + bounds.width, `${name} icon inside`)
  }
  await page.screenshot({ path: 'test-results/sidebar-operational-mobile.png' })
  await page.getByRole('button', { name: 'Fechar menu', exact: true }).click()
  await page.setViewportSize({ width: 1366, height: 900 })

  // The ticket form: Gestão Operacional is one module, with its five screens as sub-modules.
  await page.locator('.sidebar').getByRole('button', { name: 'Ticket', exact: true }).click()
  const form = page.getByRole('region', { name: 'Abrir novo ticket', exact: true })
  const modules = form.getByRole('group', { name: 'Módulo do sistema', exact: true })
  const moduleNames = await modules.locator('.ticket-module-option').allTextContents()
  assert.ok(moduleNames.includes('Gestão Operacional'))
  assert.ok(moduleNames.includes('Estoque Administrativo'), 'Estoque Administrativo is a module of its own, outside the group')
  assert.ok(!moduleNames.includes('Estoque') && !moduleNames.includes('Pedidos de material'), 'Estoque and Pedidos de material are screens of the group now')
  await form.getByRole('radio', { name: 'Médio', exact: true }).check()
  await modules.getByRole('radio', { name: 'Gestão Operacional', exact: true }).check()
  const screens = form.getByRole('group', { name: 'Sub-módulo de Gestão Operacional', exact: true })
  assert.deepEqual(await screens.locator('.ticket-module-option').allTextContents(), members)
  await screens.getByRole('radio', { name: 'Etapas', exact: true }).check()
  await form.getByLabel('Título', { exact: true }).fill('Etapa sem máquina')
  await form.getByLabel('Descrição do problema', { exact: true }).fill('A etapa nova não aparece no tablet.')
  await page.screenshot({ path: 'test-results/sidebar-operational-ticket.png', fullPage: true })
  await form.getByRole('button', { name: 'Abrir ticket', exact: true }).click()
  await page.locator('.ticket-module-cell').filter({ hasText: 'Etapas' }).waitFor()
  assert.match(await page.locator('.ticket-module-cell').first().innerText(), /Gestão Operacional\s*Etapas/)

  // An administrative employee has the same group (only Gestão Financeira is hidden from them).
  await fixture.adminRequest('/employees', 'POST', { name: 'Bruno Administrativo', birthDate: '1990-01-01', cpf: '00000000002', email: 'bruno@example.invalid', identification: '', type: 'administrative', password: 'senha123' })
  await page.evaluate(() => sessionStorage.clear())
  await sidebar.getByRole('button', { name: 'Sair', exact: true }).click()
  await signIn('00000000002', 'senha123')
  assert.equal(await sidebar.getByRole('button', { name: 'Gestão Financeira', exact: true }).count(), 0)
  await group.click()
  assert.deepEqual(await submenu.locator('.nav-item').allTextContents(), members)
  await page.screenshot({ path: 'test-results/sidebar-operational-staff.png' })
  assert.deepEqual(errors, [])
  console.log('Gestão Operacional passed: below Início, five ordered screens, starts closed, session state, tab auto-open, phone, ticket module and administrative employee.')
} catch (error) {
  await page.screenshot({ path: 'test-results/sidebar-operational-failure.png' })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
