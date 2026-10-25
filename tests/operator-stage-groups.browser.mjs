import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { identifiedOperator, stagePlans } from './operatorEntry.js'
import { defaultStageLayout, orderedStageSelection } from '../server/serviceStages.js'

const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const group = (name) => page.getByRole('region', { name: `Etapas de ${name}`, exact: true })
const groupNames = () => page.locator('.operator-stage-group-heading h4').allTextContents()
async function createOrder(service, stages, stageLayout = defaultStageLayout()) {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service })).data.item
  // Every stage on the same labor service: the operator moves between the stages with it.
  const planned = (await fixture.adminRequest('/labor-services')).data.items[0]
  const saved = await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages, stageLayout, stageResources: stagePlans(stages, { type: 'labor-service', id: planned.id }) })
  assert.equal(saved.status, 200)
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  const accepted = await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(accepted.status, 201)
  return accepted.data.item
}
try {
  const order = await createOrder('Projeto com sete subetapas', ['turning', 'milling', 'cnc-turning', 'painting', 'cut-bend', 'torch-cut', 'grinding'])
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Carla Teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'carla@example.invalid', identification: '001' }, fixture.admin)).data.item
  const laborService = (await fixture.adminRequest('/labor-services')).data.items[0]
  const started = (await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: employee.id, laborServiceId: laborService.id }, { Authorization: `Bearer ${fixture.operatorToken}` })).data
  const session = { id: started.operation.activeSession.id, token: started.sessionToken }
  const counts = [10, 10, 10, 3, 3, 1, 0]
  await fixture.mutateStore((store) => {
    const operation = store.orders.find((item) => item.code === order.code).operation
    operation.stageCounts = Object.fromEntries(operation.stages.map((stage, index) => [stage.key, counts[index]]))
  })
  const layout = defaultStageLayout()
  const customLayout = [layout[1], { ...layout[2], stages: ['plasma-cut', ...layout[2].stages.filter((key) => key !== 'plasma-cut')] }, { ...layout[0], stages: [...layout[0].stages].reverse() }]
  const customOrder = await createOrder('Projeto com ordem personalizada', orderedStageSelection(customLayout, ['painting', 'cut-bend', 'plasma-cut', 'turning', 'assembly']), customLayout)
  const single = await createOrder('Projeto somente pintura', ['painting'])
  await context.addInitScript(({ token, code, session, operator }) => {
    sessionStorage.setItem('gmac-operator-token', token)
    sessionStorage.setItem(...operator)
    sessionStorage.setItem(`gmac-operator-session-${code}`, JSON.stringify(session))
  }, { token: fixture.operatorToken, operator: identifiedOperator(employee), code: order.code, session })
  await page.goto(fixture.url)
  await page.locator('.operator-project').filter({ hasText: order.service }).click()
  await group('Usinagem').waitFor()
  assert.deepEqual(await groupNames(), ['Usinagem', 'Pintura', 'Caldeiraria'])
  assert.deepEqual(await group('Usinagem').locator('.operator-stage strong').allTextContents(), ['Tornearia', 'Freza', 'Torno CMC'])
  assert.deepEqual(await group('Caldeiraria').locator('.operator-stage strong').allTextContents(), ['Corte e dobra', 'Corte com Ma\u00e7arico', 'Esmirilhamento'])
  assert.deepEqual(await page.locator('.operator-stage-number').allTextContents(), ['1', '2', '3', '4', '5', '6', '7'])
  assert.equal(await page.locator('.operator-stages-heading strong').innerText(), '37/70 passagens')
  assert.equal(await group('Usinagem').locator('.operator-stage-group-heading span').innerText(), '30/30 passagens')
  assert.equal(await group('Pintura').locator('.operator-stage-group-heading span').innerText(), '3/10 passagens')
  assert.equal(await group('Caldeiraria').locator('.operator-stage-group-heading span').innerText(), '4/30 passagens')
  for (const [width, height] of [[1366, 900], [900, 800], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no page overflow`)
    assert.ok(await page.locator('.operator-stage-number').evaluateAll((items) => items.every((item) => item.getBoundingClientRect().top >= item.closest('.operator-stages').getBoundingClientRect().top)), `${width}: unclipped numbers`)
    assert.ok(await page.locator('.operator-stage-action button').evaluateAll((items) => items.every((item) => item.scrollWidth <= item.clientWidth)), `${width}: readable buttons`)
    assert.ok(await group('Caldeiraria').locator('.operator-stage-action').evaluateAll((items) => items.every((item) => Math.abs(item.getBoundingClientRect().top - items[0].getBoundingClientRect().top) < 1)), `${width}: aligned controls`)
    await page.locator('.operator-stage-groups').screenshot({ path: `test-results/operator-stage-groups-${width}.png` })
  }
  await page.setViewportSize({ width: 1366, height: 900 })
  // Pieces are registered only on the stage the operator works on: the others offer to move there.
  const firstBoilerButton = group('Caldeiraria').getByRole('button', { name: 'Registrar', exact: true }).first()
  assert.equal(await group('Caldeiraria').getByRole('button', { name: 'Registrar', exact: true }).count(), 0)
  const blocked = await fixture.adminRequest(`/operations/orders/${order.code}/stages/${started.operation.stages[4].key}`, 'POST', { quantity: 1, sessionId: session.id, sessionToken: session.token }, { Authorization: `Bearer ${fixture.operatorToken}` })
  assert.equal(blocked.status, 409)
  await group('Pintura').getByRole('button', { name: 'Trabalhar nesta etapa', exact: true }).click()
  await group('Pintura').getByRole('button', { name: 'Registrar', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.operator-stage-group')[1].querySelector('.operator-stage small').textContent === '4/10 pe\u00e7as')
  await group('Caldeiraria').getByRole('button', { name: 'Trabalhar nesta etapa', exact: true }).first().click()
  await firstBoilerButton.click()
  await page.waitForFunction(() => document.querySelector('.operator-stages-heading strong').textContent === '39/70 passagens')
  const persisted = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items.find((item) => item.code === order.code).operation
  assert.deepEqual(persisted.stages.map((stage) => persisted.stageCounts[stage.key]), [10, 10, 10, 4, 4, 1, 0])
  await page.getByRole('button', { name: '← Voltar para as OS', exact: true }).click()
  await page.locator('.operator-project').filter({ hasText: customOrder.service }).click()
  await group('Pintura').waitFor()
  assert.deepEqual(await groupNames(), ['Pintura', 'Caldeiraria', 'Usinagem'])
  assert.deepEqual(await page.locator('.operator-stage strong').allTextContents(), ['Pintura', 'Corte a plasma', 'Corte e dobra', 'Montagem', 'Tornearia'])
  await page.reload()
  await page.locator('.operator-project').filter({ hasText: customOrder.service }).click()
  assert.deepEqual(await groupNames(), ['Pintura', 'Caldeiraria', 'Usinagem'])
  await page.locator('.operator-stage-groups').screenshot({ path: 'test-results/operator-stage-groups-custom.png' })
  await page.getByRole('button', { name: '← Voltar para as OS', exact: true }).click()
  await page.locator('.operator-project').filter({ hasText: single.service }).click()
  assert.deepEqual(await groupNames(), ['Pintura'])
  assert.deepEqual(errors, [])
  console.log('Operator stage groups passed: offer/OS order, custom substeps, totals, global numbering, cross-group registration rules, reload and desktop/mobile layout.')
} finally { await browser.close(); await fixture.close() }
