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
  const materials = [{ id: 'inox', name: 'Aco Inox 304', detail: 'Chapa inoxidavel', quantity: 10, unitPrice: 38.4, stockStatus: 'unknown', purchaseQuantity: 10 }, { id: 'ferro', name: 'Ferro', detail: 'Barra redonda', quantity: 2, unitPrice: 20, stockStatus: 'unknown', purchaseQuantity: 2 }]
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials, laborEntries: [], stages: ['painting'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 500, deadline: offer.deadline } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 393, height: 852 }, { width: 430, height: 932 }, { width: 1440, height: 900, theme: 'dark' }]) {
    await fixture.mutateStore((store) => {
      store.offers.find((item) => item.id === offer.id).resources.materials = structuredClone(materials)
      store.orders.find((item) => item.code === order.code).resources.materials = structuredClone(materials)
      store.materialRequestStatuses = []
    })
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
    page.setDefaultTimeout(10000)
    let writes = 0, refusals = 0, failOnce = true
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/inventory**', (route) => { if (route.request().method() !== 'GET') writes++; return route.fulfill({ status: 200, json: { items: [], movements: [] } }) })
    await page.route('**/api/material-requests/*/reject', (route) => {
      refusals++
      if (failOnce) { failOnce = false; return route.fulfill({ status: 500, json: { message: 'Falha de teste' } }) }
      return route.continue()
    })
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    if (viewport.theme) await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), viewport.theme)
    const imageSuffix = `${viewport.width}${viewport.theme ? '-dark' : ''}`
    const navigate = async (name) => {
      if (viewport.width < 768) await page.getByRole('button', { name: 'Abrir menu de navega\u00e7\u00e3o', exact: true }).click()
      await page.locator('.sidebar').getByRole('button', { name, exact: true }).click()
    }
    await navigate('Servi\u00e7os em andamento')
    await page.getByRole('button', { name: 'Material pendente', exact: true }).click()
    const pending = page.getByRole('dialog', { name: 'Material pendente', exact: true })
    assert.ok((await pending.innerText()).includes('10 kg'))
    assert.ok((await pending.innerText()).includes('2 kg'))
    assert.ok((await pending.innerText()).includes('12 kg'))
    assert.ok((await pending.innerText()).includes(materials[0].name))
    assert.ok((await pending.innerText()).includes(materials[0].detail))
    assert.equal(await pending.getByText('Deseja come\u00e7ar o servi\u00e7o mesmo assim?', { exact: true }).count(), 0)
    const box = await pending.boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width)
    await page.screenshot({ path: `test-results/material-pending-inspection-${imageSuffix}.png` })
    await page.keyboard.press('Escape')
    await pending.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Material pendente', exact: true }).click()
    await pending.getByRole('button', { name: 'Ir ao pedido', exact: true }).click()
    await page.getByRole('heading', { name: 'Pedidos de material', exact: true }).waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0)
    const row = page.locator('.material-orders-table tbody tr').filter({ hasText: materials[0].name })
    await row.getByRole('button', { name: 'Adicionar material', exact: true }).click()
    const entry = page.getByRole('dialog', { name: 'Adicionar material', exact: true })
    assert.equal(await entry.getByLabel(/^Quantidade dispon\u00edvel/).inputValue(), '10')
    await entry.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await page.screenshot({ path: `test-results/material-order-actions-${imageSuffix}.png`, fullPage: true })
    await row.getByRole('button', { name: 'Recusar pedido', exact: true }).click()
    const rejection = page.getByRole('dialog', { name: 'Recusar pedido de material?', exact: true })
    assert.ok((await rejection.innerText()).includes('10 kg'))
    await rejection.getByRole('button', { name: 'Cancelar', exact: true }).click()
    assert.equal(refusals, 0)
    await row.getByRole('button', { name: 'Recusar pedido', exact: true }).click()
    await page.screenshot({ path: `test-results/material-request-rejection-${imageSuffix}.png` })
    await rejection.getByRole('button', { name: 'Recusar pedido', exact: true }).click()
    await rejection.getByRole('alert').waitFor()
    assert.equal(await row.count(), 1)
    await rejection.getByRole('button', { name: 'Recusar pedido', exact: true }).click()
    await rejection.waitFor({ state: 'hidden' })
    await row.getByText('Pedido recusado', { exact: true }).waitFor()
    assert.equal(await row.getByRole('button', { name: 'Adicionar material', exact: true }).count(), 0)
    assert.equal(await row.getByRole('button', { name: 'Recusar pedido', exact: true }).count(), 0)
    assert.equal(await page.locator('.material-orders-table tbody tr').count(), 2)
    assert.equal(refusals, 2)
    assert.equal(writes, 0, 'Inspection, cancel and refusal must not change stock')
    await page.reload()
    await page.getByRole('heading', { name: 'Pedidos de material', exact: true }).waitFor()
    await row.getByText('Pedido recusado', { exact: true }).waitFor()
    assert.equal(await row.count(), 1, 'Refused requests must remain after reload')
    await navigate('Servi\u00e7os em andamento')
    await page.getByRole('button', { name: 'Material pendente', exact: true }).click()
    assert.ok((await pending.innerText()).includes('12 kg'), 'Refusal does not clear the OS shortage')
    await page.keyboard.press('Escape')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Pending material inspection -> orders, restrained row buttons, refusal confirmation/cancel/retry/persistence, unchanged stock and OS: desktop and iPhone 15/Pro Max passed.')
} finally { await browser.close(); await fixture.close() }
