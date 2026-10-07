import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'

const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' } })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
const errors = []
const contrasts = []
page.on('pageerror', (error) => errors.push(error.message))
await mkdir('test-results/theme', { recursive: true })
const screens = ['Início', 'Máquinas', 'Estoque', 'Calculadora de pesos e medidas', 'Fornecedores', 'Administradores', 'Funcionários', 'Clientes', 'Serviços em andamento', 'Ofertas e serviços', 'Pedidos de material', 'Contas a Pagar', 'Business Intelligence', 'Classificações', 'Relatórios', 'Configurações']
const slug = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
async function login(cpf = '12345678901') {
  await page.getByLabel('CPF', { exact: true }).fill(cpf)
  await page.getByLabel('Senha', { exact: true }).fill('teste123')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
}
async function navigate(name) {
  const button = page.locator('.sidebar').getByRole('button', { name, exact: true })
  if (!(await button.isVisible())) await page.locator('.sidebar').getByRole('button', { name: ['Fornecedores', 'Administradores', 'Funcionários', 'Clientes'].includes(name) ? 'Cadastros' : 'Gestão Financeira', exact: true }).click()
  await button.click()
  await page.waitForTimeout(100)
}
async function capture(name) {
  await page.screenshot({ path: `test-results/theme/${slug(name)}.png`, fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: page overflow`)
  const issues = await page.evaluate(() => {
    const rgb = (value) => (value.match(/[\d.]+/g) || []).map(Number)
    const composite = (fg, bg) => fg.slice(0, 3).map((value, index) => value * (fg[3] ?? 1) + bg[index] * (1 - (fg[3] ?? 1)))
    const background = (element) => {
      if (!element) return [13, 28, 46]
      const own = rgb(getComputedStyle(element).backgroundColor)
      return composite(own, (own[3] ?? 1) === 1 ? [0, 0, 0] : background(element.parentElement))
    }
    const luminance = (color) => color.slice(0, 3).map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
    return [...document.querySelectorAll('main h1, main h2, main h3, main p, main label, main button, main input, main select, main th, main td, main small')].filter((element) => {
      const box = element.getBoundingClientRect()
      return box.width && box.height && !element.disabled && !element.closest('fieldset[disabled]') && !['checkbox', 'radio', 'file', 'range', 'color'].includes(element.type) && getComputedStyle(element).opacity === '1' && (element.textContent.trim() || element.value)
    }).map((element) => {
      const a = luminance(rgb(getComputedStyle(element).color)), b = luminance(background(element))
      const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
      return { selector: `${element.tagName}.${element.className}`, text: (element.textContent || element.value).trim().slice(0, 60), ratio: Number(ratio.toFixed(2)) }
    }).filter((item) => item.ratio < 4.5)
  })
  contrasts.push({ name, issues })
}
try {
  const auth = (await fixture.request('/auth/login', 'POST', { cpf: '12345678901', password: 'teste123' })).data.token
  const headers = { Authorization: `Bearer ${auth}` }
  const post = (route, body) => fixture.request(route, 'POST', body, headers)
  await post('/admins', { name: 'Outro Admin', cpf: '00000000002', birthDate: '1990-01-01', email: 'outro@example.invalid', password: 'teste123' })
  await post('/employees', { name: 'Ana Teste', identification: '001', cpf: '00000000001', birthDate: '1990-01-01', email: 'ana@example.invalid' })
  await post('/clients', { name: 'Cliente Teste', documentType: 'cnpj', document: offerDraft.cnpj, email: 'cliente@example.invalid' })
  await post('/machines', { name: 'Torno CNC 01', type: 'Torno CNC', sector: 'Usinagem', hourlyRate: 80 })
  const supplier = (await post('/suppliers', { name: 'Acos Teste', document: offerDraft.cnpj, email: 'acos@example.invalid', phone: '71999999999' })).data.item
  const classification = (await post('/classifications', { name: 'Materiais' })).data.item
  await post('/payables', { supplierId: supplier.id, classificationId: classification.id, description: 'Chapas de aco', documentNumber: 'NF-001', issueDate: todayBahia(), dueDate: todayBahia(), value: '1450.50', kind: 'normal' })
  const offer = (await post('/offers', offerDraft)).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'm1', name: 'Ferro', quantity: 10, unitPrice: 20 }], laborEntries: [], stages: ['turning', 'painting'], kind: 'service' })
  await post(`/offers/${offer.id}/proposal`, { layout: 'classic', proposal: { key: 'A', deadline: '2026-12-20', serviceValue: 300, materials: 200, labor: 0, margin: 15, discount: 0 } })
  await post(`/offers/${offer.id}/accept`, {})
  await page.goto(fixture.url)
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light')
  await login()
  await navigate('Configurações')
  const dark = page.getByRole('radio', { name: 'Modo escuro', exact: true })
  const light = page.getByRole('radio', { name: 'Modo claro', exact: true })
  await light.waitFor()
  assert.ok(await light.isChecked())
  await page.route('**/account/appearance', async (route) => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 503, json: { message: 'Falha simulada na aparência.' } })
    else await route.continue()
  })
  await dark.check()
  await page.getByRole('alert').getByText('Falha simulada na aparência.').waitFor()
  assert.ok(await light.isChecked())
  await page.unroute('**/account/appearance')
  await dark.check()
  await page.getByRole('status').getByText('Aparência salva.').waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
  for (const name of screens) {
    await navigate(name)
    await capture(name)
    if (name === 'Ofertas e serviços') {
      await page.getByRole('button', { name: 'Ver OS', exact: true }).click()
      await page.locator('.os-detail').waitFor()
      await capture('Detalhes da OS')
      await page.getByRole('button', { name: 'Editar OS', exact: true }).click()
      await page.getByRole('dialog').waitFor()
      await page.screenshot({ path: 'test-results/theme/editar-os.png' })
      await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click()
    }
  }
  await writeFile('test-results/theme/contrast.json', JSON.stringify(contrasts, null, 2))
  console.log('Contrast issues:', JSON.stringify(contrasts.filter((entry) => entry.issues.length)))
  assert.deepEqual(contrasts.filter((entry) => entry.issues.length), [], 'Every sampled text/control must meet 4.5:1 contrast.')
  await navigate('Configurações')
  await page.reload()
  await dark.waitFor()
  assert.ok(await dark.isChecked())
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
  await page.locator('.sidebar').getByRole('button', { name: 'Sair', exact: true }).click()
  await page.getByRole('heading', { name: 'Entrar no sistema' }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light')
  await page.evaluate(() => localStorage.clear())
  await login()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.locator('.sidebar').getByRole('button', { name: 'Sair', exact: true }).click()
  await login('00000000002')
  await navigate('Configurações')
  assert.ok(await light.isChecked())
  await page.locator('.sidebar').getByRole('button', { name: 'Sair', exact: true }).click()
  await login()
  await navigate('Configurações')
  await light.check()
  await page.getByRole('status').getByText('Aparência salva.').waitFor()
  await page.reload()
  await light.waitFor()
  assert.ok(await light.isChecked())
  assert.deepEqual(errors, [])
  console.log('Account theme passed: light default even with dark OS, save/retry, account isolation, server persistence, reload, logout, all desktop screens and OS modal.')
} finally { await browser.close(); await fixture.close() }
