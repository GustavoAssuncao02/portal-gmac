import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// Serviços em andamento e concluídos: "Modo de exibição" in the top right corner beside the search (the clock beside it in
// the display mode), a 22px title, lower deadline buttons and no footer.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cut-bend'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  for (const screen of ['Serviços em andamento', 'Serviços concluídos']) {
    await page.locator('.sidebar').getByRole('button', { name: screen, exact: true }).click()
    const header = page.locator('.admin-os-main .dashboard-header')
    await header.waitFor()
    const display = header.getByRole('button', { name: 'Modo de exibição', exact: true })
    const [search, button, title] = await Promise.all([header.locator('.global-search').boundingBox(), display.boundingBox(), header.locator('h1').boundingBox()])
    assert.ok(button.x >= search.x + search.width, `${screen}: beside the search, on its right`)
    assert.ok(Math.abs((button.y + button.height / 2) - (search.y + search.height / 2)) <= 2, `${screen}: on the line of the search`)
    assert.ok(Math.abs((title.y + title.height / 2) - (search.y + search.height / 2)) <= 4, `${screen}: the title on the same line`)
    assert.equal(await header.locator('h1').evaluate((element) => getComputedStyle(element).fontSize), '22px')
    assert.equal(await header.locator('p').count(), 0, 'no empty paragraph')
    assert.equal(await page.locator('footer.admin-os-display-controls').count(), 0, 'no footer')
    if (screen === 'Serviços em andamento') {
      const deadline = page.locator('.deadline-filters button').first()
      assert.ok((await deadline.boundingBox()).height <= 34, 'lower deadline buttons')
    }
    await page.screenshot({ path: `test-results/panel-header-${screen === 'Serviços concluídos' ? 'completed' : 'progress'}.png` })
  }
  // The display mode: the clock beside the button, at the top.
  await page.locator('.sidebar').getByRole('button', { name: 'Serviços em andamento', exact: true }).click()
  await page.getByRole('button', { name: 'Modo de exibição', exact: true }).click()
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('admin-os-main'))
  const clock = page.locator('.admin-os-main .dashboard-header .admin-os-display-controls time')
  await clock.waitFor()
  const exit = page.getByRole('button', { name: 'Sair do modo de exibição', exact: true })
  const [time, exitBox] = await Promise.all([clock.boundingBox(), exit.boundingBox()])
  assert.ok(time.x + time.width <= exitBox.x && Math.abs((time.y + time.height / 2) - (exitBox.y + exitBox.height / 2)) <= 2, 'the clock beside the button')
  assert.ok(exitBox.y < 120, 'at the top of the screen')
  await page.screenshot({ path: 'test-results/panel-header-display.png' })
  await exit.click()
  await page.waitForFunction(() => !document.fullscreenElement)
  // Narrow screens: no horizontal scroll.
  for (const width of [1180, 1004, 390]) {
    await page.setViewportSize({ width, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal scroll at ${width}`)
    await page.screenshot({ path: `test-results/panel-header-${width}.png` })
  }
  assert.deepEqual(errors, [])
  console.log('Panel header passed: Modo de exibição beside the search in both screens, 22px title, lower deadline buttons, no footer or empty paragraph, the clock beside the button in the display mode, no overflow at 1180/1004/390.')
} catch (error) {
  await page.screenshot({ path: 'test-results/panel-header-failure.png', fullPage: true })
  throw error
} finally { await browser.close(); await fixture.close() }
