import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { sampleOfx, sampleRows, sicoobOfx } from './ofxSample.js'

// Several OFX files chosen at once (Itaú and Sicoob): each becomes its own batch and account, a broken file does not stop the others.
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
  const files = [
    { name: 'itau.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(sampleOfx(sampleRows), 'utf8') },
    { name: 'extrato-conta-corrente-ofx-money.ofx', mimeType: 'application/x-ofx', buffer: sicoobOfx('\r\n') },
    { name: 'quebrado.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from('não é um OFX') },
  ]
  await page.getByLabel('Arquivo OFX', { exact: true }).setInputFiles(files)
  await page.getByRole('status').filter({ hasText: '2 extratos importados' }).waitFor()
  assert.match(await page.getByRole('status').filter({ hasText: 'extratos importados' }).innerText(), /2 extratos importados: 11 movimentações novas no total/)
  const results = page.locator('.bank-import-result')
  assert.equal(await results.count(), 2)
  assert.match(await results.nth(0).innerText(), /itau\.ofx[\s\S]*Itaú \(0341\)/)
  assert.match(await results.nth(1).innerText(), /ofx-money\.ofx[\s\S]*Sicoob \(756\) · Agência 0001-0 · Conta 12345-6/)
  assert.match(await page.getByRole('alert').innerText(), /quebrado\.ofx: /, 'the broken file is reported by name')
  // The last account imported is shown: Sicoob, with the counterparty taken from <NAME> and the operations named.
  const account = page.getByRole('combobox', { name: 'Conta bancária', exact: true })
  assert.deepEqual(await account.locator('option').allTextContents(), ['Itaú (0341) · Conta 0001234567 · Conta corrente', 'Sicoob (756) · Agência 0001-0 · Conta 12345-6 · Conta corrente'])
  assert.match(await account.locator('option:checked').innerText(), /^Sicoob/)
  const rows = page.locator('.bank-transactions tbody tr')
  assert.equal(await rows.count(), 5)
  assert.match(await rows.filter({ hasText: 'CRÉD.TED-STR' }).innerText(), /CLIENTE EXEMPLO INDUSTRIA E COM[\s\S]*TED recebida/)
  assert.match(await rows.filter({ hasText: 'RESGATE RDC' }).innerText(), /Resgate de aplicação \(RDC\)/)
  await page.screenshot({ path: 'test-results/bank-multi-import.png', fullPage: true })
  await account.selectOption({ label: 'Itaú (0341) · Conta 0001234567 · Conta corrente' })
  assert.equal(await rows.count(), 6)
  assert.deepEqual(errors, [])
  console.log('Bank multi import passed: Itaú and Sicoob chosen together, one batch and account each, broken file reported, counterparty from <NAME>.')
} catch (error) {
  await page.screenshot({ path: 'test-results/bank-multi-import-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
