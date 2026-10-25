import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { openOrder, typeOperatorCode } from './operatorEntry.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
await mkdir('test-results', { recursive: true })
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const errors = []

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  page.on('pageerror', (error) => errors.push(error.message))
  return page
}

async function signIn(page, cpf, password) {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(cpf)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
}

async function openRegistration(page, name) {
  const item = page.locator('.sidebar').getByRole('button', { name, exact: true })
  if (!await item.isVisible()) await page.locator('.sidebar').getByRole('button', { name: 'Cadastros', exact: true }).click()
  await item.click()
}

async function fillEmployee(form, index, name) {
  await form.getByLabel(/^Nome completo/).fill(name)
  if (await form.getByLabel(/^Identificação/).count()) await form.getByLabel(/^Identificação/).fill(`00${index}`)
  await form.getByLabel(/^Data de nascimento/).fill('1990-01-01')
  await form.getByLabel(/^CPF/).fill(`0000000000${index}`)
  await form.getByLabel(/^E-mail/).fill(`funcionario${index}@example.invalid`)
}

try {
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno 01' }] })
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'], stageResources: { turning: { type: 'machine', id: 'torno' } } })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item

  const admin = await newPage()
  await signIn(admin, env.DEMO_ADMIN_CPF, env.DEMO_ADMIN_PASSWORD)
  await admin.locator('.sidebar').getByRole('button', { name: 'Gestão Financeira', exact: true }).waitFor()
  await openRegistration(admin, 'Funcionários')
  // Same pattern as Fornecedores: the list on screen, adding in a modal.
  await admin.getByRole('button', { name: 'Novo funcionário', exact: true }).click()
  let form = admin.getByRole('dialog', { name: 'Novo funcionário' })
  await fillEmployee(form, 1, 'Ana Operadora')
  assert.equal(await form.getByLabel(/^Senha/).count(), 0, 'operators have no password')
  await form.getByRole('button', { name: 'Gerar código', exact: true }).click()
  const code = await form.getByLabel(/^Código de acesso/).inputValue()
  assert.match(code, /^\d{4}$/)
  await admin.screenshot({ path: 'test-results/employee-access-operator-form.png', fullPage: true })
  await form.getByRole('button', { name: 'Salvar', exact: true }).click()
  await admin.getByText('Funcionário cadastrado com sucesso.', { exact: true }).waitFor()
  const anaRow = admin.locator('.registration-table tbody tr').filter({ hasText: 'Ana Operadora' })
  // Type and code have their own columns.
  assert.equal(await anaRow.locator('td[data-label="Tipo"]').innerText(), 'Operador')
  assert.equal(await anaRow.locator('td[data-label="Código"]').innerText(), code)

  await admin.getByRole('button', { name: 'Novo funcionário', exact: true }).click()
  form = admin.getByRole('dialog', { name: 'Novo funcionário' })
  await form.getByLabel(/^Tipo de funcionário/).selectOption('administrative')
  assert.equal(await form.getByLabel(/^Identificação/).count(), 0, 'administrative employees have no 3-digit identification')
  await fillEmployee(form, 2, 'Bruno Administrativo')
  assert.equal(await form.getByLabel(/^Código de acesso/).count(), 0, 'administrative employees have no operator code')
  assert.equal(await form.getByLabel(/^Senha/).evaluate((input) => input.required), true)
  await form.getByLabel(/^Senha/).fill('senha123')
  await form.getByRole('button', { name: 'Salvar', exact: true }).click()
  await admin.getByText('Funcionário cadastrado com sucesso.', { exact: true }).waitFor()
  assert.match(await admin.locator('.registration-table tbody tr').filter({ hasText: 'Bruno Administrativo' }).innerText(), /Administrativo/)
  await admin.screenshot({ path: 'test-results/employee-access-list.png', fullPage: true })
  await admin.locator('.sidebar').getByRole('button', { name: 'Sair', exact: true }).click()

  await signIn(admin, '00000000002', 'senha123')
  const sidebar = admin.locator('.sidebar')
  assert.equal(await sidebar.getByRole('button', { name: 'Gestão Financeira', exact: true }).count(), 0)
  assert.equal(await sidebar.locator('.account-copy span').innerText(), 'Administrativo')
  assert.equal(await admin.locator('.home-payables').count(), 0, 'the home page has no payable summary')
  await admin.screenshot({ path: 'test-results/employee-access-staff-home.png', fullPage: true })
  await openRegistration(admin, 'Fornecedores')
  await admin.getByRole('heading', { name: 'Fornecedores', exact: true }).waitFor()
  await admin.getByRole('button', { name: 'Novo fornecedor' }).waitFor()
  assert.equal(await admin.locator('.admin-tool-error').count(), 0)
  await admin.reload()
  await admin.getByRole('heading', { name: 'Fornecedores', exact: true }).waitFor()
  assert.equal(await sidebar.getByRole('button', { name: 'Gestão Financeira', exact: true }).count(), 0, 'reloading keeps the restricted menu')
  await admin.close()

  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await context.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
  const operator = await context.newPage()
  operator.on('pageerror', (error) => errors.push(error.message))
  await operator.goto(fixture.url)
  await operator.locator('.operator-entry').waitFor()
  assert.equal(await operator.locator('.operator-project').count(), 0)
  await operator.screenshot({ path: 'test-results/employee-access-operator-entry.png' })
  await operator.getByRole('button', { name: 'Entrar', exact: true }).click()
  assert.equal(await operator.locator('.operator-entry input').count(), 0, 'only the on-screen keypad is used')
  assert.equal(await operator.getByRole('button', { name: 'OK', exact: true }).isDisabled(), true)
  await typeOperatorCode(operator, code === '0000' ? '9999' : '0000')
  await operator.getByRole('alert').filter({ hasText: 'Código não encontrado. Confira os 4 dígitos.' }).waitFor()
  assert.equal(await operator.locator('.operator-code-dots .filled').count(), 0, 'a wrong code clears the digits')
  await operator.screenshot({ path: 'test-results/employee-access-operator-keypad.png' })
  await operator.keyboard.type(code)
  await operator.keyboard.press('Enter')
  await operator.locator('.operator-entry').waitFor({ state: 'detached' })
  await operator.getByRole('heading', { name: 'Selecione uma OS', exact: true }).waitFor()
  assert.equal(await operator.locator('.operator-detail').count(), 0, 'no OS is open before the operator chooses one')
  assert.equal(await operator.locator('.operator-sidebar-bottom strong').innerText(), 'Ana Operadora')
  await operator.screenshot({ path: 'test-results/operator-flow-list.png' })
  await openOrder(operator, order.service)
  assert.equal(await operator.locator('.operator-project').count(), 0, 'the OS list gives way to the OS')
  // The stage brings the machine planned in the offer: the operator does not choose it.
  const start = operator.getByRole('button', { name: /Iniciar trabalho/ })
  await operator.locator('.operator-step--resource').getByText('Máquina: Torno 01', { exact: true }).waitFor()
  assert.equal(await start.isEnabled(), true, 'the planned machine is enough to start')
  assert.equal(await operator.getByRole('button', { name: /Concluir serviço/ }).isDisabled(), true)
  await operator.screenshot({ path: 'test-results/operator-flow-order.png' })
  await start.click()
  await operator.locator('.operator-worker').filter({ hasText: 'Ana Operadora' }).waitFor()
  await operator.getByRole('button', { name: /Pausar trabalho/ }).first().waitFor()
  await operator.screenshot({ path: 'test-results/operator-flow-working.png' })
  await operator.locator('.operator-stage-action input').first().fill(String(order.quantity))
  await operator.locator('.operator-stage-action button').first().click()
  const finish = operator.getByRole('dialog')
  await finish.getByRole('heading', { name: 'Concluir serviço', exact: true }).waitFor()
  await operator.screenshot({ path: 'test-results/operator-flow-finish.png' })
  await finish.getByRole('button', { name: 'Fechar', exact: true }).click()
  assert.equal(await operator.getByRole('button', { name: /Concluir serviço/ }).isEnabled(), true, 'the service can still be completed later')
  await operator.getByRole('button', { name: '← Voltar para as OS', exact: true }).click()
  await operator.getByRole('heading', { name: 'Selecione uma OS', exact: true }).waitFor()
  const mine = operator.getByRole('group', { name: 'OS em que você está trabalhando' })
  await mine.getByText(order.code, { exact: false }).waitFor()
  await operator.screenshot({ path: 'test-results/operator-flow-list-mine.png' })
  await operator.reload()
  await operator.getByRole('heading', { name: 'Selecione uma OS', exact: true }).waitFor()
  assert.equal(await operator.locator('.operator-entry').count(), 0, 'reloading keeps the identified operator')
  await context.close()

  assert.deepEqual(errors, [])
  console.log('Employee access passed: operator code generated in the form, administrative login without Gestão Financeira, operator entry by code.')
} finally {
  await browser.close()
  await fixture.close()
}
