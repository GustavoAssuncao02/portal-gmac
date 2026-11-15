import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createTestDatabase, createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { openSidebarItem } from './sidebarNavigation.js'

// The user's case of 2026-11-15: 20 kg of steel not in stock, estimated at R$ 120 in the proposal, bought at R$ 130.
// The receipt of the material request updates the real cost of the OS (margin R$ 150), and the purchase posted from
// "Lançar esta compra no financeiro?" goes on that OS as the request's purchase, not again as an extra cost.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const stock = await createTestDatabase('gmac_test_real_cost_ui')
const fixture = await createWorkflowFixture({ accountsEnv: env, inventoryPool: stock.pool })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(10000)
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

try {
  const api = async (route, method = 'GET', body) => {
    const response = await fixture.adminRequest(route, method, body)
    assert.ok(response.status < 400, `${method} ${route}: ${response.status} ${JSON.stringify(response.data)}`)
    return response.data
  }
  const offer = (await api('/offers', 'POST', { ...offerDraft, service: 'Eixo do redutor' })).item
  await api(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'aco', name: 'Aço SAE 1020', unit: 'kg', quantity: 20, unitPrice: 6, stockStatus: 'missing', stockAvailable: 0, purchaseQuantity: 20 }], laborEntries: [], kind: 'service', stages: ['turning'] })
  await api(`/offers/${offer.id}/finish`, 'POST', {})
  await api(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offer.deadline, materials: 120, labor: 200, serviceValue: 320, margin: 50, discount: 0, osValue: 480 } })
  const order = (await api(`/offers/${offer.id}/accept`, 'POST')).item
  const classification = (await api('/classifications', 'POST', { name: 'Compra de material' })).item
  const supplier = (await api('/suppliers', 'POST', { name: 'Loja de aço', document: '11222333000181' })).item

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()

  // Pedidos de material › Adicionar material at R$ 6,50/kg.
  await openSidebarItem(page, 'Pedidos de material')
  const row = page.locator('.material-orders-table tbody tr').filter({ hasText: 'Aço SAE 1020' })
  await row.getByRole('button', { name: 'Adicionar material', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Adicionar material', exact: true })
  await modal.getByLabel('Valor por kg', { exact: true }).fill('6.5')
  await modal.getByRole('button', { name: 'Adicionar material', exact: true }).click()
  await modal.waitFor({ state: 'hidden' })

  // The purchase goes to Contas a Pagar already on the OS, marked as the purchase of the request.
  const finance = page.getByRole('dialog', { name: 'Lançar esta compra no financeiro?', exact: true })
  await finance.getByRole('button', { name: /Conta a pagar/ }).click()
  const form = page.getByRole('dialog', { name: 'Nova conta a pagar', exact: true })
  assert.equal(await form.getByLabel('OS vinculada (custo)', { exact: true }).inputValue(), order.code)
  await form.getByText('Compra do pedido de material desta OS: já entra no custo real do material, não como custo adicional.', { exact: true }).waitFor()
  await form.getByLabel('Fornecedor', { exact: true }).selectOption(String(supplier.id))
  await form.getByLabel('Classificação', { exact: true }).selectOption(classification.id)
  await form.getByLabel('Vencimento', { exact: true }).fill('2026-12-15')
  await page.screenshot({ path: 'test-results/order-real-cost-payable.png' })
  await form.getByRole('button', { name: 'Salvar conta', exact: true }).click()
  await form.waitFor({ state: 'detached' })
  const purchase = (await api('/payables')).items.find((item) => item.orderCode === order.code)
  assert.equal(purchase.materialRequestId, `${offer.id}-aco`)
  assert.equal(purchase.valueCents, 13000)

  // The OS: material R$ 120 planned, R$ 130 real; margin R$ 150; the purchase listed, already in the material.
  await openSidebarItem(page, 'Serviços em andamento')
  await page.locator('.admin-os-table tbody tr').filter({ hasText: order.code }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  const card = page.locator('.os-costs')
  await card.locator('.os-cost-facts').waitFor()
  const fact = async (label) => (await card.locator('.os-cost-facts > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd').innerText()).replace(/\s+/g, ' ')
  assert.match(await fact('Valor da OS'), /R\$ 480,00/)
  assert.match(await fact('Material'), /R\$ 130,00 real Previsto R\$ 120,00 · \+ R\$ 10,00 pelo preço real do material/)
  assert.match(await fact('Custos lançados'), /R\$ 330,00 Previsto \+ R\$ 10,00 no material/)
  assert.match(await fact('Margem real'), /R\$ 150,00 · 45,5%/)
  assert.match(await card.locator('.os-section-heading span').innerText(), /^0 custos adicionais$/)
  await card.locator('.os-cost-list li').filter({ hasText: purchase.id }).getByText('Compra do pedido de material: já está no custo do material', { exact: true }).waitFor()
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/order-real-cost-card.png' })

  assert.deepEqual(errors, [])
  console.log('Order real cost: price paid for the material, margin R$ 150 and the request purchase not counted twice passed.')
} finally {
  await browser.close()
  await fixture.close()
  await stock.drop()
}
