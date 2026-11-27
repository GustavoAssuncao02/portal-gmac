import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// Serviços em andamento (2026-11-27): the OS whose production is finished leave the main table for the block
// "Aguardando NF-e" at the end: open by default (collapsing is remembered), the one waiting longest first, yellow from 5
// days and red from 10; the deadline filters count only the production; the Modo de exibição hides the block. Fictitious data.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString()

async function createOrder(service) {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cut-bend'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  const result = await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(result.status, 201, JSON.stringify(result.data))
  return result.data.item
}
async function signIn(page) {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
}
async function openPanel(page) {
  const menu = page.getByRole('button', { name: 'Abrir menu de navegação', exact: true })
  if (await menu.isVisible()) await menu.click()
  const item = page.locator('.sidebar').getByRole('button', { name: 'Serviços em andamento', exact: true })
  if (!await item.isVisible()) await page.locator('.sidebar').getByRole('button', { name: 'Operação', exact: true }).click()
  await item.click()
  await page.getByRole('heading', { name: 'Painel de serviços em andamento' }).waitFor()
}

try {
  const production = await createOrder('Eixo em produção')
  const today = await createOrder('Bucha concluída hoje')
  const week = await createOrder('Flange concluída na semana')
  const old = await createOrder('Polia concluída há tempo')
  const operations = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items
  await fixture.mutateStore((store) => {
    for (const [code, days] of [[today.code, 0], [week.code, 6], [old.code, 12]]) {
      const order = store.orders.find((item) => item.code === code)
      order.operation = { ...operations.find((item) => item.code === code).operation, status: 'completed', startedAt: daysAgo(days + 1), completedAt: daysAgo(days), completionAcknowledgedAt: null, activeSession: null }
    }
    Object.assign(store.orders.find((item) => item.code === week.code), { purchaseOrderNumber: 'PC-123', entryInvoiceNumber: 'NE-9' })
  })

  const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, timezoneId: 'America/Bahia' })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signIn(page)
  await openPanel(page)

  // The main table: only the production. The block below it, open, the one waiting longest first.
  const productionRows = page.locator('.admin-os-table tbody tr')
  await productionRows.filter({ hasText: production.code }).waitFor()
  assert.equal(await productionRows.count(), 1)
  const block = page.locator('.admin-invoice-block')
  const heading = block.locator('.admin-invoice-heading')
  assert.equal(await heading.getAttribute('aria-expanded'), 'true')
  assert.equal(await heading.locator('strong').innerText(), '3')
  const [table, blockBox] = await Promise.all([page.locator('.admin-os-table-wrap').boundingBox(), block.boundingBox()])
  assert.ok(blockBox.y > table.y + table.height - 1, 'below the production')
  const invoiceRows = block.locator('tbody tr')
  const codes = async () => (await invoiceRows.locator('td:first-child small').allInnerTexts()).map((text) => text.slice(0, 12))
  assert.deepEqual(await codes(), [old.code, week.code, today.code])
  assert.deepEqual(await invoiceRows.locator('.admin-invoice-wait').allInnerTexts(), ['há 12 dias', 'há 6 dias', 'hoje'])
  assert.deepEqual(await invoiceRows.locator('.admin-invoice-wait').evaluateAll((items) => items.map((item) => item.className.split('--')[1])), ['late', 'warn', 'ok'])
  // Pendências: what is still missing for the invoice.
  assert.match(await invoiceRows.filter({ hasText: old.code }).locator('[data-label="Pendências"]').innerText(), /Sem pedido de compra\s+Sem nota de entrada/)
  assert.equal(await invoiceRows.filter({ hasText: week.code }).locator('[data-label="Pendências"]').innerText(), '—')
  await page.screenshot({ path: 'test-results/invoice-waiting-1600.png', fullPage: true })

  // The filters: deadlines count only the production; "Aguardando NF-e" shows only the block.
  const chip = (name) => page.locator('.deadline-filters').getByRole('button', { name })
  assert.equal(await chip('Todos').locator('strong').innerText(), '4')
  assert.equal(await chip('Dentro do prazo').locator('strong').innerText(), '1')
  assert.equal(await chip('Aguardando NF-e').locator('strong').innerText(), '3')
  assert.equal(await chip('Concluídos').count(), 0)
  await chip('Dentro do prazo').click()
  assert.equal(await block.count(), 0)
  assert.equal(await productionRows.count(), 1)
  await chip('Aguardando NF-e').click()
  assert.equal(await page.locator('.admin-os-table').count(), 0)
  assert.equal(await invoiceRows.count(), 3)
  await chip('Todos').click()

  // The search looks in both; the titles sort the block apart.
  await page.getByLabel('Buscar serviços', { exact: true }).fill('Flange')
  assert.deepEqual(await codes(), [week.code])
  assert.equal(await productionRows.count(), 0)
  await page.getByLabel('Buscar serviços', { exact: true }).fill('')
  const waiting = block.locator('th').filter({ hasText: 'Esperando' })
  await waiting.getByRole('button').click()
  assert.equal(await waiting.getAttribute('aria-sort'), 'descending')
  assert.deepEqual(await codes(), [old.code, week.code, today.code])
  await waiting.getByRole('button').click()
  assert.deepEqual(await codes(), [today.code, week.code, old.code])

  // The green button: the receivable, as before; Ver OS opens the OS.
  await invoiceRows.filter({ hasText: today.code }).getByRole('button', { name: 'Aguardando NF-e', exact: true }).click()
  const schedule = page.getByRole('dialog', { name: 'Recebimento do serviço', exact: true })
  await schedule.waitFor()
  await page.keyboard.press('Escape')
  await schedule.waitFor({ state: 'detached' })
  await invoiceRows.filter({ hasText: old.code }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  await page.getByText(old.code, { exact: true }).first().waitFor()
  await openPanel(page)

  // Collapsed: remembered for this account, also after reloading.
  await heading.click()
  assert.equal(await heading.getAttribute('aria-expanded'), 'false')
  assert.equal(await invoiceRows.count(), 0)
  assert.equal(await heading.locator('.admin-invoice-toggle-text').innerText(), 'Mostrar')
  await page.reload()
  await page.locator('.sidebar').waitFor()
  await openPanel(page)
  assert.equal(await heading.getAttribute('aria-expanded'), 'false')
  await heading.click()
  assert.equal(await invoiceRows.count(), 3)

  // Modo de exibição (TV of the factory): only the production, no block and no filter of the NF-e.
  await page.getByRole('button', { name: 'Modo de exibição', exact: true }).click()
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('admin-os-main'))
  assert.equal(await block.count(), 0)
  assert.equal(await chip('Aguardando NF-e').count(), 0)
  assert.equal(await productionRows.count(), 1)
  await page.getByRole('button', { name: 'Sair do modo de exibição', exact: true }).click()
  await page.waitForFunction(() => !document.fullscreenElement)
  await block.waitFor()
  assert.deepEqual(errors, [])
  await page.close()

  // Layouts: nothing out of the screen, the buttons inside the block.
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1004, height: 628 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    const view = await browser.newPage({ viewport, timezoneId: 'America/Bahia' })
    await signIn(view)
    await openPanel(view)
    const box = view.locator('.admin-invoice-block')
    await box.locator('tbody tr').first().waitFor()
    assert.ok(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${viewport.width}: no horizontal scroll`)
    const outer = await box.boundingBox()
    for (const button of await box.locator('tbody button').all()) {
      const inner = await button.boundingBox()
      assert.ok(inner.x >= outer.x - 1 && inner.x + inner.width <= outer.x + outer.width + 1, `${viewport.width}: a button out of the block`)
    }
    await box.screenshot({ path: `test-results/invoice-waiting-block-${viewport.width}.png` })
    await view.close()
  }
  console.log('invoice waiting browser test passed')
} finally {
  await browser.close()
  await fixture.close()
}
