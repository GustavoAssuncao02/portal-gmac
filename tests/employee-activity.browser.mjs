import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { activityDateRange } from '../server/employeeActivity.js'
import { createWorkflowFixture } from './workflowFixture.js'

const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste', DEMO_ADMIN_NAME: 'Gustavo' } })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const today = activityDateRange('today').start
const day = 86400000
const yesterday = new Date(today - day).toISOString().slice(0, 10)
const event = (id, offset, fields = {}) => ({ id, type: 'started', at: new Date(today + offset).toISOString(), employeeId: 'ana', employeeName: 'Ana Teste', ...fields })
const dialog = page.getByRole('dialog')

async function countActivities(count) {
  await dialog.getByRole('status').getByText(`${count} ${count === 1 ? 'atividade' : 'atividades'}`, { exact: true }).waitFor()
  assert.equal(await dialog.locator('tbody tr').count(), count || 1)
}

try {
  await fixture.mutateStore((store) => {
    store.employees = [
      { id: 'ana', name: 'Ana Teste', identification: '001', cpf: '00000000001', email: 'ana@example.invalid', birthDate: '1990-01-15' },
      { id: 'bruno', name: 'Bruno Teste', identification: '002', cpf: '00000000002', email: 'bruno@example.invalid', birthDate: '1992-06-20' },
    ]
    store.orders = [{ code: 'OS-2026-0001', service: 'Estrutura metalica', company: 'Cliente A', quantity: 10, operationEvents: [
      event('old', -40 * day), event('month', -29 * day), event('week', -6 * day), event('yesterday', -1000),
      event('start', 1000, { sessionId: 'ana-session' }),
      event('progress', 2000, { type: 'stage_progress', stageName: 'Soldagem', quantity: 3, stageTotal: 7 }),
      event('pause', 3000, { type: 'paused', reason: 'Descanso', durationMs: 3661000 }),
      event('interrupt', 4000, { type: 'admin_interrupted', employeeId: null, employeeName: 'Administrador', sessionId: 'ana-session', reason: 'Manutencao' }),
      event('other', 5000, { employeeId: 'bruno', employeeName: 'Bruno Teste' }),
    ] }]
  })
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill('12345678901')
  await page.getByLabel('Senha', { exact: true }).fill('teste')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Serviços em andamento', exact: true }).click()
  await page.getByRole('heading', { name: 'Painel de serviços em andamento' }).waitFor()
  const employees = page.locator('.sidebar').getByRole('button', { name: 'Funcionários', exact: true })
  if (!await employees.isVisible()) await page.locator('.sidebar').getByRole('button', { name: 'Cadastros', exact: true }).click()
  await employees.click()
  const ana = page.getByRole('button', { name: 'Ver histórico de Ana Teste', exact: true })
  await ana.waitFor()
  const row = page.locator('.registration-table tbody tr').filter({ has: ana })
  const deleteBox = await row.getByRole('button', { name: 'Excluir Ana Teste', exact: true }).boundingBox()
  const infoBox = await ana.boundingBox()
  assert.ok(infoBox.x >= deleteBox.x + deleteBox.width)
  await page.screenshot({ path: 'test-results/employee-history-actions.png', fullPage: true })
  await ana.click()
  await dialog.waitFor()
  assert.equal(await dialog.getByLabel('Período', { exact: true }).inputValue(), 'today')
  assert.deepEqual(await dialog.locator('select option').allTextContents(), ['Hoje', 'Ontem', 'Últimos 7 dias', 'Últimos 30 dias', 'Desde sempre', 'Data específica'])
  await countActivities(4)
  const content = await dialog.innerText()
  assert.ok(content.includes('Soldagem: +3 peças (7/10 no total)'))
  assert.ok(content.includes('Tempo da sessão: 01:01:01'))
  assert.ok(content.includes('Encerrada pelo administrador'))
  assert.ok(content.includes('OS-2026-0001') && content.includes('Estrutura metalica'))
  const period = dialog.getByLabel('Período', { exact: true })
  for (const [value, count] of [['yesterday', 1], ['7days', 6], ['30days', 7], ['all', 8]]) {
    await period.selectOption(value)
    await countActivities(count)
  }
  await page.screenshot({ path: 'test-results/employee-history-desktop.png' })
  await period.selectOption('date')
  const date = dialog.getByLabel('Data específica', { exact: true })
  await date.fill(yesterday)
  await countActivities(1)
  await date.fill('2000-01-01')
  await countActivities(0)
  await dialog.getByText('Nenhuma atividade registrada neste período.').waitFor()
  await date.fill('')
  await dialog.getByText('Selecione uma data.').waitFor()
  await page.route('**/employees/ana/activities?period=today', (route) => route.fulfill({ status: 503, json: { message: 'Falha simulada no histórico.' } }), { times: 1 })
  await period.selectOption('today')
  await dialog.getByRole('alert').getByText('Falha simulada no histórico.').waitFor()
  await dialog.getByRole('button', { name: 'Tentar novamente' }).click()
  await countActivities(4)
  let releaseSlowResponse
  const slowResponse = new Promise((resolve) => { releaseSlowResponse = resolve })
  let markRequested
  const requested = new Promise((resolve) => { markRequested = resolve })
  await page.route('**/employees/ana/activities?period=yesterday', async (route) => {
    const response = await route.fetch()
    markRequested()
    await slowResponse
    await route.fulfill({ response }).catch(() => {})
  }, { times: 1 })
  await period.selectOption('yesterday')
  await requested
  await period.selectOption('all')
  await countActivities(8)
  releaseSlowResponse()
  await page.waitForTimeout(100)
  await countActivities(8)
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab')
    assert.ok(await dialog.evaluate((element) => element.contains(document.activeElement) || element === document.activeElement || document.activeElement === document.body))
  }
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.ok(await ana.evaluate((button) => button === document.activeElement))
  await page.getByRole('button', { name: 'Ver histórico de Bruno Teste', exact: true }).click()
  await countActivities(1)
  assert.equal(await dialog.getByLabel('Período', { exact: true }).inputValue(), 'today')
  assert.equal(await dialog.getByRole('heading').innerText(), 'Bruno Teste')
  assert.ok(!(await dialog.innerText()).includes('Soldagem'))
  await dialog.getByRole('button', { name: 'Fechar histórico' }).click()
  await dialog.waitFor({ state: 'detached' })
  await ana.click()
  await countActivities(4)
  await page.mouse.click(5, 5)
  await dialog.waitFor({ state: 'detached' })
  await ana.click()
  await countActivities(4)
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await dialog.getByLabel('Período', { exact: true }).selectOption('date')
    await dialog.getByLabel('Data específica', { exact: true }).fill(yesterday)
    await countActivities(1)
    const box = await dialog.boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 844)
    assert.ok(await dialog.locator('.employee-activity-filters').evaluate((element) => element.scrollWidth <= element.clientWidth))
    await page.screenshot({ path: `test-results/employee-history-mobile-${width}.png` })
  }
  assert.deepEqual(errors, [])
  console.log('Employee history browser passed: icon position, default today, all six filters, specific/empty dates, event details, employee isolation, error/retry, stale request cancellation, keyboard focus isolation, Escape/focus restoration, close/backdrop, desktop and mobile modal bounds.')
} catch (error) {
  await page.screenshot({ path: 'test-results/employee-history-failure.png' })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
