import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await context.newPage()
const errors = []
const requests = []
let documentLoads = 0
page.on('pageerror', (error) => errors.push(error.message))
page.on('request', (request) => {
  if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentLoads++
  if (new URL(request.url()).pathname === '/api/operations/operator/orders') requests.push(Date.now())
})
const auth = { Authorization: `Bearer ${fixture.operatorToken}` }
const card = (service) => page.locator('.operator-project').filter({ hasText: service })

async function createOrder(service) {
  const offer = (await fixture.request('/offers', 'POST', { ...offerDraft, service })).data.item
  assert.equal((await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning', 'painting'] })).status, 200)
  assert.equal((await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste de atualizacao', deadline: offerDraft.deadline, serviceValue: 100, margin: 15 } })).status, 200)
  const result = await fixture.request(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(result.status, 201)
  return result.data.item
}

try {
  const first = await createOrder('OS em trabalho')
  const employee = (await fixture.request('/employees', 'POST', { name: 'Operador teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'operador@example.invalid', identification: '001' })).data.item
  const started = (await fixture.request(`/operations/orders/${first.code}/start`, 'POST', { employeeId: employee.id }, auth)).data
  const session = { id: started.operation.activeSession.id, token: started.sessionToken }
  await context.addInitScript(({ token, code, session }) => {
    sessionStorage.setItem('gmac-operator-token', token)
    sessionStorage.setItem(`gmac-operator-session-${code}`, JSON.stringify(session))
  }, { token: fixture.operatorToken, code: first.code, session })
  await page.goto(fixture.url)
  await card(first.service).waitFor()
  await page.getByRole('button', { name: 'Pausar trabalho', exact: true }).waitFor()
  const quantities = page.locator('.operator-stage-action input')
  await quantities.first().fill('3')
  const baseline = requests.at(-1)
  const incoming = await createOrder('OS criada com o operador aberto')
  assert.equal(await card(incoming.service).count(), 0)
  await card(incoming.service).waitFor({ timeout: 15000 })
  assert.ok(requests.some((at) => at - baseline >= 9500 && at - baseline <= 13000), 'A real ten-second polling tick discovers the new OS')
  assert.equal(documentLoads, 1, 'The page never reloads')
  assert.equal(await page.locator('.operator-detail-heading h2').innerText(), first.service)
  assert.equal(await quantities.first().inputValue(), '3')
  assert.deepEqual(await page.evaluate((code) => JSON.parse(sessionStorage.getItem(`gmac-operator-session-${code}`)), first.code), session)
  const operation = (await fixture.request('/operations/orders')).data.items.find((order) => order.code === first.code).operation
  assert.equal(operation.activeSession.id, session.id)
  await page.screenshot({ path: 'test-results/operator-polling-new-os.png' })
  const response = await fetch(`${fixture.url}/api/operations/operator/orders`, { headers: auth })
  assert.equal(response.headers.get('cache-control'), 'no-store')

  await page.getByRole('button', { name: 'Em execu\u00e7\u00e3o', exact: true }).click()
  await page.getByPlaceholder('Buscar por projeto, cliente ou c\u00f3digo...').fill(first.service)
  const focusOrder = await createOrder('OS recebida ao retornar para a aba')
  const pendingResponse = page.waitForResponse((response) => response.url().endsWith('/api/operations/operator/orders') && response.ok())
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await pendingResponse
  await page.getByRole('button', { name: 'Todos', exact: true }).click()
  await page.getByPlaceholder('Buscar por projeto, cliente ou c\u00f3digo...').fill('')
  await card(focusOrder.service).waitFor()

  let failNext = true
  await page.route('**/api/operations/operator/orders', async (route) => {
    if (failNext) { failNext = false; await route.fulfill({ status: 503, json: { message: 'Falha temporaria de teste' } }) }
    else await route.continue()
  })
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.getByRole('alert').filter({ hasText: 'Falha temporaria de teste' }).waitFor()
  assert.equal(await page.locator('.operator-detail-heading h2').innerText(), first.service)
  const recoveryOrder = await createOrder('OS recebida apos reconectar')
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await card(recoveryOrder.service).waitFor()
  assert.equal(await page.getByRole('alert').count(), 0)
  await page.getByRole('button', { name: 'Visualizar informa\u00e7\u00f5es do projeto', exact: true }).click()
  await page.locator('.operator-project-info').waitFor()
  const infoResponse = page.waitForResponse((response) => response.url().endsWith('/api/operations/operator/orders') && response.ok())
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await infoResponse
  assert.equal(await page.locator('.operator-project-info').count(), 1)
  assert.equal(documentLoads, 1)
  assert.deepEqual(errors, [])
  console.log('Operator polling passed: new OS appears on a real 10-second tick, selection/input/private work session survive, focus/reconnection refresh, retries and project information remain intact.')
} catch (error) {
  await page.screenshot({ path: 'test-results/operator-polling-failure.png' })
  throw error
} finally {
  await context.unrouteAll({ behavior: 'ignoreErrors' })
  await browser.close()
  await fixture.close()
}
