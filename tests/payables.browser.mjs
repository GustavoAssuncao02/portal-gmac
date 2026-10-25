import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Bahia' })
const errors = []; page.on('pageerror', (e) => errors.push(e.message))
// Cadastros and Gestão Financeira are menu groups that may start collapsed.
const nav = async (name) => {
  const item = page.locator('.sidebar').getByRole('button', { name, exact: true })
  if (!await item.isVisible()) await page.locator('.sidebar').getByRole('button', { name: ['Fornecedores', 'Administradores', 'Funcionários', 'Clientes'].includes(name) ? 'Cadastros' : ['Serviços em andamento', 'Serviços concluídos', 'Ofertas e serviços'].includes(name) ? 'Operação' : 'Gestão Financeira', exact: true }).click()
  await item.click()
}
const modal = () => page.locator('dialog[open]').last()
const apiToken = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
const headers = { Authorization: `Bearer ${apiToken}` }
const req = (route, method, body) => fixture.request(route, method, body, headers)
async function fillAccount({ value = '300', date = todayBahia(), description = 'Energia do mes' } = {}) {
  await modal().getByLabel('Fornecedor', { exact: true }).selectOption({ label: 'Fornecedor teste' })
  await modal().getByLabel('Descrição', { exact: true }).fill(description)
  await modal().getByLabel('Classificação', { exact: true }).selectOption({ label: 'Energia' })
  await modal().getByLabel('Número do documento / boleto / nota fiscal', { exact: true }).fill('NF-001')
  await modal().getByLabel('Valor', { exact: true }).fill(value)
  await modal().getByLabel('Vencimento', { exact: true }).fill(date)
}
async function saveAccount() { await modal().getByRole('button', { name: 'Salvar conta', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.payable-form')) }
async function closeDialog() { await modal().getByRole('button', { name: 'Fechar janela', exact: true }).click() }
async function openRow(id) { await page.locator('.payable-table tbody tr').filter({ hasText: id }).click(); await modal().getByRole('heading', { name: 'Dados principais', exact: true }).waitFor() }

try {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await nav('Fornecedores'); await page.getByRole('button', { name: 'Novo fornecedor', exact: true }).click()
  await modal().getByLabel('Nome / razão social', { exact: true }).fill('Fornecedor teste')
  await modal().getByLabel('CPF/CNPJ', { exact: true }).fill('12345678000190')
  await modal().getByLabel('E-mail', { exact: true }).fill('supplier@example.invalid')
  await modal().getByLabel('Telefone', { exact: true }).fill('71999999999')
  await modal().getByRole('button', { name: 'Salvar', exact: true }).click(); await page.locator('.payable-table tbody tr').filter({ hasText: 'Fornecedor teste' }).waitFor()
  await nav('Classificações'); await page.getByRole('button', { name: 'Nova classificação', exact: true }).click()
  await modal().getByLabel('Nome da classificação', { exact: true }).fill('Energia'); await modal().getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.locator('.payable-table tbody tr').filter({ hasText: 'Energia' }).waitFor()
  await nav('Contas a Pagar'); await page.getByRole('button', { name: 'Nova conta a pagar', exact: true }).click()
  await fillAccount()
  await modal().getByLabel('Anexos', { exact: true }).setInputFiles({ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('Nota de teste') })
  await page.screenshot({ path: 'test-results/payable-create.png', fullPage: true })
  await saveAccount(); await openRow('PAG-000001')
  console.log('Payables: normal account and attachment verified')
  assert.ok((await modal().innerText()).includes('nota.txt'))
  await modal().getByRole('button', { name: 'Dar baixa', exact: true }).click()
  await modal().getByLabel('Juros (R$)', { exact: true }).fill('10')
  assert.equal(await modal().getByLabel('Desconto (R$)', { exact: true }).isDisabled(), true)
  assert.ok((await modal().locator('.payable-final').innerText()).includes('310,00'))
  await modal().getByLabel('Observação do pagamento', { exact: true }).fill('Pago pelo financeiro')
  await modal().getByLabel('Comprovantes', { exact: true }).setInputFiles({ name: 'comprovante.txt', mimeType: 'text/plain', buffer: Buffer.from('Pagamento confirmado') })
  await modal().getByRole('button', { name: 'Confirmar baixa', exact: true }).click()
  await modal().getByRole('heading', { name: 'Pagamento', exact: true }).waitFor()
  assert.equal(await modal().getByRole('button', { name: 'Editar', exact: true }).count(), 0, 'Paid accounts only show possible actions')
  assert.equal(await modal().getByRole('button', { name: 'Estornar baixa', exact: true }).count(), 1)
  assert.equal(await modal().getByLabel('Adicionar anexos', { exact: true }).isDisabled(), true)
  assert.ok((await modal().innerText()).includes('comprovante.txt'))
  await page.screenshot({ path: 'test-results/payable-paid-details.png', fullPage: true })
  for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); assert.ok(await modal().evaluate((el) => el.scrollWidth <= el.clientWidth)); assert.ok(await modal().locator('footer').evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight)); await page.screenshot({ path: `test-results/payable-details-${width}.png`, fullPage: true }) }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const pdfEvent = page.waitForEvent('download'); await modal().getByRole('button', { name: 'Mais ações', exact: true }).click(); await modal().getByRole('menuitem', { name: 'Gerar PDF individual', exact: true }).click(); await (await pdfEvent).saveAs('test-results/payable-individual.pdf')
  await modal().getByRole('button', { name: 'Estornar baixa', exact: true }).click()
  await modal().getByLabel('Motivo', { exact: true }).fill('Baixa registrada por engano'); await modal().getByRole('button', { name: 'Confirmar', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 1)
  await modal().getByRole('button', { name: 'Editar', exact: true }).click()
  await modal().getByLabel('Descrição', { exact: true }).fill('Energia corrigida'); await saveAccount()
  await modal().getByRole('heading', { name: 'Dados principais', exact: true }).waitFor(); await closeDialog()
  await page.getByRole('button', { name: 'Nova conta a pagar', exact: true }).click(); await fillAccount(); await modal().getByRole('button', { name: 'Salvar conta', exact: true }).click()
  await modal().getByRole('alert').waitFor(); assert.ok((await modal().getByRole('alert').innerText()).includes('duplicada')); await closeDialog()
  await page.getByRole('button', { name: 'Nova conta a pagar', exact: true }).click(); await fillAccount({ value: '100.01', date: '2027-01-31', description: 'Compra parcelada' })
  await modal().getByRole('radio', { name: 'Parcelada', exact: true }).check(); await modal().getByLabel('Quantidade de parcelas', { exact: true }).fill('3')
  assert.equal(await modal().getByLabel('Vencimento da parcela 2', { exact: true }).inputValue(), '2027-02-28')
  assert.equal(await modal().getByLabel('Vencimento da parcela 3', { exact: true }).inputValue(), '2027-03-31')
  await modal().getByLabel('Valor da parcela 1', { exact: true }).fill('1'); await modal().getByRole('button', { name: 'Salvar conta', exact: true }).click(); await modal().getByRole('alert').waitFor()
  await modal().getByLabel('Valor da parcela 1', { exact: true }).fill('33.34'); await saveAccount()
  await openRow('PAG-000002'); assert.ok((await modal().innerText()).includes('100,01')); assert.equal(await modal().locator('.payable-siblings button').count(), 3); await closeDialog()
  await page.getByRole('button', { name: 'Nova conta a pagar', exact: true }).click(); await fillAccount({ value: '80', description: 'Conta recorrente' }); await modal().getByRole('radio', { name: 'Recorrente', exact: true }).check(); await modal().getByLabel('Ocorrências futuras geradas agora', { exact: true }).fill('0'); await saveAccount()
  await openRow('PAG-000005'); await modal().getByRole('button', { name: 'Dar baixa', exact: true }).click(); await modal().getByLabel('Desconto (R$)', { exact: true }).fill('5')
  assert.equal(await modal().getByLabel('Juros (R$)', { exact: true }).isDisabled(), true)
  await modal().getByRole('button', { name: 'Confirmar baixa', exact: true }).click(); await modal().getByRole('heading', { name: 'Criar próxima conta recorrente?', exact: true }).waitFor(); await modal().getByRole('button', { name: 'Confirmar', exact: true }).click()
  assert.equal(await modal().getByLabel('Vencimento', { exact: true }).inputValue(), shiftMonth(todayBahia(), 1)); await saveAccount()
  await page.getByLabel('Busca rápida', { exact: true }).fill('Conta recorrente')
  await page.getByRole('checkbox', { name: 'Selecionar contas da página', exact: true }).check()
  const beforeBulkRecurrence = (await req('/payables')).data.items.length
  await page.getByRole('button', { name: 'Dar baixa', exact: true }).click(); await modal().getByRole('button', { name: 'Confirmar baixa', exact: true }).click()
  await modal().getByRole('heading', { name: 'Criar próxima conta recorrente?', exact: true }).waitFor(); await modal().getByRole('button', { name: 'Cancelar', exact: true }).click()
  assert.equal((await req('/payables')).data.items.length, beforeBulkRecurrence)
  await page.getByLabel('Busca rápida', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Nova conta a pagar', exact: true }).click(); await fillAccount({ value: '70', description: 'Salvar e continuar' })
  await modal().getByRole('button', { name: 'Salvar e criar outra', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('dialog select[aria-label="Fornecedor"]')?.value === '')
  assert.equal(await modal().getByLabel('Descrição', { exact: true }).inputValue(), ''); assert.equal(await modal().getByLabel('Valor', { exact: true }).inputValue(), ''); await closeDialog()
  const supplier = (await req('/suppliers')).data.items[0], category = (await req('/classifications')).data.items[0]
  console.log('Payables: individual payment, locks, reversal, installment, duplicate and recurrence verified')
  for (let i = 0; i < 26; i++) await req('/payables', 'POST', { supplierId: supplier.id, classificationId: category.id, issueDate: todayBahia(), dueDate: todayBahia(), value: String(i + 1), description: `Conta lote ${i}`, kind: 'normal' })
  await nav('Business Intelligence'); await page.getByRole('heading', { name: 'Resumo financeiro', exact: true }).waitFor(); await nav('Contas a Pagar')
  await page.getByRole('button', { name: 'Filtros', exact: true }).click(); await page.getByLabel('Fornecedor', { exact: true }).selectOption(supplier.id)
  await page.getByLabel('Busca rápida', { exact: true }).fill('Conta lote')
  await page.waitForFunction(() => document.querySelectorAll('.payable-table tbody tr').length === 20)
  await page.getByRole('checkbox', { name: 'Selecionar contas da página', exact: true }).check()
  await page.getByRole('button', { name: 'Selecionar todas as contas do filtro atual (26)', exact: true }).click()
  await page.getByRole('button', { name: 'Dar baixa', exact: true }).click(); assert.ok((await modal().innerText()).includes('26 contas selecionadas')); assert.equal(await modal().getByLabel('Juros (R$)', { exact: true }).count(), 0)
  await modal().getByRole('button', { name: 'Confirmar baixa', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  await page.getByRole('button', { name: /Pagas/, exact: false }).click(); await page.getByRole('checkbox', { name: 'Selecionar contas da página', exact: true }).check()
  await page.getByRole('button', { name: 'Selecionar todas as contas do filtro atual (26)', exact: true }).click(); await page.getByRole('button', { name: 'Desativar', exact: true }).click(); await modal().getByRole('button', { name: 'Confirmar', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  await page.getByRole('button', { name: /Desativadas/ }).click(); await page.getByLabel('Por página', { exact: true }).selectOption('50'); assert.equal(await page.locator('.payable-table tbody tr').count(), 26)
  for (const format of ['PDF', 'Excel']) { const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: format, exact: true }).click(); await (await downloadEvent).saveAs(`test-results/payable-filtered.${format === 'PDF' ? 'pdf' : 'xlsx'}`) }
  await page.getByRole('button', { name: 'Histórico geral', exact: true }).click(); await modal().getByText('Baixa em massa', { exact: false }).first().waitFor(); await closeDialog()
  await page.getByRole('button', { name: 'Notificações', exact: true }).click(); await page.locator('.notifications-payables').waitFor(); await page.locator('.notifications-payables button').first().click(); await modal().getByRole('heading', { name: 'Dados principais', exact: true }).waitFor(); await closeDialog()
  for (const screen of ['Contas a Pagar', 'Business Intelligence', 'Classificações', 'Fornecedores']) {
    await nav(screen)
    if (screen === 'Business Intelligence') { await page.locator('.payable-chart-bar').first().click(); assert.equal(await page.locator('.payable-chart-bar[aria-pressed=true]').count(), 1); await page.locator('.payable-chart-bar[aria-pressed=true]').click() }
    for (const [width, height] of [[1440, 1000], [900, 800], [390, 844], [320, 740]]) {
      await page.setViewportSize({ width, height }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${screen} fits ${width}`)
      await page.screenshot({ path: `test-results/payables-${screen === 'Contas a Pagar' ? 'accounts' : screen === 'Business Intelligence' ? 'bi' : screen === 'Classificações' ? 'classifications' : 'suppliers'}-${width}.png`, fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await nav('Contas a Pagar'); await page.getByRole('button', { name: 'Nova conta a pagar', exact: true }).click(); await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'test-results/payable-modal-mobile.png', fullPage: true }); assert.ok(await modal().evaluate((el) => el.scrollWidth <= el.clientWidth)); await closeDialog()
  assert.deepEqual(errors, []); console.log('Payables browser: registries, normal/installment/recurring accounts, files, payments, interest/discount, reversal, duplicate rejection, bulk, filters, exports, notifications, BI and responsive screens passed.')
} catch (error) { await page.screenshot({ path: 'test-results/payables-browser-failure.png', fullPage: true }); throw error }
finally { await browser.close(); await fixture.close() }
