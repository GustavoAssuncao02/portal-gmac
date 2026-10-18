import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste', DEMO_ADMIN_NAME: 'Gustavo' } })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

async function createOrder(service) {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cutting'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  return (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
}

async function login(targetPage) {
  // After a reload the administrator session is restored and the login form does not show.
  const cpf = targetPage.getByLabel('CPF', { exact: true })
  await Promise.race([cpf.waitFor(), targetPage.locator('.sidebar').waitFor()])
  if (await cpf.isVisible()) {
    await cpf.fill('12345678901')
    await targetPage.getByLabel('Senha', { exact: true }).fill('teste')
    await targetPage.getByRole('button', { name: 'Entrar', exact: true }).click()
  }
  await targetPage.locator('.sidebar').getByRole('button', { name: 'Servi\u00e7os em andamento', exact: true }).click()
  await targetPage.getByRole('heading', { name: 'Painel de servi\u00e7os em andamento' }).waitFor()
}

try {
  const finished = await createOrder('Projeto para concluir')
  await createOrder('Projeto aguardando')
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Funcionario de teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'teste@example.invalid', identification: '001' }, fixture.admin)).data.item
  await page.clock.install()
  await page.goto(fixture.url)
  await login(page)
  const rows = page.locator('.admin-os-table tbody tr')
  const completedRow = rows.filter({ hasText: 'Projeto para concluir' })
  assert.equal(await rows.count(), 2)
  await page.locator('.deadline-filters').getByRole('button', { name: 'Dentro do prazo' }).click()
  const headers = { Authorization: `Bearer ${fixture.operatorToken}` }
  const route = `/operations/orders/${finished.code}`
  const started = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id }, headers)
  const session = { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken }
  assert.equal((await fixture.request(`${route}/stages/${started.data.operation.stages[0].key}`, 'POST', { ...session, quantity: finished.quantity }, headers)).status, 200)
  assert.equal((await fixture.request(`${route}/complete`, 'POST', session, headers)).status, 200)
  await page.clock.fastForward(10000)
  await completedRow.getByRole('button', { name: 'Conclu\u00eddo', exact: true }).waitFor()
  assert.equal(await rows.count(), 2)
  assert.equal(await completedRow.locator('.admin-os-remaining').innerText(), '\u2014')
  await page.clock.fastForward(30000)
  assert.equal(await completedRow.count(), 1)
  assert.ok(!(await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items.find((item) => item.code === finished.code).operation.completionAcknowledgedAt)
  await page.reload()
  await login(page)
  await completedRow.getByRole('button', { name: 'Conclu\u00eddo', exact: true }).waitFor()
  assert.equal(await rows.count(), 2)
  await page.screenshot({ path: 'test-results/service-completion-pending-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await completedRow.getByRole('button', { name: 'Conclu\u00eddo', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/service-completion-pending-mobile.png', fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.setViewportSize({ width: 1600, height: 950 })
  await page.locator('.deadline-filters').getByRole('button', { name: 'Conclu\u00eddos' }).click()
  assert.equal(await rows.count(), 1)
  await page.route('**/acknowledge-completion', (route) => route.fulfill({ status: 503, json: { message: 'Falha simulada ao confirmar.' } }), { times: 1 })
  await completedRow.getByRole('button', { name: 'Conclu\u00eddo', exact: true }).click()
  const schedule = page.getByRole('dialog', { name: 'Recebimento do serviço', exact: true })
  // The OS can be archived without posting the receivable.
  await schedule.getByRole('button', { name: 'Concluir sem lançar', exact: true }).waitFor()
  await schedule.getByRole('button', { name: 'Concluir sem lançar', exact: true }).click()
  await schedule.getByRole('alert').filter({ hasText: 'Falha simulada ao confirmar.' }).waitFor()
  assert.equal(await completedRow.count(), 1)
  assert.ok(!(await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items.find((item) => item.code === finished.code).operation.completionAcknowledgedAt)
  await schedule.getByRole('button', { name: 'Concluir sem lançar', exact: true }).click()
  await completedRow.waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('alert').count(), 0)
  assert.equal(await schedule.count(), 0)
  await page.locator('.deadline-filters').getByRole('button', { name: 'Todos' }).click()
  assert.equal(await rows.count(), 1)
  await page.clock.fastForward(20000)
  assert.equal(await rows.count(), 1)
  await page.reload()
  await login(page)
  assert.equal(await rows.count(), 1)
  const secondPage = await browser.newPage()
  await secondPage.goto(fixture.url)
  await login(secondPage)
  assert.equal(await secondPage.locator('.admin-os-table tbody tr').count(), 1)
  await secondPage.close()
  const stored = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items
  assert.equal(stored.length, 2)
  assert.ok(stored.find((item) => item.code === finished.code).operation.completionAcknowledgedAt)
  const events = (await fixture.request(`${route}/events`, 'GET', undefined, { Authorization: `Bearer ${fixture.operatorToken}` })).data.items
  assert.equal(events.filter((event) => event.type === 'completion_acknowledged').length, 1)
  assert.deepEqual(errors, [])
  console.log('Service completion passed: operator completion stays visible through polling/reload, completed status/filter works, failed confirmation preserves the row, successful click hides it persistently across browsers without deleting the OS.')
} catch (error) {
  await page.screenshot({ path: 'test-results/service-completion-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
