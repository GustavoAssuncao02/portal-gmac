import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { stageLabel } from '../server/serviceStages.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const today = todayBahia(), first = shiftMonth(today, 1)
const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10)
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  await api('/clients', 'POST', { name: 'Nestlé Nordeste Alimentos e Bebidas Ltda', documentType: 'cnpj', document: '08334818000152', email: 'compras.nestle@clientes-teste.invalid' })
  const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { stages: ['painting'], materials: [], laborEntries: [], kind: 'service' })
  await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offer.deadline, serviceValue: 9000 } })
  const order = (await fixture.request(`/offers/${offer.id}/accept`, 'POST')).data.item
  await fixture.mutateStore((store) => { store.orders.find((item) => item.code === order.code).operation = { status: 'completed', completedAt: new Date().toISOString(), completionAcknowledgedAt: null, accumulatedMs: 0, activeSession: null, stages: [{ key: 'stage-0', name: stageLabel('painting') }], stageCounts: { 'stage-0': 10 } } })

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Contas a Receber', exact: true }).click()
  await page.getByRole('button', { name: 'Nova conta a receber', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Nova conta a receber', exact: true })
  await form.getByLabel('Cliente cadastrado', { exact: true }).selectOption({ label: 'Nestlé Nordeste Alimentos e Bebidas Ltda' })
  await form.getByLabel('Descrição', { exact: true }).fill('Acordo de manutenção anual')
  await form.getByLabel('Número do documento / boleto / nota fiscal', { exact: true }).fill('NF 5501')
  // A date before the issue date is refused before reaching the server; past dates after the issue are fine.
  await form.getByLabel('Valor', { exact: true }).fill('10.000,00')
  await form.getByLabel('Data prevista de recebimento', { exact: true }).fill(yesterday)
  assert.equal(await form.getByLabel('Data prevista de recebimento', { exact: true }).getAttribute('min'), today)
  assert.equal(await form.getByLabel('Data prevista de recebimento', { exact: true }).evaluate((input) => input.validity.valid), false)
  await form.getByText('A data prevista de recebimento não pode ser anterior à data de emissão.').waitFor()
  await form.getByLabel('Data de emissão', { exact: true }).fill(new Date(Date.parse(today) - 3 * 86400000).toISOString().slice(0, 10))
  assert.equal(await form.getByLabel('Data prevista de recebimento', { exact: true }).evaluate((input) => input.validity.valid), true)
  await form.getByRole('radio', { name: 'Recebimento parcelado', exact: true }).check()
  await form.getByLabel('Data da 1ª parcela', { exact: true }).fill(first)
  await form.getByLabel('Quantidade de parcelas', { exact: true }).fill('3')
  assert.equal(await form.getByLabel('Valor da parcela 1', { exact: true }).inputValue(), '3.333,34')
  assert.equal(await form.getByLabel('Valor da parcela 3', { exact: true }).inputValue(), '3.333,33')
  assert.equal(await form.getByLabel('Recebimento da parcela 3', { exact: true }).inputValue(), shiftMonth(first, 2))
  await form.getByLabel('Valor da parcela 1', { exact: true }).fill('4.000,00')
  await form.getByText(/diferença de .* para o total/).waitFor()
  await form.getByRole('button', { name: 'Salvar conta', exact: true }).click()
  await form.getByRole('alert').filter({ hasText: 'A soma das parcelas deve ser exatamente igual ao valor total.' }).waitFor()
  await form.getByLabel('Valor da parcela 1', { exact: true }).fill('3.334,00')
  await form.getByLabel('Valor da parcela 2', { exact: true }).fill('3.333,00')
  await form.getByLabel('Valor da parcela 3', { exact: true }).fill('3.333,00')
  await page.screenshot({ path: 'test-results/receivables-installments-form.png' })
  await form.getByRole('button', { name: 'Salvar conta', exact: true }).click()
  await form.waitFor({ state: 'hidden' })
  const details = page.getByRole('dialog', { name: /^REC-/ })
  await details.getByRole('heading', { name: 'Parcelas do recebimento', exact: true }).waitFor()
  assert.equal(await details.locator('.payable-siblings button').count(), 3)
  assert.ok((await details.innerText()).includes('Valor total do acordo'))
  await details.locator('.payable-siblings button').nth(2).click()
  await page.getByRole('dialog', { name: 'REC-000003', exact: true }).getByText('3 de 3', { exact: true }).waitFor()
  await page.screenshot({ path: 'test-results/receivables-installments-details.png' })
  await page.getByRole('dialog', { name: 'REC-000003', exact: true }).getByRole('button', { name: 'Fechar janela', exact: true }).click()
  assert.equal(await page.locator('.receivable-table tbody tr').filter({ hasText: 'Acordo de manutenção anual' }).count(), 3)
  assert.deepEqual(await page.locator('.receivable-table tbody td[data-label="Parcela"]').allTextContents(), ['1 de 3', '2 de 3', '3 de 3'])
  assert.deepEqual((await api('/receivables')).data.items.map((row) => row.valueCents), [333400, 333300, 333300])

  // Finishing an OS can also schedule installments.
  await page.locator('.sidebar').getByRole('button', { name: 'Serviços em andamento', exact: true }).click()
  await page.locator('.admin-os-table tbody tr').filter({ hasText: order.code }).getByRole('button', { name: 'Concluído', exact: true }).click()
  const schedule = page.getByRole('dialog', { name: 'Programar recebimento', exact: true })
  await schedule.getByRole('radio', { name: 'Recebimento parcelado', exact: true }).check()
  assert.equal(await schedule.getByLabel('Valor total a receber', { exact: true }).inputValue(), '9.000,00')
  await schedule.getByLabel('Data da 1ª parcela', { exact: true }).fill(first)
  await schedule.getByLabel('Quantidade de parcelas', { exact: true }).fill('3')
  await page.screenshot({ path: 'test-results/receivables-installments-os.png' })
  await schedule.getByRole('button', { name: 'Programar e concluir', exact: true }).click()
  await schedule.waitFor({ state: 'hidden' })
  const fromOrder = (await api('/receivables')).data.items.filter((row) => row.orderCode === order.code)
  assert.deepEqual(fromOrder.map((row) => [row.installmentNumber, row.valueCents, row.dueDate]), [[1, 300000, first], [2, 300000, shiftMonth(first, 1)], [3, 300000, shiftMonth(first, 2)]])
  assert.deepEqual(errors, [])
  console.log('Receivables installments: issue-date minimum, 10.000 in 3x with exact sum, installment list and navigation, and OS scheduling in installments passed.')
} catch (error) { await page.screenshot({ path: 'test-results/receivables-installments-failure.png', fullPage: true }); throw error } finally { await browser.close(); await fixture.close() }
