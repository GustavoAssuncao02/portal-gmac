import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { chooseResource, enterOperatorCode, openOrder } from './operatorEntry.js'

const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno 01' }, { id: 'fresa', name: 'Fresa 02' }] })
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'ana@example.invalid', identification: '001' }, fixture.admin)).data.item
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  await context.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
  await page.goto(fixture.url)
  await enterOperatorCode(page, employee.accessCode)
  assert.equal(await page.getByRole('button', { name: 'Troca de máquina ou serviço', exact: true }).count(), 0)
  await openOrder(page, order.service)
  assert.equal(await page.getByRole('button', { name: /Iniciar trabalho/ }).isEnabled(), false, 'a machine or a labor service must be chosen')
  await chooseResource(page, 'Serviço', 'Tornearia')
  await page.getByText('Serviço: Tornearia', { exact: true }).waitFor()
  await chooseResource(page, 'Máquina', 'Torno 01')
  await page.getByText('Máquina: Torno 01', { exact: true }).waitFor()
  await page.getByRole('button', { name: /Iniciar trabalho/ }).click()
  const pause = page.getByRole('button', { name: /^Pausar trabalho/ })
  await pause.waitFor()
  assert.equal(await page.getByRole('button', { name: 'Troca de máquina ou serviço' }).count(), 0, 'the worker list has no action buttons')
  assert.match(await page.locator('.operator-workers').innerText(), /Ana Teste[\s\S]*Máquina: Torno 01/)
  const before = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0].operation
  const session = await page.evaluate((code) => sessionStorage.getItem(`gmac-operator-sessions-${code}`), order.code)
  assert.ok(JSON.parse(session)[before.activeSessions[0].id])
  const quantities = page.locator('.operator-stage-action input')
  await quantities.first().fill('2')
  const change = async (group, name) => {
    await page.getByRole('button', { name: /Selecionar máquina \/ serviço/ }).click()
    await page.getByRole('region', { name: group, exact: true }).getByRole('button', { name, exact: true }).click()
    await page.locator('.operator-steps').waitFor()
  }
  await page.getByRole('button', { name: /Selecionar máquina \/ serviço/ }).click()
  assert.equal(await page.getByRole('button', { name: 'Torno 01', exact: true }).getAttribute('aria-pressed'), 'true', 'the running machine is marked')
  await page.screenshot({ path: 'test-results/operator-machine-change-desktop.png' })
  await page.getByRole('button', { name: 'Fresa 02', exact: true }).click()
  await page.locator('.operator-step--resource').getByText('Máquina: Fresa 02', { exact: true }).waitFor()
  const after = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0].operation
  assert.equal(after.activeSessions[0].machineId, 'fresa')
  assert.equal(after.activeSessions[0].id, before.activeSessions[0].id)
  assert.equal(after.activeSessions[0].startedAt, before.activeSessions[0].startedAt)
  assert.equal(await quantities.first().inputValue(), '2')
  assert.equal(await page.evaluate((code) => sessionStorage.getItem(`gmac-operator-sessions-${code}`), order.code), session)
  await page.locator('.operator-history summary').click()
  await page.getByText('Trocou de máquina', { exact: true }).waitFor()
  assert.match(await page.locator('.operator-history').innerText(), /Torno 01 → Máquina Fresa 02/)
  await page.reload()
  await openOrder(page, order.service)
  await pause.waitFor()
  await page.getByRole('button', { name: 'Visualizar informações do projeto', exact: true }).click()
  await page.locator('.operator-project-info').waitFor()
  assert.match(await page.locator('.operator-project-info').innerText(), /Máquina atual\s*Fresa 02/)
  await page.getByRole('button', { name: /Voltar/ }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await pause.waitFor()
  await page.screenshot({ path: 'test-results/operator-machine-change-mobile.png' })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow on mobile')
  // Leaves the machine for manual work with a labor service.
  await page.getByRole('button', { name: /Selecionar máquina \/ serviço/ }).click()
  const serviceButton = page.getByRole('region', { name: 'Serviço', exact: true }).getByRole('button').nth(1)
  const chosen = await serviceButton.innerText()
  await serviceButton.click()
  await page.locator('.operator-steps').waitFor()
  const manual = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0].operation.activeSessions[0]
  assert.equal(manual.machineId, null)
  assert.equal(manual.laborServiceName, chosen)
  // And back from the labor service to a machine.
  await change('Máquina', 'Torno 01')
  const back = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0].operation.activeSessions[0]
  assert.deepEqual([back.machineId, back.laborServiceId], ['torno', null])
  await pause.click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('select').selectOption('Descanso')
  await page.getByRole('button', { name: 'Confirmar pausa', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await pause.count(), 0)
  assert.equal((await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0].operation.status, 'paused')
  assert.deepEqual(errors, [])
  console.log('Operator machine change passed: exclusive machine/service choice, same work session, reload, machine and labor service swaps, history, pause and desktop/mobile layout.')
} catch (error) {
  await page.screenshot({ path: 'test-results/operator-machine-change-failure.png' })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
