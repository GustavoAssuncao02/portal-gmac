import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { identifiedOperator } from './operatorEntry.js'

const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
const headers = { Authorization: `Bearer ${fixture.operatorToken}` }
const errors = []
let operator

async function checkLogout(storage = {}, blocked = false, selectService) {
  const context = await browser.newContext()
  try {
    await context.addInitScript(({ token, storage }) => {
      sessionStorage.setItem('gmac-operator-token', token)
      for (const [key, value] of Object.entries(storage)) sessionStorage.setItem(key, value)
    }, { token: fixture.operatorToken, storage: { ...Object.fromEntries([operator]), ...storage } })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(fixture.url)
    await page.getByRole('heading', { name: 'Selecione uma OS', exact: true }).waitFor()
    if (selectService) await page.locator('.operator-project').filter({ hasText: selectService }).click()
    await page.getByTitle('Sair', { exact: true }).click()
    if (blocked) {
      await page.getByRole('alert').filter({ hasText: 'Pause o trabalho antes de sair da conta do operador.' }).waitFor()
      assert.equal(await page.evaluate(() => sessionStorage.getItem('gmac-operator-token')), fixture.operatorToken)
    } else {
      await page.locator('.operator-app').waitFor({ state: 'detached' })
      assert.equal(await page.evaluate(() => sessionStorage.getItem('gmac-operator-token')), null)
      assert.equal(await page.evaluate(() => sessionStorage.getItem('gmac-operator-employee')), null, 'the next sign-in starts without an identified operator')
    }
  } finally {
    await context.close()
  }
}

// Switching operators keeps the shared account signed in and asks for a code again.
async function checkSwitch() {
  const context = await browser.newContext()
  try {
    await context.addInitScript(({ token, operator }) => { sessionStorage.setItem('gmac-operator-token', token); sessionStorage.setItem(...operator) }, { token: fixture.operatorToken, operator })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(fixture.url)
    await page.getByRole('button', { name: 'Trocar operador', exact: true }).click()
    await page.getByRole('button', { name: 'Entrar', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => sessionStorage.getItem('gmac-operator-token')), fixture.operatorToken)
    assert.equal(await page.evaluate(() => sessionStorage.getItem('gmac-operator-employee')), null)
  } finally {
    await context.close()
  }
}

async function createOrder(service) {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cutting'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  const result = await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(result.status, 201)
  return result.data.item
}

try {
  const employeeResult = await fixture.adminRequest('/employees', 'POST', { name: 'Funcionario de teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'teste@example.invalid', identification: '001' }, fixture.admin)
  assert.equal(employeeResult.status, 201)
  operator = identifiedOperator(employeeResult.data.item)
  const order = await createOrder('Projeto de trabalho')
  await createOrder('Projeto aguardando')
  const key = `gmac-operator-session-${order.code}`
  await checkLogout()
  await checkLogout({ [key]: '{invalid-json' })
  await checkLogout({ [key]: JSON.stringify({ id: 'old-session', token: 'old-token' }) })

  const started = await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: employeeResult.data.item.id }, headers)
  assert.equal(started.status, 200)
  const sessionId = started.data.operation.activeSession.id
  const sessionToken = started.data.sessionToken
  const stored = { [key]: JSON.stringify({ id: sessionId, token: sessionToken }) }
  await checkLogout()
  await checkLogout({ [key]: '{invalid-json' })
  await checkLogout({ [key]: JSON.stringify({ id: 'another-session', token: sessionToken }) })
  await checkLogout({ [key]: JSON.stringify({ id: sessionId }) })
  await checkLogout(stored, true)
  await checkLogout(stored, true, 'Projeto aguardando')

  const paused = await fixture.request(`/operations/orders/${order.code}/pause`, 'POST', { sessionId, sessionToken, reason: 'Descanso' }, headers)
  assert.equal(paused.status, 200)
  await checkLogout()
  await checkLogout(stored)

  const resumed = await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: employeeResult.data.item.id }, headers)
  assert.equal(resumed.status, 200)
  const credentials = { sessionId: resumed.data.operation.activeSession.id, sessionToken: resumed.data.sessionToken }
  const stage = resumed.data.operation.stages[0]
  assert.equal((await fixture.adminRequest(`/operations/orders/${order.code}/stages/${stage.key}`, 'POST', { ...credentials, quantity: order.quantity }, headers)).status, 200)
  assert.equal((await fixture.request(`/operations/orders/${order.code}/complete`, 'POST', credentials, headers)).status, 200)
  await checkLogout({ [key]: JSON.stringify({ id: credentials.sessionId, token: credentials.sessionToken }) })
  await checkSwitch()
  assert.deepEqual(errors, [])
  console.log('Operator logout passed: waiting, paused, completed, malformed/stale credentials and another operator allow logout; owned active work blocks it even when a different project is selected.')
} finally {
  await browser.close()
  await fixture.close()
}
