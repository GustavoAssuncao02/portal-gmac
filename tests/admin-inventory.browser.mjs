import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { openSidebarItem } from './sidebarNavigation.js'

// Estoque Administrativo (2026-11-14): right below Estoque in Gestão Operacional, the same screen with office icons and a
// "Dar baixa" on each material. Both stocks filter by icon, with the icon and its name, and look the same.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'test-stock', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const officeIcons = ['Todos', 'Material de expediente', 'Material de limpeza', 'Copa e cozinha', 'Higiene pessoal', 'Descartáveis', 'Suprimentos de informática', 'Material elétrico', 'EPI e uniformes', 'Primeiros socorros', 'Embalagens', 'Manutenção predial', 'Outros']
const filter = page.getByRole('group', { name: 'Filtrar por tipo de material', exact: true })
const tiles = async () => (await filter.locator('button span').allTextContents())
const rows = () => page.locator('.inventory-row:not(.inventory-row--header) .inventory-material-name strong').allTextContents()
await mkdir('test-results', { recursive: true })

async function addMaterial({ icon, name, quantity, minimum, price }) {
  await page.locator('.inventory-header .inventory-add-button').click()
  const modal = page.getByRole('dialog', { name: 'Adicionar material', exact: true })
  assert.deepEqual(await modal.getByRole('group', { name: 'Ícones do material', exact: true }).locator('button span').allTextContents(), officeIcons.slice(1))
  assert.equal(await modal.getByLabel('Unidade (un)', { exact: true }).isChecked(), true, 'office supplies are counted by unit')
  await modal.getByRole('button', { name: icon, exact: true }).click()
  await modal.getByPlaceholder('Digite para buscar no estoque', { exact: true }).fill(name)
  await modal.getByLabel(/^Quantidade disponível/).fill(String(quantity))
  await modal.getByLabel(/^Estoque mínimo/).fill(String(minimum))
  await modal.getByLabel('Valor por unidade', { exact: true }).fill(String(price))
  await modal.getByRole('button', { name: 'Adicionar material', exact: true }).click()
  await modal.waitFor({ state: 'detached' })
  const finance = page.getByRole('dialog', { name: 'Lançar esta compra no financeiro?', exact: true })
  await finance.getByRole('button', { name: 'Não lançar agora', exact: true }).click()
  await finance.waitFor({ state: 'detached' })
}

try {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()

  await openSidebarItem(page, 'Estoque Administrativo')
  await page.getByRole('heading', { name: 'Estoque Administrativo', exact: true }).waitFor()
  assert.deepEqual(await tiles(), officeIcons)
  await addMaterial({ icon: 'Higiene pessoal', name: 'Papel higiênico', quantity: 20, minimum: 5, price: 2.5 })
  await addMaterial({ icon: 'Material de expediente', name: 'Caneta azul', quantity: 50, minimum: 10, price: 1.2 })
  assert.deepEqual(await rows(), ['CANETA AZUL', 'PAPEL HIGIÊNICO'])
  assert.equal(await page.getByRole('img', { name: 'Higiene pessoal' }).count(), 1, 'the row shows the office icon')

  // The filter: icon and name; a click shows only that kind, a second click (or Todos) shows everything again.
  await filter.getByRole('button', { name: /^Higiene pessoal/ }).click()
  assert.deepEqual(await rows(), ['PAPEL HIGIÊNICO'])
  assert.equal(await filter.getByRole('button', { name: /^Higiene pessoal/ }).getAttribute('aria-pressed'), 'true')
  await page.screenshot({ path: 'test-results/admin-inventory-filter.png', fullPage: true })
  await filter.getByRole('button', { name: /^Todos/ }).click()
  assert.equal((await rows()).length, 2)

  // Dar baixa: never above the balance; the balance drops and the history shows the "baixa" and who registered it.
  await page.getByRole('button', { name: 'Dar baixa em Papel higiênico', exact: true }).click()
  const exit = page.getByRole('dialog', { name: 'Dar baixa', exact: true })
  const quantity = exit.getByLabel(/^Quantidade da baixa \(un\)/)
  await quantity.fill('25')
  await exit.getByText('A baixa não pode ser maior que o saldo disponível.', { exact: true }).waitFor()
  assert.equal(await exit.getByRole('button', { name: 'Dar baixa', exact: true }).isDisabled(), true)
  await quantity.fill('6')
  await exit.getByText('Saldo após a baixa: 14 un', { exact: true }).waitFor()
  await exit.getByLabel('Retirado por / destino', { exact: true }).fill('Banheiro da produção')
  await page.screenshot({ path: 'test-results/admin-inventory-exit.png' })
  await exit.getByRole('button', { name: 'Dar baixa', exact: true }).click()
  await exit.waitFor({ state: 'detached' })
  const paper = page.locator('.inventory-row').filter({ hasText: 'PAPEL HIGIÊNICO' })
  await paper.getByText('14 un', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Ver histórico de Papel higiênico', exact: true }).click()
  const history = page.locator('.inventory-history-modal')
  await history.getByText('Baixa de material', { exact: true }).waitFor()
  assert.ok((await history.innerText()).includes('Banheiro da produção'))
  assert.ok((await history.innerText()).includes('por Gustavo'))
  await page.screenshot({ path: 'test-results/admin-inventory-history.png' })
  await history.getByRole('button', { name: 'Fechar', exact: true }).click()
  await history.waitFor({ state: 'detached' })
  await page.screenshot({ path: 'test-results/admin-inventory.png', fullPage: true })

  // The factory stock: same filter with its own icons; office supplies never show up there.
  await openSidebarItem(page, 'Estoque')
  await page.getByRole('heading', { name: 'Estoque', exact: true }).waitFor()
  assert.deepEqual((await tiles()).slice(0, 4), ['Todos', 'Chapas', 'Barras', 'Tubos'])
  assert.equal(await page.getByRole('button', { name: /^Dar baixa/ }).count(), 0, 'the factory stock leaves by the OS')
  assert.ok(!(await rows()).some((name) => name.startsWith('PAPEL')))
  await page.screenshot({ path: 'test-results/inventory-filter.png', fullPage: true })

  // Phone: the filter is one row that scrolls sideways; nothing overflows the page.
  await openSidebarItem(page, 'Estoque Administrativo')
  await page.getByRole('heading', { name: 'Estoque Administrativo', exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow')
  const bounds = await filter.boundingBox()
  assert.ok(bounds.height < 80, 'one row of tiles')
  assert.ok(await filter.evaluate((element) => element.scrollWidth > element.clientWidth), 'the row scrolls sideways')
  await page.screenshot({ path: 'test-results/admin-inventory-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Dar baixa em Caneta azul', exact: true }).click()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: 'test-results/admin-inventory-exit-mobile.png' })
  assert.deepEqual(errors, [])
  console.log('Estoque Administrativo passed: menu, office icons, unit by default, icon filter on both stocks, baixa limited to the balance, history with who, factory stock apart, phone.')
} catch (error) {
  await page.screenshot({ path: 'test-results/admin-inventory-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
