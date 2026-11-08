import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { invoicePdf, sampleNfse, sampleNfe } from './invoiceSample.js'

// "Importar notas (PDF)": the invoices read are shown to be checked, with 7.02 for the NFS-e and 7.04 for the NF-e; a
// client not registered must be registered first (with the name and CNPJ of the invoice); then each one is posted.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env, fillClassifications: false })
await (await fixture.serverModule('accountPlan.js')).ensureAccountPlan()
await fixture.adminRequest('/clients', 'POST', { name: 'Cliente Exemplo Serviços Ltda', document: sampleNfse.document, documentType: 'cnpj' })
await mkdir('test-results', { recursive: true })
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
  await page.locator('.sidebar').getByRole('button', { name: 'Contas a Receber', exact: true }).click()
  await page.getByRole('button', { name: 'Nova conta a receber', exact: true }).waitFor()
  await page.getByLabel('PDF das notas', { exact: true }).setInputFiles({ name: 'notas.pdf', mimeType: 'application/pdf', buffer: await invoicePdf([sampleNfse, sampleNfe]) })

  const dialog = page.getByRole('dialog', { name: 'Importar notas (PDF)', exact: true })
  const service = dialog.getByRole('article', { name: 'NFS-e 2026000000451', exact: true }), product = dialog.getByRole('article', { name: 'NF-e 000.000.915', exact: true })
  await service.waitFor()
  assert.match(await service.innerText(), /Cliente[\s\S]*Cliente Exemplo Serviços Ltda[\s\S]*11\.222\.333\/0001-81/)
  assert.equal(await service.getByLabel('Descrição de NFS-e 2026000000451', { exact: true }).inputValue(), '1 - SERVICO DE USINAGEM EM 10 PEÇAS DE EXEMPLO - R$ 1.654,40')
  assert.equal(await service.getByLabel('Valor de NFS-e 2026000000451', { exact: true }).inputValue(), '1.654,40')
  assert.equal(await service.getByLabel('ISS retido de NFS-e 2026000000451', { exact: true }).inputValue(), '82,72')
  assert.match(await service.innerText(), /Líquido a receber\s*R\$\s1\.571,68/)
  assert.equal(await service.getByLabel('Vencimento de NFS-e 2026000000451', { exact: true }).inputValue(), '2026-12-04')
  const chosen = (card, name) => card.getByLabel(`Classificação de ${name}`, { exact: true }).evaluate((select) => select.selectedOptions[0].textContent)
  assert.match(await chosen(service, 'NFS-e 2026000000451'), /^7\.02/)
  assert.match(await chosen(product, 'NF-e 000.000.915'), /^7\.04/)
  assert.match(await product.innerText(), /Cliente não cadastrado[\s\S]*INDÚSTRIA EXEMPLO S\.A[\s\S]*44\.555\.666\/0001-77/)
  assert.equal(await product.getByLabel('Vencimento 2 de NF-e 000.000.915', { exact: true }).inputValue(), '2026-12-05')
  await page.screenshot({ path: 'test-results/invoice-import-review.png' })

  // Posting with the client missing is refused on that invoice.
  await dialog.getByRole('button', { name: 'Lançar 2 contas', exact: true }).click()
  await product.getByText('Cadastre o cliente antes de lançar esta nota.', { exact: true }).waitFor()
  await product.getByRole('button', { name: 'Cadastrar cliente', exact: true }).click()
  const register = page.getByRole('dialog', { name: 'Novo cliente', exact: true })
  assert.equal(await register.getByLabel('Nome / razão social').inputValue(), 'INDÚSTRIA EXEMPLO S.A')
  assert.equal(await register.getByLabel('CPF/CNPJ').inputValue(), '44555666000177')
  await register.getByRole('button', { name: 'Salvar cliente', exact: true }).click()
  await register.waitFor({ state: 'detached' })
  assert.doesNotMatch(await product.innerText(), /Cliente não cadastrado/)
  await dialog.getByRole('button', { name: 'Lançar 2 contas', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  await page.getByText('2 notas lançadas em Contas a Receber, com o PDF anexado.', { exact: true }).waitFor()
  const rows = await fixture.mutateStore((store) => store.receivables.map((row) => [row.documentNumber, row.valueCents, row.issCents, row.dueDate, row.attachments.length]))
  assert.deepEqual(rows, [['2026000000451', 165440, 8272, '2026-12-04', 1], ['000.000.915', 10000000, 0, '2026-11-05', 1], ['000.000.915', 4700000, 0, '2026-12-05', 1]])

  // Read again, the invoices already posted come unchecked; on a phone the cards stay within the screen.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('PDF das notas', { exact: true }).setInputFiles({ name: 'notas.pdf', mimeType: 'application/pdf', buffer: await invoicePdf([sampleNfse, sampleNfe]) })
  await service.waitFor()
  assert.match(await service.innerText(), /Esta nota já foi lançada em REC-000001\./)
  assert.equal(await service.getByLabel('Lançar NFS-e 2026000000451', { exact: true }).isChecked(), false)
  assert.equal(await dialog.getByRole('button', { name: /^Lançar 0 contas$/ }).isDisabled(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: 'test-results/invoice-import-phone.png' })
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  await page.waitForFunction(async () => true)
  assert.deepEqual(errors, [])
  console.log('Invoice import passed: NFS-e and NF-e read, 7.02/7.04 suggested, client registered first, posted with the PDF, duplicates unchecked and phone layout.')
} catch (error) {
  await page.screenshot({ path: 'test-results/invoice-import-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
