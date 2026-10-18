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
  const unknown = { id: 'unknown', name: 'Titanio solicitado', detail: 'Chapa 10mm', quantity: 5, purchaseQuantity: 5, unitPrice: 20, stockStatus: 'unknown' }
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [unknown], laborEntries: [], stages: ['painting'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', serviceValue: 250, deadline: offer.deadline } })
  const accepted = await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(accepted.status, 201)
  const existing = { id: 6, name: 'Aco SAE 1020', detail: 'Barra redonda', quantity: 0, minimum: 10, unitPrice: 12.8 }
  const requested = { id: 'registered', inventoryId: 6, name: existing.name, detail: existing.detail, quantity: 170, purchaseQuantity: 10, inventoryConsumedQuantity: 160, stockStatus: 'partial', unitPrice: 12.8 }
  await fixture.mutateStore((store) => {
    store.offers.find((item) => item.id === offer.id).resources.materials = [requested, unknown]
    store.orders.find((item) => item.code === accepted.data.item.code).resources.materials = [requested, unknown]
  })
  for (const { width, height, local = false } of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 393, height: 852 }, { width: 430, height: 932 }, { width: 1440, height: 900, local: true }]) {
    await fixture.mutateStore((store) => {
      store.offers.find((item) => item.id === offer.id).resources.materials = structuredClone([requested, unknown])
      store.orders.find((item) => item.code === accepted.data.item.code).resources.materials = structuredClone([requested, unknown])
      store.materialRequestStatuses = []
    })
    const page = await browser.newPage({ viewport: { width, height } })
    page.setDefaultTimeout(10000)
    let items = [structuredClone(existing)]
    const writes = [], errors = []
    let rejectSave = true
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript((initial) => {
      localStorage.setItem('gmac-inventory-migrated-v1', 'true')
      localStorage.setItem('gmac-inventory', JSON.stringify(initial))
    }, items)
    await page.route('**/api/inventory**', async (route) => {
      const request = route.request()
      if (request.method() === 'GET') return route.fulfill(local ? { status: 503, json: { message: 'Local fixture' } } : { status: 200, json: { items, movements: [] } })
      writes.push({ method: request.method(), url: request.url(), body: request.postDataJSON() })
      if (rejectSave) { rejectSave = false; return route.fulfill({ status: 500, json: { message: 'Falha de teste' } }) }
      const body = request.postDataJSON()
      if (request.url().endsWith('/movements')) items[0].quantity += body.quantityKg
      else items.push({ ...body, id: 7 })
      assert.ok(body.materialRequestId, 'Stock entry should be linked to its request')
      const received = await fixture.request(`/material-requests/${encodeURIComponent(body.materialRequestId)}/receive-local`, 'POST', { materialId: request.url().endsWith('/movements') ? 6 : 7, quantity: body.quantityKg ?? body.quantity, receiptId: body.materialReceiptId }, { Authorization: `Bearer ${fixture.adminToken}` })
      assert.equal(received.status, 200)
      items[request.url().endsWith('/movements') ? 0 : 1].quantity -= received.data.item.allocatedQuantity
      return route.fulfill({ status: 201, json: { item: items.at(-1) } })
    })
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    if (width < 768) await page.getByRole('button', { name: 'Abrir menu de navega\u00e7\u00e3o', exact: true }).click()
    await page.locator('.sidebar').getByRole('button', { name: 'Pedidos de material', exact: true }).click()
    const table = page.locator('.material-orders-table')
    await table.getByRole('button', { name: existing.name, exact: true }).waitFor()
    assert.deepEqual(await table.locator('th').allTextContents(), ['Código','Material solicitado', 'Especifica\u00e7\u00e3o', 'Quantidade a pedir', 'Quantidade necess\u00e1ria', 'OS / Oferta relacionada', 'Data', 'A\u00e7\u00f5es', 'Histórico'])
    const row = table.locator('tbody tr').filter({ has: page.getByRole('button', { name: existing.name, exact: true }) })
    await page.screenshot({ path: `test-results/material-order-entry-table-${width}${local ? '-local' : ''}.png`, fullPage: true })
    await row.getByRole('button', { name: 'Adicionar material', exact: true }).click()
    let modal = page.getByRole('dialog', { name: 'Adicionar material', exact: true })
    const quantity = modal.getByLabel(/^Quantidade de entrada/)
    assert.equal(await quantity.inputValue(), '10', 'Prefill the shortage, not the 170 kg total or the current balance')
    assert.equal(await quantity.evaluate((input) => input.readOnly), false)
    assert.equal(await modal.getByPlaceholder('Digite para buscar no estoque', { exact: true }).inputValue(), existing.name)
    assert.equal(await modal.getByLabel('Especifica\u00e7\u00e3o', { exact: true }).inputValue(), existing.detail)
    assert.equal(await modal.getByLabel('Valor por kg', { exact: true }).inputValue(), '12.8')
    assert.equal(writes.length, 0)
    await page.screenshot({ path: `test-results/material-order-entry-modal-${width}${local ? '-local' : ''}.png`, fullPage: true })
    await modal.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await row.getByRole('button', { name: 'Adicionar material', exact: true }).click()
    await quantity.fill('12')
    await modal.getByLabel('Valor por kg', { exact: true }).fill('14')
    await modal.getByRole('button', { name: 'Registrar entrada', exact: true }).click()
    if (!local) {
      await modal.getByRole('alert').waitFor()
      assert.equal(await quantity.inputValue(), '12')
      await modal.getByRole('button', { name: 'Registrar entrada', exact: true }).click()
    }
    await modal.waitFor({ state: 'hidden' })
    // The purchase is offered to the financial module; here it is left for later.
    const finance = page.getByRole('dialog', { name: 'Lançar esta compra no financeiro?', exact: true })
    assert.match((await finance.locator('.finance-choice-summary').innerText()).replace(/\s/g, ' '), /entrou no estoque: 12 kg × R\$ 14,00 = R\$ 168,00\./)
    await finance.getByRole('button', { name: 'Não lançar agora', exact: true }).click()
    await finance.waitFor({ state: 'detached' })
    await row.getByText('Material solicitado adicionado', { exact: true }).waitFor()
    assert.equal(await row.getByRole('button', { name: 'Adicionar material', exact: true }).count(), 0)
    assert.equal(await row.getByRole('button', { name: 'Recusar pedido', exact: true }).count(), 0)
    if (!local) {
      assert.equal(writes.length, 2)
      assert.ok(writes[1].url.endsWith('/api/inventory/6/movements'))
      assert.equal(writes[1].method, 'POST')
      assert.equal(writes[1].body.quantityKg, 12)
      assert.equal(writes[1].body.unitPrice, 14)
      assert.equal(items.length, 1, 'Do not duplicate an existing material')
    } else {
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gmac-inventory')))
      assert.equal(stored[0].quantity, 2)
      assert.equal(stored[0].history.at(-1).type, 'exit')
      assert.equal(stored[0].history.at(-1).quantity, 10)
      assert.equal(stored[0].history.at(-1).order, accepted.data.item.code)
      assert.equal(writes.length, 0)
    }
    const newRow = table.locator('tbody tr').filter({ has: page.getByRole('button', { name: unknown.name, exact: true }) })
    await newRow.getByRole('button', { name: 'Adicionar material', exact: true }).click()
    modal = page.getByRole('dialog', { name: 'Adicionar material', exact: true })
    assert.equal(await modal.getByLabel(/^Quantidade dispon\u00edvel/).inputValue(), '5')
    await modal.getByPlaceholder('Digite para buscar no estoque', { exact: true }).fill('Titanio recebido')
    await modal.getByLabel('Especifica\u00e7\u00e3o', { exact: true }).fill('Chapa 12mm')
    await modal.getByLabel(/^Quantidade dispon\u00edvel/).fill('6')
    await modal.getByRole('button', { name: 'Adicionar material', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    await finance.getByRole('button', { name: 'Não lançar agora', exact: true }).click()
    await finance.waitFor({ state: 'detached' })
    await newRow.getByText('Material solicitado adicionado', { exact: true }).waitFor()
    await page.reload()
    await table.waitFor()
    await row.getByText('Material solicitado adicionado', { exact: true }).waitFor()
    await newRow.getByText('Material solicitado adicionado', { exact: true }).waitFor()
    assert.equal(await table.getByRole('button', { name: 'Adicionar material', exact: true }).count(), 0)
    assert.equal(await table.getByRole('button', { name: 'Recusar pedido', exact: true }).count(), 0)
    await page.screenshot({ path: `test-results/material-order-received-${width}${local ? '-local' : ''}.png`, fullPage: true })
    if (width < 768) await page.getByRole('button', { name: 'Abrir menu de navega\u00e7\u00e3o', exact: true }).click()
    await page.locator('.sidebar').getByRole('button', { name: 'Servi\u00e7os em andamento', exact: true }).click()
    await page.locator('.admin-os-table').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Material pendente', exact: true }).count(), 0)
    if (!local) {
      assert.ok(writes.at(-1).url.endsWith('/api/inventory'))
      assert.equal(writes.at(-1).body.name, 'Titanio recebido')
      assert.equal(writes.at(-1).body.detail, 'Chapa 12mm')
      assert.equal(writes.at(-1).body.quantity, 6)
    }
    assert.deepEqual(errors, [])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await page.close()
  }
  console.log('Material order entry: last action column, 10 kg shortage prefill, existing stock entry, new editable material, cancel/retry, server/local storage; desktop and iPhone 15/Pro Max passed.')
} finally { await browser.close(); await fixture.close() }
