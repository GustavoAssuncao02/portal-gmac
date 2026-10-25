import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
try {
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['painting'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', serviceValue: 100, deadline: offer.deadline } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const material = { id: 1, name: 'Inox 304', quantity: 0, minimum: 1, unitPrice: 38.4, icon: 'sheet' }
  const history = [{ id: 1, type: 'exit', date: new Date().toISOString(), quantity: 24, unitPrice: 38.4, balance: 0, destination: 'Utilizado na ordem de servico', order: order.code }]
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 393, height: 852 }]) {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/inventory**', (route) => route.fulfill({ status: 200, json: route.request().url().endsWith('/history') ? { history } : { items: [material], movements: [] } }))
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    if (viewport.width < 768) await page.getByRole('button', { name: 'Abrir menu de navega\u00e7\u00e3o', exact: true }).click()
    await page.locator('.sidebar').getByRole('button', { name: 'Estoque', exact: true }).click()
    await page.getByRole('button', { name: 'Ver hist\u00f3rico de Inox 304', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Hist\u00f3rico do material' })
    await modal.getByRole('button', { name: order.code, exact: true }).waitFor()
    assert.ok((await modal.innerText()).includes('24 kg'))
    const clipped = await modal.locator('.inventory-history-row:not(.inventory-history-row--header)').evaluateAll((rows) => rows.some((row) => [...row.children].some((child) => child.getBoundingClientRect().right > document.querySelector('.inventory-history-table').getBoundingClientRect().right + 1)))
    assert.equal(clipped, false, 'All history columns must remain visible inside the table')
    await page.screenshot({ path: `test-results/inventory-order-history-${viewport.width}.png`, fullPage: true })
    await modal.getByRole('button', { name: order.code, exact: true }).click()
    await page.locator('.os-detail').waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.ok((await page.locator('.os-detail-heading').innerText()).includes(order.code))
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Inventory OS history link passed on desktop and iPhone 15: exit quantity, modal closure and correct OS navigation.')
} finally { await browser.close(); await fixture.close() }
