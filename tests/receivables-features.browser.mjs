import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const day = (offset) => new Date(Date.parse(todayBahia()) + offset * 86400000).toISOString().slice(0, 10)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  for (let index = 0; index < 22; index++) await api('/receivables', 'POST', { customerName: `Cliente lote ${index}`, value: String(100 + index), dueDate: day(10 + index), description: `Lote ${index}` })
  await api('/receivables', 'POST', { customerName: 'Borrachas Vipal Nordeste S.A.', customerDocument: '07857217000161', value: '210', dueDate: day(2), description: 'Vence logo' })

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()

  // Bell: the reminder opens the receivable.
  await page.getByRole('button', { name: 'Notificações', exact: true }).click()
  const notice = page.locator('.notifications-payables button').filter({ hasText: 'A receber' })
  await notice.waitFor()
  assert.match(await notice.innerText(), /Vence em 2 dias[\s\S]*Borrachas Vipal Nordeste S\.A\./)
  await notice.click()
  await page.getByRole('dialog', { name: /^REC-/ }).getByText('Vence logo', { exact: true }).waitFor()
  await page.getByRole('dialog', { name: /^REC-/ }).getByRole('button', { name: 'Fechar janela', exact: true }).click()

  // Pagination, sorting, totals and due shortcuts.
  assert.match(await page.locator('.payable-pagination').innerText(), /23 contas · R\$\s2\.641,00[\s\S]*1 \/ 2/)
  await page.locator('.receivable-table thead').getByRole('button', { name: 'Valor' }).click()
  await page.locator('.receivable-table thead').getByRole('button', { name: 'Valor' }).click()
  assert.match(await page.locator('.receivable-table tbody tr').first().innerText(), /R\$\s210,00/)
  assert.match(await page.getByRole('group', { name: 'Situação' }).getByRole('button', { name: /Pendentes/ }).innerText(), /23[\s\S]*R\$\s2\.641,00/)
  await page.getByRole('group', { name: 'Vencimento' }).getByRole('button', { name: 'Próximos 7 dias', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.receivable-table tbody tr').length === 1)
  await page.getByRole('group', { name: 'Vencimento' }).getByRole('button', { name: 'Próximos 7 dias', exact: true }).click()
  await page.getByLabel('Busca rápida', { exact: true }).fill('07.857.217/0001-61')
  await page.waitForFunction(() => document.querySelectorAll('.receivable-table tbody tr').length === 1)
  await page.getByLabel('Busca rápida', { exact: true }).fill('121,00')
  await page.waitForFunction(() => document.querySelectorAll('.receivable-table tbody tr').length === 1 && document.querySelector('.receivable-table tbody tr').innerText.includes('Cliente lote 21'))
  await page.getByLabel('Busca rápida', { exact: true }).fill('')

  // Selection with total and bulk receipt.
  // Sorted by value (highest first): the Vipal bill (210) and lote 21 (121).
  await page.getByLabel('Selecionar REC-000023', { exact: true }).check()
  await page.getByLabel('Selecionar REC-000022', { exact: true }).check()
  assert.match(await page.locator('.payable-bulk-actions').innerText(), /2 selecionadas · R\$\s331,00/)
  await page.locator('.payable-bulk-actions').getByRole('button', { name: 'Dar baixa', exact: true }).click()
  const bulk = page.getByRole('dialog', { name: 'Confirmar recebimento em massa', exact: true })
  assert.equal(await bulk.getByLabel('Valor recebido').count(), 0)
  await bulk.getByRole('button', { name: 'Confirmar recebimento', exact: true }).click()
  await bulk.waitFor({ state: 'hidden' })
  assert.deepEqual((await api('/receivables')).data.items.filter((row) => row.receipt).map((row) => row.id).sort(), ['REC-000022', 'REC-000023'])

  // New contract: client registered in place, recurring months, attachment previewed.
  await page.getByRole('button', { name: 'Nova conta a receber', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Nova conta a receber', exact: true })
  await form.getByLabel('Descrição', { exact: true }).fill('Contrato de manutenção preventiva')
  await form.getByLabel('Classificação', { exact: true }).selectOption({ label: '98.01 · Receita de teste' })
  await form.getByRole('button', { name: 'Cadastrar cliente', exact: true }).click()
  const client = page.getByRole('dialog', { name: 'Novo cliente', exact: true })
  await client.getByLabel('Nome / razão social', { exact: true }).fill('Nestlé Nordeste Alimentos e Bebidas Ltda')
  await client.getByLabel('CPF/CNPJ', { exact: true }).fill('08334818000152')
  await client.getByLabel('E-mail', { exact: true }).fill('compras.nestle@clientes-teste.invalid')
  await client.getByRole('button', { name: 'Salvar cliente', exact: true }).click()
  await client.waitFor({ state: 'hidden' })
  assert.equal(await form.getByLabel('Descrição', { exact: true }).inputValue(), 'Contrato de manutenção preventiva', 'The draft survives client creation')
  assert.equal(await form.getByLabel('Cliente cadastrado', { exact: true }).locator('option:checked').innerText(), 'Nestlé Nordeste Alimentos e Bebidas Ltda')
  await form.getByRole('radio', { name: 'Contrato recorrente', exact: true }).check()
  await form.getByLabel('Valor', { exact: true }).fill('1.500,00')
  await form.getByLabel('Data de emissão', { exact: true }).fill(day(5))
  await form.getByLabel('Data prevista de recebimento', { exact: true }).fill(day(3))
  await form.getByText('A data prevista de recebimento não pode ser anterior à data de emissão.').waitFor()
  await form.getByLabel('Data prevista de recebimento', { exact: true }).fill(shiftMonth(day(5), 1))
  await form.getByText(`Serão criadas 12 contas de R$ 1.500,00, até ${shiftMonth(shiftMonth(day(5), 1), 11).split('-').reverse().join('/')}.`, { exact: false }).waitFor()
  await form.getByLabel('Anexos (NF, boleto, contrato)', { exact: true }).setInputFiles({ name: 'contrato.png', mimeType: 'image/png', buffer: png })
  await page.screenshot({ path: 'test-results/receivables-features-form.png' })
  await form.getByRole('button', { name: 'Salvar conta', exact: true }).click()
  await form.waitFor({ state: 'hidden' })
  const details = page.getByRole('dialog', { name: /^REC-/ })
  await details.getByText(/Contrato recorrente · Mensal · ocorrência 1 de 12/).waitFor()
  await details.getByRole('button', { name: 'Visualizar contrato.png', exact: true }).click()
  await page.getByRole('dialog', { name: 'contrato.png', exact: true }).getByRole('img', { name: 'contrato.png' }).waitFor()
  await page.getByRole('dialog', { name: 'contrato.png', exact: true }).getByRole('button', { name: 'Fechar', exact: true }).click()
  assert.equal((await api('/receivables')).data.items.filter((row) => row.description === 'Contrato de manutenção preventiva').length, 12)

  // Single receipt: typing the amount received fills the interest.
  await details.getByRole('button', { name: 'Dar baixa', exact: true }).click()
  const receipt = page.getByRole('dialog', { name: /^Dar baixa/ })
  await receipt.getByLabel('Valor recebido', { exact: true }).fill('1.530,00')
  assert.equal(await receipt.getByLabel('Juros (R$)', { exact: true }).inputValue(), '30,00')
  await receipt.getByLabel('Comprovantes', { exact: true }).setInputFiles({ name: 'pix.png', mimeType: 'image/png', buffer: png })
  await receipt.getByRole('button', { name: 'Confirmar recebimento', exact: true }).click()
  await details.getByRole('heading', { name: 'Recebimento', exact: true }).waitFor()
  assert.match(await details.innerText(), /Valor recebido\s+R\$\s1\.530,00/)
  assert.equal(await details.getByRole('button', { name: 'Visualizar pix.png', exact: true }).count(), 1)
  await details.getByRole('button', { name: 'Fechar janela', exact: true }).click()

  // Phone: compact toolbar and no horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(200)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const first = page.locator('.receivable-table tbody tr').first()
  assert.ok((await first.boundingBox()).y < 760, 'First receivable is visible without scrolling far')
  await page.screenshot({ path: 'test-results/receivables-features-mobile.png' })
  assert.deepEqual(errors, [])
  console.log('Receivables features: bell reminder, pagination, sorting, totals, due shortcuts, value/CNPJ search, selection sum, bulk receipt, inline client, recurring contract, issue-date rule, attachments preview, received amount and compact mobile passed.')
} catch (error) { await page.screenshot({ path: 'test-results/receivables-features-failure.png', fullPage: true }); throw error } finally { await browser.close(); await fixture.close() }
