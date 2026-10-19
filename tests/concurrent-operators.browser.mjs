import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { enterOperatorCode, openOrder, startWork } from './operatorEntry.js'

const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno 01' }] })
  const employees = []
  for (const [index, name] of ['Ana Teste', 'Bruno Teste', 'Carla Teste'].entries()) {
    employees.push((await fixture.adminRequest('/employees', 'POST', { name, birthDate: '1990-01-01', cpf: `0000000000${index + 1}`, email: `operador${index}@example.invalid`, identification: `00${index + 1}` }, fixture.admin)).data.item)
  }
  const [ana, bruno, carla] = employees
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning', 'painting'] })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const service = (await fixture.adminRequest('/labor-services')).data.items[0]
  // Carla started on another device: this browser has no credential for her session.
  const remote = await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: carla.id, laborServiceId: service.id }, { Authorization: `Bearer ${fixture.operatorToken}` })
  assert.equal(remote.status, 200)
  await context.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
  await page.goto(fixture.url)

  // Each employee takes the shared tablet, identifies with their own code and starts on the OS.
  const identify = async (employee) => {
    if (!await page.locator('.operator-entry').isVisible()) await page.getByRole('button', { name: 'Sair do funcionário', exact: true }).click()
    await enterOperatorCode(page, employee.accessCode)
  }
  const work = async (employee, group, name) => {
    await identify(employee)
    await openOrder(page, order.service)
    await startWork(page, group, name)
    await page.locator('.operator-worker').filter({ hasText: employee.name }).waitFor()
  }
  await page.locator('.operator-entry').waitFor()
  assert.equal(await page.locator('.operator-project').count(), 0, 'the OS list appears only after the code')
  await work(ana, 'Máquina', 'Torno 01')
  await work(bruno, 'Serviço', service.name)
  await identify(ana)
  await openOrder(page, order.service)
  assert.equal(await page.getByRole('button', { name: /Iniciar trabalho/ }).count(), 0, 'someone already working sees Pausar instead of Iniciar')
  await page.getByRole('button', { name: /^Pausar trabalho/ }).waitFor()

  const workers = page.locator('.operator-worker')
  assert.equal(await workers.count(), 3)
  assert.match(await page.locator('.operator-workers-heading').innerText(), /3 funcionários/)
  const workersBox = await page.locator('.operator-workers').boundingBox()
  assert.ok(workersBox.y > (await page.locator('.operator-stage-groups').boundingBox()).y, 'workers are listed below the stages')
  assert.ok(workersBox.y < (await page.locator('.operator-history').boundingBox()).y, 'workers are listed above the activity history')

  // The list only shows who is working; pausing and changing are done on the step cards above.
  assert.equal(await workers.getByRole('button').count(), 0)
  assert.match(await workers.filter({ hasText: 'Carla Teste' }).innerText(), /Serviço:/)
  await page.screenshot({ path: 'test-results/concurrent-operators-desktop.png', fullPage: true })

  // With more than one employee working, the stage record asks who completed it.
  await page.locator('.operator-stage-action input').first().fill('2')
  await page.getByRole('button', { name: 'Registrar', exact: true }).first().click()
  const ask = page.getByRole('dialog')
  await ask.getByRole('heading', { name: 'Quem concluiu esta etapa?' }).waitFor()
  assert.deepEqual(await ask.getByRole('radio').evaluateAll((items) => items.map((item) => item.closest('label').querySelector('span').firstChild.textContent)), ['Carla Teste', 'Ana Teste', 'Bruno Teste'])
  assert.equal(await ask.getByRole('button', { name: 'Registrar etapa', exact: true }).isEnabled(), false)
  await page.screenshot({ path: 'test-results/concurrent-operators-completed-by.png' })
  await ask.getByRole('radio', { name: /Carla Teste/ }).check()
  await ask.getByRole('button', { name: 'Registrar etapa', exact: true }).click()
  await ask.waitFor({ state: 'hidden' })
  const events = (await fixture.adminRequest(`/operations/orders/${order.code}/events`)).data.items
  const progress = events.find((event) => event.type === 'stage_progress')
  assert.equal(progress.employeeName, 'Carla Teste')
  assert.equal(progress.quantity, 2)
  await page.locator('.operator-history summary').click()
  assert.match(await page.locator('.operator-history').innerText(), /Carla Teste · .*Tornearia: \+2 \(2 no total\) · Registrado por Ana Teste/)

  // Pausing one employee keeps the others working.
  await identify(bruno)
  await openOrder(page, order.service)
  await page.getByRole('button', { name: /^Pausar trabalho/ }).click()
  await page.getByRole('dialog').locator('select').selectOption('Descanso')
  await page.getByRole('button', { name: 'Confirmar pausa', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.querySelectorAll('.operator-worker').length === 2)
  const operation = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0].operation
  assert.deepEqual(operation.activeSessions.map((session) => session.employeeName), ['Carla Teste', 'Ana Teste'])
  assert.equal(operation.status, 'running')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.operator-workers').scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow on mobile')
  await page.locator('.operator-workers').screenshot({ path: 'test-results/concurrent-operators-mobile.png' })
  assert.deepEqual(errors, [])
  console.log('Concurrent operators passed: start always available, workers listed between stages and history, per-employee actions, foreign device guard, "who completed" question, per-employee pause and mobile layout.')
} catch (error) {
  await page.screenshot({ path: 'test-results/concurrent-operators-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
