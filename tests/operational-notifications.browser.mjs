import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { notificationDefaults, notificationOptions } from '../server/notificationRules.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
let inventory = [{ id: 1, name: 'Inox', quantity: 20, minimum: 5 }]
const fixture = await createWorkflowFixture({ accountsEnv: env, notificationInventory: async () => inventory })
const browser = await chromium.launch()
const auth = { Authorization: `Bearer ${fixture.adminToken}` }
const request = (route, method, body) => fixture.request(route, method, body, auth)
try {
  await request('/notifications')
  const offer = (await request('/offers', 'POST', offerDraft)).data.item
  await request(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'titanio', name: 'Titanio', quantity: 10, unitPrice: 20, purchaseQuantity: 10, stockStatus: 'unknown' }], laborEntries: [], stages: ['painting'], kind: 'service' })
  await request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offer.deadline, serviceValue: 100 } })
  const order = (await request(`/offers/${offer.id}/accept`, 'POST')).data.item
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 393, height: 852 }, { width: 430, height: 932 }, { width: 1440, height: 900, theme: 'dark' }]) {
    await request('/account/notifications', 'PATCH', notificationDefaults)
    await fixture.mutateStore((store) => { for (const notice of store.operationalNotifications) notice.readBy = [] })
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
    page.setDefaultTimeout(16000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem('gmac-inventory-migrated-v1', 'true'))
    await page.route('**/api/inventory**', (route) => route.fulfill({ status: 200, json: { items: inventory, movements: [] } }))
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.notifications-count').waitFor()
    if (viewport.width === 1920) {
      assert.equal(await page.locator('.notifications-count').innerText(), '2')
      const employee = (await request('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001', birthDate: '1990-01-01', email: 'ana@example.invalid', identification: '001' })).data.item
      const operatorAuth = { Authorization: `Bearer ${fixture.operatorToken}` }
      const route = `/operations/orders/${order.code}`
      const pending = (await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id }, operatorAuth)).data.pendingMaterials
      const started = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id, pendingMaterialsConfirmation: pending.map((row) => [row.key, row.quantity]) }, operatorAuth)
      const session = { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken }
      await fixture.request(`${route}/stages/${started.data.operation.stages[0].key}`, 'POST', { ...session, quantity: order.quantity }, operatorAuth)
      await fixture.request(`${route}/complete`, 'POST', session, operatorAuth)
      inventory = [{ ...inventory[0], quantity: 4 }]
      await page.waitForFunction(() => document.querySelector('.notifications-count')?.textContent === '4', { timeout: 16000 })
    }
    if (viewport.theme) await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), viewport.theme)
    const suffix = `${viewport.width}${viewport.theme ? '-dark' : ''}`
    const bell = page.getByRole('button', { name: 'Notifica\u00e7\u00f5es', exact: true })
    await bell.click()
    await page.waitForFunction(() => !document.querySelector('.notifications-count'))
    const popup = page.locator('.notifications-popup')
    assert.equal(await popup.locator('.notifications-payables button').count(), 4)
    const bounds = await popup.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width)
    await popup.screenshot({ path: `test-results/operational-notifications-${suffix}.png` })
    await popup.getByRole('button').filter({ hasText: 'Novo pedido de material' }).click()
    await page.getByRole('heading', { name: 'Pedidos de material', exact: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector('.notifications-count'))
    if (viewport.width < 768) await page.getByRole('button', { name: 'Abrir menu de navega\u00e7\u00e3o', exact: true }).click()
    await page.locator('.sidebar').getByRole('button', { name: 'Configura\u00e7\u00f5es', exact: true }).click()
    const options = page.locator('.account-notification-options')
    await options.waitFor()
    for (const [, label] of notificationOptions) assert.ok(await options.getByLabel(label, { exact: true }).isChecked())
    for (const label of await options.locator('label').all()) {
      const checkbox = await label.locator('input').boundingBox()
      const text = await label.locator('span').boundingBox()
      assert.ok(text.x >= checkbox.x + checkbox.width + 6, 'Checkbox text must be on the right')
      assert.ok(Math.abs(checkbox.y + checkbox.height / 2 - text.y - text.height / 2) < 2, 'Checkbox and label must be vertically aligned')
    }
    await options.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `test-results/notification-checkboxes-${suffix}.png` })
    await options.getByLabel(notificationOptions[0][1], { exact: true }).uncheck()
    await page.getByRole('button', { name: 'Salvar notifica\u00e7\u00f5es', exact: true }).click()
    await page.getByText('Prefer\u00eancia de notifica\u00e7\u00f5es salva.', { exact: true }).waitFor()
    assert.equal((await request('/account/notifications')).data.settings.materialRequests, false)
    await bell.click()
    await page.waitForFunction(() => document.querySelectorAll('.notifications-payables button').length === 3)
    assert.equal(await popup.getByText('Novo pedido de material', { exact: true }).count(), 0)
    await page.keyboard.press('Escape')
    await page.reload()
    await options.waitFor()
    await page.waitForFunction(() => document.querySelector('.account-notification-options input')?.disabled === false)
    assert.equal(await options.getByLabel(notificationOptions[0][1], { exact: true }).isChecked(), false)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('All four notices, 10-second polling, reading, shortcuts, per-account checkbox persistence and inline labels passed on desktop, iPhone 15/Pro Max and dark mode.')
} finally { await browser.close(); await fixture.close() }
