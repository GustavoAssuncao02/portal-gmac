import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, timezoneId: 'America/Bahia' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

async function createOrder(service, stages) {
  const offer = (await fixture.request('/offers', 'POST', { ...offerDraft, service, company: 'Cliente de teste com nome completo' })).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'material', name: 'Aco inox 305 e aluminio para estrutura', quantity: 10, unitPrice: 5 }], laborEntries: [], stages, kind: 'service' })
  await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  return (await fixture.request(`/offers/${offer.id}/accept`, 'POST')).data.item
}

try {
  const order = await createOrder('Soldagem e acabamento da estrutura', ['cutting', 'machining', 'welding', 'painting', 'assembly', 'boiler'])
  await createOrder('Projeto com soldagem e pintura', ['welding', 'painting'])
  const employee = (await fixture.request('/employees', 'POST', { name: 'Carla Teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'teste@example.invalid', identification: '001' })).data.item
  const started = await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: employee.id }, { Authorization: `Bearer ${fixture.operatorToken}` })
  const session = { id: started.data.operation.activeSession.id, token: started.data.sessionToken }
  await context.addInitScript(({ token, code, session }) => {
    sessionStorage.setItem('gmac-operator-token', token)
    sessionStorage.setItem(`gmac-operator-session-${code}`, JSON.stringify(session))
  }, { token: fixture.operatorToken, code: order.code, session })
  await page.goto(fixture.url)
  await page.locator('.operator-project').filter({ hasText: order.service }).click()
  await page.getByRole('button', { name: 'Pausar trabalho', exact: true }).waitFor()
  const list = page.locator('.operator-project-list')
  const detail = page.locator('.operator-detail')
  const sidebarBox = await page.locator('.operator-sidebar').boundingBox()
  const listBox = await list.boundingBox()
  const detailBox = await detail.boundingBox()
  assert.ok(listBox.x - sidebarBox.width <= 11, 'project list is closer to the left sidebar')
  assert.ok(listBox.x - sidebarBox.width <= 7, 'status filters and list move slightly farther left')
  assert.ok(detailBox.width / listBox.width >= 1.65, 'work panel receives most of the width')
  const headerBox = await page.locator('.operator-header').boundingBox()
  const filtersBox = await page.locator('.operator-filters').boundingBox()
  assert.ok(Math.abs(detailBox.y - headerBox.y) <= 1, 'details start at the top alongside the list heading')
  assert.ok(detailBox.y < filtersBox.y && detailBox.y < listBox.y, 'details occupy the former empty area above the projects')
  assert.ok(filtersBox.x + filtersBox.width <= detailBox.x, 'status filters stay in the left column')
  const statusBox = await detail.locator('.operator-detail-heading > .operator-status').boundingBox()
  assert.ok(detailBox.x + detailBox.width - statusBox.x - statusBox.width >= 26, 'project status is inset farther left')
  assert.equal(await detail.locator('.operator-detail-heading h2').evaluate((element) => getComputedStyle(element).fontSize), '21px')
  assert.equal(await detail.locator('.operator-detail-facts strong').first().evaluate((element) => getComputedStyle(element).fontSize), '13px')
  assert.equal(await detail.locator('.operator-stage small').first().evaluate((element) => getComputedStyle(element).fontSize), '12px')
  assert.equal(await detail.locator('.operator-time-banner strong').first().evaluate((element) => getComputedStyle(element).fontSize), '22px')
  for (const [name, width, height] of [['desktop', 1366, 768], ['wide', 1600, 950], ['tablet-wide', 1050, 850], ['tablet', 900, 800], ['narrow', 781, 800], ['stacked', 780, 800], ['mobile', 390, 844], ['mobile-small', 320, 740]]) {
    await page.setViewportSize({ width, height })
    if (width > 780) {
      const detailBounds = await detail.boundingBox()
      const headerBounds = await page.locator('.operator-header').boundingBox()
      assert.ok(Math.abs(detailBounds.y - headerBounds.y) <= 1, `${name} details stay at the top`)
      const filtersBounds = await page.locator('.operator-filters').boundingBox()
      assert.ok(filtersBounds.x + filtersBounds.width <= detailBounds.x, `${name} filters stay to the left`)
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} page overflow`)
    assert.ok(await detail.locator('.operator-detail-facts strong, .operator-detail-heading h2, .operator-stage-action button, .operator-actions button, .operator-time-banner strong').evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth)), `${name} readable text`)
    assert.ok(await detail.locator('.operator-stage-number').evaluateAll((elements) => elements.every((element) => element.getBoundingClientRect().top >= element.closest('.operator-stages').getBoundingClientRect().top)), `${name} stage circles are not clipped`)
    await page.screenshot({ path: `test-results/operator-layout-${name}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.locator('.operator-filters').getByRole('button', { name: 'Aguardando', exact: true }).click()
  assert.equal(await page.locator('.operator-project').count(), 1)
  await page.locator('.operator-filters').getByRole('button', { name: 'Todos', exact: true }).click()
  const search = page.locator('.operator-search input')
  await search.fill('Projeto com soldagem')
  assert.equal(await page.locator('.operator-project').count(), 1)
  await search.fill('')
  assert.equal(await page.locator('.operator-project').count(), 2)
  await detail.getByRole('button', { name: 'Registrar', exact: true }).first().click()
  await page.waitForFunction(() => document.querySelector('.operator-stage small')?.textContent === '1/10 pe\u00e7as')
  assert.equal((await fixture.request('/operations/orders')).data.items.find((item) => item.code === order.code).operation.stageCounts[started.data.operation.stages[0].key], 1)
  await page.locator('.operator-project').filter({ hasText: 'Projeto com soldagem e pintura' }).click()
  assert.equal(await detail.locator('.operator-stage').count(), 2)
  await page.screenshot({ path: 'test-results/operator-layout-two-stages.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('Operator layout passed: work panel starts at the top, status filters stay in the left column, status badge shifted left, list/search/filter work, wider panel and existing fonts preserved, unclipped stage numbers, working piece registration, two/six stages and eight desktop/mobile viewports.')
} catch (error) {
  await page.screenshot({ path: 'test-results/operator-layout-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
