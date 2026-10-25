import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

// In Settings, the account data and the operator access are summaries with a button; each form opens in a dialog.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await mkdir('test-results/account-modals', { recursive: true })
try {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Configurações', exact: true }).click()
  const account = page.locator('.account-summary-card').filter({ has: page.getByRole('heading', { name: 'Dados da conta' }) })
  const operator = page.locator('.account-summary-card').filter({ has: page.getByRole('heading', { name: 'Acesso do operador' }) })
  await operator.getByRole('button', { name: 'Alterar acesso do operador', exact: true }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.operator-access-settings header button').disabled)
  assert.match(await account.innerText(), /123\.456\.789-01/)
  for (const label of ['Senha atual', /^Usuário do operador/, 'Justificativa da alteração']) assert.equal(await page.getByLabel(label).count(), 0, `${label} stays out of the page`)
  await page.screenshot({ path: 'test-results/account-modals/configuracoes.png', fullPage: true })

  await operator.getByRole('button', { name: 'Alterar acesso do operador', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Acesso do operador' })
  await dialog.waitFor()
  await page.screenshot({ path: 'test-results/account-modals/operador-modal.png' })
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })

  await operator.getByRole('button', { name: 'Alterar acesso do operador', exact: true }).click()
  await dialog.getByLabel(/^Usuário do operador/).fill('98765432100')
  await dialog.getByLabel('Nova senha do operador', { exact: true }).fill('tablet123')
  await dialog.getByLabel('Confirmar senha do operador', { exact: true }).fill('outra123')
  await dialog.getByLabel('Justificativa da alteração', { exact: true }).fill('Troca periódica da senha dos tablets.')
  await dialog.getByRole('button', { name: 'Salvar acesso do operador', exact: true }).click()
  await dialog.getByRole('alert').getByText('A confirmação da senha do operador não confere.').waitFor()
  await dialog.getByLabel('Confirmar senha do operador', { exact: true }).fill('tablet123')
  await dialog.getByRole('button', { name: 'Salvar acesso do operador', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  await operator.getByRole('status').getByText(/Acesso do operador atualizado/).waitFor()
  assert.match(await operator.innerText(), /987\.654\.321-00/)
  assert.match(await operator.innerText(), /Alterada em/)
  await operator.getByRole('button', { name: 'Histórico de alterações do acesso do operador' }).click()
  await page.getByRole('dialog', { name: 'Histórico do acesso do operador' }).getByText('Justificativa: Troca periódica da senha dos tablets.').waitFor()
  await page.getByRole('dialog', { name: 'Histórico do acesso do operador' }).getByRole('button', { name: 'Fechar janela' }).click()

  await account.getByRole('button', { name: 'Editar dados e senha', exact: true }).click()
  await page.getByRole('dialog', { name: 'Dados da conta' }).waitFor()
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.documentElement.dataset.tone = 'black' })
  await page.screenshot({ path: 'test-results/account-modals/conta-modal-escuro-intenso.png' })
  await page.keyboard.press('Escape')
  await page.screenshot({ path: 'test-results/account-modals/configuracoes-escuro-intenso.png', fullPage: true })
  for (const [width, height] of [[1024, 800], [390, 844]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no page overflow`)
    await page.screenshot({ path: `test-results/account-modals/configuracoes-${width}.png`, fullPage: true })
  }
  await operator.getByRole('button', { name: 'Alterar acesso do operador', exact: true }).click()
  await dialog.waitFor()
  const box = await dialog.boundingBox()
  assert.ok(box.x >= 0 && box.x + box.width <= 390, 'the dialog fits the phone')
  await page.screenshot({ path: 'test-results/account-modals/operador-modal-390.png' })
  assert.deepEqual(errors, [])
  console.log('Account settings dialogs passed: summaries without form fields, account and operator forms in dialogs, cancel, validation, save, history, dark mode and phone width.')
} finally {
  await browser.close()
  await fixture.close()
}
