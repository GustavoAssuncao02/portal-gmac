import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { sicoobOfx } from './ofxSample.js'

// The reconciliation of a month is closed with a justification for what is pending, locked, consulted, reopened and deleted.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Gestão Financeira', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Conciliação bancária', exact: true }).click()
  await page.getByText('Nenhuma conciliação encerrada ainda.', { exact: false }).waitFor({ state: 'detached', timeout: 1 }).catch(() => {})
  await page.getByLabel('Arquivo OFX', { exact: true }).setInputFiles({ name: 'sicoob.ofx', mimeType: 'application/x-ofx', buffer: sicoobOfx() })
  const bar = page.getByRole('region', { name: 'Encerramento da conciliação', exact: true })
  await bar.getByText('Conciliação em aberto', { exact: true }).waitFor()
  assert.equal(await page.getByRole('combobox', { name: 'Mês da conciliação', exact: true }).inputValue(), '2026-10')
  assert.match(await bar.innerText(), /5 movimentações · 0 conciliadas · 3 pendentes · 2 de aplicação\/resgate/)

  await bar.getByRole('button', { name: 'Encerrar conciliação', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Encerrar conciliação · outubro de 2026', exact: true })
  assert.match(await dialog.innerText(), /3 movimentações continuam sem conciliação/)
  await dialog.getByRole('button', { name: 'Encerrar conciliação', exact: true }).click()
  assert.equal(await dialog.isVisible(), true, 'the justification is required while something is pending')
  await dialog.getByLabel('Justificativa das pendências', { exact: true }).fill('Lançamentos ainda não cadastrados no financeiro.')
  await page.screenshot({ path: 'test-results/bank-closing-dialog.png' })
  await dialog.getByRole('button', { name: 'Encerrar conciliação', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  await bar.getByText('Conciliação encerrada · CON-000001', { exact: true }).waitFor()
  const conciliate = page.locator('.bank-transactions tbody').getByRole('button', { name: 'Conciliar', exact: true })
  assert.deepEqual(await conciliate.evaluateAll((buttons) => buttons.map((button) => button.disabled)), [true, true, true, true, true], 'a closed month is locked')
  assert.match(await page.getByRole('combobox', { name: 'Mês da conciliação', exact: true }).locator('option:checked').innerText(), /encerrada/)
  const closings = page.locator('.bank-closings li')
  assert.match(await closings.first().innerText(), /CON-000001 · outubro de 2026[\s\S]*Sicoob \(756\)[\s\S]*0 conciliadas · 3 pendentes[\s\S]*Encerrada/)
  await page.screenshot({ path: 'test-results/bank-closing-closed.png', fullPage: true })

  await closings.first().getByRole('button', { name: 'Ver CON-000001', exact: true }).click()
  const details = page.getByRole('dialog', { name: 'CON-000001 · Conciliação de outubro de 2026', exact: true })
  assert.equal(await details.locator('.bank-closing-items tbody tr').count(), 5)
  assert.match(await details.innerText(), /Lançamentos ainda não cadastrados no financeiro\.[\s\S]*Pendente[\s\S]*Movimentação interna/)
  await details.getByRole('button', { name: 'Fechar janela', exact: true }).click()

  await bar.getByRole('button', { name: 'Reabrir para editar', exact: true }).click()
  const reopen = page.getByRole('dialog', { name: 'Reabrir CON-000001 · outubro de 2026', exact: true })
  await reopen.getByLabel('Motivo', { exact: true }).fill('Vou lançar as contas que faltaram.')
  await reopen.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await bar.getByText('Conciliação reaberta · CON-000001', { exact: true }).waitFor()
  assert.equal(await conciliate.first().isEnabled(), true, 'reopened, the month can be reconciled again')
  assert.ok(await bar.getByRole('button', { name: 'Encerrar novamente', exact: true }).isVisible())

  await closings.first().getByRole('button', { name: 'Excluir CON-000001', exact: true }).click()
  await page.getByRole('dialog', { name: 'Excluir CON-000001 · outubro de 2026', exact: true }).getByRole('button', { name: 'Confirmar', exact: true }).click()
  await page.getByText('Nenhuma conciliação encerrada ainda.', { exact: false }).waitFor()
  await bar.getByText('Conciliação em aberto', { exact: true }).waitFor()
  // Phone: the closing bar and the list keep within the screen.
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(errors, [])
  console.log('Bank closing passed: justification for pending movements, locked month, consultation, reopening with reason, deletion and phone layout.')
} catch (error) {
  await page.screenshot({ path: 'test-results/bank-closing-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
