import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { openSidebarItem } from './sidebarNavigation.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'

// Baixa em Lote › Adicionar lançamentos: Fornecedor and Classificação filters (decision of 2026-11-14); no bank filter,
// since only paid accounts have a bank and this list has only open ones.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  const energy = (await api('/classifications', 'POST', { name: 'Energia de teste' })).data.item
  const rent = (await api('/classifications', 'POST', { name: 'Aluguel de teste' })).data.item
  const coelba = (await api('/suppliers', 'POST', { name: 'Coelba Teste', document: '15139629000194' })).data.item
  const landlord = (await api('/suppliers', 'POST', { name: 'Imobiliária Teste', document: '12345678000190' })).data.item
  await api('/suppliers', 'POST', { name: 'Fornecedor sem contas', document: '11222333000181' })
  const dueDate = shiftMonth(todayBahia(), 1)
  for (const [supplier, classification, value] of [[coelba, energy, '310.00'], [coelba, rent, '120.00'], [landlord, rent, '2500.00']]) {
    const created = await api('/payables', 'POST', { supplierId: supplier.id, classificationId: classification.id, issueDate: todayBahia(), value, dueDate, kind: 'normal' })
    assert.equal(created.status, 201, JSON.stringify(created.data))
  }

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await openSidebarItem(page, 'Baixa em Lote')
  const rows = page.locator('.batch-picker-table tbody tr')
  await rows.filter({ hasText: 'Imobiliária Teste' }).waitFor()
  const filters = page.locator('.batch-filters')
  assert.equal(await filters.getByLabel(/banco/i).count(), 0, 'no bank filter')

  // Fornecedor lists only who has an open account.
  const supplier = filters.getByLabel('Fornecedor', { exact: true })
  assert.deepEqual(await supplier.locator('option').allInnerTexts(), ['Todos', 'Coelba Teste', 'Imobiliária Teste'])
  await supplier.selectOption({ label: 'Coelba Teste' })
  await rows.filter({ hasText: 'Imobiliária Teste' }).waitFor({ state: 'detached' })
  assert.equal(await rows.filter({ hasText: 'Coelba Teste' }).count(), 2)

  // Classificação narrows it further; "Limpar filtros" brings everything back.
  await filters.getByLabel('Classificação', { exact: true }).selectOption(energy.id)
  await page.waitForFunction(() => document.querySelectorAll('.batch-picker-table tbody tr').length === 1)
  assert.match(await rows.first().innerText(), /Coelba Teste[\s\S]*Energia de teste/)
  await filters.locator('xpath=..').screenshot({ path: 'test-results/batch-settlement-filters.png' })
  await filters.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.batch-picker-table tbody tr').length === 3)

  assert.deepEqual(errors, [])
  console.log('Baixa em Lote: Fornecedor (only suppliers with open accounts) and Classificação filters, no bank filter passed.')
} finally {
  await browser.close()
  await fixture.close()
}
