import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// The portal is used over HTTP by the address of the local network. There the browser is not a secure context and
// hides crypto.randomUUID; adding materials and labor to an offer must still work.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Eixo orçado pela rede' })).data.item
  await page.addInitScript(() => { delete Crypto.prototype.randomUUID })
  await page.goto(fixture.url)
  assert.equal(await page.evaluate(() => typeof crypto.randomUUID), 'undefined', 'same as a browser on the local network address')
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
  await page.locator('.offers-table-row').filter({ hasText: offer.service }).locator('.offer-review-button').click()
  await page.getByRole('heading', { name: `Detalhes da oferta ${offer.code}`, exact: true }).waitFor()
  const saved = () => page.waitForFunction(() => !document.querySelector('.offer-proposal-button')?.disabled)

  await page.getByRole('button', { name: 'Adicionar material', exact: true }).click()
  const materialForm = page.locator('.offer-inline-form').first()
  await materialForm.getByRole('combobox', { name: /^Material/ }).fill('Aço 1045 pela rede')
  await materialForm.getByLabel('Quantidade (kg)').fill('8')
  await materialForm.getByLabel('Valor unitário').fill('15')
  await materialForm.getByRole('button', { name: 'Adicionar material', exact: true }).click()
  await page.locator('.offer-material-row').filter({ hasText: 'Aço 1045 pela rede' }).waitFor()
  await materialForm.waitFor({ state: 'detached' })
  await saved()

  await page.getByRole('button', { name: 'Adicionar mão de obra', exact: true }).click()
  const laborForm = page.locator('.offer-labor-form')
  await laborForm.getByLabel('Tipo', { exact: true }).selectOption('person')
  const service = laborForm.getByLabel('Serviço do profissional', { exact: true })
  await service.selectOption({ index: 1 })
  const serviceName = (await service.locator('option:checked').innerText()).split(' · ')[0]
  await laborForm.getByLabel('Tempo (horas)').fill('3')
  await laborForm.getByRole('button', { name: 'Adicionar mão de obra', exact: true }).click()
  await page.locator('.offer-material-row--labor').filter({ hasText: serviceName }).waitFor()
  await laborForm.waitFor({ state: 'detached' })
  await saved()

  const stored = (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items.find((item) => item.id === offer.id).resources
  assert.deepEqual(stored.materials.map((item) => [item.name, item.quantity, item.unitPrice]), [['Aço 1045 pela rede', 8, 15]])
  assert.deepEqual(stored.laborEntries.map((item) => [item.resource, item.hours]), [[serviceName, 3]])
  for (const item of [...stored.materials, ...stored.laborEntries]) assert.match(item.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  // With the resources saved the proposal can be made.
  await page.getByRole('checkbox', { name: 'Tornearia', exact: true }).check()
  await saved()
  await page.getByRole('button', { name: 'Fazer proposta', exact: true }).click()
  await page.getByRole('heading', { name: 'Fazer proposta', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Offer over the local network passed: without crypto.randomUUID, material and labor are added, saved with valid ids and the proposal opens.')
} catch (error) {
  await page.screenshot({ path: 'test-results/offer-local-network-failure.png', fullPage: true })
  console.error('Erros da página:', errors)
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
