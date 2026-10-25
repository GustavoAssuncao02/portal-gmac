import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste', DEMO_ADMIN_NAME: 'Gustavo' } })
const browser = await chromium.launch({ headless: true })
const errors = []

// Each administrator in a browser of their own, both talking to the same fixture.
async function signIn(cpf, password) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    await route.fulfill({ response: await route.fetch({ url: `${fixture.url}${url.pathname}${url.search}` }) })
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(process.env.PREVIEW_URL || fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(cpf)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.sidebar').waitFor()
  return page
}
const navigate = (page, label) => page.locator('.sidebar').getByRole('button', { name: label, exact: true }).click()
const margins = (page) => page.locator('.proposal-card').locator('.proposal-card-column > div').filter({ has: page.getByRole('button', { name: 'Editar margin', exact: true }) }).locator('strong').allTextContents()

try {
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'aco', name: 'Aço', quantity: 2, unitPrice: 100 }], laborEntries: [], stages: ['painting'], kind: 'service' })).status, 200)
  assert.equal((await fixture.adminRequest('/admins', 'POST', { name: 'Segundo Admin', birthDate: '1990-01-01', cpf: '00000000002', email: 'segundo@example.invalid', password: 'teste123' })).status, 200)

  // The first administrator starts the quote: picks option C, changes its margin and saves.
  const first = await signIn('12345678901', 'teste')
  await navigate(first, 'Ofertas e serviços')
  await first.locator('.offer-review-button').first().click()
  await first.getByRole('button', { name: 'Fazer proposta', exact: true }).click()
  await first.getByRole('heading', { name: 'Fazer proposta', exact: true }).waitFor()
  const cards = first.locator('.proposal-card')
  await cards.nth(2).locator('.proposal-card-label').click()
  await cards.nth(2).getByRole('button', { name: 'Editar margin', exact: true }).click()
  await cards.nth(2).locator('.proposal-inline-edit').fill('27')
  await cards.nth(2).locator('.proposal-inline-edit').press('Tab')
  await first.getByText('Alterações ainda não salvas.').waitFor()
  const chosen = await margins(first)
  assert.equal(chosen[2], '27,0%')
  const saved = first.waitForResponse((response) => response.url().endsWith(`/offers/${offer.id}/proposal-draft`) && response.request().method() === 'PUT')
  await first.getByRole('button', { name: 'Salvar', exact: true }).click()
  assert.equal((await saved).status(), 200)
  await first.locator('.proposal-draft-status').filter({ hasText: /^ ?Proposta C salva por Gustavo em / }).waitFor()
  await first.screenshot({ path: 'test-results/proposal-draft-saved.png', fullPage: true })
  // Whoever saved already knows: their own bell stays empty.
  await first.getByRole('button', { name: 'Notificações', exact: true }).click()
  await first.getByText('Nenhuma notificação no momento.').waitFor()
  assert.equal(await first.locator('.notifications-payables button').filter({ hasText: 'Proposta salva' }).count(), 0)
  await first.keyboard.press('Escape')

  // In the list the offer shows the saved proposal, and its button opens the proposal screen as it was left.
  await navigate(first, 'Ofertas e serviços')
  const row = first.locator('.offers-table-row').filter({ hasText: offer.code })
  assert.match(await row.locator('.offer-table-status').innerText(), /Proposta salva\s*Opção C/)
  await first.screenshot({ path: 'test-results/proposal-draft-list.png' })
  await row.getByRole('button', { name: 'Proposta salva', exact: true }).click()
  await first.getByRole('heading', { name: 'Fazer proposta', exact: true }).waitFor()
  assert.deepEqual(await margins(first), chosen)
  assert.match(await first.locator('.proposal-card').nth(2).getAttribute('class'), /proposal-card--selected/)

  // The second administrator is told and picks the quote up where it stopped.
  const second = await signIn('00000000002', 'teste123')
  await second.locator('.notifications-count').filter({ hasText: '1' }).waitFor()
  await second.getByRole('button', { name: 'Notificações', exact: true }).click()
  const notice = second.locator('.notifications-payables button').filter({ hasText: 'Proposta salva' })
  assert.match(await notice.innerText(), new RegExp(`${offer.code} · ${offerDraft.service} · Proposta C[\\s\\S]*Gustavo`))
  await second.screenshot({ path: 'test-results/proposal-draft-notice.png' })
  await notice.click()
  await second.getByRole('heading', { name: 'Fazer proposta', exact: true }).waitFor()
  assert.deepEqual(await margins(second), chosen, 'the four options come back as saved')
  assert.match(await second.locator('.proposal-card').nth(2).getAttribute('class'), /proposal-card--selected/)
  await second.locator('.proposal-draft-status').filter({ hasText: 'Proposta C salva por Gustavo' }).waitFor()

  // The notice can be turned off in the account settings.
  await navigate(second, 'Configurações')
  const option = second.getByLabel('Propostas salvas', { exact: true })
  assert.equal(await option.isChecked(), true)
  await option.uncheck()
  await second.getByRole('button', { name: 'Salvar notificações', exact: true }).click()
  await second.getByText('Preferência de notificações salva.').waitFor()
  await second.getByRole('button', { name: 'Notificações', exact: true }).click()
  await second.getByText('Nenhuma notificação no momento.').waitFor()
  assert.deepEqual(errors, [])
  console.log('Proposta salva: opções guardadas, aviso entregue ao outro administrador e preferência respeitada.')
} finally {
  await browser.close()
  await fixture.close()
}
