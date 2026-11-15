import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { enterOperatorCode, stagePlans } from './operatorEntry.js'

// Operator screen: the identified employee leaves after 10 minutes without any use (back to the code), and the sidebar
// with who is identified stays in view while a long list of OS scrolls.
const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
await mkdir('test-results/operator-idle', { recursive: true })
const errors = []

try {
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Paula Teste', cpf: '00000000001' })).data.item
  const shared = { type: 'labor-service', id: (await fixture.adminRequest('/labor-services')).data.items[0].id }
  for (let index = 1; index <= 8; index += 1) {
    const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: `Peça de teste ${index}` })).data.item
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['assembly'], stageResources: stagePlans(['assembly'], shared) })
    await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
    await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.install()
  await page.goto(fixture.url)
  await enterOperatorCode(page, employee.accessCode)
  await page.locator('.operator-project').nth(7).waitFor()

  // At the end of a long list, who is identified is still in view.
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 200), 'the list is longer than the screen')
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const account = await page.locator('.operator-sidebar-bottom').boundingBox()
  assert.ok(account.y >= 0 && account.y + account.height <= 800, `the account stays in view (${Math.round(account.y)})`)
  assert.equal(await page.locator('.operator-sidebar-bottom strong').innerText(), 'Ana Paula Teste')
  await page.screenshot({ path: 'test-results/operator-idle/lista-rolada.png' })

  // Any use restarts the count: 9 minutes, a movement, 9 more minutes and the employee is still identified.
  await page.clock.fastForward('09:00')
  await page.mouse.move(500, 300)
  await page.clock.fastForward('09:00')
  assert.equal(await page.locator('.operator-entry').count(), 0, 'a movement restarts the 10 minutes')
  // 10 minutes without anything: back to the code screen, with the reason.
  await page.clock.fastForward('01:10')
  await page.locator('.operator-entry').waitFor()
  await page.getByRole('status').filter({ hasText: 'Saída automática após 10 minutos sem uso.' }).waitFor()
  await page.screenshot({ path: 'test-results/operator-idle/saida-automatica.png' })
  // The code brings the employee back; the notice goes away.
  await enterOperatorCode(page, employee.accessCode)
  await page.locator('.operator-project').first().waitFor()
  assert.equal(await page.getByText('Saída automática', { exact: false }).count(), 0)
  await context.close()

  assert.deepEqual(errors, [])
  console.log('Operator idle passed: automatic exit after 10 minutes without use, account always in view.')
} finally {
  await browser.close()
  await fixture.close()
}
