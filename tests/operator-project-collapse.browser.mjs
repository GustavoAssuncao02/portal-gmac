import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await context.newPage()
const errors = []
let loads = 0
page.on('pageerror', (error) => errors.push(error.message))
page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loads++ })
const card = (service) => page.locator('.operator-project').filter({ hasText: service })
const detail = page.locator('.operator-detail')
const panel = page.locator('#operator-projects-panel')
const reopen = page.getByRole('button', { name: 'Mostrar projetos', exact: true })
async function createOrder(service) {
  const offer = (await fixture.request('/offers', 'POST', { ...offerDraft, service })).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['turning', 'milling', 'cnc-turning', 'painting', 'cut-bend', 'torch-cut', 'grinding'], kind: 'service' })
  await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  const accepted = await fixture.request(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(accepted.status, 201)
  return accepted.data.item
}
try {
  const work = await createOrder('Estrutura em producao')
  const other = await createOrder('Outro projeto')
  const employee = (await fixture.request('/employees', 'POST', { name: 'Ana Teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'ana@example.invalid', identification: '001' })).data.item
  const started = (await fixture.request(`/operations/orders/${work.code}/start`, 'POST', { employeeId: employee.id }, { Authorization: `Bearer ${fixture.operatorToken}` })).data
  const session = { id: started.operation.activeSession.id, token: started.sessionToken }
  await fixture.mutateStore((store) => {
    const operation = store.orders.find((order) => order.code === work.code).operation
    const counts = [10, 10, 10, 3, 3, 1, 0]
    operation.stageCounts = Object.fromEntries(operation.stages.map((stage, i) => [stage.key, counts[i]]))
  })
  await context.addInitScript(({ token, code, session }) => {
    sessionStorage.setItem('gmac-operator-token', token)
    sessionStorage.setItem(`gmac-operator-session-${code}`, JSON.stringify(session))
  }, { token: fixture.operatorToken, code: work.code, session })
  await page.goto(fixture.url)
  await card(work.service).waitFor()
  assert.ok(await panel.isVisible(), 'Initial automatic selection does not hide the list')
  const originalWidth = (await detail.boundingBox()).width
  await page.getByRole('button', { name: 'Em execução', exact: true }).click()
  const search = page.getByPlaceholder('Buscar por projeto, cliente ou código...')
  await search.fill('Estrutura')
  await card(work.service).focus()
  await page.keyboard.press('Enter')
  await reopen.waitFor()
  assert.ok(await panel.isHidden())
  assert.equal(await reopen.getAttribute('aria-expanded'), 'false')
  assert.ok(await detail.locator('h2').evaluate((element) => element === document.activeElement), 'Keyboard focus moves into the visible details')
  assert.ok((await detail.boundingBox()).width >= originalWidth + 300, 'Details gain the project-list width')
  assert.equal(await page.locator('.operator-projects').evaluate((element) => element.getBoundingClientRect().width), 44)
  const quantity = page.locator('.operator-stage-action input').nth(3)
  await quantity.fill('2')
  for (const [width, height] of [[1366, 900], [1920, 1080], [900, 800], [781, 800], [780, 800], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no page overflow`)
    assert.ok(await detail.locator('.operator-detail-heading h2, .operator-detail-facts strong, .operator-actions button, .operator-stage-action button').evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth)), `${width}: readable text`)
    assert.ok(await detail.locator('.operator-stage-number').evaluateAll((elements) => elements.every((element) => element.getBoundingClientRect().top >= element.closest('.operator-stages').getBoundingClientRect().top)), `${width}: unclipped stage numbers`)
    const bounds = await detail.boundingBox()
    const main = await page.locator('.operator-main').boundingBox()
    if (width > 780) assert.ok(bounds.width >= main.width - 80, `${width}: narrow rail leaves most width for details`)
    else assert.ok(bounds.width >= main.width - 32, `${width}: mobile uses the whole content width`)
    await page.screenshot({ path: `test-results/operator-project-collapsed-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1366, height: 900 })
  const incoming = await createOrder('OS recebida com a lista recolhida')
  await page.waitForFunction(() => document.querySelector('.operator-projects-count')?.textContent === '3', undefined, { timeout: 15000 })
  assert.ok(await panel.isHidden(), 'A ten-second refresh never reopens the list')
  assert.equal(await detail.locator('h2').innerText(), work.service)
  assert.equal(await quantity.inputValue(), '2')
  assert.deepEqual(await page.evaluate((code) => JSON.parse(sessionStorage.getItem(`gmac-operator-session-${code}`)), work.code), session)
  await page.locator('.operator-worker-toggle').first().click()
  await page.getByRole('button', { name: 'Troca de máquina ou serviço', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('button', { name: 'Fechar', exact: true }).click()
  assert.ok(await panel.isHidden())
  await page.getByRole('button', { name: 'Visualizar informações do projeto', exact: true }).click()
  await page.getByRole('button', { name: 'Voltar aos projetos', exact: true }).click()
  assert.ok(await panel.isHidden(), 'Returning from project information preserves the focused layout')
  await reopen.click()
  assert.ok(await panel.isVisible())
  assert.equal(await search.inputValue(), 'Estrutura')
  assert.ok(await page.getByRole('button', { name: 'Em execução', exact: true }).evaluate((element) => element.classList.contains('active')))
  await page.getByRole('button', { name: 'Todos', exact: true }).click()
  await search.fill('')
  await card(incoming.service).waitFor()
  await card(other.service).click()
  assert.ok(await panel.isHidden())
  assert.equal(await detail.locator('h2').innerText(), other.service)
  await reopen.click()
  await card(work.service).click()
  assert.equal(await quantity.inputValue(), '2')
  assert.equal((await fixture.request('/operations/orders')).data.items.find((order) => order.code === work.code).operation.activeSession.id, session.id)
  await fixture.mutateStore((store) => { store.orders = [] })
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await detail.getByText('Nenhuma OS aberta. As ordens aceitas pelo admin aparecerão aqui.', { exact: true }).waitFor()
  assert.ok(await panel.isVisible(), 'An empty order list cannot leave a stranded collapsed panel')
  assert.ok(await page.getByRole('button', { name: 'Recolher projetos', exact: true }).isDisabled())
  assert.equal(loads, 1)
  assert.deepEqual(errors, [])
  console.log('Operator collapse passed: selection/keyboard focus, wider OS details, reopening/filter preservation, seven desktop/mobile sizes, 10-second new-OS count, unchanged work session, machine dialog and project information.')
} catch (error) {
  await page.screenshot({ path: 'test-results/operator-project-collapse-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
