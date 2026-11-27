import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { shiftMonth, todayBahia } from '../server/payableRules.js'

// Início: the period of Contas a pagar / a receber (1, 3, 6, 12 by default, 24 months or Tudo) changes Total em aberto /
// Total a receber, is saved with the account and opens the account screens on the same accounts.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const today = todayBahia()
const inDays = (days) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const brDate = (date) => date.split('-').reverse().join('/')
try {
  // Overdue, within 3 months, within 12 months and beyond 24 months.
  const dates = [inDays(-5), shiftMonth(today, 2), shiftMonth(today, 10), shiftMonth(today, 30)]
  await fixture.mutateStore((store) => {
    store.suppliers = [{ id: 's1', name: 'Fornecedor Teste', document: '12345678000190' }]
    store.classifications = [{ id: 'c1', name: 'Despesas industriais' }, { id: 'r1', name: 'Receita de serviços', dreLine: 'gross_revenue' }]
    store.payables = dates.map((dueDate, index) => ({ id: `PAG-00000${index + 1}`, supplierId: 's1', supplierName: 'Fornecedor Teste', classificationId: 'c1', classificationName: 'Despesas industriais', description: `Conta ${index + 1}`, documentNumber: '', issueDate: today, dueDate, kind: 'normal', valueCents: 10000 * 10 ** index, attachments: [] }))
    store.payableSequence = dates.length
    store.receivables = dates.map((dueDate, index) => ({ id: `REC-00000${index + 1}`, clientId: '1', customerName: 'Cliente Teste', classificationId: 'r1', classificationName: 'Receita de serviços', description: `Recebimento ${index + 1}`, documentNumber: '', issueDate: today, dueDate, kind: 'single', valueCents: 20000 * 10 ** index, issCents: 0, attachments: [] }))
    store.receivableSequence = dates.length
  })
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const auth = { Authorization: `Bearer ${token}` }
  assert.equal((await fixture.request('/account/home-layout', 'PUT', { layout: [{ id: 'payables-summary', w: 4, h: 1 }, { id: 'receivables-summary', w: 4, h: 1 }] }, auth)).status, 200)

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  const payables = page.locator('.home-payables:not(.home-receivables)'), receivables = page.locator('.home-receivables')
  const total = (widget) => widget.locator('.home-payable--open')
  await page.waitForFunction(() => [...document.querySelectorAll('.home-payable')].every((button) => !button.disabled) && document.querySelectorAll('.home-payable').length === 8)
  const payablePeriod = payables.getByLabel('Período do total em aberto', { exact: true })
  const receivablePeriod = receivables.getByLabel('Período do total a receber', { exact: true })
  assert.deepEqual(await payablePeriod.locator('option').allTextContents(), ['1 mês', '3 meses', '6 meses', '12 meses', '24 meses', 'Tudo'])
  assert.equal(await payablePeriod.inputValue(), '12', '12 months by default')
  // 12 months: overdue + 2 months + 10 months.
  assert.match(await total(payables).locator('strong').innerText(), /11\.100,00/)
  assert.equal(await total(payables).locator('small').innerText(), '3 contas')
  const overdueBefore = await payables.locator('.home-payable--overdue strong').innerText()

  // Tudo: every open account; the other cards stay; saved with the account.
  await payablePeriod.selectOption('all')
  await page.waitForFunction(() => document.querySelector('.home-payables:not(.home-receivables) .home-payable--open small').textContent === '4 contas')
  assert.match(await total(payables).locator('strong').innerText(), /111\.100,00/)
  assert.equal(await payables.locator('.home-payable--overdue strong').innerText(), overdueBefore)
  await page.waitForFunction(async () => (await (await fetch('/api/account/home-layout', { headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token')}` } })).json()).layout[0].period === 'all')
  await page.screenshot({ path: 'test-results/home-account-periods.png' })
  await page.reload()
  await page.waitForFunction(() => document.querySelector('.home-payables:not(.home-receivables) .home-payable--open small')?.textContent === '4 contas')
  assert.equal(await payablePeriod.inputValue(), 'all', 'kept after reloading')

  // Total em aberto opens Contas a Pagar on the same accounts.
  await total(payables).click()
  await page.getByRole('heading', { name: 'Contas a Pagar', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.payable-table tbody tr').length === 4)

  // Contas a Receber, 3 months: overdue + 2 months; the card opens the screen with Vencimento final.
  await page.locator('.sidebar').getByRole('button', { name: 'Início', exact: true }).click()
  await receivablePeriod.selectOption('3')
  await page.waitForFunction(() => document.querySelector('.home-receivables .home-payable--open small').textContent === '2 contas')
  assert.match(await total(receivables).locator('strong').innerText(), /2\.200,00/)
  await total(receivables).click()
  await page.getByRole('heading', { name: 'Contas a Receber', exact: true }).waitFor()
  const rows = page.locator('.receivable-table tbody tr')
  await page.waitForFunction(() => document.querySelectorAll('.receivable-table tbody tr').length === 2)
  assert.equal(await page.getByLabel('Vencimento final', { exact: true }).inputValue(), shiftMonth(today, 3))
  assert.equal(await rows.filter({ hasText: brDate(dates[2]) }).count(), 0)
  // Recebimentos vencidos opens on the late one.
  await page.locator('.sidebar').getByRole('button', { name: 'Início', exact: true }).click()
  await receivables.locator('.home-payable--overdue').click()
  await page.getByRole('heading', { name: 'Contas a Receber', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.receivable-table tbody tr').length === 1)
  assert.equal(await rows.first().getByText('REC-000001').count(), 1)
  assert.equal(await page.locator('.payable-status-filters').getByRole('button', { name: /^Vencidas/ }).getAttribute('aria-pressed'), 'true')

  // Narrow screens: the period fits in the heading.
  await page.locator('.sidebar').getByRole('button', { name: 'Início', exact: true }).click()
  for (const width of [1004, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await receivablePeriod.waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal scroll at ${width}`)
    await page.screenshot({ path: `test-results/home-account-periods-${width}.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log('Home account periods passed: 12 months by default, Tudo saved with the account, other cards unchanged, Total em aberto / Total a receber open the screens on the same accounts, Recebimentos vencidos filtered, narrow screens.')
} catch (error) {
  await page.screenshot({ path: 'test-results/home-account-periods-failure.png', fullPage: true })
  throw error
} finally { await browser.close(); await fixture.close() }
