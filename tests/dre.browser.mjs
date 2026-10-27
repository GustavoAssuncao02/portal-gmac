import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env, fillClassifications: false })
const browser = await chromium.launch()
await mkdir('test-results/dre', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true })
const errors = []
const today = todayBahia(), month = today.slice(0, 7), previous = shiftMonth(`${month}-01`, -1), previousMonth = previous.slice(0, 7)
// A day of this month that is never in the future (payments cannot be).
const day = (number) => { const date = `${month}-${String(number).padStart(2, '0')}`; return date > today ? today : date }
page.on('pageerror', (error) => errors.push(error.message))
page.on('dialog', async (dialog) => { errors.push(`Unexpected browser dialog: ${dialog.type()}`); await dialog.dismiss() })
const shot = (name) => page.screenshot({ path: `test-results/dre/${name}.png`, fullPage: true })
try {
  await (await fixture.serverModule('accountPlan.js')).ensureAccountPlan()
  const api = async (route, method, body) => { const result = await fixture.adminRequest(route, method, body); assert.ok(result.status < 400, `${route}: ${result.data?.message}`); return result.data }
  const { items } = await api('/classifications')
  const id = (code) => items.find((item) => item.code === code).id
  const supplier = (await api('/suppliers', 'POST', { name: 'Aço Bahia Distribuidora', document: '12345678000190' })).item
  const energy = (await api('/suppliers', 'POST', { name: 'Coelba', document: '15139629000194' })).item
  // Last month and this month: services and industrialization received, raw material, energy, salaries and taxes paid.
  for (const [date, code, value, iss] of [[previous, '7.01', '18500.00', '0'], [day(2), '7.02', '24300.00', '1215.00'], [day(3), '7.03', '9800.00', '0']]) {
    const sale = (await api('/receivables', 'POST', { customerName: 'Nestlé Nordeste Alimentos e Bebidas Ltda', classificationId: id(code), issueDate: date, dueDate: date, value, iss, description: 'Manutenção de esteira' })).item
    await api(`/receivables/${sale.id}/receive`, 'POST', { date, method: 'transfer', iss })
  }
  for (const [date, code, value, interest] of [[previous, '1.01', '6200.00', '0'], [day(4), '1.01', '8450.00', '35.20'], [day(5), '1.08', '7300.00', '0'], [day(5), '2.01', '4100.00', '0'], [day(6), '3.05', '640.00', '0'], [day(7), '5.04', '730.00', '0'], [day(8), '5.05', '980.00', '0']]) {
    const bill = (await api('/payables', 'POST', { supplierId: supplier.id, classificationId: id(code), issueDate: date, dueDate: date, kind: 'normal', value, description: 'Compra do mês' })).items[0]
    await api(`/payables/${bill.id}/pay`, 'POST', { date, method: 'pix', interest })
  }
  await api('/payables', 'POST', { treasury: true, supplierId: energy.id, classificationId: id('1.23'), date: day(9), method: 'boleto', value: '2140.55', description: 'Energia da fábrica' })
  await api('/payables', 'POST', { treasury: true, supplierId: supplier.id, classificationId: id('6.04'), date: day(10), method: 'transfer', value: '15000.00', description: 'Compra de torno' })
  await api('/dre-adjustments', 'POST', { month: previousMonth, classificationId: id('1.26'), value: '1200.00', description: 'Depreciação das máquinas', repeat: 2, variation: '0' })

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  const sidebar = page.locator('.sidebar')
  const group = sidebar.getByRole('button', { name: 'Gestão Financeira', exact: true })
  if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  assert.deepEqual(await sidebar.locator('#sidebar-finance-menu .nav-item').allTextContents(), ['Contas a Pagar', 'Contas a Receber', 'Tesouraria', 'Fluxo de caixa', 'Baixa em Lote', 'Conciliação bancária', 'Business Intelligence', 'DRE', 'Ajustes da DRE', 'Grupos de contas', 'Classificações'])
  const navigate = (name) => sidebar.getByRole('button', { name, exact: true }).click()

  // DRE of the current month, compared with the previous one.
  await navigate('DRE')
  await page.getByRole('heading', { name: 'DRE', exact: true }).waitFor()
  const table = page.locator('.dre-table')
  await table.waitFor()
  const line = (label) => table.locator('tbody tr').filter({ has: page.locator('th', { hasText: label }) }).first()
  await line('Lucro líquido').waitFor()
  const cells = async (label) => (await line(label).locator('td').allInnerTexts()).map((text) => text.split('\n')[0].trim())
  assert.deepEqual((await cells('(+) Receita bruta')).slice(0, 2), ['18.500,00', '34.100,00'])
  assert.equal((await cells(/^5.02s*ISS$/))[1], '-1.215,00')
  assert.equal((await cells('Multas e juros por atraso'))[1], '-35,20', 'the interest paid leaves the raw material and goes to 4.05')
  // 34.100 − 1.215 − 730 − 8.450 − 7.300 − 2.140,55 − 1.200 − 4.100 − 640 − 35,20 − 980
  assert.equal((await cells('(=) Lucro líquido'))[1], '7.309,25')
  assert.equal(await line('Compra de máquinas e equipamentos').locator('td').nth(1).innerText(), '-15.000,00')
  assert.equal(await table.locator('tbody th', { hasText: 'Insumos solda' }).count(), 0, 'lines without values are hidden')
  await shot('01-dre-month')
  await page.getByLabel('Mostrar linhas zeradas').check()
  await table.locator('tbody th', { hasText: 'Insumos solda' }).waitFor()
  await page.getByLabel('Mostrar linhas zeradas').uncheck()

  // The entries behind a line, and the account opened from there.
  await line('Matéria-prima').click()
  const entries = page.getByRole('dialog')
  await entries.locator('.dre-entries-table').waitFor()
  assert.equal(await entries.locator('tbody tr').count(), 1)
  await shot('02-dre-entries')
  await entries.getByRole('button', { name: 'Fechar janela' }).click()

  await page.getByRole('button', { name: 'Período personalizado', exact: true }).click()
  await page.getByLabel('Mês inicial').fill(previousMonth)
  await page.getByLabel('Mês final').fill(month)
  await table.locator('thead th', { hasText: 'Total' }).waitFor()
  assert.equal((await cells('(+) Receita bruta')).at(-2), '52.600,00')
  await shot('03-dre-period')
  await page.getByRole('button', { name: 'Competência', exact: true }).click()
  await page.locator('.dre-report-heading', { hasText: 'Visão competência' }).waitFor()

  const download = (label) => Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label, exact: true }).click()]).then(([file]) => file)
  const pdf = await download('PDF')
  assert.match(pdf.suggestedFilename(), /^gmac-dre-.*\.pdf$/)
  await pdf.saveAs('test-results/dre/dre.pdf')
  const sheet = await download('Excel')
  await sheet.saveAs('test-results/dre/dre.xlsx')

  // Grupos de contas and Classificações.
  await navigate('Grupos de contas')
  await page.getByRole('heading', { name: 'Grupos de contas', exact: true }).waitFor()
  await page.locator('.account-plan-settings').waitFor()
  await shot('04-groups')
  await navigate('Classificações')
  await page.getByRole('heading', { name: 'Classificações', exact: true }).waitFor()
  await page.locator('.account-plan-group-row', { hasText: '1 · Custos de produção' }).waitFor()
  await page.getByRole('button', { name: 'Nova classificação', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Nova classificação', exact: true })
  await form.getByLabel('Grupo de contas').selectOption({ label: '1 · Custos de produção' })
  assert.equal(await form.getByLabel('Código').inputValue(), '1.27', 'the next free code of the group')
  await form.getByLabel('Nome da classificação').fill('Combustível de empilhadeira')
  await shot('05-classification-form')
  await form.getByRole('button', { name: 'Salvar', exact: true }).click()
  await form.waitFor({ state: 'detached' })
  await page.locator('.account-plan-table td', { hasText: 'Combustível de empilhadeira' }).waitFor()
  await shot('06-classifications')

  // Ajustes da DRE: a depreciation repeated for 6 months, 2% less each month.
  await navigate('Ajustes da DRE')
  await page.getByRole('heading', { name: 'Ajustes da DRE', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Novo ajuste', exact: true }).click()
  const adjustment = page.getByRole('dialog', { name: 'Novo ajuste da DRE', exact: true })
  await adjustment.getByLabel('Classificação').selectOption({ label: '1.26 · Depreciação da produção' })
  await adjustment.getByLabel('Valor').fill('1000,00')
  await adjustment.getByLabel('Descrição').fill('Depreciação do torno novo')
  await adjustment.getByLabel('Repetir por quantos meses').fill('6')
  await adjustment.getByLabel('Variação por mês (%)').fill('-2')
  await adjustment.locator('.dre-adjustment-preview li').nth(5).waitFor()
  assert.equal((await adjustment.locator('.dre-adjustment-preview li').nth(1).innerText()).replace(/\s+/g, ' ').trim().split(' ').slice(-2).join(' ').replace(/ /g, ' '), 'R$ 980,00')
  await shot('07-adjustment-form')
  await adjustment.getByRole('button', { name: 'Salvar 6 ajustes', exact: true }).click()
  await adjustment.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.dre-adjustments-table tbody tr').count(), 8)
  await shot('08-adjustments')

  // A new receivable takes a revenue classification; the dates suggest a prazo.
  await navigate('Contas a Receber')
  await page.getByRole('button', { name: 'Nova conta a receber', exact: true }).click()
  const receivable = page.getByRole('dialog', { name: 'Nova conta a receber', exact: true })
  const options = await receivable.getByLabel('Classificação', { exact: true }).locator('option').allTextContents()
  assert.ok(options.includes('7.02 · Receita de Serviços a Prazo') && options.includes('6.11 · Captação de empréstimos') && !options.includes('1.01 · Matéria-prima'), 'revenues and money outside the result only')
  await receivable.getByLabel('Classificação', { exact: true }).selectOption({ label: '7.01 · Receita de Serviços à Vista' })
  await receivable.getByLabel('Data prevista de recebimento').fill(shiftMonth(today, 1))
  await receivable.getByRole('button', { name: 'usar 7.02 · Receita de Serviços a Prazo' }).click()
  assert.equal(await receivable.getByLabel('Classificação', { exact: true }).locator('option:checked').innerText(), '7.02 · Receita de Serviços a Prazo')
  await shot('09-receivable-form')
  await receivable.getByRole('button', { name: 'Cancelar', exact: true }).click()

  // Dark mode.
  await navigate('DRE')
  await page.locator('.dre-table').waitFor()
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await shot('10-dre-dark')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.locator('.dre-table').waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the DRE scrolls inside its table, not the page')
  await shot('11-dre-mobile')

  assert.deepEqual(errors, [])
  await writeFile('test-results/dre/ok.txt', 'ok')
  console.log('dre browser test ok')
} finally {
  await browser.close()
  await fixture.close()
}
