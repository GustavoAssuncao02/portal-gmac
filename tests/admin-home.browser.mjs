import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createWorkflowFixture } from './workflowFixture.js'

const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
let userName = 'Gustavo Almeida'
let inventoryStatus = 200
let inventory = [
  { id: 1, name: 'Inox zerado', detail: 'Chapa', quantity: 0, minimum: 15, unitPrice: 20 },
  { id: 2, name: 'Ferro critico', detail: 'Barra', quantity: 2, minimum: 20, unitPrice: 10 },
  { id: 3, name: 'Aco no minimo', detail: 'Perfil', quantity: 4, minimum: 4, unitPrice: 15 },
  { id: 4, name: 'Aluminio disponivel', detail: 'Chapa', quantity: 50, minimum: 10, unitPrice: 30 },
]
const home = page.locator('.admin-home-main')
const navigate = (label) => page.locator('.sidebar').getByRole('button', { name: label === 'Dashboard' ? 'In\u00edcio' : label, exact: true }).click()
const order = (code, service, deadline, status = 'waiting', fields = {}) => ({
  code, offerId: `offer-${code}`, service, company: 'Cliente industrial', cnpj: '12345678000190', labelNumber: '120', description: 'Estrutura conforme desenho', quantity: 10,
  requestedAt: '2026-09-01T12:00:00Z', createdAt: '2026-09-01T12:00:00Z', deadline, attachments: [], resources: { materials: [], laborEntries: [] },
  proposal: { key: 'A', title: 'Opção A', deadline, serviceValue: 600, materials: 200, labor: 400, kind: 'service', stages: ['welding'] },
  operation: { status, stages: [{ key: 'stage-1', name: 'Soldagem' }], stageCounts: { 'stage-1': 0 }, accumulatedMs: 0, activeSession: null }, ...fields,
})
async function login(name) {
  await page.getByLabel('CPF', { exact: true }).fill('12345678901')
  await page.getByLabel('Senha', { exact: true }).fill('teste')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await home.getByRole('heading', { name: `Bem-vindo, ${name}`, exact: true }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.home-stock-title small')?.textContent.includes('Carregando') && !document.querySelector('.home-orders')?.textContent.includes('Carregando'))
}
async function metric(label) {
  return home.locator('.home-metric').filter({ hasText: label }).locator('strong').innerText()
}
try {
  await fixture.mutateStore((store) => {
    store.orders = [order('OS-0004', 'Entrega distante', '2026-10-30'), order('OS-0005', 'Sem prazo', ''), order('OS-0002', 'Entrega hoje', '2026-10-03', 'running'), order('OS-0003', 'Entrega proxima', '2026-10-05'), order('OS-0001', 'Atrasada prioritaria', '2026-12-20', 'paused', { proposal: { deadline: '2026-10-02', key: 'A', serviceValue: 600 } }), order('OS-0006', 'Concluida aguardando leitura', '2026-10-01', 'completed'), order('OS-0007', 'Concluida confirmada', '2026-10-01', 'completed', { operation: { status: 'completed', completionAcknowledgedAt: '2026-10-02', stages: [], stageCounts: {}, accumulatedMs: 0 } })]
    store.offers = [
      { id: 'review-1', code: 'OF-001', status: 'review', service: 'Oferta nova', company: 'Cliente', quantity: 10, deadline: '2026-10-20', requestedAt: '2026-10-02', resources: { materials: [{ id: 'metal', name: 'Metal especial novo', quantity: 10, purchaseQuantity: 10, stockStatus: 'unknown' }], laborEntries: [] } },
      { id: 'review-2', code: 'OF-002', status: 'review', service: 'Outra oferta', resources: { materials: [], laborEntries: [] } },
    ]
  })
  await page.route('**/api/auth/login', (route) => route.fulfill({ status: 200, json: { user: { id: 1, name: userName, cpf: '12345678901' } } }))
  await page.route('**/api/payables', (route) => route.fulfill({ status: 200, json: { items: [] } }))
  await page.route('**/api/inventory', (route) => route.fulfill({ status: inventoryStatus, json: inventoryStatus === 200 ? { items: inventory } : { message: 'Estoque indisponivel' } }))
  await page.clock.install({ time: new Date('2026-10-03T15:00:00-03:00') })
  await page.goto(fixture.url)
  await login('Gustavo')
  assert.equal(await page.getByRole('tab', { name: 'In\u00edcio', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.locator('.account-copy strong').innerText(), 'Gustavo Almeida')
  assert.equal(await page.locator('.account-copy > span').innerText(), 'Administrador')
  assert.equal(await metric('OS em aberto'), '5')
  assert.equal(await metric('Em execução'), '1')
  assert.equal(await metric('OS atrasadas'), '1')
  assert.equal(await metric('Ofertas em análise'), '2')
  assert.deepEqual(await home.locator('.home-order-link strong').allTextContents(), ['Atrasada prioritaria', 'Entrega hoje', 'Entrega proxima', 'Entrega distante', 'Sem prazo'])
  assert.match(await home.locator('.home-orders tbody tr').first().innerText(), /02\/10\/2026/)
  assert.deepEqual(await home.locator('.home-stock-item strong').allTextContents(), ['Inox zerado', 'Ferro critico', 'Aco no minimo'])
  assert.equal(await home.locator('.home-stock-title small').innerText(), '3 materiais')
  assert.equal(await home.locator('.home-attention-item').filter({ hasText: 'Materiais aguardando aprovação' }).locator('strong').innerText(), '1')
  assert.equal(await home.locator('.home-attention-item').filter({ hasText: 'OS concluídas aguardando confirmação' }).locator('strong').innerText(), '1')
  assert.ok(await page.locator('.sidebar-logo img').evaluate((element) => element.complete && element.naturalWidth > 0))
  assert.ok(await home.locator('*').evaluateAll((elements) => elements.every((element) => getComputedStyle(element).animationName === 'none' && getComputedStyle(element).transitionDuration === '0s')))
  await page.screenshot({ path: 'test-results/admin-home-desktop.png', fullPage: true })
  await home.getByRole('button', { name: 'Abrir estoque baixo', exact: true }).click()
  await page.getByRole('heading', { name: 'Estoque', exact: true }).waitFor()
  assert.equal(await page.locator('.account-copy strong').innerText(), 'Gustavo Almeida')
  await navigate('Dashboard')
  await home.getByRole('button', { name: 'Calculadora de pesos e medidas', exact: true }).click()
  await page.getByRole('heading', { name: 'Calculadora de pesos e medidas', exact: true }).waitFor()
  await navigate('Dashboard')
  await home.locator('.home-order-link').filter({ hasText: 'Atrasada prioritaria' }).click()
  await page.locator('.os-detail-title').getByText('OS-0001', { exact: true }).waitFor()
  await navigate('Dashboard')
  await home.getByRole('button', { name: 'Ver todas', exact: true }).click()
  await page.getByRole('heading', { name: 'Painel de serviços em andamento', exact: true }).waitFor()
  await navigate('Dashboard')
  await home.locator('.home-attention-item').filter({ hasText: 'Pedidos de material' }).click()
  await page.getByRole('heading', { name: 'Pedidos de material', exact: true }).waitFor()
  await navigate('Dashboard')
  inventory = inventory.map((item) => ({ ...item, quantity: 100 }))
  await home.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await home.getByText('Nenhum material abaixo do mínimo.', { exact: true }).waitFor()
  inventoryStatus = 500
  await home.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await home.getByRole('alert').getByText('Não foi possível atualizar o estoque. Exibindo os últimos dados disponíveis.', { exact: true }).waitFor()
  inventoryStatus = 503
  await home.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await home.getByText('Estoque local', { exact: true }).waitFor()
  assert.equal(await home.getByRole('alert').count(), 0)
  inventoryStatus = 200
  inventory[0].quantity = 0
  await home.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await home.locator('.home-stock-title small').getByText('1 material', { exact: true }).waitFor()
  for (const [name, width, height] of [['wide', 1600, 950], ['desktop', 1366, 900], ['tablet-wide', 1050, 850], ['tablet', 900, 800], ['narrow', 768, 900], ['mobile', 390, 844], ['mobile-small', 320, 740]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} page overflow`)
    assert.ok(await home.locator('h1, h2, .home-calculator > span, .home-attention-item > span').evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth)), `${name} text fits`)
    await page.screenshot({ path: `test-results/admin-home-${name}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await page.getByRole('heading', { name: 'Entrar no sistema', exact: true }).waitFor()
  userName = 'Fernanda Oliveira'
  await login('Fernanda')
  assert.equal(await page.locator('.account-copy strong').innerText(), 'Fernanda Oliveira')
  assert.equal(await page.getByRole('tab').count(), 1)
  await fixture.mutateStore((store) => { store.orders = []; store.offers = [] })
  await page.clock.fastForward(10000)
  await home.getByText('Nenhuma OS em aberto.', { exact: true }).waitFor()
  assert.equal(await metric('OS em aberto'), '0')
  assert.equal(await metric('Ofertas em análise'), '0')
  await page.screenshot({ path: 'test-results/admin-home-empty.png', fullPage: true })
  await fixture.mutateStore((store) => { store.orders = Array.from({ length: 8 }, (_, index) => order(`OS-${index}`, `Projeto ${index}`, `2026-10-${20 + index}`)) })
  await page.clock.fastForward(10000)
  await home.getByText('8 ordens de serviço', { exact: true }).waitFor()
  assert.equal(await home.locator('.home-orders tbody tr').count(), 6)
  await home.getByRole('button', { name: 'Ver mais 2 ordens de serviço', exact: true }).click()
  await page.getByRole('heading', { name: 'Painel de serviços em andamento', exact: true }).waitFor()
  assert.equal(await page.locator('.admin-os-table tbody tr').count(), 8)
  await navigate('Dashboard')
  await page.route('**/api/operations/orders', (route) => route.fulfill({ status: 503, json: { message: 'Falha simulada nas OS.' } }), { times: 1 })
  await home.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await home.getByRole('alert').getByText('Não foi possível carregar ofertas e OS: Falha simulada nas OS.', { exact: true }).waitFor()
  assert.equal(await home.locator('.home-orders tbody tr').count(), 6)
  await home.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.home-error'))
  assert.deepEqual(errors, [])
  console.log('Admin home passed: linked names/default home, real sorted deadlines and stats, low inventory, pending material/completion counts, navigation and refresh, cached stock/error/recovery, empty state, identity isolation, no animations, loaded logo, and seven desktop/mobile sizes.')
} catch (error) {
  await page.screenshot({ path: 'test-results/admin-home-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
