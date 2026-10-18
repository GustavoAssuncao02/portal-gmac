import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
try {
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  const material = { id: 'request-test', name: 'Titanio solicitado', detail: 'Chapa 10mm', quantity: 12.5, unitPrice: 20, stockStatus: 'unknown' }
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [material], laborEntries: [], stages: ['painting'], kind: 'service' })).status, 200)
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', serviceValue: 250, deadline: offer.deadline } })
  const accepted = await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(accepted.status, 201)
  const order = accepted.data.item
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 393, height: 852 }]) {
    const page = await browser.newPage({ viewport })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem('gmac-inventory-migrated-v1', 'true'))
    await page.route('**/api/inventory**', (route) => route.fulfill({ status: 200, json: { items: [], movements: [] } }))
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    const openOrders = async () => {
      if (viewport.width < 768) await page.getByRole('button', { name: 'Abrir menu de navega\u00e7\u00e3o', exact: true }).click()
      await page.locator('.sidebar').getByRole('button', { name: 'Pedidos de material', exact: true }).click()
      const labels = await page.locator('.sidebar-nav .nav-item').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))
      assert.equal(labels[labels.indexOf('Estoque') + 1], 'Pedidos de material')
      await page.getByRole('heading', { name: 'Pedidos de material', exact: true }).waitFor()
      assert.equal(await page.locator('.workspace-tab').filter({ hasText: 'Pedidos de material' }).count(), 1)
    }
    await openOrders()
    await page.locator('.material-orders-table').getByRole('button', { name: material.name, exact: true }).click()
    await page.getByRole('heading', { name: 'Estoque', exact: true }).waitFor()
    assert.equal(await page.locator('.os-detail').count(), 0)
    assert.equal(await page.locator('.pending-material-card').count(), 0)
    await page.screenshot({ path: `test-results/inventory-without-preregistration-${viewport.width}.png`, fullPage: true })
    await page.locator('.inventory-header').getByRole('button', { name: 'Adicionar material', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Adicionar material', exact: true })
    assert.equal(await modal.getByPlaceholder('Digite para buscar no estoque', { exact: true }).inputValue(), '')
    await modal.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await openOrders()
    await page.locator('.material-orders-table').getByRole('button', { name: order.code, exact: true }).click()
    await page.locator('.os-detail').waitFor()
    assert.ok((await page.locator('.os-detail-heading').innerText()).includes(order.code))
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Unapproved new material appears directly in orders; material opens inventory with no preregistration; related OS link preserved on desktop and iPhone 15.')
} finally { await browser.close(); await fixture.close() }
