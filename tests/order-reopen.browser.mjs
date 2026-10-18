import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Bahia' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await mkdir('test-results/order-reopen', { recursive: true })
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  const dueDate = shiftMonth(todayBahia(), 1)
  async function finished(service) {
    const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service })).data.item
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cutting'], kind: 'service' })
    await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 1000 } })
    const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
    const current = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items.find((item) => item.code === order.code)
    await fixture.mutateStore((store) => { store.orders.find((item) => item.code === order.code).operation = { ...current.operation, status: 'completed', startedAt: '2026-10-01T10:00:00Z', completedAt: '2026-10-02T10:00:00Z', completionAcknowledgedAt: '2026-10-02T11:00:00Z' } })
    return order
  }
  const plain = await finished('OS sem conta')
  const scheduled = await finished('OS com conta programada')
  const scheduledRow = (await api('/receivables', 'POST', { orderCode: scheduled.code, value: '1000', dueDate })).data.item
  const kept = await finished('OS que mantem a conta')
  const keptRow = (await api('/receivables', 'POST', { orderCode: kept.code, value: '1000', dueDate })).data.item
  const received = await finished('OS ja recebida')
  const receivedRow = (await api('/receivables', 'POST', { orderCode: received.code, value: '1000', dueDate })).data.item
  await api(`/receivables/${receivedRow.id}/receive`, 'POST', { date: todayBahia(), method: 'pix' })
  const onPhone = await finished('OS no celular')
  await api('/receivables', 'POST', { orderCode: onPhone.code, value: '1000', dueDate })

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  const navigate = (name) => page.locator('.sidebar').getByRole('button', { name, exact: true }).click()
  const dialog = page.getByRole('dialog')
  const status = async (order) => (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items.find((item) => item.code === order.code).operation.status
  const linked = async (order) => (await api(`/receivables/order/${order.code}`)).data.items.map((row) => row.id)
  // The way the user walks: Serviços concluídos → Ver OS → Reabrir OS.
  async function openReopenDialog(order) {
    await navigate('Serviços concluídos')
    await page.locator('.admin-os-table tbody tr').filter({ hasText: order.code }).getByRole('button', { name: 'Ver OS', exact: true }).click()
    await page.locator('.os-detail').getByRole('button', { name: 'Reabrir OS', exact: true }).click()
    await dialog.getByRole('heading', { name: 'Reabrir OS', exact: true }).waitFor()
  }
  // The OS lands in the panel of services in progress, highlighted, and is gone from the concluded ones.
  async function assertInProgress(order) {
    const row = page.locator('.admin-os-table tbody tr.admin-os-row--reopened').filter({ hasText: order.code })
    await row.waitFor()
    await page.getByRole('heading', { name: 'Painel de serviços em andamento', exact: true }).waitFor()
    assert.equal(await status(order), 'paused')
    assert.ok(await row.evaluate((element) => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight }), 'the reopened OS is in view')
    await navigate('Serviços concluídos')
    assert.equal(await page.locator('.admin-os-table tbody tr').filter({ hasText: order.code }).count(), 0)
  }

  // No account receivable: nothing to ask.
  await openReopenDialog(plain)
  assert.equal(await dialog.locator('.os-action-receivables').count(), 0)
  await dialog.getByRole('button', { name: 'Reabrir OS', exact: true }).click()
  await assertInProgress(plain)

  // An account receivable: the user must answer before reopening; deleting removes it.
  await openReopenDialog(scheduled)
  const box = dialog.locator('.os-action-receivables')
  await box.waitFor()
  assert.match((await box.innerText()).replace(/\s+/g, ' '), new RegExp(`Conta a receber vinculada a esta OS ${scheduledRow.id} · R\\$ 1\\.000,00 · previsto para \\d{2}/\\d{2}/\\d{4}`))
  const confirm = dialog.getByRole('button', { name: 'Reabrir OS', exact: true })
  assert.equal(await confirm.isDisabled(), true, 'nothing is assumed before the answer')
  assert.equal(await dialog.getByRole('radio').count(), 2)
  assert.equal(await dialog.getByRole('radio', { checked: true }).count(), 0)
  await dialog.getByRole('radio', { name: /^Excluir a conta a receber/ }).check()
  assert.equal(await confirm.isDisabled(), false)
  await page.screenshot({ path: 'test-results/order-reopen/modal-1920.png' })
  await confirm.click()
  await assertInProgress(scheduled)
  assert.deepEqual(await linked(scheduled), [])

  // Keeping it leaves the account as it is.
  await openReopenDialog(kept)
  await dialog.getByRole('radio', { name: /^Manter a conta a receber/ }).check()
  await dialog.getByRole('button', { name: 'Reabrir OS', exact: true }).click()
  await assertInProgress(kept)
  assert.deepEqual(await linked(kept), [keptRow.id])

  // A received account cannot be deleted: the dialog says so and the account is kept.
  await openReopenDialog(received)
  const note = dialog.locator('.os-action-note')
  await note.waitFor()
  assert.match(await note.innerText(), /Não é possível excluir esta conta: Conta com recebimento: preserve o histórico\. Ela será mantida\./)
  assert.equal(await dialog.getByRole('radio').count(), 0)
  await dialog.getByRole('button', { name: 'Reabrir OS', exact: true }).click()
  await assertInProgress(received)
  assert.deepEqual(await linked(received), [receivedRow.id])

  // The dialog fits a phone screen without sideways scrolling.
  const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, timezoneId: 'America/Bahia', hasTouch: true })
  const mobile = await phone.newPage()
  await mobile.goto(fixture.url)
  await mobile.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await mobile.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await mobile.getByRole('button', { name: 'Entrar', exact: true }).click()
  await mobile.getByRole('button', { name: 'Abrir menu de navegação', exact: true }).click()
  await mobile.locator('.sidebar').getByRole('button', { name: 'Serviços concluídos', exact: true }).click()
  await mobile.locator('.admin-os-table tbody tr').filter({ hasText: onPhone.code }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  await mobile.locator('.os-detail').getByRole('button', { name: 'Reabrir OS', exact: true }).click()
  const phoneDialog = mobile.getByRole('dialog')
  await phoneDialog.locator('.os-action-receivables').waitFor()
  assert.ok(await phoneDialog.evaluate((element) => element.scrollWidth <= element.clientWidth), 'no sideways scroll in the dialog')
  const frame = await phoneDialog.boundingBox()
  assert.ok(frame.x >= 0 && frame.x + frame.width <= 390 && frame.y >= 0 && frame.y + frame.height <= 780, 'the dialog is inside the screen')
  await mobile.screenshot({ path: 'test-results/order-reopen/modal-390.png' })
  await phone.close()

  assert.deepEqual(errors, [])
  console.log('Order reopen passed: the OS goes back to Serviços em andamento highlighted; the linked account receivable is asked about (keep or delete), blocked when it has a receipt, and absent from the question when there is none.')
} catch (error) {
  await page.screenshot({ path: 'test-results/order-reopen/failure.png', fullPage: true })
  throw error
} finally { await browser.close(); await fixture.close() }
