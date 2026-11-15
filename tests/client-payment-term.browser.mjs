import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { openSidebarItem } from './sidebarNavigation.js'

// Cadastros › Clientes has "Prazo de pagamento (dias)"; the letter proposal (model A) comes with it in "Pagamento (dias)".
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

try {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, cnpj: '11222333000181', company: 'Belgo Bekaert', service: 'Eixo do redutor' })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { stages: ['painting'], materials: [], laborEntries: [], kind: 'service' })

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()

  // The client form: only the number of days.
  await openSidebarItem(page, 'Clientes')
  await page.getByRole('button', { name: 'Novo cliente', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Novo cliente', exact: true })
  await form.getByLabel('Nome / razão social', { exact: true }).fill('Belgo Bekaert')
  await form.getByLabel('CNPJ', { exact: true }).fill('11222333000181')
  await form.getByLabel(/^Prazo de pagamento \(dias\)/).fill('45')
  await page.screenshot({ path: 'test-results/client-payment-term-form.png' })
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await form.waitFor({ state: 'hidden' })
  const saved = (await fixture.adminRequest('/clients')).data.items.find((item) => item.document === '11222333000181')
  assert.equal(saved.paymentDays, 45)
  await page.getByRole('button', { name: /^Editar Belgo Bekaert$/i }).click()
  assert.equal(await page.getByRole('dialog', { name: 'Editar cliente', exact: true }).getByLabel(/^Prazo de pagamento \(dias\)/).inputValue(), '45')
  await page.getByRole('dialog', { name: 'Editar cliente', exact: true }).getByRole('button', { name: 'Cancelar', exact: true }).click()

  // The proposal of an offer of this client: model A comes with 45 in "Pagamento (dias)".
  await openSidebarItem(page, 'Ofertas e serviços')
  await page.locator('.offers-table-row').filter({ hasText: 'Eixo do redutor' }).locator('.offer-review-button').click()
  await page.getByRole('button', { name: 'Fazer proposta', exact: true }).click()
  await page.getByRole('button', { name: 'Gerar proposta em PDF', exact: true }).click()
  const chooser = page.getByRole('dialog', { name: 'Escolha o modelo da proposta', exact: true })
  await chooser.getByRole('button', { name: /^Modelo A/ }).click()
  const letter = page.getByRole('dialog', { name: 'Proposta · Modelo A', exact: true })
  const payment = letter.getByLabel(/^Pagamento \(dias\)/)
  assert.equal(await payment.inputValue(), '45')
  await letter.getByText('Do cadastro de BELGO BEKAERT.').waitFor()
  await payment.fill('30')
  await letter.getByText('O cadastro de BELGO BEKAERT tem 45 dias; o valor daqui vale só para este documento.').waitFor()
  await payment.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/client-payment-term-proposal.png' })

  assert.deepEqual(errors, [])
  console.log('Client payment term: client form, model A filled from the client and the hint passed.')
} finally {
  await browser.close()
  await fixture.close()
}
