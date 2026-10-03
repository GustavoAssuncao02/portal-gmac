import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const preference = page.getByLabel('Contas a pagar a vencer', { exact: true })
const save = page.getByRole('button', { name: 'Salvar notificações', exact: true })
const dateAfter = (days) => new Date(Date.parse(`${todayBahia()}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const waitBadge = (count) => page.waitForFunction((expected) => {
  const badge = document.querySelector('.notifications-count')
  return expected ? badge?.textContent === String(expected) : !badge
}, count)
async function selectAndSave(value, count) {
  await preference.selectOption(value)
  await save.click()
  await page.getByRole('status').filter({ hasText: 'Preferência de notificações salva.' }).waitFor()
  await waitBadge(count)
}
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const auth = { Authorization: `Bearer ${token}` }
  const request = (path, method, body) => fixture.request(path, method, body, auth)
  const supplier = (await request('/suppliers', 'POST', { name: 'Fornecedor teste', document: '12345678000190' })).data.item
  const classification = (await request('/classifications', 'POST', { name: 'Material' })).data.item
  for (const day of [2, 4, 6, 8]) {
    const result = await request('/payables', 'POST', { supplierId: supplier.id, classificationId: classification.id, description: `Conta de teste ${day} dias`, issueDate: todayBahia(), dueDate: dateAfter(day), value: '10', kind: 'normal' })
    assert.equal(result.status, 201)
  }
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Configurações', exact: true }).click()
  await preference.waitFor()
  await page.waitForFunction(() => !document.querySelector('.account-notification-settings fieldset').disabled)
  assert.equal(await preference.inputValue(), '3')
  assert.deepEqual(await preference.locator('option').allTextContents(), ['3 dias antes do vencimento', '5 dias antes do vencimento', '7 dias antes do vencimento', 'Nunca'])
  await waitBadge(1)
  assert.equal(await page.getByLabel('Senha atual', { exact: true }).inputValue(), '')
  await selectAndSave('5', 2)
  assert.equal((await request('/account/notifications')).data.settings.payableReminderDays, 5)
  assert.equal((await request('/auth/session')).data.user.name, 'Gustavo')
  await page.reload()
  await page.waitForFunction(() => document.querySelector('.account-notification-settings select')?.value === '5')
  await waitBadge(2)
  await selectAndSave('7', 3)
  await page.screenshot({ path: 'test-results/notification-settings-desktop.png', fullPage: true })
  await page.route('**/api/account/notifications', async (route) => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 503, json: { message: 'Falha temporaria de teste' } })
    else await route.continue()
  })
  await preference.selectOption('never')
  await save.click()
  await page.getByRole('alert').filter({ hasText: 'Falha temporaria de teste' }).waitFor()
  assert.equal((await request('/account/notifications')).data.settings.payableReminderDays, 7)
  assert.equal(await page.locator('.notifications-count').innerText(), '3')
  await page.unroute('**/api/account/notifications')
  await selectAndSave('never', 0)
  await page.getByRole('button', { name: 'Notificações', exact: true }).click()
  await page.locator('.notifications-empty').waitFor()
  assert.deepEqual((await request('/payables/notifications')).data.items, [])
  await page.getByRole('button', { name: 'Fechar notificações', exact: true }).click()
  await page.reload()
  await page.waitForFunction(() => document.querySelector('.account-notification-settings select')?.value === 'never')
  await waitBadge(0)
  for (const [width, height] of [[390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no page overflow`)
    const bounds = await preference.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `${width}: preference control fits`)
    assert.ok(await save.evaluate((element) => element.scrollWidth <= element.clientWidth), `${width}: save label fits`)
    await page.screenshot({ path: `test-results/notification-settings-mobile-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.getByLabel('Nome', { exact: true }).fill('Gustavo Atualizado')
  await page.getByLabel('Senha atual', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Conta atualizada com sucesso.' }).waitFor()
  await selectAndSave('3', 1)
  assert.deepEqual(errors, [])
  console.log('Notification settings passed: four options, password-free save, immediate bell updates, reload persistence, failure/retry, never/no alerts and desktop/mobile layouts.')
} catch (error) {
  await page.screenshot({ path: 'test-results/notification-settings-failure.png', fullPage: true })
  throw error
} finally {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await browser.close()
  await fixture.close()
}
