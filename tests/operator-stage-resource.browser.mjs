import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { enterOperatorCode, openOrder } from './operatorEntry.js'

// The operator selects the stage, and the machine or labor service planned for it in the offer comes with it: another
// resource cannot be used, and a planned machine in use by someone else blocks the stage.
const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno 01' }, { id: 'fresa', name: 'Fresa 02' }] })
  const service = (await fixture.adminRequest('/labor-services')).data.items.find((item) => item.name === 'Pintura industrial')
  const ana = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001' })).data.item
  const bruno = (await fixture.adminRequest('/employees', 'POST', { name: 'Bruno Teste', cpf: '00000000002' })).data.item
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning', 'painting'], strictProcess: false, stageResources: { turning: { type: 'machine', id: 'torno' }, painting: { type: 'labor-service', id: service.id } } })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  await context.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
  await page.goto(fixture.url)
  await enterOperatorCode(page, ana.accessCode)
  await openOrder(page, order.service)
  const step = page.getByRole('button', { name: /Selecionar etapa/ })
  await step.getByText('Máquina: Torno 01', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /Iniciar trabalho/ }).isEnabled(), true, 'the planned machine is enough to start')

  await step.click()
  const stages = page.getByRole('region', { name: 'Etapas', exact: true })
  await stages.getByText('Máquina: Torno 01', { exact: true }).waitFor()
  await stages.getByRole('button', { name: /Pintura/ }).click()
  await step.getByText('Serviço: Pintura industrial', { exact: true }).waitFor()
  assert.match(await step.innerText(), /Pintura · Serviço: Pintura industrial/)
  await page.getByRole('button', { name: /Iniciar trabalho/ }).click()
  await page.getByRole('button', { name: /^Pausar trabalho/ }).waitFor()
  let session = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0].operation.activeSessions[0]
  assert.deepEqual([session.laborServiceName, session.stageName], ['Pintura industrial', 'Pintura'], 'the stage decides the resource')
  assert.equal(await page.locator('.operator-stage-action').count(), 1, 'pieces are registered only on the stage of the operator')

  const sessionToken = JSON.parse(await page.evaluate((code) => sessionStorage.getItem(`gmac-operator-sessions-${code}`), order.code))[session.id]
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  assert.equal((await fixture.request(`/operations/orders/${order.code}/resource`, 'POST', { resourceType: 'machine', resourceId: 'fresa', sessionId: session.id, sessionToken }, operator)).status, 409, 'a planned stage keeps its resource')
  assert.equal((await fixture.request(`/operations/orders/${order.code}/stages/stage-1`, 'POST', { quantity: 1, sessionId: session.id, sessionToken }, operator)).status, 409, 'another stage is not registered from here')

  // Moving to the turning stage brings its machine along.
  await step.click()
  await stages.locator('.operator-picker-option').first().click()
  await step.getByText('Máquina: Torno 01', { exact: true }).waitFor()
  session = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0].operation.activeSessions[0]
  assert.equal(session.machineName, 'Torno 01')

  // For someone else the turning stage is blocked while Ana uses the lathe.
  const other = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await other.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
  const second = await other.newPage()
  second.on('pageerror', (error) => errors.push(error.message))
  await second.goto(fixture.url)
  await enterOperatorCode(second, bruno.accessCode)
  await openOrder(second, order.service)
  assert.equal(await second.getByRole('button', { name: /Iniciar trabalho/ }).isDisabled(), true, 'the stage waits for the planned machine')
  await second.getByRole('button', { name: /Selecionar etapa/ }).click()
  const turning = second.getByRole('region', { name: 'Etapas', exact: true }).locator('.operator-picker-option').first()
  await turning.getByText(/Em uso por Ana Teste/).waitFor()
  assert.equal(await turning.isDisabled(), true)
  await other.close()
  assert.deepEqual(errors, [])
  console.log('Operator stage resource passed: the stage decides the planned machine or service, keeps it, registers only its own pieces and waits for a machine in use.')
} finally {
  await browser.close()
  await fixture.close()
}
