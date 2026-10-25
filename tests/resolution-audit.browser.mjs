import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { identifiedOperator } from './operatorEntry.js'
import { todayBahia } from '../server/payableRules.js'
import { stageLabel } from '../server/serviceStages.js'

const resolutions = [[3456, 2234], [3024, 1964], [3072, 1920], [2880, 1864], [2880, 1800], [2560, 1664], [2560, 1600], [2304, 1440], [1440, 900], [1920, 1080]]
const before = process.argv.includes('--before')
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7)
const family = process.argv.includes('--verdana') ? 'verdana' : 'default'
const dark = process.argv.includes('--dark')
const directory = `test-results/resolutions-${before ? 'before' : 'after'}-${family}${dark ? '-dark' : ''}`
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
const results = [], errors = []
const screens = ['Início', 'Máquinas', 'Estoque', 'Calculadora de pesos e medidas', 'Fornecedores', 'Administradores', 'Funcionários', 'Clientes', 'Serviços em andamento', 'Ofertas e serviços', 'Pedidos de material', 'Contas a Pagar', 'Business Intelligence', 'Classificações', 'Relatórios', 'Configurações']
const slug = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
await mkdir(directory, { recursive: true })
try {
  const headers = { Authorization: `Bearer ${fixture.adminToken}` }
  async function request(path, body, method = 'POST') {
    const response = await fixture.request(path, method, body, headers)
    assert.ok(response.status < 300, `${path}: ${JSON.stringify(response.data)}`)
    return response.data
  }
  await request('/account/appearance', { fontFamily: family, theme: dark ? 'dark' : 'light' }, 'PATCH')
  const employee = (await request('/employees', { name: 'Ana Operadora Teste', identification: '001', cpf: '00000000001', birthDate: '1990-01-01', email: 'ana@example.invalid' })).item
  await request('/clients', { name: 'Industria de Estruturas Metalicas Teste', documentType: 'cnpj', document: offerDraft.cnpj, email: 'compras@example.invalid' })
  await request('/admins', { name: 'Administrador de Producao', cpf: '00000000002', birthDate: '1990-01-01', email: 'admin@example.invalid', password: 'teste123' })
  const machine = (await request('/machines', { name: 'Centro de Usinagem CNC 01', type: 'Centro de Usinagem', sector: 'Usinagem', hourlyRate: 80 })).item
  const supplier = (await request('/suppliers', { name: 'Fornecedor de Materiais Metalurgicos Teste', document: offerDraft.cnpj, email: 'financeiro@example.invalid', phone: '71999999999' })).item
  const classification = (await request('/classifications', { name: 'Materiais e insumos de producao' })).item
  await request('/payables', { supplierId: supplier.id, classificationId: classification.id, description: 'Compra de chapas de aco para estrutura metalica', documentNumber: 'NF-001', issueDate: todayBahia(), dueDate: todayBahia(), value: '1450.50', kind: 'normal' })
  const material = { id: 'material-audit', name: 'Chapa de aco galvanizado', detail: 'Espessura 3 mm', quantity: 12, unitPrice: 20 }
  const stages = ['turning', 'milling', 'cnc-turning', 'painting', 'cut-bend', 'torch-cut', 'structural-assembly']
  const resources = { materials: [material], laborEntries: [{ id: 'labor', type: 'machine', resource: machine.name, hours: 5, hourlyRate: 80 }], stages, kind: 'service', manufacturedFrom: 'drawing', tempering: true, paintColor: 'Azul epoxi', serviceDescription: 'Conferir medidas e acabamento conforme desenho tecnico.' }
  const accepted = (await request('/offers', { ...offerDraft, service: 'Estrutura metalica industrial', company: 'Industria de Estruturas Metalicas Teste' })).item
  await request(`/offers/${accepted.id}/resources`, resources, 'PUT')
  await request(`/offers/${accepted.id}/proposal`, { layout: 'classic', proposal: { key: 'A', deadline: '2026-12-20', serviceValue: 640, stages, kind: 'service' } })
  await request(`/offers/${accepted.id}/accept`, {})
  await fixture.mutateStore((store) => {
    const order = store.orders[0]
    const now = new Date(), start = new Date(now.getTime() - 7200000)
    const actor = { employeeId: employee.id, employeeName: employee.name, machineId: machine.id, machineName: machine.name, sessionId: 'audit-session' }
    order.operationEvents = [{ ...actor, id: 'start', type: 'started', at: start.toISOString() }, { ...actor, id: 'pause', type: 'paused', at: now.toISOString(), durationMs: 7200000, reason: 'Pausa para manutencao preventiva' }]
    order.operation = { status: 'paused', accumulatedMs: 7200000, activeSession: null, stages: stages.map((key, i) => ({ key: `stage-${i}`, name: stageLabel(key) })), stageCounts: Object.fromEntries(stages.map((_, i) => [`stage-${i}`, i < 3 ? 7 : 4])) }
  })
  const review = (await request('/offers', { ...offerDraft, service: 'Reforma de conjunto mecanico', company: 'Industria de Estruturas Metalicas Teste' })).item
  await request(`/offers/${review.id}/resources`, resources, 'PUT')
  await request(`/material-requests/${encodeURIComponent(`${review.id}-${material.id}`)}/approve`, {})

  for (const [width, height] of resolutions) {
    const resolution = `${width}x${height}`
    if (only && resolution !== only) continue
    console.log(`Starting ${resolution}`)
    await mkdir(`${directory}/${resolution}`, { recursive: true })
    const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'America/Bahia' })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push({ resolution, message: error.message }))
    async function capture(name, targetPage = page) {
      await targetPage.waitForTimeout(100)
      const metrics = await targetPage.evaluate(() => {
        const visible = (el) => el.getBoundingClientRect().width && el.getBoundingClientRect().height && getComputedStyle(el).visibility !== 'hidden'
        const main = document.querySelector('main')
        const nav = document.querySelector('.sidebar-nav'), active = nav?.querySelector('.nav-item--active')
        const bounds = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } }
        return {
          width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
          main: main && bounds(main),
          activeNavigationVisible: !active || (active.getBoundingClientRect().top >= nav.getBoundingClientRect().top - 1 && active.getBoundingClientRect().bottom <= nav.getBoundingClientRect().bottom + 1),
          sections: [...document.querySelectorAll('main > section, .registration-card, .registration-list-card, .inventory-stock-card, .calculator-workspace, .offer-details-grid, .proposal-card-grid, .os-detail-columns, .account-settings-form, .operator-workspace')].filter(visible).map((el) => ({ class: el.className, ...bounds(el) })),
          clipped: [...document.querySelectorAll('button, .admin-os-stage-label, main h1, main h2, main h3, dialog h2')].filter(visible).filter((el) => el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2).map((el) => ({ class: el.className, text: el.textContent.trim().slice(0, 90), width: el.clientWidth, scrollWidth: el.scrollWidth, height: el.clientHeight, scrollHeight: el.scrollHeight })),
          dialogs: [...document.querySelectorAll('dialog[open], [role=dialog]')].filter(visible).map((el) => ({ ...bounds(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })),
          tableOverflow: [...document.querySelectorAll('.machine-table-scroll, .inventory-table-scroll, .pending-material-list, .registration-list, .admin-os-table-scroll')].filter(visible).filter((el) => el.scrollWidth > el.clientWidth + 2).map((el) => ({ class: el.className, width: el.clientWidth, scrollWidth: el.scrollWidth })),
        }
      })
      results.push({ resolution, name, ...metrics })
      await targetPage.screenshot({ path: `${directory}/${resolution}/${slug(name)}.png` })
      if (!before) {
        assert.ok(metrics.scrollWidth <= width, `${resolution} ${name}: page overflow`)
        assert.deepEqual(metrics.clipped, [], `${resolution} ${name}: clipped text`)
        assert.deepEqual(metrics.tableOverflow, [], `${resolution} ${name}: horizontal table scroll`)
        assert.ok(metrics.activeNavigationVisible, `${resolution} ${name}: active navigation item outside menu viewport`)
        for (const modal of metrics.dialogs) {
          assert.ok(modal.x >= 0 && modal.y >= 0 && modal.x + modal.width <= width + 1 && modal.y + modal.height <= height + 1, `${resolution} ${name}: modal outside viewport`)
          assert.ok(modal.scrollWidth <= modal.clientWidth + 1, `${resolution} ${name}: modal overflow`)
        }
      }
    }
    async function navigate(name) {
      const button = page.locator('.sidebar').getByRole('button', { name, exact: true })
      if (!(await button.isVisible())) await page.locator('.sidebar').getByRole('button', { name: ['Fornecedores', 'Administradores', 'Funcionários', 'Clientes'].includes(name) ? 'Cadastros' : ['Serviços em andamento', 'Serviços concluídos', 'Ofertas e serviços'].includes(name) ? 'Operação' : 'Gestão Financeira', exact: true }).click()
      await button.click()
      await page.evaluate(() => window.scrollTo(0, 0))
    }
    async function modal(name, button, close) {
      await page.getByRole('button', { name: button, exact: true }).first().click()
      const dialog = page.getByRole('dialog').last()
      await dialog.waitFor()
      await capture(name)
      await dialog.getByRole('button', { name: close, exact: true }).click()
    }
    await page.goto(fixture.url)
    await capture('Login')
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    for (const name of screens) {
      await navigate(name)
      if (['Contas a Pagar', 'Fornecedores', 'Classificações'].includes(name)) await page.locator('.payable-table tbody tr').first().waitFor()
      await capture(name)
      if (name === 'Máquinas') {
        await modal('Cadastro de maquina', 'Adicionar máquina', 'Fechar')
        await modal('Historico da maquina', `Ver histórico de uso de ${machine.name}`, 'Fechar histórico')
      }
      if (name === 'Estoque') await modal('Cadastro de material', 'Adicionar material', 'Fechar')
      if (name === 'Fornecedores') await modal('Cadastro de fornecedor', 'Novo fornecedor', 'Fechar janela')
      if (name === 'Classificações') await modal('Cadastro de classificacao', 'Nova classificação', 'Fechar janela')
      if (name === 'Funcionários') await modal('Historico do funcionario', `Ver histórico de ${employee.name}`, 'Fechar histórico')
      if (name === 'Ofertas e serviços') {
        await modal('Cadastro de oferta', 'Inserir Oferta Manualmente', 'Fechar formulário')
        await page.locator('.offers-table-row').filter({ hasText: review.service }).getByRole('button', { name: 'Em análise', exact: true }).click()
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
        await modal('Historico da OS', 'Histórico de operações', 'Fechar histórico')
        await modal('Editar OS', 'Editar OS', 'Fechar edição')
      }
      if (name === 'Contas a Pagar') {
        await modal('Nova conta a pagar', 'Nova conta a pagar', 'Fechar janela')
        await page.locator('.payable-table tbody tr').first().click()
        const dialog = page.getByRole('dialog').last()
        await dialog.getByRole('heading', { name: 'Dados principais', exact: true }).waitFor()
        await capture('Detalhes da conta')
        await dialog.getByRole('button', { name: 'Dar baixa', exact: true }).click()
        await capture('Pagamento da conta')
        await dialog.getByRole('button', { name: 'Fechar janela', exact: true }).click()
      }
      if (name === 'Relatórios') {
        await page.getByLabel('Tipo de relatório', { exact: true }).selectOption('employee-hours')
        await page.getByLabel('Data de início', { exact: true }).fill(todayBahia())
        await page.getByLabel('Data de fim', { exact: true }).fill(todayBahia())
        await page.getByRole('button', { name: 'Consultar', exact: true }).click()
        await page.locator('.reports-result').waitFor()
        await capture('Relatorio de horas')
      }
    }
    const operatorContext = await browser.newContext({ viewport: { width, height }, timezoneId: 'America/Bahia' })
    await operatorContext.addInitScript(({ token, operator }) => { sessionStorage.setItem('gmac-operator-token', token); sessionStorage.setItem(...operator) }, { token: fixture.operatorToken, operator: identifiedOperator(employee) })
    const operatorPage = await operatorContext.newPage()
    operatorPage.on('pageerror', (error) => errors.push({ resolution, message: error.message }))
    await operatorPage.goto(fixture.url)
    await operatorPage.locator('.operator-project').first().click()
    await operatorPage.locator('.operator-detail').waitFor()
    await capture('Operador projeto', operatorPage)
    await operatorPage.getByRole('button', { name: 'Visualizar informações do projeto', exact: true }).click()
    await operatorPage.locator('.operator-project-info').waitFor()
    await capture('Operador informacoes', operatorPage)
    await operatorContext.close()
    await context.close()
    await writeFile(`${directory}/metrics.json`, JSON.stringify(results, null, 2))
    console.log(`Finished ${resolution}: ${results.filter((row) => row.resolution === resolution).length} screens/dialogs`)
  }
  assert.deepEqual(errors, [])
  console.log(`Audit complete: ${results.length} views; ${results.filter((row) => row.clipped.length || row.scrollWidth > row.width).length} layout issues.`)
} finally { await writeFile(`${directory}/metrics.json`, JSON.stringify(results, null, 2)); await browser.close(); await fixture.close() }
