import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { openSidebarItem } from './sidebarNavigation.js'

// User's decision of 2026-11-15: the Nestlé sheet (FS-3055) charges the contract prices, so once its PDF is generated the
// option of the proposal shows the PDF total as the Valor da OS (gross profit and % over it); the costs stay the GMAC ones.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const page = await context.newPage()
page.setDefaultTimeout(10000)
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const money = (text) => text.replace(/\s/g, ' ')

try {
  // GMAC cost: 1 h of Corte e dobra (the turning stage) at R$ 65 + 9 kg of steel at R$ 15 = R$ 200.
  // Contract: 1 h of Caldeiraria at R$ 47,19 + 9 kg × R$ 19,97 = R$ 226,92.
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, company: 'Nestlé Nordeste Alimentos e Bebidas Ltda', service: 'Base de fixação do cilindro', quantity: 1, labelNumber: '' })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'm1', name: 'Chapa aço 1020', detail: 'chapa 3/8', quantity: 9, unitPrice: 15 }], laborEntries: [], stages: ['turning'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/finish`, 'POST', {})

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await openSidebarItem(page, 'Ofertas e serviços')
  await page.locator('.offer-review-button').first().click()
  await page.getByRole('button', { name: 'Fazer proposta', exact: true }).click()
  await page.getByRole('heading', { name: 'Fazer proposta', exact: true }).waitFor()
  const cardA = page.locator('.proposal-card').filter({ hasText: 'PROPOSTA A' })
  const price = () => cardA.locator('.proposal-price b').innerText().then(money)
  const profit = () => cardA.locator('.proposal-profit b').innerText().then(money)
  assert.equal(await price(), 'R$ 230,00', 'option A at 15% before the PDF')
  await cardA.click()

  // The Nestlé form says the contract total becomes the Valor da OS.
  await page.getByRole('button', { name: 'Gerar proposta em PDF', exact: true }).click()
  await page.getByRole('button', { name: /^Nestlé/ }).click()
  const nestle = page.getByRole('dialog', { name: 'Proposta · Nestlé (FS-3055)', exact: true })
  assert.equal(await nestle.getByLabel('Quantidade de Barra Metalica Aco Sae1020 1M', { exact: true }).inputValue(), '9', 'the materials go to the sheet')
  await nestle.getByLabel('Nº da solicitação', { exact: true }).fill('123')
  await nestle.getByLabel('Linha da planilha para Corte e dobra', { exact: true }).selectOption({ label: '14. Serv Restauracao Caldeiraria' })
  const notice = money(await page.locator('.proposal-total-differs').innerText())
  assert.equal(notice, 'Esta planilha usa os preços do contrato: o total (R$ 226,92) passa a ser o Valor da OS desta opção, no lugar de R$ 230,00. Os custos da GMAC continuam os da oferta.')
  await page.screenshot({ path: 'test-results/nestle-proposal-form.png' })
  const download = page.waitForEvent('download')
  await nestle.getByRole('button', { name: 'Gerar PDF', exact: true }).click()
  await download
  await nestle.waitFor({ state: 'detached' })

  // The option now charges the PDF total; the % is the real one over the GMAC cost.
  assert.equal(await price(), 'R$ 226,92')
  assert.equal(await profit(), 'R$ 26,92')
  await cardA.getByText('13,5%', { exact: true }).waitFor()
  const saved = (await fixture.adminRequest('/offers')).data.items.find((item) => item.id === offer.id).proposal
  assert.deepEqual([saved.osValue, saved.serviceValue, saved.materials, saved.labor], [226.92, 200, 135, 65], 'costs stay the GMAC ones')
  await page.screenshot({ path: 'test-results/nestle-proposal-card.png' })

  // Coming back to the screen keeps it; changing the % goes back to the computed value, for a new PDF.
  await page.reload()
  await page.getByRole('heading', { name: 'Fazer proposta', exact: true }).waitFor()
  assert.equal(await price(), 'R$ 226,92')
  await cardA.getByRole('button', { name: 'Editar margin', exact: true }).click()
  const input = cardA.locator('.proposal-inline-edit')
  // Option B is at 20%, so A goes up to 17% at most.
  await input.fill('17')
  await input.press('Enter')
  await cardA.locator('.proposal-price b', { hasText: '234,00' }).waitFor()

  assert.deepEqual(errors, [])
  console.log('Nestlé proposal value: the PDF total becomes the Valor da OS of the option, costs kept, edit recomputes passed.')
} finally {
  await browser.close()
  await fixture.close()
}
