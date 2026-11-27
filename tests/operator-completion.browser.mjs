import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// "Concluir atividades do Operador" on the services panel: only on the OS with every piece in every stage; the modal names
// the open sessions; after it the row waits for the NF-e as usual.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

async function createOrder(service) {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cut-bend'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  return (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
}
const headers = { Authorization: `Bearer ${fixture.operatorToken}` }
async function work(order, employee, quantity) {
  const route = `/operations/orders/${order.code}`
  const started = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id }, headers)
  assert.equal(started.status, 200)
  const session = { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken }
  assert.equal((await fixture.request(`${route}/stages/${started.data.operation.stages[0].key}`, 'POST', { ...session, quantity }, headers)).status, 200)
}

try {
  const finished = await createOrder('Projeto com todas as pecas')
  const partial = await createOrder('Projeto pela metade')
  const first = (await fixture.adminRequest('/employees', 'POST', { name: 'Operador Ficticio', birthDate: '1990-01-01', cpf: '00000000001', email: 'operador@example.invalid', identification: '001' })).data.item
  const second = (await fixture.adminRequest('/employees', 'POST', { name: 'Outro Operador', birthDate: '1990-01-01', cpf: '00000000002', email: 'outro@example.invalid', identification: '002' })).data.item
  await work(finished, first, finished.quantity)
  await work(partial, second, 3)

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Serviços em andamento', exact: true }).click()
  await page.getByRole('heading', { name: 'Painel de serviços em andamento' }).waitFor()
  const rows = page.locator('.admin-os-table tbody tr')
  const finishedRow = rows.filter({ hasText: finished.code }), partialRow = rows.filter({ hasText: partial.code })
  const button = finishedRow.getByRole('button', { name: 'Concluir atividades do Operador', exact: true })
  await button.waitFor()
  assert.equal(await partialRow.getByRole('button', { name: 'Concluir atividades do Operador' }).count(), 0, 'only with every piece in every stage')
  // Below Ver OS, inside the column.
  const [verOs, complete] = await Promise.all([finishedRow.getByRole('button', { name: 'Ver OS', exact: true }).boundingBox(), button.boundingBox()])
  assert.ok(complete.y >= verOs.y + verOs.height, 'below Ver OS')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll at 1920')
  // iPad 11 width (rows in two floors): the button stays inside the row.
  await page.setViewportSize({ width: 1180, height: 820 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll at 1180')
  const [row, narrow] = await Promise.all([finishedRow.boundingBox(), button.boundingBox()])
  assert.ok(narrow.x >= row.x && narrow.x + narrow.width <= row.x + row.width + 1, 'inside the row at 1180')
  await page.screenshot({ path: 'test-results/operator-completion-1180.png' })
  await page.setViewportSize({ width: 1920, height: 1080 })

  // Cancelar keeps the OS as it is.
  await button.click()
  const dialog = page.getByRole('dialog', { name: 'Concluir OS', exact: true })
  await dialog.getByText('Tem certeza que deseja concluir a OS? Isso fará com que a OS saia do painel dos Operadores.', { exact: true }).waitFor()
  assert.deepEqual(await dialog.locator('.complete-operator-sessions li').allInnerTexts(), ['Operador Ficticio'])
  await page.screenshot({ path: 'test-results/operator-completion-modal.png' })
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal((await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items.find((item) => item.code === finished.code).operation.status, 'finalizing')

  // Concluir OS: the row turns into Aguardando NF-e and the button goes away.
  await button.click()
  await dialog.getByRole('button', { name: 'Concluir OS', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  await finishedRow.getByRole('button', { name: 'Aguardando NF-e', exact: true }).waitFor()
  assert.equal(await button.count(), 0)
  const operation = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items.find((item) => item.code === finished.code).operation
  assert.equal(operation.status, 'completed')
  assert.deepEqual(operation.activeSessions, [])
  await page.screenshot({ path: 'test-results/operator-completion-done.png' })

  assert.deepEqual(errors, [])
  console.log('Operator completion passed: button only with every piece in every stage, below Ver OS; modal with the open session; Cancelar keeps it; Concluir OS ends the session and waits for the NF-e.')
} catch (error) {
  await page.screenshot({ path: 'test-results/operator-completion-failure.png', fullPage: true })
  throw error
} finally { await browser.close(); await fixture.close() }
