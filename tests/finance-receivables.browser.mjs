import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'
import { stageLabel } from '../server/serviceStages.js'
import { sampleOfx, sampleRows } from './ofxSample.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
// Expected receipt dates cannot be in the past, so the scenario follows the current month.
const nextMonth = shiftMonth(todayBahia(), 1), later = shiftMonth(todayBahia(), 2)
const brDate = (value) => value.split('-').reverse().join('/')
const monthLabel = (value) => new Date(`${value.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', '').replace(' de ', '/')
page.on('pageerror', (error) => errors.push(error.message))
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { stages: ['painting'], materials: [], laborEntries: [], kind: 'service' })
  await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offer.deadline, serviceValue: 1250.5 } })
  const order = (await fixture.request(`/offers/${offer.id}/accept`, 'POST')).data.item
  await fixture.mutateStore((store) => { const row = store.orders.find((item) => item.code === order.code); row.proposal.discount = 10; row.operation = { status: 'completed', completedAt: '2026-10-06T15:00:00Z', completionAcknowledgedAt: null, accumulatedMs: 3600000, activeSession: null, stages: [{ key: 'stage-0', name: stageLabel('painting') }], stageCounts: { 'stage-0': 10 } } })
  const category = (await api('/classifications', 'POST', { name: 'Beneficios' })).data.item
  const sodexo = (await api('/suppliers', 'POST', { name: 'Sodexo Pass do Brasil', document: '49930514000135' })).data.item
  const other = (await api('/suppliers', 'POST', { name: 'Fornecedor quimico', document: '12345678000190' })).data.item
  for (const supplier of [sodexo, other]) await api('/payables', 'POST', { supplierId: supplier.id, classificationId: category.id, issueDate: '2026-09-01', value: '800.00', dueDate: '2026-10-01', kind: 'normal' })

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  const navigate = (name) => page.locator('.sidebar').getByRole('button', { name, exact: true }).click()
  const file = { name: 'extrato.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(sampleOfx(sampleRows), 'latin1') }

  await navigate('Conciliação bancária')
  await page.getByLabel('Arquivo OFX', { exact: true }).setInputFiles(file)
  const result = page.locator('.bank-import-result')
  await result.waitFor()
  assert.doesNotMatch(await result.innerText(), /Divergência de saldo/, 'R$ 0,18 is below the R$ 10,00 warning threshold')
  assert.match(await result.innerText(), /6 movimentações[\s\S]*2 posições de saldo[\s\S]*6\s*movimentações novas/)
  assert.match(await result.innerText(), /windows-1252/, 'Encoding fallback is reported')
  assert.equal(await page.locator('.bank-transactions tbody tr').count(), 6)
  assert.equal(await page.locator('.bank-balances li').count(), 2)
  assert.ok(await page.getByText('SALDO TOTAL DISPONÍVEL DIA', { exact: false }).first().isVisible(), 'Accents survive the windows-1252 fallback')
  await page.getByLabel('Arquivo OFX', { exact: true }).setInputFiles(file)
  await result.locator('h2', { hasText: 'EXT-000002' }).waitFor()
  assert.match(await result.innerText(), /0\s*movimentações novas · 6\s*já existentes/)
  assert.equal(await page.locator('.bank-transactions tbody tr').count(), 6)
  await page.screenshot({ path: 'test-results/finance-bank-import.png', fullPage: true })

  await page.getByLabel('Buscar movimentações', { exact: true }).fill('sodexo')
  await page.locator('.bank-transactions tbody tr').getByRole('button', { name: 'Conciliar', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Conciliar movimentação', exact: true })
  const candidates = dialog.locator('.bank-candidates > li')
  await candidates.first().waitFor()
  assert.equal(await candidates.count(), 2)
  assert.match(await candidates.first().innerText(), /Sodexo[\s\S]*CNPJ coincide[\s\S]*Forte/)
  assert.match(await candidates.nth(1).innerText(), /Fraca/)
  await candidates.first().getByRole('button', { name: 'Conciliar', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.locator('.bank-linked').getByText('PAG-000001').waitFor()
  await page.getByLabel('Buscar movimentações', { exact: true }).fill('quiravelli')
  await page.locator('.bank-transactions tbody tr').getByRole('button', { name: 'Conciliar', exact: true }).click()
  await candidates.first().waitFor()
  assert.equal(await candidates.count(), 1, 'A reconciled payable is not offered again')
  await dialog.getByRole('button', { name: 'Fechar janela', exact: true }).click()

  await navigate('Serviços em andamento')
  const row = page.locator('.admin-os-table tbody tr').filter({ hasText: order.code })
  await row.getByRole('button', { name: 'Concluído', exact: true }).click()
  const schedule = page.getByRole('dialog', { name: 'Programar recebimento', exact: true })
  await schedule.getByLabel('Valor a receber', { exact: true }).waitFor()
  assert.equal(await schedule.getByLabel('Valor a receber', { exact: true }).inputValue(), '1.125,45', 'Defaults to the OS value after discount')
  await schedule.getByLabel('Valor a receber', { exact: true }).fill('1100')
  await schedule.getByLabel('Data prevista de recebimento', { exact: true }).fill(nextMonth)
  await schedule.getByRole('button', { name: 'Programar e concluir', exact: true }).click()
  await row.waitFor({ state: 'detached' })

  await navigate('Contas a Receber')
  const receivable = page.locator('.receivable-table tbody tr').filter({ hasText: order.code })
  await receivable.waitFor()
  assert.ok((await receivable.innerText()).includes(brDate(nextMonth)))
  assert.match(await receivable.innerText(), /REC-000001[\s\S]*R\$\s1\.100,00/)
  await page.getByRole('button', { name: 'Nova conta a receber', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Nova conta a receber', exact: true })
  await form.getByLabel('Nome do pagador', { exact: true }).fill('Cliente avulso')
  await form.getByLabel('Valor', { exact: true }).fill('250.10')
  await form.getByLabel('Data prevista de recebimento', { exact: true }).fill(later)
  await form.getByRole('button', { name: 'Salvar conta', exact: true }).click()
  const details = page.getByRole('dialog', { name: 'REC-000002', exact: true })
  await details.getByRole('button', { name: 'Dar baixa', exact: true }).click()
  const receipt = page.getByRole('dialog', { name: 'Dar baixa · REC-000002', exact: true })
  await receipt.getByRole('button', { name: 'Confirmar recebimento', exact: true }).click()
  await details.getByText('Recebimento baixado', { exact: true }).waitFor()
  await details.getByRole('button', { name: 'Fechar janela', exact: true }).click()
  await page.screenshot({ path: 'test-results/finance-receivables.png', fullPage: true })

  await navigate('Business Intelligence')
  const plot = page.locator('.finance-trend-plot svg')
  await plot.waitFor()
  assert.deepEqual(await page.locator('.finance-trend-legend li').allTextContents(), ['Contas a receber', 'Contas a pagar'])
  await plot.focus()
  await page.keyboard.press('End')
  await page.locator('.finance-trend-tooltip').waitFor()
  await page.getByRole('button', { name: 'Ver tabela', exact: true }).click()
  const november = page.locator('.finance-trend-table tbody tr').filter({ hasText: monthLabel(nextMonth) })
  assert.match(await november.innerText(), /R\$\s1\.100,00/)
  for (const [width, height] of [[1920, 1080], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `BI fits ${width}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  for (const name of ['Conciliação bancária', 'Contas a Receber']) {
    await page.getByRole('button', { name: 'Abrir menu de navegação', exact: true }).click()
    await navigate(name)
    await page.getByRole('heading', { name, exact: true }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} fits 390`)
  }
  assert.deepEqual(errors, [])
  console.log('Finance browser: OFX import with encoding fallback and no warning for a R$ 0,18 gap, idempotent re-import, evidence-ranked reconciliation without reuse, OS completion scheduling, manual receivable and receipt, BI trend chart and responsive screens passed.')
} catch (error) { await page.screenshot({ path: 'test-results/finance-browser-failure.png', fullPage: true }); throw error } finally { await browser.close(); await fixture.close() }
