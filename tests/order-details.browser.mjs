import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium, webkit } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste', DEMO_ADMIN_NAME: 'Gustavo' } })
const browser = await (process.env.BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('dialog', async (dialog) => { errors.push(`Unexpected browser dialog: ${dialog.type()}`); await dialog.dismiss() })
let historyRequests = 0
page.on('request', (request) => { if (request.url().endsWith('/events')) historyRequests += 1 })

async function createOrder(service, resources) {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service, description: 'Fabricacao de estrutura metalica conforme desenho.\nSoldagem seguida de pintura.' })).data.item
  const response = await fetch(`${fixture.url}/api/offers/${offer.id}/attachments?name=desenho.txt&type=text/plain`, { method: 'POST', headers: { ...fixture.admin, 'Content-Type': 'application/octet-stream' }, body: 'Desenho de teste da estrutura' })
  assert.equal(response.status, 201)
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', resources)
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Opção A', deadline: '2026-10-05', serviceValue: 600, materials: 200, labor: 400, discount: 0, margin: 10, machine: '20 horas', serviceTime: '20 horas' } })
  return (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
}

async function viewOrder(service) {
  await page.locator('.sidebar').getByRole('button', { name: 'Serviços em andamento', exact: true }).click()
  await page.locator('.admin-os-table tbody tr').filter({ hasText: service }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  await page.locator('.os-detail-title h2').getByText(service, { exact: true }).waitFor()
}

try {
  const order = await createOrder('Estrutura metalica principal', {
    materials: [{ id: 'material-1', name: 'Alumínio 6061', detail: 'Chapa 10 mm', quantity: 10, unitPrice: 20 }],
    laborEntries: [{ id: 'labor-1', type: 'machine', resource: 'Maquina de solda', hours: 20, hourlyRate: 20 }], stages: ['welding', 'painting'], kind: 'service',
  })
  const legacy = await createOrder('Projeto sem operacoes', { materials: [], laborEntries: [], stages: ['cutting'], kind: 'product' })
  await fixture.mutateStore((store) => { store.orders.find((item) => item.code === legacy.code).proposal.stages = [] })
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'ana@example.invalid', identification: '001' }, fixture.admin)).data.item
  const headers = { Authorization: `Bearer ${fixture.operatorToken}` }
  const route = `/operations/orders/${order.code}`
  // Materials still pending must be acknowledged before the work starts.
  const pendingStart = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id }, headers)
  const started = pendingStart.status === 409 ? await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id, pendingMaterialsConfirmation: pendingStart.data.pendingMaterials?.map((row) => [row.key, row.quantity]) }, headers) : pendingStart
  const session = { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken }
  await fixture.request(`${route}/stages/stage-1`, 'POST', { ...session, quantity: 3 }, headers)
  await fixture.request(`${route}/pause`, 'POST', { ...session, reason: 'Descanso' }, headers)
  await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id, pendingMaterialsConfirmation: pendingStart.data.pendingMaterials?.map((row) => [row.key, row.quantity]) }, headers)
  await page.clock.install()
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill('12345678901')
  await page.getByLabel('Senha', { exact: true }).fill('teste')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Serviços em andamento', exact: true }).click()
  await page.getByRole('heading', { name: 'Painel de serviços em andamento' }).waitFor()
  await page.locator('.admin-os-table tbody tr').filter({ hasText: order.service }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  const article = page.locator('.os-detail')
  await article.waitFor()
  // The OS opens on its own screen, not inside the material requests.
  await page.getByRole('heading', { name: 'Ordem de serviço', exact: true }).waitFor()
  assert.deepEqual(await page.getByRole('tab').allTextContents(), ['Início', 'Serviços em andamento', 'Ordem de serviço'])
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(historyRequests, 0)
  await page.clock.fastForward(11000)
  assert.equal(historyRequests, 0)
  assert.equal(await article.locator('.os-proposal-option').innerText(), 'Opção A')
  assert.equal(await article.locator('.os-proposal-title').count(), 0)
  const value = async (label) => article.locator('.os-proposal .os-facts > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd').innerText()
  assert.match(await value('Valor do serviço'), /600,00/)
  assert.equal(await value('Prazo acordado'), '05/10/2026')
  assert.match(await value('Materiais'), /200,00/)
  assert.match(await value('Mão de obra'), /400,00/)
  assert.equal(await value('Desconto'), '0%')
  assert.equal(await value('Margem'), '10%')
  assert.equal(await value('Tipo'), 'Serviço')
  assert.equal(await value('Tempo de máquina'), '20 horas')
  assert.equal(await value('Tempo de serviço'), '20 horas')
  assert.deepEqual(await article.locator('.os-proposal-stages li').allTextContents(), ['1Soldagem', '2Pintura'])
  assert.match(await article.locator('.os-resource-table').first().innerText(), /Alumínio 6061.*Chapa 10 mm.*10 kg.*200,00/s)
  const pdfButton = article.getByRole('button', { name: 'Baixar PDF da proposta', exact: true })
  assert.ok(await pdfButton.evaluate((element) => getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(element).textDecorationLine === 'none'))
  const downloadPromise = page.waitForEvent('download')
  await pdfButton.click()
  const pdf = await downloadPromise
  assert.match(pdf.suggestedFilename(), /^Proposta-OF-.*\.pdf$/)
  assert.equal((await readFile(await pdf.path())).subarray(0, 4).toString(), '%PDF')
  const attachmentPromise = page.waitForEvent('download')
  await article.getByRole('button', { name: 'desenho.txt', exact: true }).click()
  assert.equal((await readFile(await (await attachmentPromise).path())).toString(), 'Desenho de teste da estrutura')
  const trigger = article.getByRole('button', { name: 'Histórico de operações', exact: true })
  await page.route('**/events', (request) => request.fulfill({ status: 503, json: { message: 'Falha simulada no histórico.' } }), { times: 1 })
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('alert').getByText('Falha simulada no histórico.').waitFor()
  await dialog.getByRole('button', { name: 'Tentar novamente' }).click()
  // The four production operations and the creation of the OS (the history of the OS is complete).
  await dialog.getByRole('status').getByText('5 operações registradas', { exact: true }).waitFor()
  assert.match(await dialog.innerText(), /OS criada/)
  assert.match(await dialog.innerText(), /Soldagem: \+3 peça\(s\), 3\/10 no total/)
  assert.match(await dialog.innerText(), /Descanso/)
  await page.screenshot({ path: 'test-results/order-history-desktop.png' })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.ok(await trigger.evaluate((element) => element === document.activeElement))
  const interrupt = article.getByRole('button', { name: 'Encerrar sessão ativa com justificativa' })
  let interruptRequests = 0
  page.on('request', (request) => { if (request.url().endsWith('/interrupt')) interruptRequests += 1 })
  for (const action of ['Cancelar', 'Fechar janela', 'Escape', 'backdrop']) {
    await interrupt.click()
    await dialog.getByLabel('Justificativa').waitFor()
    assert.ok(await dialog.getByLabel('Justificativa').evaluate((element) => element === document.activeElement))
    if (action === 'Escape') await page.keyboard.press('Escape')
    else if (action === 'backdrop') await page.mouse.click(5, 5)
    else await dialog.getByRole('button', { name: action, exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.ok(await interrupt.evaluate((element) => element === document.activeElement))
  }
  assert.equal(interruptRequests, 0)
  await interrupt.click()
  const reason = dialog.getByLabel('Justificativa')
  await dialog.getByRole('button', { name: 'Encerrar sessão', exact: true }).click()
  assert.equal(interruptRequests, 0)
  await reason.fill('   ')
  await dialog.getByRole('button', { name: 'Encerrar sessão', exact: true }).click()
  await dialog.getByRole('alert').getByText('Informe a justificativa da interrupção.').waitFor()
  assert.equal(interruptRequests, 0)
  await reason.fill('  Manutencao preventiva  ')
  for (const width of [1366, 393, 430]) {
    await page.setViewportSize({ width, height: width < 500 ? 852 : 768 })
    const box = await dialog.boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= (width < 500 ? 852 : 768))
    assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth))
    await page.screenshot({ path: `test-results/order-interrupt-${process.env.BROWSER_ENGINE || 'chromium'}-${width}.png` })
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.route('**/interrupt', (route) => route.fulfill({ status: 503, json: { message: 'Falha simulada ao encerrar.' } }), { times: 1 })
  await dialog.getByRole('button', { name: 'Encerrar sessão', exact: true }).click()
  await dialog.getByRole('alert').getByText('Falha simulada ao encerrar.').waitFor()
  assert.equal(await reason.inputValue(), '  Manutencao preventiva  ')
  assert.ok((await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items.find((item) => item.code === order.code).operation.activeSession)
  let release
  const pending = new Promise((resolve) => { release = resolve })
  await page.route('**/interrupt', async (request) => { await pending; await request.continue() }, { times: 1 })
  await dialog.getByRole('button', { name: 'Encerrar sessão', exact: true }).click()
  await dialog.getByRole('button', { name: 'Encerrando...', exact: true }).waitFor()
  assert.ok(await dialog.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled())
  assert.ok(await dialog.getByRole('button', { name: 'Fechar janela', exact: true }).isDisabled())
  await page.keyboard.press('Escape')
  assert.equal(await dialog.count(), 1)
  release()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(interruptRequests, 2)
  await article.getByText('Sem sessão ativa', { exact: true }).waitFor()
  await trigger.click()
  await dialog.getByRole('status').getByText('6 operações registradas', { exact: true }).waitFor()
  assert.match(await dialog.innerText(), /Manutencao preventiva/)
  assert.match(await dialog.innerText(), /Operador: Ana Teste/)
  await dialog.getByRole('button', { name: 'Fechar histórico' }).click()
  await dialog.waitFor({ state: 'detached' })
  const closedRequests = historyRequests
  await page.clock.fastForward(11000)
  assert.equal(historyRequests, closedRequests)
  for (const width of [1600, 1366, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.screenshot({ path: `test-results/order-details-${width}.png`, fullPage: true })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflow at ${width}`)
    if (width >= 1366) {
      const left = await article.locator('.os-detail-primary').boundingBox()
      const right = await article.locator('.os-detail-secondary').boundingBox()
      assert.ok(right.x >= left.x + left.width)
    }
    await trigger.click()
    await dialog.getByRole('status').getByText('6 operações registradas', { exact: true }).waitFor()
    const box = await dialog.boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 1000)
    if (width === 390) await page.screenshot({ path: 'test-results/order-history-mobile.png' })
    await dialog.getByRole('button', { name: 'Fechar histórico' }).click()
    await dialog.waitFor({ state: 'detached' })
  }
  await page.setViewportSize({ width: 1366, height: 1000 })
  await viewOrder(legacy.service)
  await article.getByRole('button', { name: 'Histórico de operações', exact: true }).click()
  await dialog.getByText('1 operação registrada', { exact: true }).waitFor() // Without production, the history still shows the creation of the OS.
  await page.mouse.click(5, 5)
  await dialog.waitFor({ state: 'detached' })
  await article.getByLabel('Etapas na ordem de produção', { exact: true }).fill('Corte, Pintura')
  await article.getByRole('button', { name: 'Salvar etapas', exact: true }).click()
  await article.locator('.os-stage-list strong').getByText('Pintura', { exact: true }).waitFor()
  await article.getByRole('button', { name: 'Histórico de operações', exact: true }).click()
  await dialog.getByRole('status').getByText('2 operações registradas', { exact: true }).waitFor()
  assert.match(await dialog.innerText(), /Etapas configuradas.*Corte, Pintura/s)
  await dialog.getByRole('button', { name: 'Fechar histórico' }).click()
  await article.getByRole('button', { name: 'Voltar para a tela anterior', exact: true }).click()
  await page.getByRole('heading', { name: 'Painel de serviços em andamento' }).waitFor()
  assert.deepEqual(await page.getByRole('tab').allTextContents(), ['Início', 'Serviços em andamento'])
  assert.deepEqual(errors, [])
  console.log('OS details passed: separated proposal fields, responsive two-column layout, PDF/attachment downloads, collapsed on-demand history, error/retry, current operations, interrupt, legacy stage configuration, keyboard/backdrop close and return navigation.')
} catch (error) {
  await page.screenshot({ path: 'test-results/order-details-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
