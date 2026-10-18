import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { purchaseMaterialRequests } from '../src/offerResources.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const inventory = [{ id: 1, name: 'A\u00e7o Inox 304', detail: 'Chapa inoxidavel', quantity: 24, minimum: 0, unitPrice: 38.4 }]
const inventoryWrites = [], errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.addInitScript((items) => {
  localStorage.setItem('gmac-inventory-migrated-v1', 'true')
  localStorage.setItem('gmac-inventory', JSON.stringify(items))
}, inventory)
await mkdir('test-results', { recursive: true })
try {
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  const material = { inventoryId: 1, name: inventory[0].name, detail: inventory[0].detail, unitPrice: 38.4, stockAvailable: 24, stockStatus: 'available', purchaseQuantity: 0, icon: '\u25b0' }
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ ...material, id: 'first', quantity: 20 }, { ...material, id: 'second', quantity: 5 }], laborEntries: [], stages: ['painting'], kind: 'service' })
  await page.route('**/api/inventory**', (route) => {
    if (route.request().method() !== 'GET') inventoryWrites.push(route.request().method())
    return route.fulfill({ status: 200, json: { items: inventory, movements: [] } })
  })
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e servi\u00e7os', exact: true }).click()
  await page.locator('.offers-table-row').filter({ hasText: offer.service }).getByRole('button', { name: 'Em an\u00e1lise', exact: true }).click()
  const badges = page.locator('.offer-materials-list .material-stock-status')
  await page.waitForFunction(() => [...document.querySelectorAll('.offer-materials-list .material-stock-status')].every((el) => el.textContent === 'Falta: 1 kg') && document.querySelectorAll('.offer-materials-list .material-stock-status').length === 2)
  await page.getByRole('button', { name: `Remover ${inventory[0].name}`, exact: true }).nth(1).click()
  await page.waitForFunction(() => document.querySelectorAll('.offer-materials-list .material-stock-status').length === 1 && !document.querySelector('.offer-proposal-button').disabled)
  assert.equal(await badges.innerText(), 'Dispon\u00edvel: 24 kg')
  await page.getByRole('button', { name: 'Adicionar material', exact: true }).click()
  const form = page.locator('.offer-inline-form').first()
  await form.getByRole('combobox').fill('Inox')
  await page.getByRole('option', { name: /Inox 304/ }).click()
  await form.getByLabel('Quantidade (kg)').fill('5')
  await form.getByRole('button', { name: 'Adicionar material', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.offer-materials-list .material-stock-status').length === 2 && !document.querySelector('.offer-proposal-button').disabled)
  assert.deepEqual(await badges.allTextContents(), ['Falta: 1 kg', 'Falta: 1 kg'])
  const saved = (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items[0]
  assert.deepEqual(saved.resources.materials.map((row) => row.purchaseQuantity), [0, 1])
  assert.equal(purchaseMaterialRequests([saved], [])[0].quantity, 1)
  await page.screenshot({ path: 'test-results/offer-material-shared-stock.png', fullPage: true })
  await page.reload()
  await badges.first().waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('.offer-materials-list .material-stock-status')].every((el) => el.textContent === 'Falta: 1 kg'))
  assert.deepEqual(await badges.allTextContents(), ['Falta: 1 kg', 'Falta: 1 kg'])
  assert.deepEqual(inventoryWrites, [])
  assert.equal(inventory[0].quantity, 24)
  assert.deepEqual(errors, [])
  console.log('Shared material stock: existing offer, add/remove, shortage, persisted 1 kg purchase request, reload and no inventory writes passed.')
} finally { await browser.close(); await fixture.close() }
