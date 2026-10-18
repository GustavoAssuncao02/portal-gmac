import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { enterOperatorCode, openOrder } from './operatorEntry.js'

// Machines with the same name in two sectors (Bancada in Usinagem and in Caldeiraria) are told apart by their sector group.
const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  // The Têmpera is one machine of both sectors: it shows in each group and is the same machine either way.
  await fixture.mutateStore((store) => { store.machines = [['u1', 'Torno CNC', ['Usinagem']], ['u2', 'Bancada', ['Usinagem']], ['t1', 'Têmpera', ['Usinagem', 'Caldeiraria']], ['c1', 'Policorte', ['Caldeiraria']], ['c2', 'Bancada', ['Caldeiraria']]].map(([id, name, sectors]) => ({ id, name, sectors, sector: sectors.join(' e '), type: '', hourlyRate: 0 })) })
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001' })).data.item
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  // Bruno is on the Torno CNC: for Ana it shows taken and cannot be chosen.
  const bruno = (await fixture.adminRequest('/employees', 'POST', { name: 'Bruno Teste', cpf: '00000000002' })).data.item
  assert.equal((await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: bruno.id, machineId: 'u1' }, { Authorization: `Bearer ${fixture.operatorToken}` })).status, 200)
  await context.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
  await page.goto(fixture.url)
  await enterOperatorCode(page, employee.accessCode)
  await openOrder(page, order.service)
  await page.getByRole('button', { name: /Selecionar máquina \/ serviço/ }).click()
  const machines = page.getByRole('region', { name: 'Máquina', exact: true })
  assert.deepEqual(await machines.locator('h4').allTextContents(), ['Usinagem', 'Caldeiraria'])
  const taken = machines.getByRole('button', { name: /^Torno CNC/ })
  assert.equal(await taken.isDisabled(), true)
  assert.match(await taken.innerText(), new RegExp(`Em uso por Bruno Teste · ${order.code}`))
  for (const sector of ['Usinagem', 'Caldeiraria']) assert.equal(await machines.getByRole('group', { name: sector, exact: true }).getByRole('button', { name: 'Têmpera', exact: true }).count(), 1)
  await page.screenshot({ path: 'test-results/operator-machine-sectors.png' })
  // Chosen from Caldeiraria, the shared Têmpera is marked in both groups: it is one machine.
  await machines.getByRole('group', { name: 'Caldeiraria', exact: true }).getByRole('button', { name: 'Têmpera', exact: true }).click()
  await page.getByText('Máquina: Têmpera', { exact: true }).waitFor()
  await page.getByRole('button', { name: /Selecionar máquina \/ serviço/ }).click()
  assert.deepEqual(await machines.getByRole('button', { name: 'Têmpera', exact: true }).evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-pressed'))), ['true', 'true'])
  await machines.getByRole('group', { name: 'Caldeiraria', exact: true }).getByRole('button', { name: 'Bancada', exact: true }).click()
  await page.getByText('Máquina: Bancada', { exact: true }).waitFor()
  await page.getByRole('button', { name: /Iniciar trabalho/ }).click()
  await page.getByRole('button', { name: /^Pausar trabalho/ }).waitFor()
  const session = (await fixture.adminRequest('/operations/orders')).data.items[0].operation.activeSessions.find((item) => item.employeeName === 'Ana Teste')
  assert.equal(session.machineId, 'c2', 'the Bancada of Caldeiraria was the one chosen')
  assert.deepEqual(errors, [])
  console.log('Operator machine sectors passed: machines grouped by sector and the same name told apart.')
} catch (error) {
  await page.screenshot({ path: 'test-results/operator-machine-sectors-failure.png' })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
