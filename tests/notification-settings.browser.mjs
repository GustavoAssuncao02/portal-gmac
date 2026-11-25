import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'

// Configurações › Notificações (2026-11-24): every preference is saved as it changes, without the account password;
// a failed save shows the error and puts the previous choice back.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const preference = page.getByLabel('Contas a pagar a vencer', { exact: true })
const dateAfter = (days) => new Date(Date.parse(`${todayBahia()}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const section = async (label) => { await page.locator('.account-settings-menu').getByRole('button', { name: new RegExp(`^${label}`) }).click(); await page.locator('.account-section-heading h2').filter({ hasText: label }).waitFor() }
const patched = () => page.waitForResponse((response) => response.url().endsWith('/api/account/notifications') && response.request().method() === 'PATCH')
const waitBadge = (count) => page.waitForFunction((expected) => {
  const badge = document.querySelector('.notifications-count')
  return expected ? badge?.textContent === String(expected) : !badge
}, count)
async function selectAndSave(value, count) {
  const saved = patched()
  await preference.selectOption(value)
  assert.equal((await saved).status(), 200)
  await page.getByRole('status').filter({ hasText: 'Preferência salva.' }).waitFor()
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
  await section('Notificações')
  await preference.waitFor()
  assert.equal(await preference.inputValue(), '3')
  assert.deepEqual(await preference.locator('option').allTextContents(), ['3 dias antes do vencimento', '5 dias antes do vencimento', '7 dias antes do vencimento', 'Nunca'])
  await waitBadge(1)
  assert.equal(await page.getByRole('button', { name: 'Salvar notificações', exact: true }).count(), 0, 'no save button: each change is saved')
  // One switch per notice, on the right of its text and in line with it.
  for (const row of await page.locator('.account-settings-section .account-setting-row:has(.account-switch)').all()) {
    const control = await row.locator('.account-switch').boundingBox()
    const text = await row.locator('.account-setting-text').boundingBox()
    assert.ok(control.x >= text.x + text.width, 'the switch is on the right of its text')
    assert.ok(Math.abs(control.y + control.height / 2 - text.y - text.height / 2) < 2, 'switch and text are aligned')
  }
  assert.equal(await page.getByLabel('Senha atual', { exact: true }).count(), 0, 'notifications are saved without the account password')
  await selectAndSave('5', 2)
  assert.equal((await request('/account/notifications')).data.settings.payableReminderDays, 5)
  assert.equal((await request('/auth/session')).data.user.name, 'Gustavo')
  await page.reload()
  await page.waitForFunction(() => document.querySelector('[aria-label="Contas a pagar a vencer"]')?.value === '5')
  await waitBadge(2)
  await selectAndSave('7', 3)
  await page.screenshot({ path: 'test-results/notification-settings-desktop.png', fullPage: true })

  // "Notificações do sistema por e-mail": on by default, a switch saved on the click (2026-11-24).
  const email = page.getByRole('switch', { name: 'Notificações do sistema por e-mail', exact: true })
  assert.equal(await email.getAttribute('aria-checked'), 'true')
  let saved = patched(); await email.click(); await saved
  await page.getByText('Os avisos continuam no sininho, mas não chegam por e-mail.').waitFor()
  assert.equal((await request('/account/notifications')).data.settings.emailNotifications, false)
  await page.locator('.account-card').filter({ hasText: 'Como receber' }).screenshot({ path: 'test-results/notification-settings-email-off.png' })
  await page.reload(); await email.waitFor()
  assert.equal(await email.getAttribute('aria-checked'), 'false', 'the choice stays after reloading')
  saved = patched(); await email.click(); await saved
  assert.equal((await request('/account/notifications')).data.settings.emailNotifications, true)

  // A failed save: the error, and the previous choice back on the screen.
  await page.route('**/api/account/notifications', async (route) => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 503, json: { message: 'Falha temporaria de teste' } })
    else await route.continue()
  })
  await preference.selectOption('never')
  await page.getByRole('alert').filter({ hasText: 'Falha temporaria de teste' }).waitFor()
  assert.equal(await preference.inputValue(), '7')
  const tickets = page.getByRole('switch', { name: 'Tickets de suporte', exact: true })
  await tickets.click()
  await page.getByRole('alert').filter({ hasText: 'Falha temporaria de teste' }).waitFor()
  await page.waitForFunction(() => document.querySelector('[aria-label="Tickets de suporte"]')?.getAttribute('aria-checked') === 'true')
  assert.equal((await request('/account/notifications')).data.settings.payableReminderDays, 7)
  assert.equal(await page.locator('.notifications-count').innerText(), '3')
  await page.unroute('**/api/account/notifications')
  await selectAndSave('never', 0)
  await page.getByRole('button', { name: 'Notificações', exact: true }).click()
  await page.locator('.notifications-empty').waitFor()
  assert.deepEqual((await request('/payables/notifications')).data.items, [])
  await page.getByRole('button', { name: 'Fechar notificações', exact: true }).click()
  await page.reload()
  await page.waitForFunction(() => document.querySelector('[aria-label="Contas a pagar a vencer"]')?.value === 'never')
  await waitBadge(0)

  // Anotações e Tarefas: the round button and the notice near the day of a task.
  await section('Anotações e Tarefas')
  const button = page.getByRole('switch', { name: 'Mostrar o ícone de Anotações e Tarefas', exact: true })
  const notices = page.getByRole('switch', { name: 'Notificações de Anotações e Tarefas', exact: true })
  const due = page.getByRole('switch', { name: 'Notificar tarefa próxima do prazo', exact: true })
  const days = page.getByLabel('Avisar com antecedência de', { exact: true })
  await page.locator('.notes-fab').waitFor()
  saved = patched(); await button.click(); await saved
  await page.locator('.notes-fab').waitFor({ state: 'detached' })
  saved = patched(); await button.click(); await saved
  await page.locator('.notes-fab').waitFor()
  assert.deepEqual(await days.locator('option').allTextContents(), ['1 dia antes', '2 dias antes', '3 dias antes', '5 dias antes', '7 dias antes'])
  saved = patched(); await days.selectOption('3'); await saved
  assert.equal((await request('/account/notifications')).data.settings.notesDueDays, 3)
  saved = patched(); await notices.click(); await saved
  assert.ok(await due.isDisabled(), 'the notice near the day depends on the notices of Anotações e Tarefas')
  assert.ok(await days.isDisabled())
  saved = patched(); await notices.click(); await saved
  saved = patched(); await due.click(); await saved
  assert.ok(await days.isDisabled())
  assert.deepEqual(Object.fromEntries(Object.entries((await request('/account/notifications')).data.settings).filter(([key]) => key.startsWith('notes'))), { notesButton: true, notesNotifications: true, notesDueReminder: false, notesDueDays: 3 })
  await page.screenshot({ path: 'test-results/notification-settings-notes.png', fullPage: true })

  await section('Notificações')
  for (const [width, height] of [[390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no page overflow`)
    const bounds = await preference.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `${width}: preference control fits`)
    for (const control of await page.locator('.account-switch').all()) {
      const box = await control.boundingBox()
      assert.ok(box.x >= 0 && box.x + box.width <= width, `${width}: every switch fits`)
    }
    await page.screenshot({ path: `test-results/notification-settings-mobile-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1366, height: 900 })
  await section('Minha conta')
  await page.getByRole('button', { name: 'Editar dados e senha', exact: true }).click()
  await page.getByLabel('Nome', { exact: true }).fill('Gustavo Atualizado')
  await page.getByLabel('Senha atual', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Conta atualizada com sucesso.' }).waitFor()
  await section('Notificações')
  await selectAndSave('3', 1)
  assert.deepEqual(errors, [])
  console.log('Notification settings passed: saved on each change without a password, immediate bell updates, reload persistence, failure/rollback, never/no alerts, Anotações e Tarefas switches and desktop/mobile layouts.')
} catch (error) {
  await page.screenshot({ path: 'test-results/notification-settings-failure.png', fullPage: true })
  throw error
} finally {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await browser.close()
  await fixture.close()
}
