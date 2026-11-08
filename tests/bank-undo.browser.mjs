import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { sicoobOfx } from './ofxSample.js'

// "Desconciliar tudo" beside "Conciliar tudo", and "Excluir lote" for an OFX imported by mistake, each confirmed first.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
await fixture.mutateStore((store) => {
  store.receivables = [{ id: 'REC-000001', origin: 'manual', kind: 'single', customerName: 'Cliente Exemplo Indústria e Comércio Ltda', customerDocument: null, description: '', documentNumber: '', issueDate: '2026-09-20', dueDate: '2026-10-01', valueCents: 157500, issCents: 7500, receipt: null, inactive: false, attachments: [], createdAt: '2026-09-20T12:00:00.000Z' }]
  store.receivableSequence = 1
})
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
  await page.getByLabel('Arquivo OFX', { exact: true }).setInputFiles({ name: 'sicoob-errado.ofx', mimeType: 'application/x-ofx', buffer: sicoobOfx() })
  const undoAll = page.getByRole('button', { name: 'Desconciliar tudo', exact: true })
  await undoAll.waitFor()
  assert.equal(await undoAll.isDisabled(), true, 'nothing linked yet')
  const rowOf = (text) => page.locator('.bank-transactions tbody tr').filter({ hasText: text })
  await rowOf('CRÉD.TED-STR').getByRole('button', { name: 'Conciliar', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Conciliar movimentação', exact: true })
  await modal.locator('.bank-candidates > li').filter({ hasText: 'REC-000001' }).getByRole('button', { name: 'Conciliar', exact: true }).click()
  await modal.waitFor({ state: 'detached' })

  await undoAll.click()
  const confirm = page.getByRole('dialog', { name: 'Desconciliar tudo', exact: true })
  assert.match(await confirm.innerText(), /Os vínculos de 1 movimentação de [\s\S]* em outubro de 2026 serão desfeitos/)
  await page.screenshot({ path: 'test-results/bank-undo-all.png' })
  await confirm.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await confirm.waitFor({ state: 'detached' })
  await page.getByText('1 vínculo desfeito.', { exact: true }).waitFor()
  assert.equal(await rowOf('CRÉD.TED-STR').getByRole('button', { name: 'Conciliar', exact: true }).isVisible(), true)

  await page.getByRole('button', { name: 'Excluir lote EXT-000001', exact: true }).click()
  const remove = page.getByRole('dialog', { name: 'Excluir lote EXT-000001', exact: true })
  assert.match(await remove.innerText(), /O arquivo sicoob-errado\.ofx sai da conciliação: as \d+ movimentações que vieram só nele são removidas/)
  await page.screenshot({ path: 'test-results/bank-remove-batch.png' })
  await remove.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await remove.waitFor({ state: 'detached' })
  await page.getByText(/Nenhum extrato importado/).waitFor()
  assert.equal(await fixture.mutateStore((store) => store.bankTransactions.length), 0)
  assert.deepEqual(errors, [])
  console.log('Bank undo passed: "Desconciliar tudo" with confirmation and "Excluir lote" removing the OFX imported by mistake.')
} catch (error) {
  await page.screenshot({ path: 'test-results/bank-undo-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
