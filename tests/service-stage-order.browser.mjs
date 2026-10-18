import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' } })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, hasTouch: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const waitSaved = () => page.waitForFunction(() => !document.querySelector('.offer-proposal-button')?.disabled)
const handle = (label) => page.getByRole('button', { name: label, exact: true })
const groups = () => page.locator('.offer-stage-heading h3').allTextContents()
const stagesIn = (group) => page.locator(`[data-stage-id="${group}"] .offer-stage-item`).evaluateAll((items) => items.map((item) => item.dataset.stageId))
async function drag(from, to) {
  await from.scrollIntoViewIfNeeded()
  const a = await from.boundingBox(), b = await to.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2, { steps: 2 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.mouse.up()
  await waitSaved()
}
try {
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill('12345678901')
  await page.getByLabel('Senha', { exact: true }).fill('teste123')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e servi\u00e7os', exact: true }).click()
  await page.locator('.offer-review-button').click()
  for (const name of ['Tornearia', 'Montagem', 'Pintura', 'Corte a plasma']) await page.getByRole('checkbox', { name, exact: true }).check()
  await waitSaved()
  await drag(handle('Reordenar grupo Pintura'), handle('Reordenar grupo Usinagem'))
  assert.deepEqual(await groups(), ['Pintura', 'Usinagem', 'Caldeiraria'])
  await drag(handle('Reordenar etapa Montagem'), handle('Reordenar etapa Tornearia'))
  assert.equal((await stagesIn('Usinagem'))[0], 'assembly')
  // Keyboard sorting uses the same handles and does not change checkbox state.
  await handle('Reordenar grupo Caldeiraria').scrollIntoViewIfNeeded()
  await handle('Reordenar grupo Caldeiraria').focus()
  await page.keyboard.press('Space')
  await page.locator('[data-stage-id="Caldeiraria"].offer-stage-dragging').waitFor()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.keyboard.press('ArrowUp')
  // The stacked groups are tall: the move scrolls the page smoothly, so the group is dropped only once it reached the
  // place of the group above (it moves by about the height of that group).
  await page.waitForFunction(() => {
    const group = document.querySelector('[data-stage-id="Caldeiraria"]'), above = document.querySelector('[data-stage-id="Usinagem"]')
    return Number(/translate3d\(0px, (-?[\d.]+)px/.exec(group.style.transform)?.[1] || 0) <= -above.getBoundingClientRect().height * 0.9
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.keyboard.press('Space')
  await waitSaved()
  assert.deepEqual(await groups(), ['Pintura', 'Caldeiraria', 'Usinagem'])
  for (const name of ['Tornearia', 'Montagem', 'Pintura', 'Corte a plasma']) assert.equal(await page.getByRole('checkbox', { name, exact: true }).isChecked(), true)
  await page.getByRole('checkbox', { name: 'Montagem', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Montagem', exact: true }).check()
  await waitSaved()
  let saved = (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items.find((row) => row.id === offer.id).resources
  assert.deepEqual(saved.stages, ['painting', 'plasma-cut', 'assembly', 'turning'])
  await page.reload()
  await handle('Reordenar grupo Pintura').waitFor()
  assert.deepEqual(await groups(), ['Pintura', 'Caldeiraria', 'Usinagem'])
  assert.equal((await stagesIn('Usinagem'))[0], 'assembly')
  await page.locator('.offer-process-settings').screenshot({ path: 'test-results/stage-order-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  // The stacked groups are tall on a phone: both handles are brought on screen before the finger drag.
  await handle('Reordenar grupo Caldeiraria').evaluate((element) => { element.scrollIntoView({ block: 'start', behavior: 'instant' }); scrollBy({ top: -80, behavior: 'instant' }) })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const cdp = await context.newCDPSession(page)
  const start = await handle('Reordenar grupo Usinagem').boundingBox(), end = await handle('Reordenar grupo Caldeiraria').boundingBox()
  const x = start.x + start.width / 2, y = start.y + start.height / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  // The finger stops inside the target group but away from the top edge, where the page would scroll by itself.
  const target = end.y + end.height / 2 + 60
  for (let step = 1; step <= 12; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (target - y) * step / 12 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await waitSaved()
  assert.deepEqual(await groups(), ['Pintura', 'Usinagem', 'Caldeiraria'])
  await page.locator('.offer-process-settings').screenshot({ path: 'test-results/stage-order-mobile.png' })
  saved = (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items.find((row) => row.id === offer.id).resources
  assert.deepEqual(saved.stages, ['painting', 'assembly', 'turning', 'plasma-cut'])
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { ...saved, stages: [...saved.stages, 'cutting', 'welding'] })
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.reload()
  await handle('Reordenar grupo Etapas do cadastro anterior').waitFor()
  await drag(handle('Reordenar grupo Etapas do cadastro anterior'), handle('Reordenar grupo Pintura'))
  assert.deepEqual(await groups(), ['Etapas do cadastro anterior', 'Pintura', 'Usinagem', 'Caldeiraria'])
  await drag(handle('Reordenar etapa Soldagem'), handle('Reordenar etapa Corte'))
  saved = (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items.find((row) => row.id === offer.id).resources
  assert.deepEqual(saved.stages, ['welding', 'cutting', 'painting', 'assembly', 'turning', 'plasma-cut'])
  await drag(handle('Reordenar grupo Pintura'), handle('Reordenar grupo Etapas do cadastro anterior'))
  saved = (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items.find((row) => row.id === offer.id).resources
  assert.deepEqual(saved.stages, ['painting', 'welding', 'cutting', 'assembly', 'turning', 'plasma-cut'])
  await page.reload()
  await handle('Reordenar grupo Pintura').waitFor()
  assert.deepEqual(await groups(), ['Pintura', 'Etapas do cadastro anterior', 'Usinagem', 'Caldeiraria'])
  assert.deepEqual(errors, [])
  console.log('Stage ordering passed: mouse, keyboard, touch, selected substeps, legacy groups, reload and mobile layout.')
} finally { await browser.close(); await fixture.close() }
