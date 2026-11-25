import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { openSidebarItem } from './sidebarNavigation.js'
import { todayBahia } from '../server/payableRules.js'

// Nº do pedido de compra and Nota de entrada (2026-11-25): the acceptance asks for both (and optional files, kept in
// "Anexos administrativos"); "Gerar OS com informações pendentes" keeps what was filled in and leaves the rest for Ver
// OS, and Serviços em andamento marks what is missing. The acceptance asks no date: a retroactive offer opens its OS on
// its "Data da solicitação". The search of the three screens finds requesters, buyer, purchase order and nota de entrada.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const errors = []
const past = new Date(Date.parse(`${todayBahia()}T12:00:00Z`) - 20 * 86400000).toISOString().slice(0, 10)
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  async function proposed(fields) {
    const offer = (await api('/offers', 'POST', { ...offerDraft, ...fields })).data.item
    await api(`/offers/${offer.id}/finish`, 'POST', {})
    await api(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [{ id: 'l1', type: 'machine', resource: 'Torno', hours: 2, hourlyRate: 30 }], stages: ['turning'], kind: 'service' })
    const saved = await api(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Proposta A', serviceValue: 350, materials: 0, labor: 60, margin: 15, discount: 0, deadline: '2026-12-21', machine: '2 horas', serviceTime: '0 horas' } })
    assert.equal(saved.status, 200, JSON.stringify(saved.data))
    return offer
  }
  const withOrder = await proposed({ service: 'Eixo do redutor', company: 'Indústria Exemplo', requesters: ['Mariana Lopes'], buyer: 'Carla Souza' })
  const without = await proposed({ service: 'Bucha de bronze', company: 'Belgo', requestedAt: past })

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()

  // --- Accepted with the purchase order, the nota de entrada and two files.
  await openSidebarItem(page, 'Ofertas e serviços')
  const offerRow = (service) => page.locator('.offers-table-row').filter({ hasText: service })
  await offerRow('Eixo do redutor').getByRole('button', { name: /Aceitar Oferta/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Tem certeza que deseja aceitar a oferta?', exact: true })
  assert.equal(await dialog.getByLabel('Data da OS').count(), 0, 'the date of the OS is not asked again')
  assert.equal(await dialog.getByText(/Lançamento retroativo/).count(), 0)
  // "Sim" needs both numbers; "Gerar OS com informações pendentes" is the other way.
  await dialog.getByRole('button', { name: 'Sim, aceitar e gerar a OS', exact: true }).click()
  assert.equal(await dialog.getByLabel('Nº do pedido de compra').evaluate((input) => input.validity.valueMissing), true)
  await dialog.getByLabel('Nº do pedido de compra').fill('4500123456')
  await dialog.getByRole('button', { name: 'Sim, aceitar e gerar a OS', exact: true }).click()
  assert.equal(await dialog.getByLabel('Nota de entrada', { exact: true }).evaluate((input) => input.validity.valueMissing), true)
  await dialog.getByLabel('Nota de entrada', { exact: true }).fill('NF-3321')
  await dialog.getByLabel('Anexos do pedido de compra e da nota de entrada').setInputFiles([{ name: 'pedido-4500123456.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 pedido') }, { name: 'nota-3321.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 nota') }])
  await page.screenshot({ path: 'test-results/purchase-order-accept.png' })
  await dialog.getByRole('button', { name: 'Sim, aceitar e gerar a OS', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })

  // --- Accepted with pending information: only the purchase order, on a retroactive offer (its OS takes the day of the request).
  await offerRow('Bucha de bronze').getByRole('button', { name: /Aceitar Oferta/ }).click()
  assert.match(await dialog.innerText(), new RegExp(`Lançamento retroativo: a OS fica com a data da solicitação, ${past.split('-').reverse().join('/')}`))
  await dialog.getByLabel('Nº do pedido de compra').fill('PC-500')
  await dialog.getByRole('button', { name: 'Gerar OS com informações pendentes', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const orders = (await api('/orders')).data.items
  const first = orders.find((order) => order.offerId === withOrder.id), second = orders.find((order) => order.offerId === without.id)
  assert.deepEqual([first.purchaseOrderNumber, first.entryInvoiceNumber], ['4500123456', 'NF-3321'])
  assert.deepEqual(first.purchaseOrders.map((file) => file.name), ['pedido-4500123456.pdf', 'nota-3321.pdf'])
  assert.deepEqual([second.purchaseOrderNumber, second.entryInvoiceNumber], ['PC-500', undefined], 'what was filled in is kept')
  assert.equal(second.createdAt, `${past}T12:00:00.000Z`)

  // --- Serviços em andamento: only the OS with something missing is marked, and the mark says what.
  await openSidebarItem(page, 'Serviços em andamento')
  const panelRow = (code) => page.locator('.admin-os-table tbody tr').filter({ hasText: code })
  const mark = panelRow(second.code).locator('.admin-os-po-missing')
  await mark.waitFor()
  assert.equal(await mark.innerText(), 'Sem nota de entrada')
  assert.equal(await panelRow(first.code).locator('.admin-os-po-missing').count(), 0)
  await page.screenshot({ path: 'test-results/purchase-order-panel.png' })
  // The search: buyer, requester, purchase order and nota de entrada.
  const search = page.getByRole('searchbox', { name: 'Buscar serviços', exact: true })
  for (const query of ['carla', 'MARIANA', '4500123', 'nf-3321']) {
    await search.fill(query)
    await page.waitForFunction(() => document.querySelectorAll('.admin-os-table tbody tr').length === 1)
    assert.match(await page.locator('.admin-os-table tbody tr').innerText(), new RegExp(first.code), query)
  }
  await search.fill('')

  // --- Ver OS: both numbers in the header; the missing one filled in later.
  await panelRow(second.code).getByRole('button', { name: 'Ver OS', exact: true }).click()
  const fact = (label) => page.locator('.os-order-summary > div').filter({ has: page.locator('dt', { hasText: label }) })
  assert.match(await fact('Nº do pedido de compra').innerText(), /PC-500/)
  assert.match(await fact('Nota de entrada').innerText(), /Não informada/)
  await fact('Nota de entrada').getByRole('button', { name: 'Informar a nota de entrada', exact: true }).click()
  const later = page.getByRole('dialog', { name: 'Pedido de compra e nota de entrada', exact: true })
  assert.equal(await later.getByLabel('Nº do pedido de compra').inputValue(), 'PC-500')
  await later.getByLabel('Nota de entrada', { exact: true }).fill('NF-778')
  await later.getByRole('button', { name: 'Salvar', exact: true }).click()
  await later.waitFor({ state: 'hidden' })
  await fact('Nota de entrada').getByText('NF-778').waitFor()
  await fact('Nota de entrada').getByRole('button', { name: 'Alterar a nota de entrada', exact: true }).waitFor()
  await page.screenshot({ path: 'test-results/purchase-order-details.png' })

  await openSidebarItem(page, 'Serviços em andamento')
  await panelRow(second.code).waitFor()
  assert.equal(await page.locator('.admin-os-po-missing').count(), 0, 'filled in, the mark goes away')
  await openSidebarItem(page, 'Ofertas e serviços')
  await page.getByRole('searchbox', { name: 'Buscar ofertas', exact: true }).fill('nf-778')
  await page.waitForFunction(() => document.querySelectorAll('.offers-table-row:not(.offers-table-header)').length === 1)
  assert.match(await page.locator('.offers-table-row:not(.offers-table-header)').innerText(), /Bucha de bronze/i)

  // Phone width: the page fits.
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0)
  assert.deepEqual(errors, [])
  console.log('Purchase order and nota de entrada passed: asked on the acceptance with two files, pending-information button keeps what was filled, retroactive date without asking, mark on the panel says what is missing, Ver OS fill-in and search.')
} finally {
  await browser.close()
  await fixture.close()
}
