import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createWorkflowFixture } from './workflowFixture.js'

const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste', DEMO_ADMIN_NAME: 'Gustavo' } })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const bell = page.getByRole('button', { name: 'Notificações', exact: true })
const popup = page.getByRole('dialog', { name: 'Notificações', exact: true })

async function expectClosed() {
  await popup.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.querySelector('.notifications-trigger')?.getAttribute('aria-expanded') === 'false')
  assert.equal(await bell.getAttribute('aria-expanded'), 'false')
}

try {
  await page.route('**/api/auth/login', (route) => route.fulfill({ status: 200, json: { user: { id: 1, name: 'Gustavo', cpf: '12345678901' }, token: fixture.adminToken } }))
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill('12345678901')
  await page.getByLabel('Senha', { exact: true }).fill('teste')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.getByRole('heading', { name: 'Bem-vindo, Gustavo', exact: true }).waitFor()
  await expectClosed()

  for (const [width, height] of [[1366, 900], [900, 800], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => scrollTo(0, 0))
    await bell.scrollIntoViewIfNeeded()
    const triggerBox = await bell.boundingBox()
    // On phones the clock is hidden (mobile.css); where it shows, the bell stays before it.
    const clockBox = await page.locator('.workspace-tabs-clock').boundingBox()
    if (clockBox) assert.ok(triggerBox.x + triggerBox.width <= clockBox.x, 'Bell stays before clock')
    // The phone header is taller and its buttons have a 44px touch target.
    assert.ok(triggerBox.y >= 0 && triggerBox.y + triggerBox.height <= (width < 760 ? 56 : 44), 'Bell stays inside top bar')
    if (clockBox) assert.ok(clockBox.x + clockBox.width <= width, 'Clock fits viewport')
    else assert.ok(triggerBox.x + triggerBox.width <= width, 'Bell fits viewport')
    await bell.click()
    await popup.waitFor()
    await page.waitForFunction(() => document.querySelector('.notifications-trigger')?.getAttribute('aria-expanded') === 'true')
    assert.equal(await bell.getAttribute('aria-expanded'), 'true')
    assert.equal(await popup.getByText('Nenhuma notificação no momento.', { exact: true }).count(), 1)
    const box = await popup.boundingBox()
    assert.ok(box.x >= 11 && box.x + box.width <= width - 11, 'Popup fits viewport')
    assert.ok(box.y >= 44 && box.height > 100, 'Popup is not clipped by top bar')
    await page.screenshot({ path: `test-results/notifications-${width}.png` })
    await bell.click()
    await expectClosed()
    await bell.click()
    await popup.getByRole('button', { name: 'Fechar notificações', exact: true }).click()
    await expectClosed()
    assert.ok(await bell.evaluate((element) => element === document.activeElement), 'Close restores bell focus')
    await bell.press('Enter')
    await popup.waitFor()
    await page.keyboard.press('Escape')
    await expectClosed()
    await bell.click()
    await page.mouse.click(width - 15, height - 20)
    await expectClosed()
  }

  await page.setViewportSize({ width: 1366, height: 900 })
  await page.evaluate(() => scrollTo(0, 0))
  await bell.click()
  await popup.waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => scrollTo(0, 0))
  await bell.scrollIntoViewIfNeeded()
  if (!await popup.isVisible()) await bell.click()
  await page.waitForFunction(() => {
    const box = document.querySelector('.notifications-popup').getBoundingClientRect()
    return box.x >= 11 && box.right <= innerWidth - 11
  })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1366, height: 900 })
  for (const screen of ['Serviços em andamento', 'Estoque', 'Funcionários', 'Início']) {
    const item = page.locator('.sidebar').getByRole('button', { name: screen, exact: true })
    // Funcionários is inside the "Cadastros" group of the side menu.
    if (!await item.isVisible()) await page.locator('.sidebar').getByRole('button', { name: 'Cadastros', exact: true }).click()
    await item.click()
    await bell.click()
    await popup.waitFor()
    await page.keyboard.press('Escape')
    await expectClosed()
  }
  assert.deepEqual(errors, [])
  console.log('Notifications verified: placement, responsive popup, toggle, keyboard, dismiss, focus, resize and navigation.')
} finally {
  await browser.close()
  await fixture.close()
}
