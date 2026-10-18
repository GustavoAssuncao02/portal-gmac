import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123' } })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('dialog', async (dialog) => { errors.push(dialog.type()); await dialog.dismiss() })

try {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Eixo com pausa esquecida' })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cutting'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Proposta A', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001', identification: '001', birthDate: '1990-01-01', email: 'ana@example.invalid' }, fixture.admin)).data.item
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  const base = `/operations/orders/${order.code}`
  const started = await fixture.request(`${base}/start`, 'POST', { employeeId: employee.id }, operator)
  await fixture.request(`${base}/pause`, 'POST', { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken, reason: 'Descanso' }, operator)
  // The employee started at 20:00 and only pressed "pause" at 23:42 (Bahia time).
  await fixture.mutateStore((store) => {
    const current = store.orders.find((item) => item.code === order.code)
    const [start, pause] = current.operationEvents
    start.at = '2026-10-01T23:00:00.000Z'
    Object.assign(pause, { at: '2026-10-02T02:42:00.000Z', durationMs: 3.7 * 3600000 })
    Object.assign(current.operation, { startedAt: start.at, accumulatedMs: 3.7 * 3600000 })
  })

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill('12345678901')
  await page.getByLabel('Senha', { exact: true }).fill('teste123')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  const tabs = () => page.getByRole('tab').allTextContents()
  const activeTab = () => page.locator('.workspace-tab--active').getByRole('tab').innerText()
  const article = page.locator('.os-detail')

  // "Ver OS" opens the OS screen, never the material requests.
  await page.locator('.sidebar').getByRole('button', { name: 'Serviços em andamento', exact: true }).click()
  await page.locator('.admin-os-table tbody tr').filter({ hasText: order.code }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  await page.getByRole('heading', { name: 'Ordem de serviço', exact: true }).waitFor()
  await article.waitFor()
  assert.deepEqual(await tabs(), ['Início', 'Serviços em andamento', 'Ordem de serviço'])
  assert.equal(await activeTab(), 'Ordem de serviço')
  assert.equal(await page.getByRole('heading', { name: 'Pedidos de material' }).count(), 0)
  await article.locator('.os-operation-facts').getByText('03:42:00', { exact: true }).waitFor()

  await article.getByRole('button', { name: 'Histórico de operações', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const pauseRow = dialog.locator('tbody tr').filter({ hasText: 'Pausa' })
  await pauseRow.getByText('01/10/2026, 23:42:00', { exact: true }).waitFor()
  assert.equal(await dialog.getByText('Horário editado', { exact: true }).count(), 0)
  assert.equal(await dialog.getByRole('button', { name: /^Editar horário de / }).count(), 2)
  await pauseRow.getByRole('button', { name: 'Editar horário de Pausa', exact: true }).click()
  const input = pauseRow.getByLabel('Novo horário de Pausa', { exact: true })
  const save = pauseRow.getByRole('button', { name: 'Salvar', exact: true })
  assert.equal(await input.inputValue(), '2026-10-01T23:42')
  assert.ok(await save.isDisabled())
  // Cancelling keeps the recorded time.
  await input.fill('2026-10-01T21:00')
  await pauseRow.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await pauseRow.getByText('01/10/2026, 23:42:00', { exact: true }).waitFor()
  await pauseRow.getByRole('button', { name: 'Editar horário de Pausa', exact: true }).click()
  // A pause cannot be moved to before the start of the same session.
  await input.fill('2026-10-01T19:00')
  await save.click()
  await pauseRow.getByRole('alert').getByText(/posterior à operação anterior do funcionário \(01\/10\/2026, 20:00:00\)/).waitFor()
  await input.fill('2026-10-01T22:00')
  await save.click()
  await pauseRow.getByText('01/10/2026, 22:00:00', { exact: true }).waitFor()
  await pauseRow.getByText('Horário editado', { exact: true }).waitFor()
  await pauseRow.getByText('Tempo da sessão: 02:00:00', { exact: true }).waitFor()
  assert.equal(await dialog.getByText('Horário editado', { exact: true }).count(), 1)
  assert.equal(await pauseRow.getByRole('note').count(), 0)
  const info = pauseRow.getByRole('button', { name: 'Ver horário original de Pausa', exact: true })
  await info.click()
  const note = pauseRow.getByRole('note')
  await note.getByText('Horário original: 01/10/2026, 23:42:00', { exact: true }).waitFor()
  assert.match(await note.innerText(), /Editado por .+ em \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2}/)
  await page.screenshot({ path: 'test-results/operation-event-time.png' })
  assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth))
  await info.click()
  assert.equal(await pauseRow.getByRole('note').count(), 0)
  // The edition is kept and shown after reopening the history.
  await dialog.getByRole('button', { name: 'Fechar histórico' }).click()
  await dialog.waitFor({ state: 'detached' })
  await article.locator('.os-operation-facts').getByText('02:00:00', { exact: true }).waitFor()
  await article.getByRole('button', { name: 'Histórico de operações', exact: true }).click()
  await pauseRow.getByText('Horário editado', { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await pauseRow.getByRole('button', { name: 'Editar horário de Pausa', exact: true }).click()
  await input.waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth))
  await page.screenshot({ path: 'test-results/operation-event-time-mobile.png' })
  await page.setViewportSize({ width: 1366, height: 768 })
  await pauseRow.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await dialog.getByRole('button', { name: 'Fechar histórico' }).click()
  await dialog.waitFor({ state: 'detached' })

  // The OS screen survives a reload and returns to the screen it was opened from.
  await page.reload()
  await article.waitFor()
  await page.getByRole('heading', { name: 'Ordem de serviço', exact: true }).waitFor()
  await article.getByRole('button', { name: 'Voltar para a tela anterior', exact: true }).click()
  await page.getByRole('heading', { name: 'Painel de serviços em andamento' }).waitFor()
  assert.deepEqual(await tabs(), ['Início', 'Serviços em andamento'])

  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
  await page.locator('.offers-table-row').filter({ hasText: offer.service }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  await article.waitFor()
  assert.equal(await activeTab(), 'Ordem de serviço')
  await article.getByRole('button', { name: 'Voltar para a tela anterior', exact: true }).click()
  await page.locator('.offers-table-row').first().waitFor()
  assert.equal(await activeTab(), 'Ofertas e serviços')
  assert.ok(!(await tabs()).includes('Ordem de serviço'))

  // The material requests screen no longer turns into the OS.
  await page.locator('.sidebar').getByRole('button', { name: 'Pedidos de material', exact: true }).click()
  await page.getByRole('heading', { name: 'Pedidos de material', exact: true }).waitFor()
  assert.equal(await article.count(), 0)
  assert.deepEqual(errors, [])
  console.log('Operation time editing passed: separate OS screen and tab, return to the origin screen, reload, time edition with validation, edited mark, original time on the info button, recalculated session and project time, mobile layout.')
} catch (error) {
  await page.screenshot({ path: 'test-results/operation-event-time-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
