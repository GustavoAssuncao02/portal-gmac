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
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cut-bend'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Proposta A', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  await fixture.adminRequest('/employees', 'POST', { name: 'Aloisio Teste', cpf: '00000000001', identification: '001', birthDate: '1990-01-01', email: 'aloisio@example.invalid' })
  const bento = (await fixture.adminRequest('/employees', 'POST', { name: 'Bento Teste', cpf: '00000000002', identification: '002', birthDate: '1990-01-01', email: 'bento@example.invalid' })).data.item
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
  // The label of a list also reads its options: the field is found by the start of its label.
  const field = (name) => form.getByLabel(new RegExp(`^${name.replace(/[()]/g, (character) => `\\${character}`)}`))
  const save = form.getByRole('button', { name: 'Salvar operação', exact: true })
  const row = (text) => dialog.locator('tbody tr').filter({ hasText: text })

  // Period of work: start and pause are typed in together, every field chosen from lists. The pause alone is not offered.
  await add.click()
  await field('Responsável').waitFor()
  await form.getByText('Lance o período de trabalho (início e pausa) e depois as peças desse período.', { exact: true }).waitFor()
  assert.deepEqual(await field('Operação').locator('option').allTextContents(), ['Período de trabalho (início e pausa)', 'Peças registradas'])
  assert.equal(await field('Operação').evaluate((element) => element.tagName), 'SELECT')
  await field('Início').fill('2026-10-01T08:00')
  await field('Responsável').selectOption({ label: 'Aloisio Teste' })
  await field('Etapa').selectOption(stage.key)
  await field('Pausa (fim do período)').fill('2026-10-01T10:00')
  await field('Motivo da pausa').selectOption('Descanso')
  await save.click()
  await form.waitFor({ state: 'detached' })
  const start = row('Início')
  await start.getByText('01/10/2026, 08:00:00', { exact: true }).waitFor()
  await start.getByText('Lançamento manual', { exact: true }).waitFor()
  await start.getByText(`Etapa: ${stage.name}`, { exact: true }).waitFor()
  const pause = row('Pausa')
  await pause.getByText('Tempo da sessão: 02:00:00', { exact: true }).waitFor()
  await pause.getByText('Descanso', { exact: true }).waitFor()
  await pause.getByRole('button', { name: 'Ver quem lançou Pausa', exact: true }).click()
  await pause.getByRole('note').getByText('Lançado a partir das anotações do funcionário', { exact: true }).waitFor()

  // Pieces: the stage comes from what the employee was doing at that time; the quantity is a list up to the OS total.
  await add.click()
  await field('Responsável').waitFor()
  await field('Operação').selectOption({ label: 'Peças registradas' })
  await field('Data e hora').fill('2026-10-01T09:00')
  await field('Responsável').selectOption({ label: 'Aloisio Teste' })
  assert.equal(await field('Etapa').inputValue(), stage.key)
  assert.equal(await field('Quantidade').locator('option').count(), total + 1)
  await field('Quantidade').selectOption('2')
  await form.getByText(`${stage.name}: +2 peça(s), 2/${total} no total`, { exact: true }).waitFor()
  await save.click()
  await form.waitFor({ state: 'detached' })
  // The history shows the time behind the pieces: one hour of work since the start, for two pieces.
  const pieces = row('Peças registradas')
  await pieces.getByText(`${stage.name.toLocaleUpperCase('pt-BR')}: +2 peças - 30 minutos por peça`, { exact: true }).waitFor()
  await pieces.getByText(`2/${total} no total`, { exact: true }).waitFor()

  // A period touching another one is refused naming the record; the form stays filled in. Right after it is fine.
  await add.click()
  await field('Responsável').waitFor()
  await field('Início').fill('2026-10-01T09:30')
  await field('Responsável').selectOption({ label: 'Aloisio Teste' })
  await field('Etapa').selectOption(stage.key)
  await field('Pausa (fim do período)').fill('2026-10-01T11:00')
  await field('Motivo da pausa').selectOption('Descanso')
  await save.click()
  await form.getByRole('alert').getByText(/^Aloisio Teste já tem um período em 01\/10 das 08:00:00 às 10:00:00 \(.+, lançado por .+\)\.$/).waitFor()
  await field('Início').fill('2026-10-01T10:30')
  await save.click()
  await form.waitFor({ state: 'detached' })
  await row('Retomada').getByText('01/10/2026, 10:30:00', { exact: true }).waitFor()

  // A start typed in before the period form, still without its pause: only for that employee the pause alone appears.
  await fixture.mutateStore((store) => {
    const saved = store.orders.find((item) => item.code === order.code)
    saved.operationEvents.push({ id: 'legacy-start', type: 'resumed', at: '2026-10-01T16:00:00.000Z', employeeId: bento.id, employeeName: bento.name, sessionId: 'legacy', workStageKey: stage.key, workStageName: stage.name, manual: { adminId: 1, adminName: 'Admin', recordedAt: '2026-10-02T12:00:00.000Z' } })
  })
  await dialog.getByRole('button', { name: 'Fechar histórico' }).click()
  await article.getByRole('button', { name: 'Histórico de operações', exact: true }).click()
  await row('01/10/2026, 13:00:00').waitFor()
  await add.click()
  await field('Responsável').waitFor()
  await field('Responsável').selectOption({ label: 'Bento Teste' })
  await field('Operação').selectOption({ label: 'Pausa' })
  await field('Data e hora').fill('2026-10-01T14:00')
  await field('Motivo da pausa').selectOption('Descanso')
  await save.click()
  await form.waitFor({ state: 'detached' })
  await add.click()
  await field('Responsável').selectOption({ label: 'Bento Teste' })
  assert.deepEqual(await field('Operação').locator('option').allTextContents(), ['Período de trabalho (início e pausa)', 'Peças registradas'], 'the pause alone is gone once the start is closed')
  await form.getByRole('button', { name: 'Cancelar', exact: true }).click()
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
  // 2 h and 30 min of Aloisio, 1 h of Bento.
  await article.locator('.os-operation-facts').getByText('03:30:00', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Manual operations passed: period with start and pause together, pieces with the stage of the moment and quantity list, overlapping period refused naming the record, pause alone only for an old open start, manual mark, project time, Escape and mobile layout.')
} catch (error) {
  await page.screenshot({ path: 'test-results/operation-manual-events-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
