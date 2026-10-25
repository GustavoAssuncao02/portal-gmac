import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste', DEMO_ADMIN_NAME: 'Gustavo' } })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const labels = ['Tornearia', 'Freza', 'Plaina', 'Montagem', 'Pintura', 'Corte e dobra']
const stageKeys = ['turning', 'milling', 'planing', 'assembly', 'painting', 'cut-bend']
let failNext = false
let requests = 0
let completed = 0
let inFlight = 0
let maxInFlight = 0
const waitSaved = () => page.waitForFunction(() => !document.querySelector('.offer-proposal-button')?.disabled)

try {
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'material', name: 'Aluminio de teste', detail: 'Chapa', quantity: 5, unitPrice: 20 }], laborEntries: [{ id: 'labor', type: 'person', resource: 'Acabamento', hours: 2, hourlyRate: 100 }], stages: [], kind: 'service' })
  await page.route('**/resources', async (route) => {
    requests++
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    const fail = failNext
    failNext = false
    await new Promise((resolve) => setTimeout(resolve, 350))
    try {
      if (fail) await route.fulfill({ status: 503, json: { message: 'Falha simulada no salvamento.' } })
      else await route.fulfill({ response: await route.fetch() })
    } finally {
      inFlight--
      completed++
    }
  })
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill('12345678901')
  await page.getByLabel('Senha', { exact: true }).fill('teste')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e servi\u00e7os', exact: true }).click()
  await page.locator('.offer-review-button').click()
  await page.getByRole('button', { name: 'Adicionar material', exact: true }).click()
  const form = page.locator('.offer-inline-form').first()
  await form.getByRole('combobox', { name: /^Material/ }).fill('Rascunho preservado')
  await page.getByRole('checkbox', { name: 'Tornearia', exact: true }).scrollIntoViewIfNeeded()
  const buttonOpacity = await page.getByRole('button', { name: 'Adicionar m\u00e3o de obra', exact: true }).evaluate((element) => getComputedStyle(element).opacity)
  await page.evaluate(() => {
    window.originalOfferFields = document.querySelector('.offer-resource-fields')
    window.disabledChanges = []
    new MutationObserver((mutations) => { for (const mutation of mutations) if (mutation.attributeName === 'disabled') window.disabledChanges.push(mutation.target.disabled) }).observe(window.originalOfferFields, { attributes: true })
  })
  await page.getByRole('checkbox', { name: 'Tornearia', exact: true }).check()
  assert.equal(await page.locator('.offer-resource-fields').evaluate((element) => element.disabled), false)
  assert.equal(await page.getByRole('button', { name: 'Adicionar m\u00e3o de obra', exact: true }).evaluate((element) => getComputedStyle(element).opacity), buttonOpacity)
  for (const label of labels.slice(1)) await page.getByRole('checkbox', { name: label, exact: true }).check()
  await page.getByRole('radio', { name: 'Produto', exact: true }).check()
  for (const label of labels) assert.equal(await page.getByRole('checkbox', { name: label, exact: true }).isChecked(), true)
  assert.equal(await page.getByRole('radio', { name: 'Produto', exact: true }).isChecked(), true)
  await page.screenshot({ path: 'test-results/offer-settings-saving.png', fullPage: true })
  await waitSaved()
  assert.equal(requests, 7)
  assert.equal(completed, 7)
  assert.equal(maxInFlight, 1)
  assert.deepEqual(await page.evaluate(() => window.disabledChanges), [])
  assert.ok(await page.evaluate(() => window.originalOfferFields === document.querySelector('.offer-resource-fields')))
  assert.equal(await form.getByRole('combobox', { name: /^Material/ }).inputValue(), 'Rascunho preservado')
  let resources = (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items.find((item) => item.id === offer.id).resources
  assert.deepEqual(resources.stages, stageKeys)
  assert.equal(resources.kind, 'product')
  assert.equal(resources.materials[0].name, 'Aluminio de teste')
  assert.equal(resources.laborEntries[0].resource, 'Acabamento')

  failNext = true
  await page.getByRole('checkbox', { name: 'Tornearia', exact: true }).uncheck()
  await waitSaved()
  await page.getByRole('alert').filter({ hasText: 'Falha simulada no salvamento.' }).waitFor()
  assert.equal(await page.getByRole('checkbox', { name: 'Tornearia', exact: true }).isChecked(), true)
  assert.equal(await form.getByRole('combobox', { name: /^Material/ }).inputValue(), 'Rascunho preservado')
  await page.getByRole('checkbox', { name: 'Tornearia', exact: true }).uncheck()
  await page.getByRole('radio', { name: 'Servi\u00e7o', exact: true }).check()
  await waitSaved()
  assert.equal(await page.getByRole('alert').count(), 0)
  resources = (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items.find((item) => item.id === offer.id).resources
  assert.deepEqual(resources.stages, stageKeys.slice(1))
  assert.equal(resources.kind, 'service')
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e servi\u00e7os', exact: true }).click()
  await page.locator('.offer-review-button').click()
  assert.equal(await page.getByRole('checkbox', { name: 'Tornearia', exact: true }).isChecked(), false)
  assert.equal(await page.getByRole('checkbox', { name: 'Corte e dobra', exact: true }).isChecked(), true)
  assert.equal(await page.getByRole('radio', { name: 'Servi\u00e7o', exact: true }).isChecked(), true)
  assert.deepEqual(errors, [])
  console.log('Offer settings autosave passed: no disabled/form remount flicker, rapid changes persist serially, drafts and existing resources survive, failed saves roll back and retry works.')
} catch (error) {
  await page.screenshot({ path: 'test-results/offer-settings-autosave-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
