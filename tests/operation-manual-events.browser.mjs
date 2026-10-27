import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// The notes of an employee without access to the portal are typed in from the history of the OS, only with lists.
const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123' } })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('dialog', async (dialog) => { errors.push(dialog.type()); await dialog.dismiss() })

try {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Eixo em serviço externo' })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cutting'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Proposta A', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  await fixture.adminRequest('/employees', 'POST', { name: 'Aloisio Teste', cpf: '00000000001', identification: '001', birthDate: '1990-01-01', email: 'aloisio@example.invalid' })
  const [stage] = (await fixture.adminRequest(`/operations/orders/${order.code}/manual-options`)).data.stages
  const total = Number(order.quantity)

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill('12345678901')
  await page.getByLabel('Senha', { exact: true }).fill('teste123')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
  await page.locator('.offers-table-row').filter({ hasText: offer.service }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  const article = page.locator('.os-detail')
  await article.waitFor()
  await article.getByRole('button', { name: 'Histórico de operações', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const add = dialog.getByRole('button', { name: 'Adicionar operação', exact: true })
  const form = dialog.getByRole('form', { name: 'Adicionar operação' })
  const field = (name) => form.getByLabel(name)
  const save = form.getByRole('button', { name: 'Salvar operação', exact: true })
  const row = (text) => dialog.locator('tbody tr').filter({ hasText: text })

  // Start: date and time, operation, employee and stage are chosen from lists.
  await add.click()
  await field('Responsável').waitFor()
  assert.deepEqual(await field('Operação').locator('option').allTextContents(), ['Início da operação', 'Peças registradas', 'Pausa'])
  assert.equal(await field('Operação').evaluate((element) => element.tagName), 'SELECT')
  await field('Data e hora').fill('2026-10-01T08:00')
  await field('Responsável').selectOption({ label: 'Aloisio Teste' })
  await field('Etapa').selectOption({ label: stage.name })
  await save.click()
  await form.waitFor({ state: 'detached' })
  const start = row('Início')
  await start.getByText('01/10/2026, 08:00:00', { exact: true }).waitFor()
  await start.getByText('Lançamento manual', { exact: true }).waitFor()
  await start.getByText(`Etapa: ${stage.name}`, { exact: true }).waitFor()

  // Pieces: the stage comes from what the employee was doing at that time; the quantity is a list up to the OS total.
  await add.click()
  await field('Responsável').waitFor()
  await field('Data e hora').fill('2026-10-01T09:00')
  await field('Operação').selectOption({ label: 'Peças registradas' })
  await field('Responsável').selectOption({ label: 'Aloisio Teste' })
  assert.equal(await field('Etapa').inputValue(), stage.key)
  assert.equal(await field('Quantidade').locator('option').count(), total + 1)
  await field('Quantidade').selectOption('2')
  await form.getByText(`${stage.name}: +2 peça(s), 2/${total} no total`, { exact: true }).waitFor()
  await save.click()
  await form.waitFor({ state: 'detached' })
  await row('Peças registradas').getByText(`${stage.name}: +2 peça(s), 2/${total} no total`, { exact: true }).waitFor()

  // A pause without an open start is refused with the reason; the form stays filled in.
  await add.click()
  await field('Responsável').waitFor()
  await field('Data e hora').fill('2026-10-01T07:00')
  await field('Operação').selectOption({ label: 'Pausa' })
  await field('Responsável').selectOption({ label: 'Aloisio Teste' })
  await field('Motivo').selectOption('Descanso')
  await save.click()
  await form.getByRole('alert').getByText(/A pausa precisa ser posterior à última operação desse período \(01\/10\/2026, 09:00:00\)/).waitFor()
  await field('Data e hora').fill('2026-10-01T10:00')
  await save.click()
  await form.waitFor({ state: 'detached' })
  const pause = row('Pausa')
  await pause.getByText('Tempo da sessão: 02:00:00', { exact: true }).waitFor()
  await pause.getByText('Descanso', { exact: true }).waitFor()
  await pause.getByRole('button', { name: 'Ver quem lançou Pausa', exact: true }).click()
  await pause.getByRole('note').getByText('Lançado a partir das anotações do funcionário', { exact: true }).waitFor()
  assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth))
  await add.click()
  await field('Responsável').waitFor()
  await page.screenshot({ path: 'test-results/operation-manual-events.png' })

  // Escape closes the form first, then the history.
  await page.keyboard.press('Escape')
  await form.waitFor({ state: 'detached' })
  await dialog.waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await add.click()
  await field('Responsável').waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth))
  await page.screenshot({ path: 'test-results/operation-manual-events-mobile.png' })
  await form.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await dialog.getByRole('button', { name: 'Fechar histórico' }).click()
  await dialog.waitFor({ state: 'detached' })
  // The project time of the OS includes the period typed in.
  await article.locator('.os-operation-facts').getByText('02:00:00', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Manual operations passed: lists for every field, start, pieces with the stage of the moment and quantity list, pause with session time, refused sequence, manual mark, project time, Escape and mobile layout.')
} catch (error) {
  await page.screenshot({ path: 'test-results/operation-manual-events-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
