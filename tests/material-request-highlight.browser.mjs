import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
try {
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  const materials = ['Inox selecionado', 'Ferro selecionado'].map((name, index) => ({ id: `material-${index}`, name, quantity: 10, stockStatus: 'unknown', purchaseQuantity: 10 }))
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials, laborEntries: [], stages: ['painting'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 500, deadline: offer.deadline } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  // Unrelated requests put the target beyond the first viewport without touching live data.
  await fixture.mutateStore((store) => {
    const unrelated = Array.from({ length: 25 }, (_, index) => ({ ...structuredClone(store.offers[0]), id: `other-${index}`, orderCode: `OTHER-${index}`, resources: { materials: [{ ...materials[0], name: `Outro material ${index}` }] } }))
    store.offers.unshift(...unrelated)
  })
  for (const viewport of [
    { width: 1920, height: 1080 }, { width: 1440, height: 900 },
    { width: 393, height: 852 }, { width: 430, height: 932 },
    { width: 1440, height: 900, dark: true }, { width: 393, height: 852, reduced: true },
  ]) {
    const page = await browser.newPage({ viewport, reducedMotion: viewport.reduced ? 'reduce' : 'no-preference' })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/inventory**', (route) => route.fulfill({ status: 200, json: { items: [], movements: [] } }))
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    if (viewport.dark) await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    async function navigate(name) {
      if (viewport.width < 768) await page.getByRole('button', { name: 'Abrir menu de navega\u00e7\u00e3o', exact: true }).click()
      await page.locator('.sidebar').getByRole('button', { name, exact: true }).click()
    }
    const highlighted = page.locator('.material-request--highlighted')
    for (let attempt = 0; attempt < 2; attempt++) {
      await navigate('Servi\u00e7os em andamento')
      await page.getByRole('button', { name: 'Material pendente', exact: true }).click()
      await page.getByRole('dialog', { name: 'Material pendente', exact: true }).getByRole('button', { name: 'Ir ao pedido', exact: true }).click()
      await highlighted.first().waitFor()
      assert.equal(await highlighted.count(), 2)
      for (const row of await highlighted.all()) assert.ok((await row.innerText()).includes(order.code), 'Only the selected OS requests should pulse')
      const box = await highlighted.first().boundingBox()
      assert.ok(box.y >= 0 && box.y < viewport.height, 'Selected request should scroll into view')
      assert.equal(await page.locator('.material-orders-table tbody tr').count(), 27)
      const row = highlighted.first()
      const animationName = await row.evaluate((element) => getComputedStyle(element).animationName)
      assert.equal(animationName, viewport.reduced ? 'none' : 'material-request-pulse')
      if (!viewport.reduced) {
        await row.evaluate((element) => {
          for (const animation of element.getAnimations()) { animation.pause(); animation.currentTime = 400 }
        })
      }
      const color = await row.evaluate((element) => getComputedStyle(element).backgroundColor)
      assert.notEqual(color, 'rgba(0, 0, 0, 0)', 'Pulse must visibly tint the row')
      if (attempt === 0) await page.screenshot({ path: `test-results/material-request-highlight-${viewport.width}${viewport.dark ? '-dark' : ''}${viewport.reduced ? '-reduced' : ''}.png` })
      await highlighted.first().waitFor({ state: 'hidden', timeout: 5000 })
      assert.equal(await highlighted.count(), 0, 'Highlight should disappear automatically')
    }
    await navigate('Estoque')
    await navigate('Pedidos de material')
    assert.equal(await highlighted.count(), 0, 'Normal navigation must not replay an old highlight')
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Correct requests, auto-scroll, soft red pulse, automatic reset, repeated navigation, desktop/mobile/dark/reduced motion passed.')
} finally { await browser.close(); await fixture.close() }
