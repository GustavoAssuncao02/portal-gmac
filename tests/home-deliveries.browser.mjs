import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'

// Início: "Próximas entregas" (the 5 open OS whose delivery comes first from today on, with "⚠ N OS atrasadas" under the
// list) and "OS atrasadas › Ver todas" open Serviços em andamento on the Atrasado filter.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const today = todayBahia()
const inDays = (days) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const shortDate = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
try {
  // Two late, one today and five ahead (the last one beyond the 5 shown).
  const plan = [['Atrasada A', -3], ['Atrasada B', -1], ['Entrega hoje', 0], ['Entrega amanha', 1], ['Entrega urgente', 2], ['Entrega cinco', 5], ['Entrega nove', 9], ['Entrega quinze', 15]]
  const codes = {}
  for (const [service] of plan) {
    const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service })).data.item
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cut-bend'], kind: 'service' })
    await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
    codes[service] = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item.code
  }
  await fixture.mutateStore((store) => {
    for (const [service, days] of plan) {
      const order = store.orders.find((item) => item.code === codes[service])
      order.deadline = inDays(days)
      if (order.proposal) order.proposal.deadline = inDays(days)
      if (service === 'Entrega urgente') order.resources = { ...order.resources, urgency: 'emergency' }
    }
  })
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  assert.equal((await fixture.request('/account/home-layout', 'PUT', { layout: [{ id: 'upcoming-deliveries', w: 2, h: 2 }, { id: 'late-orders', w: 2, h: 1 }] }, { Authorization: `Bearer ${token}` })).status, 200)

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  const widget = page.locator('[data-widget="upcoming-deliveries"]')
  await widget.getByRole('heading', { name: 'Próximas entregas', exact: true }).waitFor()
  const rows = widget.locator('.home-rows li')
  await rows.first().waitFor()
  assert.deepEqual(await rows.locator('.home-rows-main strong').evaluateAll((items) => items.map((item) => item.firstChild.textContent)), ['Entrega hoje', 'Entrega amanha', 'Entrega urgente', 'Entrega cinco', 'Entrega nove'], 'the 5 nearest from today, without the late ones')
  assert.equal(await rows.nth(2).locator('.home-rows-badge').innerText(), 'Emergencial')
  assert.deepEqual(await rows.locator('.home-rows-value').evaluateAll((items) => items.map((item) => item.innerText.replace(/\s+/g, ' ').trim())), [`${shortDate(inDays(0))} hoje`, `${shortDate(inDays(1))} amanhã`, `${shortDate(inDays(2))} em 2 dias`, `${shortDate(inDays(5))} em 5 dias`, `${shortDate(inDays(9))} em 9 dias`])
  assert.match(await rows.first().locator('small').first().innerText(), new RegExp(`^${codes['Entrega hoje']} · Teste de fluxo · peças 0/10$`))
  const late = widget.getByRole('button', { name: '2 OS atrasadas', exact: true })
  await late.waitFor()
  await page.screenshot({ path: 'test-results/home-deliveries.png' })

  // A row opens the OS.
  await rows.first().getByRole('button').click()
  await page.getByText(codes['Entrega hoje']).first().waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Início', exact: true }).click()

  // "⚠ 2 OS atrasadas" opens the panel on Atrasado.
  await late.click()
  await page.getByRole('heading', { name: 'Painel de serviços em andamento' }).waitFor()
  const panelRows = page.locator('.admin-os-table tbody tr')
  assert.equal(await page.locator('.deadline-filters button.selected').innerText().then((text) => text.replace(/\s+/g, ' ').trim()), '! Atrasado 2')
  assert.equal(await panelRows.count(), 2)
  // From the menu the panel continues as it was left, on Atrasado (2026-11-27: going back to a screen keeps it as it was).
  await page.locator('.sidebar').getByRole('button', { name: 'Início', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Serviços em andamento', exact: true }).click()
  await page.getByRole('heading', { name: 'Painel de serviços em andamento' }).waitFor()
  assert.match(await page.locator('.deadline-filters button.selected').innerText(), /Atrasado/)
  await page.locator('.deadline-filters').getByRole('button', { name: /Todos/ }).click()
  assert.match(await page.locator('.deadline-filters button.selected').innerText(), /Todos/)
  // OS atrasadas › Ver todas: Atrasado too.
  await page.locator('.sidebar').getByRole('button', { name: 'Início', exact: true }).click()
  await page.locator('[data-widget="late-orders"]').getByRole('button', { name: 'Ver todas', exact: true }).click()
  await page.getByRole('heading', { name: 'Painel de serviços em andamento' }).waitFor()
  assert.match(await page.locator('.deadline-filters button.selected').innerText(), /Atrasado/)
  assert.equal(await panelRows.count(), 2)

  // Narrow screens.
  await page.locator('.sidebar').getByRole('button', { name: 'Início', exact: true }).click()
  for (const width of [1004, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await widget.waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal scroll at ${width}`)
    await page.screenshot({ path: `test-results/home-deliveries-${width}.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log('Home deliveries passed: the 5 nearest deliveries from today (no late OS), Emergencial badge, hoje/amanhã/em X dias, row opens the OS, "2 OS atrasadas" and OS atrasadas › Ver todas open the panel on Atrasado, the menu keeps the panel as it was left.')
} catch (error) {
  await page.screenshot({ path: 'test-results/home-deliveries-failure.png', fullPage: true })
  throw error
} finally { await browser.close(); await fixture.close() }
