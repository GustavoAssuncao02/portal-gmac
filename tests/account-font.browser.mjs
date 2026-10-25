import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await mkdir('test-results/font', { recursive: true })
const screens = ['Início', 'Máquinas', 'Estoque', 'Calculadora de pesos e medidas', 'Fornecedores', 'Administradores', 'Funcionários', 'Clientes', 'Serviços em andamento', 'Ofertas e serviços', 'Pedidos de material', 'Contas a Pagar', 'Contas a Receber', 'Conciliação bancária', 'Business Intelligence', 'Classificações', 'Relatórios', 'Configurações']
const slug = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
const font = (selector) => page.locator(selector).first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
async function login(cpf = env.DEMO_ADMIN_CPF) {
  await page.getByLabel('CPF', { exact: true }).fill(cpf)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
}
async function navigate(name) {
  const item = page.locator('.sidebar').getByRole('button', { name, exact: true })
  if (!(await item.isVisible())) await page.locator('.sidebar').getByRole('button', { name: ['Fornecedores', 'Administradores', 'Funcionários', 'Clientes'].includes(name) ? 'Cadastros' : ['Serviços em andamento', 'Serviços concluídos', 'Ofertas e serviços'].includes(name) ? 'Operação' : 'Gestão Financeira', exact: true }).click()
  await item.click()
  await page.waitForTimeout(100)
}
async function choose(name, value) {
  const option = page.getByRole('radio', { name, exact: true })
  await option.check()
  await page.waitForFunction((size) => document.documentElement.dataset.fontSize === size, value)
  await page.waitForFunction(() => !document.querySelector('[name="account-font-size"]').disabled)
  assert.ok(await option.isChecked())
}
async function chooseFamily(value) {
  const select = page.getByRole('combobox', { name: 'Fonte', exact: true })
  await select.selectOption(value)
  await page.waitForFunction((family) => document.documentElement.dataset.fontFamily === family, value)
  await page.waitForFunction(() => !document.querySelector('[aria-label="Fonte"]').disabled)
  assert.equal(await select.inputValue(), value)
}
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const headers = { Authorization: `Bearer ${token}` }
  await fixture.request('/admins', 'POST', { name: 'Outro Admin', cpf: '00000000002', birthDate: '1990-01-01', email: 'outro@example.invalid', password: env.DEMO_ADMIN_PASSWORD }, headers)
  await page.goto(fixture.url)
  await login()
  await navigate('Configurações')
  const selectors = ['.account-appearance-settings h2', '.account-theme-option', '.account-summary dd', 'main h1']
  const baseline = await Promise.all(selectors.map(font))
  assert.ok(await page.getByRole('radio', { name: 'Padrão', exact: true }).isChecked())
  const snapshot = () => page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,p,label,input,button,span')].map((el) => getComputedStyle(el).fontSize))
  const defaultSnapshot = await snapshot()
  await page.evaluate(() => delete document.documentElement.dataset.fontSize)
  assert.deepEqual(await snapshot(), defaultSnapshot, 'Default typography matches the original unscoped CSS')
  await page.evaluate(() => { document.documentElement.dataset.fontSize = 'default' })
  assert.equal(await page.getByRole('combobox', { name: 'Fonte', exact: true }).inputValue(), 'default')
  const familySnapshot = () => page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,p,label,input,button,span')].map((el) => getComputedStyle(el).fontFamily))
  const originalFamilies = await familySnapshot()
  await page.evaluate(() => delete document.documentElement.dataset.fontFamily)
  assert.deepEqual(await familySnapshot(), originalFamilies, 'Default font family preserves the original typography')
  await page.evaluate(() => { document.documentElement.dataset.fontFamily = 'default' })
  await page.route('**/account/appearance', (route) => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, json: { message: 'Falha simulada na fonte.' } }) : route.continue())
  // The save fails on purpose and the choice rolls back, possibly before check() could see it marked: a plain click.
  await page.getByRole('radio', { name: 'Grande', exact: true }).click()
  await page.getByRole('alert').getByText('Falha simulada na fonte.').waitFor()
  assert.ok(await page.getByRole('radio', { name: 'Padrão', exact: true }).isChecked())
  assert.deepEqual(await Promise.all(selectors.map(font)), baseline)
  await page.getByRole('combobox', { name: 'Fonte', exact: true }).selectOption('verdana')
  await page.waitForFunction(() => document.documentElement.dataset.fontFamily === 'default' && !document.querySelector('[aria-label="Fonte"]').disabled)
  assert.deepEqual([...new Set(await familySnapshot())], [...new Set(originalFamilies)], 'Failed save restores the original family, including the error message')
  await page.unroute('**/account/appearance')
  const fontFamilies = { system: 'Segoe UI', verdana: 'Verdana', tahoma: 'Tahoma', inter: 'Inter', roboto: 'Roboto', 'open-sans': 'Open Sans', montserrat: 'Montserrat', 'source-sans-3': 'Source Sans 3' }
  assert.equal(await page.getByRole('combobox', { name: 'Fonte', exact: true }).locator('option').count(), 9)
  assert.equal(await page.locator('option[value="system"]').textContent(), 'Segoe UI')
  for (const [family, expected] of Object.entries(fontFamilies)) {
    await navigate('Configurações')
    await chooseFamily(family)
    await page.evaluate((name) => Promise.all([400, 700].map((weight) => document.fonts.load(`${weight} 16px "${name}"`, 'Ações, Usinagem, Caldeiraria, Pintura'))), expected)
    assert.ok(await page.evaluate((name) => document.fonts.check(`700 16px "${name}"`, 'Classificações'), expected))
    for (const screen of screens) {
      await navigate(screen)
      const families = await familySnapshot()
      assert.ok(families.every((value) => value.replaceAll('"', '').startsWith(expected)), `${family}: ${screen} applies the family to every text element`)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${family}: ${screen} has no page overflow`)
    }
    await page.screenshot({ path: `test-results/font/family-${family}.png`, fullPage: true })
    assert.equal((await fixture.request('/account/appearance', 'GET', undefined, headers)).data.settings.fontFamily, family)
  }
  await chooseFamily('default')
  for (const [name, size, factor] of [['Pequena', 'small', .9], ['Grande', 'large', 1.15], ['Padrão', 'default', 1]]) {
    await choose(name, size)
    for (const [index, selector] of selectors.entries()) assert.ok(Math.abs(await font(selector) - baseline[index] * factor) < .05, `${selector}: ${size} scales once`)
    await page.screenshot({ path: `test-results/font/settings-${size}.png`, fullPage: true })
    assert.equal((await fixture.request('/account/appearance', 'GET', undefined, headers)).data.settings.fontSize, size)
  }
  await choose('Grande', 'large')
  await page.getByRole('radio', { name: 'Modo escuro', exact: true }).check()
  await page.waitForFunction(() => !document.querySelector('[name="account-theme"]').disabled)
  assert.equal(await page.evaluate(() => document.documentElement.dataset.fontSize), 'large')
  for (const size of ['large', 'small']) {
    await navigate('Configurações')
    await choose(size === 'large' ? 'Grande' : 'Pequena', size)
    for (const screen of screens) {
      await navigate(screen)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${size}: ${screen} overflows the page`)
      await page.screenshot({ path: `test-results/font/${size}-${slug(screen)}.png`, fullPage: true })
    }
  }
  await choose('Grande', 'large')
  await chooseFamily('verdana')
  await page.reload()
  await page.getByRole('radio', { name: 'Grande', exact: true }).waitFor()
  assert.ok(await page.getByRole('radio', { name: 'Grande', exact: true }).isChecked())
  assert.equal(await page.evaluate(() => document.documentElement.dataset.fontSize), 'large')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.fontFamily), 'verdana')
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await page.getByRole('button', { name: 'Entrar', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.fontSize), 'default')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.fontFamily), 'default')
  await page.evaluate(() => localStorage.clear())
  await login()
  await page.waitForFunction(() => document.documentElement.dataset.fontSize === 'large')
  await page.waitForFunction(() => document.documentElement.dataset.fontFamily === 'verdana')
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await login('00000000002')
  await navigate('Configurações')
  assert.ok(await page.getByRole('radio', { name: 'Padrão', exact: true }).isChecked())
  assert.deepEqual(await Promise.all(selectors.map(font)), baseline)
  assert.equal(await page.getByRole('combobox', { name: 'Fonte', exact: true }).inputValue(), 'default')
  assert.deepEqual(errors, [])
  console.log('Font preferences: original default, sizes, eight alternative font families, rollback, reload, server persistence and account isolation passed.')
} finally { await browser.close(); await fixture.close() }
