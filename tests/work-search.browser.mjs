import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { openSidebarItem } from './sidebarNavigation.js'
import { stageLabel } from '../server/serviceStages.js'

// One magnifier for Ofertas e serviços, Serviços em andamento and Serviços concluídos (src/workSearch.js): at the top
// right of the three screens, finding the quote number and attachments — "Anexos administrativos" included.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

try {
  const accepted = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Bucha de bronze TM-23', company: 'A L de Jesus' })).data.item
  await fixture.adminRequest(`/offers/${accepted.id}/resources`, 'PUT', { stages: ['painting'], materials: [], laborEntries: [], kind: 'service' })
  await fixture.adminRequest(`/offers/${accepted.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: accepted.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${accepted.id}/accept`, 'POST')).data.item
  const review = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Eixo do redutor', company: 'Belgo' })).data.item
  const finishedCode = 'OS-2026-0099'
  await fixture.mutateStore((store) => {
    const offer = store.offers.find((item) => item.id === accepted.id), os = store.orders.find((item) => item.code === order.code)
    offer.proposal.document = { model: 'model-a', quoteNumber: '13483' }
    os.proposal.document = { model: 'model-a', quoteNumber: '13483' }
    os.purchaseOrders = [{ id: 'adm-1', name: 'Pão de forma - pedido 778.pdf', uploadedAt: '2026-11-14T12:00:00Z' }]
    store.offers.find((item) => item.id === review.id).attachments = [{ id: 'att-1', name: 'desenho-eixo.pdf' }]
    store.orders.push({ ...structuredClone(os), code: finishedCode, offerId: 'old-offer', service: 'Estrutura antiga', purchaseOrders: [], proposal: { ...os.proposal, document: null }, attachments: [{ id: 'att-2', name: 'laudo-final.pdf' }],
      operation: { status: 'completed', completedAt: '2026-10-01T15:00:00Z', completionAcknowledgedAt: '2026-10-02T12:00:00Z', accumulatedMs: 3600000, activeSession: null, stages: [{ key: 'stage-0', name: stageLabel('painting') }], stageCounts: { 'stage-0': 10 } } })
  })

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()

  // The field sits at the right end of the page header on the three screens.
  async function headerSearch(header, label) {
    const field = page.locator(`${header} .global-search`), input = page.getByRole('searchbox', { name: label, exact: true })
    await input.waitFor()
    const [box, head] = await Promise.all([field.boundingBox(), page.locator(header).boundingBox()])
    assert.ok(Math.abs(box.x + box.width - (head.x + head.width)) < 2, `${label}: at the right of the header`)
    assert.ok(box.y < head.y + 20, `${label}: at the top of the header`)
    assert.match(await input.getAttribute('placeholder'), /cotação ou anexo/)
    return input
  }

  await openSidebarItem(page, 'Ofertas e serviços')
  const offerSearch = await headerSearch('.offers-header', 'Buscar ofertas')
  assert.equal(await page.locator('.offers-board-toolbar input:not([type=date])').count(), 0, 'no second search inside the board')
  const offerCodes = () => page.locator('.offers-table-row:not(.offers-table-header) .offer-piece span:first-of-type').allTextContents()
  await offerSearch.fill('pao')
  await page.waitForFunction(() => document.querySelectorAll('.offers-table-row:not(.offers-table-header)').length === 1)
  assert.deepEqual(await offerCodes(), [accepted.code], 'an administrative attachment of the OS finds its offer')
  await offerSearch.fill('13483')
  assert.deepEqual(await offerCodes(), [accepted.code], 'the quote number')
  await offerSearch.fill('DESENHO')
  assert.deepEqual(await offerCodes(), [review.code], 'an attachment of the offer')
  await page.screenshot({ path: 'test-results/work-search-offers.png' })

  const orderCodes = () => page.locator('.admin-os-table tbody tr td:first-child small').allTextContents().then((rows) => rows.map((text) => text.split(' ·')[0]))
  await openSidebarItem(page, 'Serviços em andamento')
  const panelSearch = await headerSearch('.dashboard-header', 'Buscar serviços')
  await panelSearch.fill('pão de forma')
  await page.waitForFunction(() => document.querySelectorAll('.admin-os-table tbody tr').length === 1)
  assert.deepEqual(await orderCodes(), [order.code])
  await panelSearch.fill('13483')
  assert.deepEqual(await orderCodes(), [order.code])

  await openSidebarItem(page, 'Serviços concluídos')
  const doneSearch = await headerSearch('.dashboard-header', 'Buscar serviços')
  await doneSearch.fill('laudo')
  await page.locator('.admin-os-table tbody tr').filter({ hasText: finishedCode }).waitFor()
  assert.deepEqual(await orderCodes(), [finishedCode])
  await page.locator('.admin-os-table thead').getByRole('button', { name: 'Anexos administrativos', exact: true }).waitFor()
  await page.screenshot({ path: 'test-results/work-search-completed.png' })

  // The OS screen: the area is "Anexos administrativos".
  await openSidebarItem(page, 'Serviços em andamento')
  await (await headerSearch('.dashboard-header', 'Buscar serviços')).fill('')
  await page.locator('.admin-os-table tbody tr').filter({ hasText: order.code }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  await page.getByRole('heading', { name: 'Anexos administrativos', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Anexar documento', exact: true }).waitFor()

  assert.deepEqual(errors, [])
  console.log('Work search: same place on the three screens, quote number, offer and administrative attachments passed.')
} finally {
  await browser.close()
  await fixture.close()
}
