import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import ExcelJS from 'exceljs'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { serviceStageGroups, stageLabel } from '../server/serviceStages.js'
import { exportPdf, exportWorkbook } from '../server/documentExports.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
const directory = 'test-results/document-review'
await mkdir(directory, { recursive: true })
const errors = []
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const headers = { Authorization: `Bearer ${token}` }
  async function request(path, body, method = 'POST') {
    const result = await fixture.request(path, method, body, headers)
    assert.ok(result.status < 300, JSON.stringify(result.data))
    return result.data
  }
  const employee = (await request('/employees', { name: 'Ana Teste', identification: '001', cpf: '00000000001', email: 'ana@example.invalid', birthDate: '1990-01-01' })).item
  await request('/clients', { name: 'Industria de Estruturas Teste', documentType: 'cnpj', document: offerDraft.cnpj, email: 'compras@example.invalid' })
  const machine = (await request('/machines', { name: 'Centro de Usinagem CNC', type: 'Usinagem', sector: 'Producao', hourlyRate: 80 })).item
  await request('/machines', { name: 'Maquina sem uso', type: 'Torno', sector: 'Producao', hourlyRate: 80 })
  const stages = ['turning', 'milling', 'cnc-turning', 'painting', 'cut-bend', 'torch-cut', 'grinding']
  const resources = { materials: [{ id: 'm1', name: 'Chapa de aco', detail: 'Espessura 10 mm, conforme desenho tecnico', quantity: 20, unitPrice: 12.5 }], laborEntries: [{ id: 'l1', type: 'machine', resource: machine.name, hours: 12, hourlyRate: 80 }], stages, kind: 'service', manufacturedFrom: 'drawing', tempering: false, paintColor: 'Azul epoxi', serviceDescription: 'Acabamento sem rebarbas e pintura conforme especificacao do desenho.' }
  const offer = (await request('/offers', { ...offerDraft, service: 'Estrutura metalica industrial', company: 'Industria de Estruturas Teste' })).item
  await request(`/offers/${offer.id}/resources`, resources, 'PUT')
  for (const layout of ['classic', 'executive', 'compact']) {
    await request(`/offers/${offer.id}/proposal`, { layout, proposal: { key: 'A', title: 'Opcao A', deadline: '2026-12-20', serviceValue: 1500, materials: 250, labor: 960, discount: 0, margin: 15, profit: 225, machine: '12 horas', serviceTime: '12 horas' } })
    const response = await fetch(`${fixture.url}/api/offers/${offer.id}/proposal.pdf`, { headers })
    assert.equal(response.status, 200)
    await writeFile(`${directory}/proposal-${layout}.pdf`, Buffer.from(await response.arrayBuffer()))
  }
  const order = (await request(`/offers/${offer.id}/accept`, {})).item
  await fixture.mutateStore((store) => {
    const row = store.orders.find((row) => row.code === order.code)
    row.createdAt = '2026-09-01T12:00:00-03:00'
    row.operation = { status: 'paused', accumulatedMs: 12 * 3600000, activeSession: null, stages: stages.map((key, i) => ({ key: `stage-${i}`, name: stageLabel(key) })), stageCounts: Object.fromEntries(stages.map((_, i) => [`stage-${i}`, i < 3 ? 7 : 4])) }
    row.operationEvents = [{ type: 'started', sessionId: 'a', at: '2026-09-01T06:00:00-03:00', employeeId: employee.id, employeeName: employee.name, machineId: machine.id, machineName: machine.name }, { type: 'paused', sessionId: 'a', at: '2026-09-01T18:00:00-03:00', durationMs: 12 * 3600000, employeeId: employee.id, employeeName: employee.name, machineId: machine.id, machineName: machine.name, reason: 'Final do expediente' }]
  })
  for (const kind of ['employees', 'clients', 'admins', 'employee-hours', 'machine-hours', 'orders']) {
    for (const idleHours of kind === 'machine-hours' ? [false, true] : [false]) {
      for (const format of ['pdf', 'xlsx']) {
        const response = await fetch(`${fixture.url}/api/reports/export`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, start: '2026-09-01', end: '2026-09-02', idleHours, format }) })
        assert.equal(response.status, 200)
        const bytes = Buffer.from(await response.arrayBuffer())
        await writeFile(`${directory}/${kind}${idleHours ? '-idle' : ''}.${format}`, bytes)
        if (format === 'xlsx') {
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load(bytes)
          for (const sheet of workbook.worksheets.slice(0, -1)) { assert.equal(sheet.views[0].ySplit, 1); assert.equal(sheet.getRow(1).height, 34) }
          if (idleHours) {
            const totals = workbook.worksheets[2].getRows(2, 2)
            const used = totals.find((row) => row.getCell(1).value === machine.name)
            assert.equal(used.getCell(5).value, 25)
            assert.equal(used.getCell(4).value, '36:00:00')
          }
        }
      }
    }
  }
  const supplier = (await request('/suppliers', { name: 'Fornecedor de insumos', document: offerDraft.cnpj, email: 'financeiro@example.invalid', phone: '71999999999' })).item
  const classification = (await request('/classifications', { name: 'Materiais de producao' })).item
  const account = (await request('/payables', { supplierId: supplier.id, classificationId: classification.id, description: 'Compra de chapas de aco para manutencao', documentNumber: 'NF-12345', issueDate: '2026-09-01', dueDate: '2026-09-02', value: '1250.50', kind: 'normal' })).items[0]
  for (const individual of [false, true]) for (const format of ['pdf', 'xlsx']) {
    const response = await fetch(`${fixture.url}/api/payables/export`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ format, ...(individual ? { id: account.id } : { filters: { status: 'all' } }) }) })
    assert.equal(response.status, 200)
    await writeFile(`${directory}/payables${individual ? '-individual' : ''}.${format}`, Buffer.from(await response.arrayBuffer()))
  }
  const stress = { title: 'Teste de textos longos e paginacao', generatedAt: new Date().toISOString(), summary: [['Registros', 60]], notes: [], sections: [{ name: 'Texto integral', columns: ['ID', 'Descricao'], rows: [['Registro completo', 'Detalhes importantes do projeto. '.repeat(500) + 'MARCADOR FINAL INTEGRAL']] }, { name: 'Registros paginados', columns: ['ID', 'Nome', 'Valor (R$)', 'Ativa (%)'], rows: Array.from({ length: 60 }, (_, i) => [`REG-${i + 1}`, 'Material industrial conforme especificacao', 1250.5 + i, 25]) }] }
  await writeFile(`${directory}/long-text.pdf`, await exportPdf(stress))
  await writeFile(`${directory}/long-text.xlsx`, Buffer.from(await exportWorkbook(stress)))
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Serviços em andamento', exact: true }).click()
  await page.locator('.admin-os-stage-label').first().waitFor()
  for (const width of [1920, 1366, 1280, 1024, 430, 393]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(200)
    const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, table: [...document.querySelectorAll('.admin-os-table-wrap')].map((el) => [el.scrollWidth, el.clientWidth]), labels: [...document.querySelectorAll('.admin-os-stage-label')].map((el) => ({ text: el.textContent, scroll: el.scrollWidth, width: el.clientWidth, whiteSpace: getComputedStyle(el).whiteSpace })) }))
    assert.equal(metrics.scrollWidth, width, JSON.stringify(metrics))
    for (const [scroll, size] of metrics.table) assert.ok(scroll <= size + 1, JSON.stringify(metrics))
    for (const label of metrics.labels) { assert.equal(label.whiteSpace, 'nowrap'); assert.ok(label.scroll <= label.width + 1, JSON.stringify(metrics)) }
    await page.screenshot({ path: `${directory}/panel-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.getByRole('button', { name: 'Modo de exibição', exact: true }).click()
  await page.waitForFunction(() => Boolean(document.fullscreenElement))
  assert.ok(await page.locator('.admin-os-table-wrap').evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
  await page.getByRole('button', { name: 'Sair do modo de exibição', exact: true }).click()
  await fixture.mutateStore((store) => {
    const row = store.orders.find((row) => row.code === order.code)
    const all = serviceStageGroups.flatMap(([, stages]) => stages.map(([key]) => key))
    row.resources.stages = all
    row.proposal.stages = all
    row.operation.stages = all.map((key, i) => ({ key: `stage-${i}`, name: stageLabel(key) }))
  })
  await page.reload()
  await page.locator('.admin-os-stage-label').nth(14).waitFor()
  for (const width of [1280, 430, 393]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(150)
    assert.ok(await page.locator('.admin-os-table-wrap').evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
    assert.ok(await page.locator('.admin-os-stage-label').evaluateAll((labels) => labels.every((el) => el.scrollWidth <= el.clientWidth + 1)))
    await page.screenshot({ path: `${directory}/panel-all-stages-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.locator('.sidebar').getByRole('button', { name: 'Relatórios', exact: true }).click()
  await page.getByLabel('Tipo de relatório').selectOption('machine-hours')
  await page.getByLabel('Data de início').fill('2026-09-01')
  await page.getByLabel('Data de fim').fill('2026-09-02')
  await page.getByRole('checkbox', { name: 'Horas ociosas', exact: true }).check()
  await page.getByRole('button', { name: 'Consultar', exact: true }).click()
  await page.getByRole('tab', { name: /Utilização e ociosidade/ }).click()
  await page.locator('.reports-table-scroll').getByText('25', { exact: true }).waitFor()
  await page.screenshot({ path: `${directory}/machine-idle-report.png`, fullPage: true })
  for (const format of ['PDF', 'Excel']) {
    const event = page.waitForEvent('download')
    await page.getByRole('button', { name: `Baixar ${format}`, exact: true }).click()
    assert.equal(await (await event).failure(), null)
  }
  assert.deepEqual(errors, [])
  console.log('Document audit: 12 PDFs + long-text stress, 10 workbooks, idle-hour selection/exports, fullscreen and 7/15 single-line stages at six widths passed.')
} finally { await browser.close(); await fixture.close() }
