import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { enterOperatorCode, openOrder } from './operatorEntry.js'

// Máquinas puts a machine in maintenance with the reason; the operator sees the stage planned on it disabled until it
// is released.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const admin = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const operatorContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const operator = await operatorContext.newPage()
const errors = []
for (const page of [admin, operator]) page.on('pageerror', (error) => errors.push(error.message))
await mkdir('test-results/machine-maintenance', { recursive: true })
try {
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno 01', sectors: ['Usinagem'], sector: 'Usinagem', hourlyRate: 80 }, { id: 'fresa', name: 'Fresa 02', sectors: ['Usinagem'], sector: 'Usinagem', hourlyRate: 90 }] })
  const ana = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001' })).data.item
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning', 'milling'], stageResources: { turning: { type: 'machine', id: 'torno' }, milling: { type: 'machine', id: 'fresa' } } })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offerDraft.deadline } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item

  await admin.goto(fixture.url)
  await admin.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await admin.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await admin.getByRole('button', { name: 'Entrar', exact: true }).click()
  await admin.locator('.admin-home-main').waitFor()
  await admin.locator('.sidebar').getByRole('button', { name: 'Máquinas', exact: true }).click()
  // The sector is only marked, from Cadastros > Setores; one is required.
  for (const name of ['Usinagem', 'Caldeiraria']) await fixture.adminRequest('/sectors', 'POST', { name })
  await admin.getByRole('button', { name: 'Adicionar máquina', exact: true }).click()
  const added = admin.getByRole('dialog', { name: 'Adicionar máquina' })
  await added.getByRole('button', { name: 'Caldeiraria', exact: true }).waitFor()
  assert.deepEqual(await added.getByRole('group', { name: 'Setor' }).getByRole('button').allTextContents(), ['Caldeiraria', 'Usinagem'])
  assert.equal(await added.getByRole('textbox', { name: 'Setor' }).count(), 0, 'no typed sector')
  await added.getByLabel('Nome da máquina').fill('Serra fita 03')
  await added.getByLabel('Valor da hora (R$)').fill('60')
  await added.getByRole('button', { name: 'Salvar máquina' }).click()
  await added.getByRole('alert').getByText('Marque pelo menos um setor.').waitFor()
  await added.getByRole('button', { name: 'Caldeiraria', exact: true }).click()
  await added.getByRole('button', { name: 'Usinagem', exact: true }).click()
  await admin.screenshot({ path: 'test-results/machine-maintenance/adicionar-maquina.png' })
  await added.getByRole('button', { name: 'Salvar máquina' }).click()
  await admin.locator('.machine-row').filter({ hasText: 'Serra fita 03' }).getByText('Caldeiraria e Usinagem').waitFor()
  const row = admin.locator('.machine-row').filter({ hasText: 'Torno 01' })
  await row.click()
  await admin.getByRole('button', { name: 'Manutenção', exact: true }).click()
  const dialog = admin.getByRole('dialog', { name: 'Colocar em manutenção' })
  await dialog.getByRole('button', { name: 'Colocar em manutenção', exact: true }).click()
  assert.equal(await dialog.isVisible(), true, 'the reason is required')
  await dialog.getByLabel('Motivo da manutenção').fill('Troca do rolamento do cabeçote')
  await admin.screenshot({ path: 'test-results/machine-maintenance/modal.png' })
  await dialog.getByRole('button', { name: 'Colocar em manutenção', exact: true }).click()
  await row.locator('.machine-status--maintenance').getByText('Em manutenção').waitFor()
  assert.match(await row.locator('.machine-status').getAttribute('title'), /Troca do rolamento do cabeçote/)
  assert.match(await admin.locator('.machine-metric').filter({ hasText: 'Em manutenção' }).innerText(), /\b1\b/)
  await admin.locator('.machine-filters').getByRole('button', { name: 'Em manutenção' }).click()
  assert.equal(await admin.locator('.machine-row:not(.machine-row--header)').count(), 1, 'only the machine in maintenance')
  await admin.locator('.machine-filters').getByRole('button', { name: 'Todas' }).click()
  await admin.screenshot({ path: 'test-results/machine-maintenance/maquinas.png', fullPage: true })
  for (const width of [1440, 1366, 390]) {
    await admin.setViewportSize({ width, height: 900 })
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no page overflow`)
    assert.ok(await admin.locator('.machine-actions').evaluate((bar) => [...bar.children].every((button) => !button.getClientRects().length || button.getBoundingClientRect().right <= innerWidth)), `${width}: every action in view`)
    await admin.screenshot({ path: `test-results/machine-maintenance/maquinas-${width}.png` })
  }
  await admin.setViewportSize({ width: 1440, height: 900 })
  assert.match(await row.getByRole('button', { name: 'Liberar Torno 01' }).getAttribute('title'), /Liberar máquina/, 'the row offers the maintenance too (the only way on the phone)')

  await operatorContext.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
  await operator.goto(fixture.url)
  await enterOperatorCode(operator, ana.accessCode)
  await openOrder(operator, order.service)
  await operator.getByRole('button', { name: /Selecionar etapa/ }).click()
  const stages = operator.getByRole('region', { name: 'Etapas', exact: true })
  const turning = stages.locator('.operator-picker-option').first()
  await turning.getByText('Máquina em manutenção').waitFor()
  assert.equal(await turning.isDisabled(), true, 'the stage planned on the machine waits for it')
  await operator.screenshot({ path: 'test-results/machine-maintenance/operador-etapas.png' })
  const milling = stages.locator('.operator-picker-option').nth(1)
  await milling.getByText('Máquina: Fresa 02').waitFor()
  assert.equal(await milling.isDisabled(), false, 'a stage on a free machine can still be chosen')

  await admin.getByRole('button', { name: 'Liberar máquina', exact: true }).click()
  const release = admin.getByRole('dialog', { name: 'Liberar máquina' })
  assert.match(await release.innerText(), /Motivo: Troca do rolamento do cabeçote/)
  await release.getByRole('button', { name: 'Liberar máquina', exact: true }).click()
  await row.locator('.machine-status--idle').waitFor()
  // The list of machines is read when the picker opens: back to the OS and in again, the Torno is free.
  await operator.getByRole('button', { name: '← Voltar para a OS', exact: true }).click()
  await operator.getByRole('button', { name: /Selecionar etapa/ }).click()
  await stages.locator('.operator-picker-option').first().getByText('Máquina: Torno 01').waitFor()
  await operator.waitForFunction(() => document.querySelector('[aria-label="Etapas"] .operator-picker-option')?.disabled === false)
  assert.deepEqual(errors, [])
  console.log('Machine maintenance passed: reason required, status, metric and filter in Máquinas, the stage on it disabled for the operator, release and the stage free again for the operator.')
} finally {
  await browser.close()
  await fixture.close()
}
