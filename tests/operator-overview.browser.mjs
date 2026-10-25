import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { enterOperatorCode } from './operatorEntry.js'

// Before the code, the shared tablet follows every open OS like the administrators' panel: read-only and live, with the
// entry below the list and always in view.
const fixture = await createWorkflowFixture()
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
try {
  const ana = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'ana@example.invalid', identification: '001' }, fixture.admin)).data.item
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning', 'painting'] })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const service = (await fixture.adminRequest('/labor-services')).data.items[0]

  for (const [index, viewport] of [{ width: 1280, height: 800 }, { width: 393, height: 852 }].entries()) {
    const context = await browser.newContext({ viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}) })
    await context.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(fixture.url)
    await page.locator('.operator-entry').waitFor()
    await page.getByRole('heading', { name: 'Projetos em andamento', exact: true }).waitFor()
    const row = page.locator('.operator-overview .admin-os-table tbody tr').filter({ hasText: order.code })
    await row.waitFor()
    assert.match(await row.innerText(), new RegExp(offerDraft.company))
    assert.equal(await page.locator('.operator-overview').getByRole('button').count(), 0, 'the panel is read-only: no "Ver OS" nor any other action')
    assert.equal(await page.locator('.operator-entry input').count(), 0, 'only the on-screen keypad is used')

    // Someone starts on another tablet: the row shows the operator at the next refresh, without touching the screen.
    if (index === 0) {
      assert.equal((await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: ana.id, laborServiceId: service.id }, { Authorization: `Bearer ${fixture.operatorToken}` })).status, 200)
    }
    await row.getByText('Ana Teste', { exact: true }).waitFor({ timeout: 15000 })

    // The entry stays below the list and inside the screen.
    const entry = page.locator('.operator-entry-card')
    const [entryBox, tableBox] = await Promise.all([entry.boundingBox(), page.locator('.operator-overview .admin-os-table-wrap').boundingBox()])
    assert.ok(entryBox.y >= tableBox.y && entryBox.y + entryBox.height <= viewport.height, 'the entry sits under the list, in view')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: `test-results/operator-overview-${viewport.width}.png` })

    await enterOperatorCode(page, ana.accessCode)
    await page.locator('.operator-project').filter({ hasText: order.service }).waitFor()
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('Painel do operador antes do código: OK (tablet e celular)')
} finally {
  await browser.close()
  await fixture.close()
}
