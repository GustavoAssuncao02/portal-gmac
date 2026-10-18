import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { identifiedOperator } from './operatorEntry.js'

const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, timezoneId: 'America/Bahia' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

async function createOrder(service, stages) {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service, company: 'Cliente de teste com nome completo' })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'material', name: 'Aco inox 305 e aluminio para estrutura', quantity: 10, unitPrice: 5 }], laborEntries: [], stages, kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  return (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
}

try {
  const order = await createOrder('Soldagem e acabamento da estrutura', ['cutting', 'machining', 'welding', 'painting', 'assembly', 'boiler'])
  await createOrder('Projeto com soldagem e pintura', ['welding', 'painting'])
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Carla Teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'teste@example.invalid', identification: '001' }, fixture.admin)).data.item
  // Materials still pending must be acknowledged before the work starts.
  const pending = await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: employee.id }, { Authorization: `Bearer ${fixture.operatorToken}` })
  const started = pending.status === 409 ? await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: employee.id, pendingMaterialsConfirmation: pending.data.pendingMaterials?.map((row) => [row.key, row.quantity]) }, { Authorization: `Bearer ${fixture.operatorToken}` }) : pending
  const session = { id: started.data.operation.activeSession.id, token: started.data.sessionToken }
  await context.addInitScript(({ token, code, session, operator }) => {
    sessionStorage.setItem('gmac-operator-token', token)
    sessionStorage.setItem(...operator)
    sessionStorage.setItem(`gmac-operator-session-${code}`, JSON.stringify(session))
  }, { token: fixture.operatorToken, operator: identifiedOperator(employee), code: order.code, session })
  await page.goto(fixture.url)
  await page.locator('.operator-project').filter({ hasText: order.service }).click()
  const detail = page.locator('.operator-detail')
  await detail.waitFor()
  assert.equal(await page.locator('.operator-project-list').count(), 0, 'the OS screen replaces the list')
  await page.getByRole('button', { name: /^Pausar trabalho/ }).waitFor()
  const statusBox = await detail.locator('.operator-detail-heading > .operator-status').boundingBox()
  const detailBox = await detail.boundingBox()
  assert.ok(detailBox.x + detailBox.width - statusBox.x - statusBox.width >= 26, 'project status is inset farther left')
  assert.equal(await detail.locator('.operator-detail-heading h2').evaluate((element) => getComputedStyle(element).fontSize), '21px')
  assert.equal(await detail.locator('.operator-detail-facts strong').first().evaluate((element) => getComputedStyle(element).fontSize), '13px')
  assert.equal(await detail.locator('.operator-stage small').first().evaluate((element) => getComputedStyle(element).fontSize), '12px')
  assert.equal(await detail.locator('.operator-time-banner strong').first().evaluate((element) => getComputedStyle(element).fontSize), '22px')
  for (const [name, width, height] of [['desktop', 1366, 768], ['wide', 1600, 950], ['tablet-wide', 1050, 850], ['tablet', 900, 800], ['narrow', 781, 800], ['stacked', 780, 800], ['mobile', 390, 844], ['mobile-small', 320, 740]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} page overflow`)
    assert.ok(await detail.locator('.operator-detail-facts strong, .operator-detail-heading h2, .operator-stage-action button, .operator-step strong, .operator-time-banner strong').evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth)), `${name} readable text`)
    assert.ok(await detail.locator('.operator-stage-number').evaluateAll((elements) => elements.every((element) => element.getBoundingClientRect().top >= element.closest('.operator-stages').getBoundingClientRect().top)), `${name} stage circles are not clipped`)
    await page.screenshot({ path: `test-results/operator-layout-${name}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  await detail.getByRole('button', { name: 'Registrar', exact: true }).first().click()
  await page.waitForFunction(() => document.querySelector('.operator-stage small')?.textContent === '1/10 peças')
  assert.equal((await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items.find((item) => item.code === order.code).operation.stageCounts[started.data.operation.stages[0].key], 1)
  await page.getByRole('button', { name: '← Voltar para as OS', exact: true }).click()
  await page.locator('.operator-filters').getByRole('button', { name: 'Aguardando', exact: true }).click()
  assert.equal(await page.locator('.operator-project').count(), 1)
  await page.locator('.operator-filters').getByRole('button', { name: 'Todos', exact: true }).click()
  const search = page.locator('.operator-search input')
  await search.fill('Projeto com soldagem')
  assert.equal(await page.locator('.operator-project').count(), 1)
  await search.fill('')
  assert.equal(await page.locator('.operator-project').count(), 2)
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 800 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: list has no page overflow`)
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.locator('.operator-project').filter({ hasText: 'Projeto com soldagem e pintura' }).click()
  assert.equal(await detail.locator('.operator-stage').count(), 2)
  await page.screenshot({ path: 'test-results/operator-layout-two-stages.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('Operator layout passed: list and OS screens apart, step cards readable at every width, fonts preserved, list/search/filter and stage registration work.')
} catch (error) {
  await page.screenshot({ path: 'test-results/operator-layout-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
