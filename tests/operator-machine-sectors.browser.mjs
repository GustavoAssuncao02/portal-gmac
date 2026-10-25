import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { enterOperatorCode, openOrder, startWork } from './operatorEntry.js'

// Machines with the same name in two sectors (Bancada in Usinagem and in Caldeiraria) are told apart by their sector group
// where the machine of each stage is chosen, in the offer; the operator then works on the one planned, without choosing.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
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

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
  await page.locator('.offers-table-row').filter({ hasText: offer.code }).getByRole('button', { name: 'Em análise', exact: true }).click()
  const select = page.getByLabel('Máquina ou serviço de Tornearia', { exact: true })
  await select.waitFor()
  const groups = await select.locator('optgroup').evaluateAll((items) => items.map((group) => [group.label, [...group.querySelectorAll('option')].map((option) => `${option.textContent}=${option.value}`)]))
  assert.deepEqual(groups.slice(0, 2), [['Máquinas · Usinagem', ['Torno CNC=machine:u1', 'Bancada=machine:u2', 'Têmpera=machine:t1']], ['Máquinas · Caldeiraria', ['Têmpera=machine:t1', 'Policorte=machine:c1', 'Bancada=machine:c2']]])
  const saved = page.waitForResponse((response) => response.url().endsWith(`/offers/${offer.id}/resources`) && response.request().method() === 'PUT')
  await select.selectOption('machine:c2')
  assert.equal((await saved).status(), 200)
  await page.screenshot({ path: 'test-results/operator-machine-sectors.png' })
  assert.equal((await fixture.adminRequest('/offers')).data.items.find((item) => item.id === offer.id).resources.stageResources.turning.id, 'c2', 'the Bancada of Caldeiraria was the one chosen')

  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const tablet = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  tablet.on('pageerror', (error) => errors.push(error.message))
  await tablet.context().addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
  await tablet.goto(fixture.url)
  await enterOperatorCode(tablet, employee.accessCode)
  await openOrder(tablet, order.service)
  await startWork(tablet, 'Máquina: Bancada')
  await tablet.getByRole('button', { name: /^Pausar trabalho/ }).waitFor()
  const session = (await fixture.adminRequest('/operations/orders')).data.items[0].operation.activeSessions.find((item) => item.employeeName === 'Ana Teste')
  assert.equal(session.machineId, 'c2', 'the operator works on the Bancada planned in the offer')
  assert.deepEqual(errors, [])
  console.log('Operator machine sectors passed: the offer groups the machines by sector and tells the same name apart; the operator works on the one planned.')
} catch (error) {
  await page.screenshot({ path: 'test-results/operator-machine-sectors-failure.png' })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
