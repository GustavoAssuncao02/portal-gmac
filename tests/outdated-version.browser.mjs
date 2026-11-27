import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

// "Versão desatualizada" (2026-11-27): a page running an old interface (here /version.json answers another version)
// opens "Atualizar o portal" once; after "Agora não", in the administrative portal the button beside the bell opens it
// again and the window does not come back by itself; on the login (no bell) it comes back 5 minutes later. The countdown
// of a scheduled update takes the place of the button. "Atualizar agora" reloads the page.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })

async function open(viewport, { schedule = null } = {}) {
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.install()
  await page.route('**/version.json', (route) => route.fulfill({ status: 200, json: { version: 'versao-nova-de-teste' } }))
  if (schedule) await page.route('**/api/update-schedule', (route) => route.fulfill({ status: 200, json: { item: schedule(), now: Date.now() } }))
  await page.goto(fixture.url)
  return { page, errors }
}
const prompt = (page) => page.getByRole('dialog', { name: 'Atualizar o portal' })
async function signIn(page) {
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
}

try {
  // The login: the window opens by itself; "Agora não" closes it and it comes back 5 minutes later.
  const { page, errors } = await open({ width: 1440, height: 900 })
  await prompt(page).waitFor()
  assert.equal(await prompt(page).locator('.payable-modal-body').innerText(), 'Há uma versão nova. Salve o que estiver fazendo antes de atualizar.')
  await page.screenshot({ path: 'test-results/outdated-version-modal-1440.png' })
  await prompt(page).getByRole('button', { name: 'Agora não', exact: true }).click()
  await prompt(page).waitFor({ state: 'detached' })
  await page.clock.fastForward('05:05')
  await prompt(page).waitFor()
  await prompt(page).getByRole('button', { name: 'Agora não', exact: true }).click()

  // The administrative portal: the button beside the bell, and the window no longer comes back by itself.
  await signIn(page)
  const button = page.locator('.workspace-tabs .version-outdated')
  await button.waitFor()
  assert.equal(await button.innerText(), 'Versão desatualizada')
  const [badge, bell] = await Promise.all([button.boundingBox(), page.getByRole('button', { name: 'Notificações', exact: true }).boundingBox()])
  assert.ok(badge.x + badge.width <= bell.x + 1 && Math.abs((badge.y + badge.height / 2) - (bell.y + bell.height / 2)) < 6, `${JSON.stringify(badge)} ${JSON.stringify(bell)}`)
  await page.locator('.workspace-tabs').screenshot({ path: 'test-results/outdated-version-button-1440.png' })
  await page.clock.fastForward('06:00')
  assert.equal(await prompt(page).count(), 0, 'no window by itself in the portal')
  await button.click()
  await prompt(page).waitFor()
  await prompt(page).getByRole('button', { name: 'Agora não', exact: true }).click()
  await prompt(page).waitFor({ state: 'detached' })
  assert.equal(await button.isVisible(), true, 'the button stays')

  // "Atualizar agora" reloads the page (still old here: the window opens again after it).
  await button.click()
  const reloaded = page.waitForEvent('load')
  await prompt(page).getByRole('button', { name: 'Atualizar agora', exact: true }).click()
  await reloaded
  await prompt(page).waitFor()
  assert.deepEqual(errors, [])
  await page.close()

  // A scheduled update in 1 minute: the countdown has the place, the button waits.
  const scheduled = await open({ width: 1440, height: 900 }, { schedule: () => ({ id: 'teste', at: new Date(Date.now() + 60000).toISOString(), status: 'scheduled' }) })
  await prompt(scheduled.page).getByRole('button', { name: 'Agora não', exact: true }).click()
  await signIn(scheduled.page)
  await scheduled.page.locator('.update-countdown').waitFor()
  assert.equal(await scheduled.page.locator('.version-outdated').count(), 1)
  assert.equal(await scheduled.page.locator('.version-outdated').isVisible(), false, 'the countdown comes first')
  await scheduled.page.close()

  // Phone and tablet: the square beside the bell (only the icon on the phone), nothing out of the screen.
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1004, height: 628 }]) {
    const view = await open(viewport)
    await prompt(view.page).getByRole('button', { name: 'Agora não', exact: true }).click()
    await signIn(view.page)
    const item = view.page.locator('.workspace-tabs .version-outdated')
    await item.waitFor()
    const box = await item.boundingBox()
    const report = await view.page.evaluate(() => ({ scroll: document.documentElement.scrollWidth - window.innerWidth }))
    assert.ok(report.scroll <= 0, `${viewport.width}: the page runs ${report.scroll}px off the screen`)
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, `${viewport.width}: ${JSON.stringify(box)}`)
    if (viewport.width < 760) assert.equal(await item.locator('.version-outdated-label').isVisible(), false)
    await view.page.locator('.workspace-tabs').screenshot({ path: `test-results/outdated-version-button-${viewport.width}.png` })
    await item.click()
    await prompt(view.page).waitFor()
    assert.deepEqual(view.errors, [])
    await view.page.close()
  }
  console.log('outdated version browser test passed')
} finally {
  await browser.close()
  await fixture.close()
}
