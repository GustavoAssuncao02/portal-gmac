import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// Voltar para uma tela (2026-11-27): o painel de Serviços em andamento, depois do Ver OS, volta na mesma rolagem, com o
// mesmo filtro, busca e ordenação; o mesmo ao trocar de aba (Ofertas e serviços). Outra OS abre do topo; fechar a aba
// esquece a rolagem; sair do sistema volta tudo ao padrão. Dados fictícios.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()

async function createOrder(service) {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cut-bend'], kind: 'service' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  const result = await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(result.status, 201, JSON.stringify(result.data))
  return result.data.item
}
async function signIn(page) {
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
}
async function openFromMenu(page, group, name) {
  const item = page.locator('.sidebar').getByRole('button', { name, exact: true })
  if (!await item.isVisible()) await page.locator('.sidebar').getByRole('button', { name: group, exact: true }).click()
  await item.click()
}
const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY))
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 2, `${label}: ${actual}, esperado ${expected}`)

try {
  const orders = []
  for (let index = 1; index <= 30; index++) orders.push(await createOrder(`Peça de retorno ${String(index).padStart(2, '0')}`))
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, timezoneId: 'America/Bahia' })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(fixture.url)
  await signIn(page)
  await openFromMenu(page, 'Operação', 'Serviços em andamento')
  const heading = page.getByRole('heading', { name: 'Painel de serviços em andamento' })
  await heading.waitFor()
  const rows = page.locator('.admin-os-table tbody tr')
  await rows.nth(29).waitFor()

  // Filtro, busca e ordenação escolhidos; a tela rolada até o meio da lista.
  const chip = (name) => page.locator('.deadline-filters').getByRole('button', { name })
  await chip('Dentro do prazo').click()
  await page.getByLabel('Buscar serviços', { exact: true }).fill('retorno')
  const sortState = async () => page.locator('.admin-os-table th[aria-sort]:not([aria-sort="none"])').evaluateAll((items) => items.map((item) => `${item.innerText.trim()}:${item.getAttribute('aria-sort')}`))
  await page.locator('.admin-os-table th').filter({ hasText: 'OS / Serviço' }).getByRole('button').click()
  const sorted = await sortState()
  assert.equal(sorted.length, 1)
  const rowOrder = await rows.locator('td:first-child').allInnerTexts()
  await page.evaluate(() => window.scrollTo(0, 900))
  await page.waitForFunction(() => Math.round(window.scrollY) === 900)
  const target = rows.nth(14)
  const targetCode = (await target.innerText()).match(/OS-\d{4}-\d+/)[0]
  await page.waitForTimeout(150)

  // Ver OS abre do topo; voltar mostra o painel como estava.
  await target.getByRole('button', { name: 'Ver OS', exact: true }).click()
  await page.getByRole('button', { name: 'Voltar para a tela anterior', exact: true }).waitFor()
  near(await scrollY(page), 0, 'a OS abre do topo')
  await page.getByRole('button', { name: 'Voltar para a tela anterior', exact: true }).click()
  await heading.waitFor()
  await page.waitForFunction(() => Math.round(window.scrollY) >= 898)
  near(await scrollY(page), 900, 'o painel volta na mesma rolagem')
  assert.equal(await chip('Dentro do prazo').getAttribute('class'), 'selected')
  assert.equal(await page.getByLabel('Buscar serviços', { exact: true }).inputValue(), 'retorno')
  assert.deepEqual(await sortState(), sorted)
  assert.deepEqual(await rows.locator('td:first-child').allInnerTexts(), rowOrder)
  assert.ok((await rows.nth(14).innerText()).includes(targetCode))

  // Outra aba e de volta: cada tela na sua rolagem e com a sua busca.
  await openFromMenu(page, 'Operação', 'Ofertas e serviços')
  await page.getByLabel('Buscar ofertas', { exact: true }).waitFor()
  near(await scrollY(page), 0, 'Ofertas abre do topo')
  await page.getByLabel('Buscar ofertas', { exact: true }).fill('retorno')
  await page.evaluate(() => window.scrollTo(0, 400))
  await page.waitForFunction(() => Math.round(window.scrollY) === 400)
  await page.waitForTimeout(150)
  await page.locator('.workspace-tab').filter({ hasText: 'Serviços em andamento' }).getByRole('tab').click()
  await heading.waitFor()
  await page.waitForFunction(() => Math.round(window.scrollY) >= 898)
  near(await scrollY(page), 900, 'a aba do painel volta na mesma rolagem')
  await page.locator('.workspace-tab').filter({ hasText: 'Ofertas e serviços' }).getByRole('tab').click()
  await page.getByLabel('Buscar ofertas', { exact: true }).waitFor()
  await page.waitForFunction(() => Math.round(window.scrollY) >= 398)
  near(await scrollY(page), 400, 'a aba de Ofertas volta na mesma rolagem')
  assert.equal(await page.getByLabel('Buscar ofertas', { exact: true }).inputValue(), 'retorno')

  // Fechar a aba do painel esquece a rolagem (os filtros continuam, como em Contas a Pagar).
  await page.locator('.workspace-tab').filter({ hasText: 'Serviços em andamento' }).locator('.workspace-tab-close').click()
  await openFromMenu(page, 'Operação', 'Serviços em andamento')
  await heading.waitFor()
  await rows.first().waitFor()
  await page.waitForTimeout(200)
  near(await scrollY(page), 0, 'a aba fechada abre do topo')
  assert.equal(await page.getByLabel('Buscar serviços', { exact: true }).inputValue(), 'retorno')

  // Sair do sistema: na próxima entrada tudo volta ao padrão.
  await page.evaluate(() => window.scrollTo(0, 600))
  await page.waitForTimeout(150)
  await page.getByRole('button', { name: 'Sair', exact: true }).first().click()
  await page.getByLabel('CPF', { exact: true }).waitFor()
  await signIn(page)
  await openFromMenu(page, 'Operação', 'Serviços em andamento')
  await heading.waitFor()
  await rows.nth(29).waitFor()
  near(await scrollY(page), 0, 'depois de sair, o painel abre do topo')
  assert.equal(await page.getByLabel('Buscar serviços', { exact: true }).inputValue(), '')
  assert.equal(await chip('Todos').getAttribute('class'), 'selected')
  assert.deepEqual(errors, [])
  console.log('screen return browser test passed')
} finally {
  await browser.close()
  await fixture.close()
}
