import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'
import { addDays, weekStart } from '../src/cashFlow.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env, fillClassifications: false })
const browser = await chromium.launch()
await mkdir('test-results/cash-flow', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('dialog', async (dialog) => { errors.push(`Unexpected browser dialog: ${dialog.type()}`); await dialog.dismiss() })
const shot = (name) => page.screenshot({ path: `test-results/cash-flow/${name}.png`, fullPage: true })
const today = todayBahia(), lastWeek = addDays(weekStart(today), -7)
try {
  await (await fixture.serverModule('accountPlan.js')).ensureAccountPlan()
  const api = async (route, method, body) => { const result = await fixture.adminRequest(route, method, body); assert.ok(result.status < 400, `${route}: ${result.data?.message}`); return result.data }
  const { items } = await api('/classifications')
  const id = (code) => items.find((item) => item.code === code).id
  const supplier = (await api('/suppliers', 'POST', { name: 'Aço Bahia Distribuidora', document: '12345678000190' })).item
  // Last week, Monday to Sunday: entries and exits that change the balance from one day to the next.
  const week = [[18000, 9000], [12500, 14000], [21000, 6500], [9500, 9500], [16000, 4000], [3000, 1200], [0, 800]]
  for (const [index, [entry, exit]] of week.entries()) {
    const date = addDays(lastWeek, index)
    if (entry) await api('/receivables', 'POST', { treasury: true, customerName: 'Nestlé Nordeste', classificationId: id(index % 2 ? '7.03' : '7.01'), date, method: 'pix', value: entry.toFixed(2), description: 'Serviço recebido' })
    if (exit) await api('/payables', 'POST', { treasury: true, supplierId: supplier.id, classificationId: id(['1.01', '1.08', '1.23', '2.05', '1.01', '3.05', '4.04'][index]), date, method: 'pix', value: exit.toFixed(2), description: 'Pagamento do dia' })
  }
  // The day before that week, for Monday's comparison, and a divided bill in the week.
  await api('/receivables', 'POST', { treasury: true, customerName: 'Cliente', classificationId: id('7.01'), date: addDays(lastWeek, -1), method: 'pix', value: '10000.00' })
  await api('/payables', 'POST', { treasury: true, supplierId: supplier.id, classificationId: id('1.06'), classificationSplit: [{ classificationId: id('1.06'), value: '700.00' }, { classificationId: id('1.19'), value: '300.00' }], date: addDays(lastWeek, 2), method: 'pix', value: '1000.00' })
  // Today.
  await api('/receivables', 'POST', { treasury: true, customerName: 'Cliente do dia', classificationId: id('7.01'), date: today, method: 'pix', value: '15000.00' })
  await api('/payables', 'POST', { treasury: true, supplierId: supplier.id, classificationId: id('1.01'), date: today, method: 'boleto', value: '11500.00' })

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  const sidebar = page.locator('.sidebar')
  const group = sidebar.getByRole('button', { name: 'Gestão Financeira', exact: true })
  if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  assert.deepEqual((await sidebar.locator('#sidebar-finance-menu .nav-item').allTextContents()).slice(0, 4), ['Contas a Pagar', 'Contas a Receber', 'Tesouraria', 'Fluxo de caixa'])
  await sidebar.getByRole('button', { name: 'Fluxo de caixa', exact: true }).click()
  await page.getByRole('heading', { name: 'Fluxo de caixa', exact: true }).waitFor()
  await page.locator('.cash-flow-bars svg').waitFor()
  assert.equal(await page.getByRole('button', { name: /Nova (entrada|saída)/ }).count(), 0, 'a cash flow has no posting actions')

  // Daily: the two totals of the day, as in the reference image.
  const metric = async (label) => (await page.locator('.treasury-summary .payable-metric').filter({ has: page.locator('span', { hasText: new RegExp(`^${label}$`) }) }).locator('strong').innerText()).replace(/\s/g, ' ')
  assert.equal(await metric('Entradas'), 'R$ 15.000,00')
  assert.equal(await metric('Saídas'), 'R$ 11.500,00')
  assert.deepEqual(await page.locator('.cash-flow-bars .cash-label').allTextContents(), ['Entradas', 'Saídas'])
  assert.equal(await page.locator('.cash-flow-table tbody tr').count(), 2)
  await shot('01-diario')

  // Weekly: last week's days with the change of each balance against the day before.
  await page.getByRole('button', { name: 'Semanal', exact: true }).click()
  await page.getByRole('button', { name: 'Período anterior', exact: true }).click()
  await page.locator('.cash-flow-period strong', { hasText: `${lastWeek.split('-').reverse().join('/')}` }).waitFor()
  assert.deepEqual(await page.locator('.cash-flow-bars .cash-label').allTextContents(), ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'])
  const chips = page.locator('.cash-flow-bars .cash-chip')
  // Monday kept 90 (180 − 90) against 100 on Sunday: −10%. Tuesday −15 against 90: less. Wednesday 135 (210 − 65 − 10): more.
  assert.equal((await chips.nth(0).textContent()).replace(/\s/g, ' '), '▼ 10,0%')
  assert.match(await chips.nth(0).getAttribute('class'), /cash-chip--bad/)
  assert.match(await chips.nth(2).getAttribute('class'), /cash-chip--good/)
  await page.locator('.cash-flow-bars .cash-hit').nth(2).hover()
  await page.locator('.cash-tooltip').waitFor()
  await shot('02-semanal')
  const costs = page.locator('.cash-flow-pie').filter({ hasText: 'Custos por classificação' })
  // Eight cost classifications: the six largest keep their slices and the divided bill (1.06 + 1.19) joins "Outras".
  assert.equal(await costs.locator('.cash-pie-legend li').count(), 7)
  assert.match(await costs.locator('.cash-pie-legend li').last().getAttribute('title'), /1.06 · Ferramentas de produção, 1.19 · EPI/)
  await page.getByRole('button', { name: 'Ver tabela', exact: true }).click()
  assert.equal(await page.locator('.cash-flow-bucket-table tbody tr').count(), 7)
  await page.getByRole('button', { name: 'Ver gráfico', exact: true }).click()

  // Monthly: the weeks of the month.
  await page.getByRole('button', { name: 'Mensal', exact: true }).click()
  const back = page.getByRole('button', { name: 'Voltar para hoje' })
  if (await back.count()) await back.click()
  assert.ok((await page.locator('.cash-flow-bars .cash-label').allTextContents()).every((label) => /^Semana \d$/.test(label)))
  await shot('03-mensal')

  for (const [theme, tone] of [['dark', ''], ['dark', 'black']]) {
    await page.evaluate(([value, black]) => { document.documentElement.dataset.theme = value; if (black) document.documentElement.dataset.tone = black; else delete document.documentElement.dataset.tone }, [theme, tone])
    await shot(`04-${tone || theme}`)
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; delete document.documentElement.dataset.tone })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.cash-flow-bars svg').waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow on a phone')
  // The chart follows the new width once it is measured; then the weeks take their short names.
  await page.waitForFunction(() => [...document.querySelectorAll('.cash-flow-bars .cash-label')].every((label) => /^S\d$/.test(label.textContent)), null, { timeout: 5000 })
  await shot('05-celular')
  assert.deepEqual(errors, [])
  console.log('cash flow browser test ok')
} finally {
  await browser.close()
  await fixture.close()
}
