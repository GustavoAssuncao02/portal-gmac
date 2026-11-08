import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { sicoobOfx } from './ofxSample.js'

// Closing the reconciliation shows the settlements it will make (asking the way only where the statement does not say it),
// and undoing a link settled by the closing warns that the settlement will be reversed.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
await fixture.mutateStore((store) => {
  store.receivables = [{ id: 'REC-000001', origin: 'manual', kind: 'single', customerName: 'Cliente Exemplo Indústria e Comércio Ltda', customerDocument: null, description: '', documentNumber: '', issueDate: '2026-09-20', dueDate: '2026-10-01', valueCents: 157500, issCents: 7500, receipt: null, inactive: false, attachments: [], createdAt: '2026-09-20T12:00:00.000Z' }]
  store.receivableSequence = 1
  store.payables = [{ id: 'PAG-000001', supplierId: null, supplierName: 'Convênio Exemplo', description: '', documentNumber: '', issueDate: '2026-09-20', dueDate: '2026-10-01', valueCents: 35000, payment: null, inactive: false, attachments: [], createdAt: '2026-09-20T12:00:00.000Z' }]
  store.payableSequence = 1
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
  await page.getByLabel('Arquivo OFX', { exact: true }).setInputFiles({ name: 'sicoob.ofx', mimeType: 'application/x-ofx', buffer: sicoobOfx() })
  const bar = page.getByRole('region', { name: 'Encerramento da conciliação', exact: true })
  await bar.getByText('Conciliação em aberto', { exact: true }).waitFor()
  const rowOf = (text) => page.locator('.bank-transactions tbody tr').filter({ hasText: text })

  // The R$ 1.575,00 receivable with R$ 75,00 of ISS is offered for the R$ 1.500,00 TED.
  for (const [memo, id] of [['CRÉD.TED-STR', 'REC-000001'], ['DÉB.CONV', 'PAG-000001']]) {
    await rowOf(memo).getByRole('button', { name: 'Conciliar', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Conciliar movimentação', exact: true })
    await modal.locator('.bank-candidates > li').filter({ hasText: id }).getByRole('button', { name: 'Conciliar', exact: true }).click()
    await modal.waitFor({ state: 'detached' })
  }
  assert.match(await rowOf('CRÉD.TED-STR').innerText(), /REC-000001[\s\S]*Em aberto · será baixada ao encerrar/)

  await bar.getByRole('button', { name: 'Encerrar conciliação', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Encerrar conciliação · outubro de 2026', exact: true })
  const settlements = dialog.getByRole('region', { name: 'Baixas que serão feitas', exact: true })
  assert.match(await settlements.innerText(), /Baixas que serão feitas \(2\)[\s\S]*REC-000001[\s\S]*Recebimento em 01\/10\/2026 · R\$\s1\.500,00[\s\S]*Transferência[\s\S]*PAG-000001[\s\S]*Pagamento em 01\/10\/2026 · R\$\s350,00/)
  await dialog.getByLabel('Justificativa das pendências', { exact: true }).fill('PIX sem conta lançada no financeiro.')
  const submit = dialog.getByRole('button', { name: 'Encerrar e dar 2 baixas', exact: true })
  await submit.click()
  assert.equal(await dialog.isVisible(), true, 'the way of the convênio debit must be chosen')
  await dialog.getByLabel('Forma da baixa de PAG-000001', { exact: true }).selectOption('boleto')
  await page.screenshot({ path: 'test-results/bank-closing-settlements-dialog.png' })
  await submit.click()
  await dialog.waitFor({ state: 'detached' })
  await page.getByText('2 contas foram baixadas com a data e o valor do extrato.', { exact: false }).waitFor()
  await bar.getByText('Conciliação encerrada · CON-000001', { exact: true }).waitFor()
  assert.match(await rowOf('CRÉD.TED-STR').innerText(), /Baixada pelo encerramento/)

  // Reopened: undoing that link warns that the settlement will be reversed.
  await bar.getByRole('button', { name: 'Reabrir para editar', exact: true }).click()
  const reopen = page.getByRole('dialog', { name: 'Reabrir CON-000001 · outubro de 2026', exact: true })
  await reopen.getByLabel('Motivo', { exact: true }).fill('Conferir o recebimento do cliente.')
  await reopen.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await bar.getByText('Conciliação reaberta · CON-000001', { exact: true }).waitFor()
  await rowOf('CRÉD.TED-STR').getByRole('button', { name: 'Desfazer', exact: true }).click()
  const warning = page.getByRole('dialog', { name: 'Desfazer conciliação e estornar a baixa', exact: true })
  assert.match(await warning.innerText(), /A baixa de REC-000001 será estornada\.[\s\S]*volta a ficar em aberto em Contas a Receber/)
  await page.screenshot({ path: 'test-results/bank-closing-settlements-undo.png' })
  await warning.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await warning.waitFor({ state: 'detached' })
  await page.getByText('Vínculo desfeito. A baixa de REC-000001 foi estornada e a conta voltou a ficar em aberto.', { exact: true }).waitFor()
  assert.equal(await rowOf('CRÉD.TED-STR').getByRole('button', { name: 'Conciliar', exact: true }).isVisible(), true)
  assert.equal((await fixture.mutateStore((store) => store.receivables[0].receipt)), null)

  // Undone too, the convênio debit comes back to the closing with the way chosen last time already filled in.
  await rowOf('DÉB.CONV').getByRole('button', { name: 'Desfazer', exact: true }).click()
  await page.getByRole('dialog', { name: 'Desfazer conciliação e estornar a baixa', exact: true }).getByRole('button', { name: 'Confirmar', exact: true }).click()
  await page.getByText('A baixa de PAG-000001 foi estornada', { exact: false }).waitFor()
  await rowOf('DÉB.CONV').getByRole('button', { name: 'Conciliar', exact: true }).click()
  const relink = page.getByRole('dialog', { name: 'Conciliar movimentação', exact: true })
  await relink.locator('.bank-candidates > li').filter({ hasText: 'PAG-000001' }).getByRole('button', { name: 'Conciliar', exact: true }).click()
  await relink.waitFor({ state: 'detached' })
  // Phone: the closing dialog keeps within the screen.
  await page.setViewportSize({ width: 390, height: 844 })
  await bar.getByRole('button', { name: 'Encerrar novamente', exact: true }).click()
  const reclose = page.getByRole('dialog', { name: 'Encerrar conciliação · outubro de 2026', exact: true })
  assert.equal(await reclose.getByLabel('Forma da baixa de PAG-000001', { exact: true }).inputValue(), 'boleto')
  assert.match(await reclose.innerText(), /Mesma forma da última baixa de débito automático/)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: 'test-results/bank-closing-settlements-phone.png' })
  assert.deepEqual(errors, [])
  console.log('Bank closing settlements passed: net ISS match, settlements listed with the way from the statement or chosen, settled on closing, reversal warning on undo and phone layout.')
} catch (error) {
  await page.screenshot({ path: 'test-results/bank-closing-settlements-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
