// Contas a Pagar, Contas a Receber e Tesouraria mantêm itens por página, ordenação, busca e página ao trocar de tela e ao
// recarregar; os atalhos da tela inicial não apagam a escolha, e sair do sistema volta ao padrão.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = async (route, method, body) => { const result = await fixture.request(route, method, body, { Authorization: `Bearer ${token}` }); assert.ok(result.status < 300, `${route}: ${JSON.stringify(result.data)}`); return result.data }
  const supplier = (await api('/suppliers', 'POST', { name: 'Fornecedor teste', document: '12345678000190' })).item
  const classification = (await api('/classifications', 'POST', { name: 'Despesas teste' })).item
  // 25 contas abertas, para haver mais de uma página de 20; 3 pagas, para a Tesouraria.
  for (let index = 1; index <= 25; index++) await api('/payables', 'POST', { supplierId: supplier.id, classificationId: classification.id, description: `Conta ${index}`, documentNumber: `NF ${index}`, issueDate: '2026-09-01', dueDate: `2027-01-${String(index).padStart(2, '0')}`, value: String(100 + index), kind: 'normal' })
  for (const [description, value] of [['Paga menor', '50'], ['Paga maior', '900'], ['Paga media', '400']]) {
    const created = await api('/payables', 'POST', { supplierId: supplier.id, classificationId: classification.id, description, issueDate: '2026-09-01', dueDate: '2026-10-01', value, kind: 'normal' })
    await api(`/payables/${created.items[0].id}/pay`, 'POST', { date: '2026-10-01', method: 'pix' })
  }
  for (let index = 1; index <= 25; index++) await api('/receivables', 'POST', { customerName: 'Cliente teste', description: `Recebimento ${index}`, issueDate: '2026-09-01', dueDate: `2027-02-${String((index % 27) + 1).padStart(2, '0')}`, value: String(200 + index), kind: 'single', count: 1 })

  const login = async () => {
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
  }
  const navigate = async (name) => {
    const item = page.locator('.sidebar').getByRole('button', { name, exact: true })
    if (!await item.isVisible()) await page.locator('.sidebar').getByRole('button', { name: 'Gestão Financeira', exact: true }).click()
    await item.click()
  }
  await page.goto(fixture.url)
  await login()

  const table = (selector) => page.locator(selector)
  const perPage = () => page.getByLabel('Por página', { exact: true })
  const search = () => page.getByLabel('Busca rápida', { exact: true })
  const sortOf = (selector, label) => table(selector).locator('thead th').filter({ hasText: label }).getAttribute('aria-sort')
  const rows = (selector) => table(selector).locator('tbody tr').count()
  const position = () => page.locator('.payable-pagination > span').nth(1).innerText()

  // 1. Cada tela guarda a própria escolha, e voltar não apaga nada.
  const screens = [
    { name: 'Contas a Pagar', table: '.payable-table', other: 'Contas a Receber', ready: async () => {} },
    { name: 'Contas a Receber', table: '.receivable-table', other: 'Contas a Pagar', ready: async () => {} },
    { name: 'Tesouraria', table: '.treasury-table', other: 'Contas a Pagar', ready: async () => { await page.getByRole('group', { name: 'Período', exact: true }).getByRole('button', { name: 'Todo o período', exact: true }).click() } },
  ]
  for (const screen of screens) {
    await navigate(screen.name)
    await table(`${screen.table} tbody tr`).first().waitFor()
    await screen.ready()
    await perPage().selectOption('100')
    const button = table(screen.table).locator('thead').getByRole('button', { name: 'Valor' })
    await button.click()
    await button.click()
    const direction = await sortOf(screen.table, 'Valor')
    const firstRow = await table(screen.table).locator('tbody tr').first().innerText()
    const count = await rows(screen.table)
    for (const step of ['trocar de tela', 'recarregar']) {
      if (step === 'trocar de tela') { await navigate(screen.other); await page.getByRole('heading', { name: screen.other, exact: true }).waitFor(); await navigate(screen.name) } else await page.reload()
      await table(`${screen.table} tbody tr`).first().waitFor()
      await page.waitForFunction(([selector, wanted]) => document.querySelectorAll(`${selector} tbody tr`).length === wanted, [screen.table, count])
      assert.equal(await perPage().inputValue(), '100', `${screen.name}: itens por página depois de ${step}`)
      assert.equal(await sortOf(screen.table, 'Valor'), direction, `${screen.name}: ordenação depois de ${step}`)
      assert.equal(await table(screen.table).locator('tbody tr').first().innerText(), firstRow, `${screen.name}: primeira linha depois de ${step}`)
    }
  }
  assert.equal(await sortOf('.treasury-table', 'Valor'), 'ascending', 'in Tesouraria the value starts descending: two clicks end ascending')

  // 2. Busca, filtro e página também voltam.
  await navigate('Contas a Pagar')
  await table('.payable-table tbody tr').first().waitFor()
  await perPage().selectOption('20')
  await page.getByRole('button', { name: 'Próxima página', exact: true }).click()
  assert.equal(await position(), '2 / 2')
  await navigate('Tesouraria')
  await table('.treasury-table tbody tr').first().waitFor()
  await navigate('Contas a Pagar')
  await table('.payable-table tbody tr').first().waitFor()
  assert.equal(await position(), '2 / 2', 'the page is kept')
  await search().fill('Conta 1')
  await page.waitForFunction(() => document.querySelectorAll('.payable-table tbody tr').length === 11)
  assert.equal(await position(), '1 / 1', 'a new search goes back to the first page')
  await navigate('Contas a Receber')
  await table('.receivable-table tbody tr').first().waitFor()
  assert.equal(await search().inputValue(), '', 'each screen has its own search')
  await navigate('Contas a Pagar')
  assert.equal(await search().inputValue(), 'Conta 1')

  // 3. Os atalhos da tela inicial são temporários: não apagam a escolha, e o menu volta para ela.
  await navigate('Início')
  await page.locator('.home-payable--open').click()
  await page.getByRole('heading', { name: 'Contas a Pagar', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.payable-table tbody tr').length > 11)
  assert.equal(await search().inputValue(), '', 'the shortcut opens without the saved search')
  await navigate('Contas a Pagar')
  await page.waitForFunction(() => document.querySelector('[aria-label="Busca rápida"]')?.value === 'Conta 1')

  // 4. Limpar filtros mantém a ordenação e os itens por página.
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  assert.equal(await search().inputValue(), '')
  assert.equal(await sortOf('.payable-table', 'Valor'), 'descending')

  // 5. Sair do sistema volta tudo ao padrão.
  await perPage().selectOption('50')
  await page.locator('.sidebar').getByRole('button', { name: 'Sair', exact: true }).click()
  await page.getByLabel('CPF', { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('gmac-list:'))), [])
  await login()
  await navigate('Contas a Pagar')
  await table('.payable-table tbody tr').first().waitFor()
  assert.equal(await perPage().inputValue(), '20')
  assert.equal(await sortOf('.payable-table', 'Vencimento'), 'ascending')
  assert.deepEqual(errors, [])
  console.log('Listas financeiras: itens por página, ordenação, busca e página mantidos ao trocar de tela e recarregar; atalhos temporários; saída limpa.')
} finally {
  await browser.close()
  await fixture.close()
}
