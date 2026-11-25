import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { openSidebarItem } from './sidebarNavigation.js'
import { todayBahia } from '../server/payableRules.js'

// Baixa parcial (TCK-0011) on the screens: the choice between total and partial settlement, the balance staying open with its
// own due date, the paid part linked to it, the ISS choice of a receivable and the reversal giving the value back.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const errors = []
const day = (offset) => new Date(Date.parse(todayBahia()) + offset * 86400000).toISOString().slice(0, 10)
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  const supplier = (await api('/suppliers', 'POST', { name: 'Aços do Nordeste', document: '12345678000190' })).data.item
  const energy = (await api('/classifications', 'POST', { name: 'Energia' })).data.item
  await api('/payables', 'POST', { supplierId: supplier.id, classificationId: energy.id, issueDate: todayBahia(), value: '1000', dueDate: day(5), kind: 'normal', description: 'Compra de chapas' })
  await api('/receivables', 'POST', { customerName: 'Indústria Exemplo', value: '1575', iss: '75', dueDate: day(8), description: 'Serviço de usinagem' })

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()

  // --- Contas a Pagar
  await openSidebarItem(page, 'Contas a Pagar')
  await page.locator('.payable-table tbody tr').first().waitFor()
  await page.locator('.payable-table tbody tr').first().click()
  const details = page.getByRole('dialog', { name: 'PAG-000001', exact: true })
  await details.getByRole('button', { name: 'Dar baixa', exact: true }).click()
  const total = page.getByRole('dialog', { name: 'Dar baixa · PAG-000001', exact: true })
  assert.equal(await total.getByRole('button', { name: 'Baixa total', exact: true }).getAttribute('aria-pressed'), 'true')
  await total.getByRole('button', { name: 'Baixa parcial', exact: true }).click()
  const pay = page.getByRole('dialog', { name: 'Baixa parcial · PAG-000001', exact: true })
  await pay.getByLabel('Valor pago agora', { exact: true }).waitFor()
  assert.equal(await pay.getByLabel('Juros (R$)').count(), 0, 'interest and discount wait for the final settlement')
  await pay.getByLabel('Valor pago agora', { exact: true }).fill('400,00')
  assert.match(await pay.locator('.payable-final').innerText(), /R\$\s400,00 pago agora[\s\S]*R\$\s600,00/)
  await pay.getByLabel('Vencimento do saldo', { exact: true }).fill(day(20))
  await page.screenshot({ path: 'test-results/partial-payable-form.png' })
  // Paying all of it is the total settlement.
  await pay.getByLabel('Valor pago agora', { exact: true }).fill('1.000,00')
  await pay.getByRole('button', { name: 'Confirmar baixa parcial', exact: true }).click()
  await pay.getByRole('alert').waitFor()
  assert.match(await pay.getByRole('alert').innerText(), /menor que/)
  await pay.getByLabel('Valor pago agora', { exact: true }).fill('400,00')
  await pay.getByRole('button', { name: 'Confirmar baixa parcial', exact: true }).click()
  const open = page.getByRole('dialog', { name: 'PAG-000001', exact: true })
  await open.getByText('Saldo em aberto', { exact: true }).waitFor()
  const facts = await open.locator('.payable-facts').first().innerText()
  assert.match(facts, /Saldo em aberto\s+R\$\s600,00/)
  assert.match(facts, /Valor original\s+R\$\s1\.000,00/)
  assert.match(facts, /Já pago em baixas parciais\s+R\$\s400,00/)
  assert.match(facts, /Pendente · Parcial/)
  await open.getByRole('button', { name: /PAG-000002/ }).waitFor()
  assert.equal(await open.getByRole('button', { name: 'Editar', exact: true }).isDisabled(), true)
  assert.equal(await open.getByRole('button', { name: 'Excluir', exact: true }).isDisabled(), true)
  await page.screenshot({ path: 'test-results/partial-payable-details.png' })

  // The paid part is an account of its own, linked to the first one; reversing it gives the value back.
  await open.getByRole('button', { name: /PAG-000002/ }).click()
  const part = page.getByRole('dialog', { name: 'PAG-000002', exact: true })
  await part.getByText('Baixa parcial de', { exact: true }).waitFor()
  await part.getByRole('button', { name: 'Estornar baixa', exact: true }).click()
  await page.getByRole('dialog', { name: 'Estornar baixa', exact: true }).getByRole('textbox').fill('Lançada por engano na conta errada')
  await page.getByRole('dialog', { name: 'Estornar baixa', exact: true }).getByRole('button', { name: 'Confirmar', exact: true }).click()
  const back = page.getByRole('dialog', { name: 'PAG-000001', exact: true })
  await back.getByText('Valor', { exact: true }).first().waitFor()
  assert.match(await back.locator('.payable-facts').first().innerText(), /Valor\s+R\$\s1\.000,00/)
  await back.getByRole('button', { name: 'Fechar janela', exact: true }).click()

  // --- Contas a Receber
  await openSidebarItem(page, 'Contas a Receber')
  await page.locator('.receivable-table tbody tr').first().waitFor()
  await page.locator('.receivable-table tbody tr').first().click()
  await page.getByRole('dialog', { name: 'REC-000001', exact: true }).getByRole('button', { name: 'Dar baixa', exact: true }).click()
  await page.getByRole('dialog', { name: 'Dar baixa · REC-000001', exact: true }).getByRole('button', { name: 'Baixa parcial', exact: true }).click()
  const receive = page.getByRole('dialog', { name: 'Baixa parcial · REC-000001', exact: true })
  await receive.getByLabel('Valor recebido agora', { exact: true }).fill('500,00')
  await receive.getByLabel('Vencimento do saldo', { exact: true }).fill(day(30))
  assert.equal(await receive.getByLabel('Sai no último recebimento').isChecked(), true, 'the ISS leaves with the last receipt unless the user chooses otherwise')
  assert.match(await receive.locator('.payable-final').innerText(), /R\$\s1\.075,00/)
  await receive.getByLabel('Sai neste recebimento').check()
  assert.match(await receive.locator('.payable-final').innerText(), /R\$\s500,00 recebidos \+ R\$\s75,00 de ISS[\s\S]*R\$\s1\.000,00/)
  await page.screenshot({ path: 'test-results/partial-receivable-form.png' })
  await receive.getByRole('button', { name: 'Confirmar recebimento parcial', exact: true }).click()
  const received = page.getByRole('dialog', { name: 'REC-000001', exact: true })
  await received.getByText('Saldo em aberto', { exact: true }).waitFor()
  const receivedFacts = await received.locator('.payable-facts').first().innerText()
  assert.match(receivedFacts, /Saldo em aberto\s+R\$\s1\.000,00/)
  assert.match(receivedFacts, /Valor original\s+R\$\s1\.575,00/)
  assert.match(receivedFacts, /ISS já retido\s+R\$\s75,00/)
  assert.doesNotMatch(receivedFacts, /ISS retido previsto/, 'the ISS already left, the balance has none')
  await page.screenshot({ path: 'test-results/partial-receivable-details.png' })
  await received.getByRole('button', { name: 'Fechar janela', exact: true }).click()

  // Phone width: the choice and the fields fit without scrolling sideways.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.receivable-table tbody tr, .receivable-card, .payable-card').first().waitFor().catch(() => {})
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0)
  assert.deepEqual(errors, [])
  console.log('Baixa parcial passed: choice between total and partial, balance with its own due date, linked paid part, ISS choice, reversal and phone width.')
} finally {
  await browser.close()
  await fixture.close()
}
