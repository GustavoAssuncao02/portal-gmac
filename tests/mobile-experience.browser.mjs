import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit, devices } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'
import { stageLabel } from '../server/serviceStages.js'

const before = process.argv.includes('--before')
const dark = process.argv.includes('--dark')
const fontFamily = process.argv.includes('--verdana') ? 'verdana' : 'default'
const fontSize = process.argv.includes('--large-font') ? 'large' : process.argv.includes('--small-font') ? 'small' : 'default'
const engine = process.argv.includes('--chromium') ? chromium : webkit
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await engine.launch()
const directory = `test-results/mobile-${dark ? 'dark-' : ''}${fontFamily !== 'default' ? `${fontFamily}-` : ''}${fontSize !== 'default' ? `${fontSize}-font-` : ''}${before ? 'before' : engine.name()}`
await mkdir(directory, { recursive: true })
const results = []
const errors = []
const screens = ['Início', 'Máquinas', 'Estoque', 'Calculadora de pesos e medidas', 'Fornecedores', 'Administradores', 'Funcionários', 'Clientes', 'Serviços em andamento', 'Ofertas e serviços', 'Pedidos de material', 'Contas a Pagar', 'Business Intelligence', 'Classificações', 'Relatórios', 'Configurações']
const slug = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()

try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const headers = { Authorization: `Bearer ${token}` }
  if (dark) assert.equal((await fixture.request('/account/appearance', 'PATCH', { theme: 'dark' }, headers)).status, 200)
  if (fontSize !== 'default') assert.equal((await fixture.request('/account/appearance', 'PATCH', { fontSize }, headers)).status, 200)
  if (fontFamily !== 'default') assert.equal((await fixture.request('/account/appearance', 'PATCH', { fontFamily }, headers)).status, 200)
  const request = async (path, body) => {
    const response = await fixture.request(path, 'POST', body, headers)
    assert.ok(response.status < 300, `${path}: ${JSON.stringify(response.data)}`)
    return response.data
  }
  const employee = (await request('/employees', { name: 'Ana Operadora Teste', identification: '001', cpf: '00000000001', birthDate: '1990-01-01', email: 'ana.operadora@example.invalid' })).item
  await request('/clients', { name: 'Industria de Estruturas Metalicas Teste', documentType: 'cnpj', document: offerDraft.cnpj, email: 'compras.industria@example.invalid' })
  const machine = (await request('/machines', { name: 'Centro de Usinagem CNC 01', type: 'Centro de Usinagem', sector: 'Usinagem', hourlyRate: 80 })).item
  const supplier = (await request('/suppliers', { name: 'Fornecedor de Materiais Metalurgicos Teste', document: offerDraft.cnpj, email: 'financeiro.materiais@example.invalid', phone: '71999999999' })).item
  const classification = (await request('/classifications', { name: 'Materiais e insumos de producao' })).item
  await request('/payables', { supplierId: supplier.id, classificationId: classification.id, description: 'Compra de chapas de aco para estrutura metalica', documentNumber: 'NF-MOBILE-001', issueDate: todayBahia(), dueDate: todayBahia(), value: '1450.50', kind: 'normal' })
  const offer = (await request('/offers', { ...offerDraft, service: 'Estrutura metalica industrial', company: 'Industria de Estruturas Metalicas Teste' })).item
  const material = { id: 'material-mobile', name: 'Chapa de aco galvanizado', detail: 'Espessura 3 mm', quantity: 12, unitPrice: 20 }
  const resources = { materials: [material], laborEntries: [{ id: 'labor-mobile', type: 'machine', resource: 'Centro de Usinagem CNC 01', hours: 5, hourlyRate: 80 }], stages: ['turning', 'milling', 'cnc-turning', 'painting', 'cut-bend', 'torch-cut', 'structural-assembly'], kind: 'service' }
  assert.ok((await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', resources, headers)).status < 300)
  await request(`/offers/${offer.id}/proposal`, { layout: 'classic', proposal: { key: 'A', deadline: '2026-12-20', serviceValue: 640, stages: resources.stages, kind: 'service' } })
  await request(`/offers/${offer.id}/accept`, {})
  await fixture.mutateStore((store) => {
    const order = store.orders[0]
    const at = new Date(), started = new Date(at.getTime() - 7200000)
    const actor = { employeeId: employee.id, employeeName: employee.name, machineId: machine.id, machineName: machine.name, sessionId: 'mobile-session' }
    order.operationEvents = [{ ...actor, id: 'mobile-start', type: 'started', at: started.toISOString() }, { ...actor, id: 'mobile-pause', type: 'paused', at: at.toISOString(), durationMs: 7200000, reason: 'Pausa para manutencao preventiva' }]
    order.operation = { status: 'paused', accumulatedMs: 7200000, activeSession: null, stages: resources.stages.map((key, index) => ({ key: `stage-${index + 1}`, name: stageLabel(key) })) }
    order.operation.stageCounts = Object.fromEntries(order.operation.stages.map((stage, index) => [stage.key, index < 3 ? 7 : 4]))
  })
  const review = (await request('/offers', { ...offerDraft, service: 'Reforma de conjunto mecanico', company: 'Industria de Estruturas Metalicas Teste' })).item
  await fixture.adminRequest(`/offers/${review.id}/resources`, 'PUT', resources, headers)
  assert.ok((await fixture.request(`/material-requests/${encodeURIComponent(`${review.id}-${material.id}`)}/approve`, 'POST', {}, headers)).status < 300)

  for (const deviceName of ['iPhone 15', 'iPhone 15 Pro Max']) {
    const context = await browser.newContext({ ...devices[deviceName], timezoneId: 'America/Bahia' })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    if (dark) await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    await page.waitForFunction((value) => document.documentElement.dataset.fontSize === value, fontSize)
    await page.waitForFunction((value) => document.documentElement.dataset.fontFamily === value, fontFamily)
    const width = devices[deviceName].viewport.width
    if (!before) {
      await page.getByRole('button', { name: 'Abrir menu de navegação', exact: true }).click()
      assert.equal(await page.locator('main').evaluate((el) => el.inert), true)
      await page.screenshot({ path: `${directory}/${slug(deviceName)}-menu.png` })
      await page.getByRole('button', { name: 'Fechar menu', exact: true }).press('Shift+Tab')
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Sair')
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Fechar menu')
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('main').evaluate((el) => el.inert), false)
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Abrir menu de navegação')
    }
    async function navigate(name) {
      const opener = page.getByRole('button', { name: 'Abrir menu de navegação', exact: true })
      if (await opener.isVisible()) await opener.click()
      const item = page.locator('.sidebar').getByRole('button', { name, exact: true })
      if (!(await item.isVisible())) await page.locator('.sidebar').getByRole('button', { name: ['Fornecedores', 'Administradores', 'Funcionários', 'Clientes'].includes(name) ? 'Cadastros' : 'Gestão Financeira', exact: true }).click()
      await item.click()
      await page.waitForTimeout(200)
      await page.evaluate(() => window.scrollTo(0, 0))
    }
    async function capture(name, locator) {
      await page.waitForTimeout(150)
      const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, mainWidth: document.querySelector('.dashboard-shell > main')?.clientWidth }))
      results.push({ deviceName, name, ...metrics })
      if (!before) assert.ok(metrics.scrollWidth <= metrics.width, `${deviceName} ${name}: page overflow ${metrics.scrollWidth}`)
      if (!before) {
        assert.equal(metrics.width, devices[deviceName].viewport.width, `${name}: Safari must not expand its layout viewport`)
        if (fontSize !== 'default') {
          const smallFields = await page.locator('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), select, textarea').evaluateAll((fields) => fields.filter((field) => field.getBoundingClientRect().width && parseFloat(getComputedStyle(field).fontSize) < 16).map((field) => field.className))
          assert.deepEqual(smallFields, [], `${name}: mobile fields must not trigger automatic Safari zoom`)
        }
        const rowOverflow = await page.locator('.pending-material-row:not(.pending-material-row--header), .machine-row:not(.machine-row--header), .inventory-row:not(.inventory-row--header), .registration-list-row:not(.registration-list-row--header), .offers-table-row:not(.offers-table-header), .admin-os-table tbody tr, .payable-table tbody tr').evaluateAll((rows) => rows.filter((row) => row.scrollWidth > row.clientWidth + 1).map((row) => row.className))
        assert.deepEqual(rowOverflow, [], `${name}: a record must not be clipped`)
      }
      const path = `${directory}/${slug(deviceName)}-${slug(name)}.png`
      if (locator) await locator.screenshot({ path })
      else {
        await page.screenshot({ path, fullPage: true })
        await page.screenshot({ path: path.replace('.png', '-viewport.png') })
      }
    }
    const dialog = () => page.getByRole('dialog').last()
    async function modalCheck(name, buttonName, closeName) {
      await page.getByRole('button', { name: buttonName, exact: true }).click()
      await dialog().waitFor()
      await capture(name)
      if (!before) assert.ok(await dialog().evaluate((el) => el.scrollWidth <= el.clientWidth), `${name}: dialog overflow`)
      if (!before && name === 'Adicionar maquina') {
        assert.equal(await page.locator('main').evaluate((el) => el.inert), true)
        await dialog().evaluate((el) => [...el.querySelectorAll('button, input, select, textarea')].filter((control) => !control.disabled).at(-1).focus())
        await page.keyboard.press('Tab')
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Fechar')
      }
      await dialog().getByRole('button', { name: closeName, exact: true }).click()
      if (!before && name === 'Adicionar maquina') {
        assert.equal(await page.locator('main').evaluate((el) => el.inert), false)
        await page.getByRole('button', { name: buttonName, exact: true }).click()
        await dialog().waitFor()
        await page.keyboard.press('Escape')
        assert.equal(await page.getByRole('dialog').count(), 0)
      }
    }
    for (const name of screens) {
      console.log(`${deviceName}: ${name}`)
      await navigate(name)
      if (name === 'Contas a Pagar' || name === 'Fornecedores' || name === 'Classificações') await page.locator('.payable-table tbody tr').first().waitFor()
      await capture(name)
      if (name === 'Máquinas') await modalCheck('Adicionar maquina', 'Adicionar máquina', 'Fechar')
      if (name === 'Estoque') await modalCheck('Adicionar material', 'Adicionar material', 'Fechar')
      if (name === 'Fornecedores') await modalCheck('Novo fornecedor', 'Novo fornecedor', 'Fechar janela')
      if (name === 'Classificações') await modalCheck('Nova classificacao', 'Nova classificação', 'Fechar janela')
      if (name === 'Funcionários') await modalCheck('Historico funcionario', 'Ver histórico de Ana Operadora Teste', 'Fechar histórico')
      if (name === 'Ofertas e serviços') {
        await modalCheck('Inserir oferta', 'Inserir Oferta Manualmente', 'Fechar formulário')
        await page.locator('.offers-table-row').filter({ hasText: 'Reforma de conjunto mecanico' }).getByRole('button', { name: 'Em análise', exact: true }).click()
        await page.locator('.offer-details-grid').waitFor()
        await capture('Detalhes da oferta')
        await page.getByRole('button', { name: 'Fazer proposta', exact: true }).click()
        await page.locator('.proposal-card-grid').waitFor()
        await capture('Propostas')
      }
      if (name === 'Serviços em andamento') {
        await page.getByRole('button', { name: 'Ver OS', exact: true }).first().click()
        await page.locator('.os-detail').waitFor()
        await capture('Detalhes da OS')
        await modalCheck('Historico da OS', 'Histórico de operações', 'Fechar histórico')
      }
      if (name === 'Contas a Pagar') {
        await modalCheck('Nova conta a pagar', 'Nova conta a pagar', 'Fechar janela')
        await page.locator('.payable-table tbody tr').first().click()
        await dialog().getByRole('heading', { name: 'Dados principais', exact: true }).waitFor()
        await capture('Detalhes da conta')
        await dialog().getByRole('button', { name: 'Dar baixa', exact: true }).click()
        await capture('Pagamento da conta')
        await dialog().getByRole('button', { name: 'Fechar janela', exact: true }).click()
      }
      if (name === 'Relatórios') {
        await page.getByLabel('Tipo de relatório', { exact: true }).selectOption('employee-hours')
        await page.getByLabel('Data de início', { exact: true }).fill('2026-10-01')
        await page.getByLabel('Data de fim', { exact: true }).fill('2026-10-03')
        await page.getByRole('button', { name: 'Consultar', exact: true }).click()
        await page.locator('.reports-result').waitFor()
        await capture('Relatorio de horas')
      }
      if (!before && name === 'Máquinas') {
        await page.getByRole('button', { name: 'Adicionar máquina', exact: true }).click()
        await dialog().getByLabel('Nome da máquina', { exact: true }).fill(`Torno mobile ${width}`)
        await dialog().getByLabel('Tipo', { exact: true }).fill('Torno')
        await dialog().getByLabel('Setor', { exact: true }).fill('Usinagem')
        await dialog().getByLabel('Valor da hora (R$)', { exact: true }).fill('90')
        await dialog().getByRole('button', { name: 'Salvar máquina', exact: true }).click()
        await page.locator('.machine-row').filter({ hasText: `Torno mobile ${width}` }).waitFor()
        await page.getByRole('button', { name: `Editar Torno mobile ${width}`, exact: true }).click()
        assert.equal(await dialog().getByLabel('Nome da máquina').inputValue(), `Torno mobile ${width}`)
        await dialog().getByRole('button', { name: 'Fechar', exact: true }).click()
      }
      if (!before && name === 'Estoque') {
        await page.getByRole('button', { name: 'Adicionar material', exact: true }).click()
        await dialog().getByPlaceholder('Digite para buscar no estoque', { exact: true }).fill(`Aco mobile ${width}`)
        await dialog().getByLabel('Especificação', { exact: true }).fill('Barra 10 mm')
        await dialog().getByLabel(/^Quantidade disponível/).fill('15')
        await dialog().getByLabel('Estoque mínimo (kg)', { exact: true }).fill('5')
        await dialog().getByLabel('Valor por kg', { exact: true }).fill('20')
        await dialog().getByRole('button', { name: 'Adicionar material', exact: true }).click()
        // The purchase is offered to the financial module; here it is left for later.
        await page.getByRole('dialog', { name: 'Lançar esta compra no financeiro?', exact: true }).getByRole('button', { name: 'Não lançar agora', exact: true }).click()
        await page.locator('.inventory-row').filter({ hasText: `Aco mobile ${width}` }).waitFor()
        await page.getByRole('button', { name: `Ver histórico de Aco mobile ${width}`, exact: true }).click()
        await capture('Historico estoque')
        await dialog().getByRole('button', { name: 'Fechar', exact: true }).click()
        // Missing materials are requested in Pedidos de material; Estoque no longer has its own request window.
      }
      if (!before && name === 'Calculadora de pesos e medidas') {
        await page.locator('.calculator-mobile-choices').getByLabel('Material', { exact: true }).selectOption('carbon')
        await page.locator('.calculator-mobile-choices').getByLabel('Formato', { exact: true }).selectOption('flat')
        await page.getByLabel('Espessura (mm)', { exact: false }).fill('10')
        await page.getByLabel('Largura (mm)', { exact: false }).fill('100')
        assert.ok((await page.locator('.weight-result strong').innerText()).includes('8 kg'))
        await page.getByRole('button', { name: 'Limpar medidas', exact: true }).click()
        assert.equal(await page.locator('.measure-fields input').first().inputValue(), '')
        await page.locator('.conversion-controls select').first().selectOption('0')
        assert.equal(await page.locator('.conversion-controls select').last().inputValue(), '0')
      }
      if (!before && ['Administradores', 'Funcionários', 'Clientes'].includes(name)) {
        // Same pattern as Fornecedores: the list on screen, adding and editing in a modal.
        const singular = { Administradores: 'administrador', 'Funcionários': 'funcionário', Clientes: 'cliente' }[name]
        const nameLabel = name === 'Clientes' ? 'Nome / razão social' : 'Nome completo'
        const title = `Cadastro mobile ${name} ${width}`
        await page.getByRole('button', { name: `Novo ${singular}`, exact: true }).click()
        const form = page.getByRole('dialog', { name: `Novo ${singular}` })
        await form.getByLabel(nameLabel, { exact: true }).fill(title)
        await form.getByLabel('E-mail', { exact: true }).fill(`mobile.${slug(name)}.${width}@example.invalid`)
        if (name === 'Clientes') await form.getByRole('textbox', { name: 'CNPJ', exact: true }).fill(`11111111000${width}`)
        else {
          await form.getByLabel('Data de nascimento', { exact: true }).fill('1990-01-01')
          await form.getByRole('textbox', { name: 'CPF', exact: true }).fill(`11111111${width}`)
          if (name === 'Funcionários') await form.getByLabel(/^Código de acesso/).fill(String(width).padStart(4, '0'))
          else await form.getByPlaceholder('Crie uma senha de acesso', { exact: true }).fill('mobile123')
        }
        await form.getByRole('button', { name: 'Salvar', exact: true }).click()
        await form.waitFor({ state: 'detached' })
        const created = page.locator('.registration-table tbody tr').filter({ hasText: title })
        await created.waitFor()
        await created.getByRole('button', { name: `Editar ${title}`, exact: true }).click()
        const editing = page.getByRole('dialog', { name: `Editar ${singular}` })
        assert.equal(await editing.getByLabel(nameLabel, { exact: true }).inputValue(), title)
        await editing.getByRole('button', { name: 'Cancelar', exact: true }).click()
      }
      if (!before && name === 'Contas a Pagar') {
        await page.getByLabel('Ordenar por', { exact: true }).selectOption('valueCents')
        await page.getByRole('checkbox', { name: 'Selecionar contas da página', exact: true }).check()
        assert.ok(await page.locator('.payable-bulk-actions').isVisible())
        await page.getByRole('checkbox', { name: 'Selecionar contas da página', exact: true }).uncheck()
        await page.getByRole('button', { name: 'Filtros', exact: true }).click()
        await page.getByLabel('Vencimento inicial', { exact: true }).fill(todayBahia())
        await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
        await page.getByRole('button', { name: 'Nova conta a pagar', exact: true }).click()
        await dialog().getByLabel('Fornecedor', { exact: true }).selectOption(supplier.id)
        await dialog().getByLabel('Classificação', { exact: true }).selectOption(classification.id)
        await dialog().getByLabel('Descrição', { exact: true }).fill(`Conta mobile ${width}`)
        await dialog().getByLabel('Número do documento / boleto / nota fiscal', { exact: true }).fill(`NF-MOBILE-${width}`)
        await dialog().getByLabel('Valor', { exact: true }).fill((125 + width / 100).toFixed(2))
        await dialog().getByLabel('Vencimento', { exact: true }).fill(todayBahia())
        await page.setViewportSize({ width, height: 400 })
        assert.ok(await dialog().locator('footer').evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight))
        await page.setViewportSize(devices[deviceName].viewport)
        await dialog().getByRole('button', { name: 'Salvar conta', exact: true }).click()
        await page.locator('.payable-table tbody tr').filter({ hasText: `Conta mobile ${width}` }).waitFor()
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        const lastRecordBottom = await page.locator('.payable-table tbody tr').last().evaluate((el) => el.getBoundingClientRect().bottom)
        const paginationTop = await page.locator('.payable-pagination').evaluate((el) => el.getBoundingClientRect().top)
        assert.ok(lastRecordBottom <= paginationTop, 'Fixed pagination must not cover the last account')
      }
      if (!before && name === 'Relatórios') {
        for (const format of ['PDF', 'Excel']) {
          const downloadEvent = page.waitForEvent('download')
          await page.getByRole('button', { name: `Baixar ${format}`, exact: true }).click()
          const download = await downloadEvent
          assert.equal(await download.failure(), null)
        }
      }
      if (!before && name === 'Configurações') {
        await page.getByLabel('Contas a pagar a vencer', { exact: true }).selectOption('7')
        await page.getByRole('button', { name: 'Salvar notificações', exact: true }).click()
        await page.locator('.account-notification-settings .admin-tool-success').waitFor()
      }
    }
    if (!before) {
      await page.getByRole('button', { name: 'Fechar todas as abas', exact: true }).click()
      await page.locator('.admin-home-main').waitFor()
      assert.equal(await page.getByRole('tab').count(), 1)
      await page.reload()
      await page.locator('.admin-home-main').waitFor()
      assert.equal(await page.getByLabel('Senha', { exact: true }).count(), 0)
    }
    await context.close()
  }
  assert.deepEqual(errors, [])
  await writeFile(`${directory}/metrics.json`, JSON.stringify(results, null, 2))
  console.log(`Mobile audit: ${results.length} screens/dialogs, ${engine.name()}, both iPhones; errors: ${errors.length}`)
} finally {
  await browser.close()
  await fixture.close()
}
