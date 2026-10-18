import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { enterOperatorCode, openOrder, startWork } from './operatorEntry.js'

// One OS at a time: starting a second OS asks before moving the operator, and the first one is paused with "Troca de serviço".
const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno 01' }] })
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001' })).data.item
  const order = async (service) => {
    const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service })).data.item
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
    await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
    return (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  }
  const first = await order('Eixo da primeira OS'), second = await order('Flange da segunda OS')
  await context.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
  await page.goto(fixture.url)
  await enterOperatorCode(page, employee.accessCode)
  await openOrder(page, first.service)
  await startWork(page, 'Máquina', 'Torno 01')
  await page.getByRole('button', { name: /^Pausar trabalho/ }).waitFor()
  await page.getByRole('button', { name: '← Voltar para as OS', exact: true }).click()
  await openOrder(page, second.service)
  await startWork(page, 'Máquina', 'Torno 01')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('heading', { name: 'Trocar de OS?', exact: true }).waitFor()
  assert.match(await dialog.innerText(), new RegExp(`Você já está trabalhando na OS ${first.code} \\(Eixo da primeira OS\\)\\. Deseja alterar para a OS ${second.code}\\?`))
  await page.screenshot({ path: 'test-results/operator-switch-order.png' })
  // Staying keeps the first OS running and nothing starts here.
  await dialog.getByRole('button', { name: 'Continuar na OS atual', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const operation = async (code) => (await fixture.adminRequest('/operations/orders')).data.items.find((item) => item.code === code).operation
  assert.equal((await operation(first.code)).status, 'running')
  assert.equal((await operation(second.code)).status, 'waiting')
  await page.getByRole('button', { name: /Iniciar trabalho/ }).click()
  await dialog.getByRole('button', { name: 'Sim, trocar para esta OS', exact: true }).click()
  await page.getByRole('button', { name: /^Pausar trabalho/ }).waitFor()
  const left = await operation(first.code)
  assert.deepEqual([left.status, left.lastPauseReason, left.activeSessions.length], ['paused', 'Troca de serviço', 0])
  assert.equal((await operation(second.code)).activeSessions[0].employeeName, 'Ana Teste')
  // The key of the old session is dropped from this device.
  assert.equal(await page.evaluate((code) => sessionStorage.getItem(`gmac-operator-sessions-${code}`), first.code), null)
  await page.getByRole('button', { name: '← Voltar para as OS', exact: true }).click()
  await openOrder(page, first.service)
  await page.locator('.operator-history summary').click()
  await page.locator('.operator-history').getByText(/Troca de serviço/).waitFor()
  assert.deepEqual(errors, [])
  console.log('Operator switch passed: one OS at a time, confirmation dialog, staying put, switching with the automatic "Troca de serviço" pause and the old session key dropped.')
} catch (error) {
  await page.screenshot({ path: 'test-results/operator-switch-order-failure.png' })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
