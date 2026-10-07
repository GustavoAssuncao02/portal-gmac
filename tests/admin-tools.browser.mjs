import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import ExcelJS from 'exceljs'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const navigate = (label) => page.locator('.sidebar').getByRole('button', { name: label, exact: true }).click()
const waitSaved = () => page.waitForFunction(() => !document.querySelector('.offer-proposal-button')?.disabled)
async function login(password = env.DEMO_ADMIN_PASSWORD) {
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
}

try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const headers = { Authorization: `Bearer ${token}` }
  const ana = (await fixture.request('/employees', 'POST', { name: 'Ana Teste', identification: '001', cpf: '00000000001', email: 'ana@example.invalid', birthDate: '1990-01-01' })).data.item
  await fixture.request('/employees', 'POST', { name: 'Bruno Teste', identification: '002', cpf: '00000000002', email: 'bruno@example.invalid', birthDate: '1991-01-01' })
  const machine = (await fixture.request('/machines', 'POST', { name: 'Torno teste', type: 'Torno', sector: 'Usinagem', hourlyRate: 80 }, headers)).data.item
  const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  await fixture.mutateStore((store) => {
    store.orders.push({ code: 'OS-REPORT', offerId: 'old-offer', service: 'Estrutura de teste', company: 'Cliente Teste', cnpj: '12345678000190', labelNumber: '120', quantity: 10, requestedAt: '2026-10-01', createdAt: '2026-10-02T12:00:00-03:00', deadline: '2026-10-30', description: 'Registro antigo preservado.', resources: { materials: [], laborEntries: [] }, proposal: { kind: 'service', stages: ['welding', 'painting'], deadline: '2026-10-30', serviceValue: 600 }, operation: { status: 'paused', stages: [{ key: 'stage-1', name: 'Soldagem' }, { key: 'stage-2', name: 'Pintura' }], stageCounts: { 'stage-1': 7, 'stage-2': 7 }, accumulatedMs: 7200000, activeSession: null }, operationEvents: [
      { id: 'start', type: 'started', sessionId: 'session', employeeId: ana.id, employeeName: ana.name, machineId: machine.id, machineName: machine.name, at: '2026-10-02T09:00:00-03:00' },
      { id: 'pause', type: 'paused', sessionId: 'session', employeeId: ana.id, employeeName: ana.name, machineId: machine.id, machineName: machine.name, at: '2026-10-02T11:00:00-03:00', durationMs: 7200000, reason: 'Descanso' },
    ] })
  })
  await page.goto(fixture.url)
  await login()
  await navigate('Clientes')
  const clientForm = page.locator('.registration-card form')
  await clientForm.getByLabel('Nome / Razão social').fill('Empresa de teste')
  await clientForm.getByRole('textbox', { name: 'CNPJ *', exact: true }).fill('12345678000190')
  await clientForm.getByLabel('E-mail').fill('empresa@example.invalid')
  await clientForm.getByRole('button', { name: /Cadastrar/ }).click()
  await page.locator('.registration-list-row').filter({ hasText: 'Empresa de teste' }).waitFor()
  await navigate('Administradores')
  await page.locator('.registration-list-row').filter({ hasText: 'Gustavo' }).waitFor()
  await navigate('Relatórios')
  await page.getByRole('heading', { name: 'Relatórios', exact: true }).waitFor()
  const kind = page.getByLabel('Tipo de relatório', { exact: true })
  for (const reportKind of ['employees', 'clients', 'admins', 'employee-hours', 'machine-hours', 'orders']) {
    await kind.selectOption(reportKind)
    if (reportKind.endsWith('-hours') || reportKind === 'orders') {
      await page.getByLabel('Data de início', { exact: true }).fill('2026-10-01')
      await page.getByLabel('Data de fim', { exact: true }).fill('2026-10-03')
    }
    await page.getByRole('button', { name: 'Consultar', exact: true }).click()
    await page.locator('.reports-result').waitFor()
    if (reportKind.endsWith('-hours')) assert.equal(await page.locator('.reports-summary dd').first().innerText(), '02:00:00')
    for (const [label, format] of [['Baixar PDF', 'pdf'], ['Baixar Excel', 'xlsx']]) {
      const downloadEvent = page.waitForEvent('download')
      await page.getByRole('button', { name: label, exact: true }).click()
      const download = await downloadEvent
      const path = `test-results/admin-tools-${reportKind}.${format}`
      await download.saveAs(path)
      const data = await readFile(path)
      if (format === 'pdf') assert.equal(data.subarray(0, 4).toString(), '%PDF')
      else { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(data); assert.ok(workbook.worksheets.length >= 2) }
    }
  }
  await kind.selectOption('employee-hours')
  await page.getByRole('checkbox', { name: 'Todos', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Bruno Teste', exact: true }).check()
  await page.getByRole('button', { name: 'Consultar', exact: true }).click()
  await page.locator('.reports-result').waitFor()
  assert.equal(await page.locator('.reports-summary dd').first().innerText(), '00:00:00')
  assert.ok(!(await page.locator('.reports-table-scroll').innerText()).includes('Ana Teste'))
  await page.getByRole('checkbox', { name: 'Todos', exact: true }).check()
  await page.getByRole('button', { name: 'Consultar', exact: true }).click()
  await page.locator('.reports-result').waitFor()
  for (const [width, height] of [[1600, 950], [1366, 900], [900, 800], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Reports fit ${width}`)
    await page.screenshot({ path: `test-results/reports-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1366, height: 900 })
  await navigate('Configurações')
  await page.getByLabel('Nome', { exact: true }).fill('Gustavo Novo')
  await page.getByLabel('Senha atual', { exact: true }).fill('errada')
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await page.getByRole('alert').getByText('Senha atual incorreta.', { exact: true }).waitFor()
  await page.getByLabel('Senha atual', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByLabel('Nova senha', { exact: true }).fill('novaSenha123')
  await page.getByLabel('Confirmar nova senha', { exact: true }).fill('novaSenha123')
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await page.getByText('Conta atualizada com sucesso.', { exact: true }).waitFor()
  assert.equal(await page.locator('.account-copy strong').innerText(), 'Gustavo Novo')
  await page.screenshot({ path: 'test-results/account-settings.png', fullPage: true })
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Account fits ${width}`)
    await page.screenshot({ path: `test-results/account-settings-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1366, height: 900 })
  await navigate('In\u00edcio')
  await page.getByRole('heading', { name: 'Bem-vindo, Gustavo', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await login('novaSenha123')
  await navigate('Ofertas e serviços')
  await page.locator('.offer-review-button').click()
  assert.equal(await page.locator('.offer-stage-group h3').count(), 3)
  assert.equal(await page.locator('.offer-stage-options input[type="checkbox"]').count(), 15)
  await page.getByRole('checkbox', { name: 'Tornearia', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Pintura', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Corte a plasma', exact: true }).check()
  await page.getByRole('radio', { name: 'Desenho', exact: true }).check()
  await page.getByRole('radio', { name: 'Sim', exact: true }).check()
  await page.getByLabel('Cor/Tipo', { exact: true }).fill('Azul epoxi')
  await page.getByLabel('Descrição do serviço', { exact: true }).fill('Acabamento conforme desenho. Sem rebarbas.')
  await page.getByLabel('Descrição do serviço', { exact: true }).blur()
  await waitSaved()
  const settings = (await fixture.request('/offers')).data.items.find((item) => item.id === offer.id).resources
  assert.equal(settings.paintColor, 'Azul epoxi')
  assert.equal(settings.serviceDescription, 'Acabamento conforme desenho. Sem rebarbas.')
  assert.equal(settings.manufacturedFrom, 'drawing')
  assert.equal(settings.tempering, true)
  await page.screenshot({ path: 'test-results/offer-process-groups.png', fullPage: true })
  await navigate('Calculadora de pesos e medidas')
  assert.equal(await page.locator('.material-option--selected').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(241, 246, 251)')
  await page.screenshot({ path: 'test-results/calculator-blue.png', fullPage: true })
  await navigate('Serviços em andamento')
  const display = page.getByRole('button', { name: 'Modo de exibição', exact: true })
  await display.click()
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('admin-os-main'))
  assert.equal(await page.locator('.admin-os-main .workspace-tabs').isVisible(), false)
  await page.screenshot({ path: 'test-results/services-fullscreen.png' })
  await page.getByRole('button', { name: 'Sair do modo de exibição', exact: true }).click()
  await page.waitForFunction(() => !document.fullscreenElement)
  await display.click()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.fullscreenElement)
  await page.evaluate((token) => { sessionStorage.setItem('gmac-operator-token', token) }, fixture.operatorToken)
  await page.reload()
  await page.getByRole('button', { name: 'Trabalhar neste projeto', exact: true }).click()
  await page.getByLabel('Funcionário', { exact: true }).selectOption(String(ana.id))
  await page.getByRole('radio', { name: 'Máquina', exact: true }).check()
  await page.getByRole('combobox', { name: 'Máquina', exact: true }).selectOption(String(machine.id))
  await page.getByRole('button', { name: 'Iniciar trabalho', exact: true }).click()
  await page.getByRole('button', { name: 'Pausar trabalho', exact: true }).waitFor()
  const running = (await fixture.request('/operations/orders')).data.items.find((item) => item.code === 'OS-REPORT')
  assert.equal(running.operation.activeSession.machineName, 'Torno teste')
  assert.deepEqual(running.operation.stageCounts, { 'stage-1': 7, 'stage-2': 7 })
  assert.deepEqual(errors, [])
  console.log('Admin tools passed: six reports PDF/XLSX, real hours/filtering, persistent clients/account, grouped offer fields, blue calculator, fullscreen/exit, operator machine and preserved legacy progress.')
} catch (error) {
  await page.screenshot({ path: 'test-results/admin-tools-failure.png', fullPage: true })
  throw error
} finally { await browser.close(); await fixture.close() }
