import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// Materials and labor are listed with the same look: gray head, rows with an icon tile, name and detail, aligned columns.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  const machine = (await api('/machines/import', 'POST', { items: [{ id: 'm-torno', name: 'Torno CNC', type: 'Torno', sector: 'Usinagem', hourlyRate: 145 }] })).data
  const [first] = (await api('/labor-services')).data.items
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Eixo com materiais e mão de obra' })).data.item
  await api(`/offers/${offer.id}/resources`, 'PUT', {
    materials: [{ id: 'material-1', name: 'Alumínio 6061', detail: 'Chapa 10 mm', quantity: 12.5, unitPrice: 40, icon: '▰' }],
    laborEntries: [
      { id: 'labor-1', type: 'machine', machineId: 'm-torno', resource: 'Torno CNC', hours: 6, hourlyRate: 145 },
      { id: 'labor-2', type: 'person', laborServiceId: first.id, resource: first.name, hours: 3.5, hourlyRate: first.hourlyRate },
      { id: 'labor-3', type: 'person', resource: 'Serviço removido do cadastro', hours: 1, hourlyRate: 50 },
    ], stages: ['turning'], kind: 'service',
  })
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
  await page.locator('.offers-table-row').filter({ hasText: 'Eixo com materiais e mão de obra' }).locator('.offer-review-button').click()
  await page.getByRole('heading', { name: `Detalhes da oferta ${offer.code}`, exact: true }).waitFor()
  const labor = page.locator('.offer-material-row--labor')
  await labor.nth(2).waitFor()

  // Same structure as the materials list.
  const heads = page.locator('.offer-materials-head')
  assert.equal(await heads.count(), 2)
  assert.deepEqual(await heads.nth(1).locator('span').allTextContents(), ['Tipo', 'Máquina / serviço', 'Tempo (h)', 'Setor', 'Valor/hora', 'Valor total', 'Ações'])
  const columns = (locator) => locator.evaluate((element) => getComputedStyle(element).gridTemplateColumns)
  assert.equal(await columns(heads.nth(1)), await columns(heads.nth(0)), 'head columns match')
  const materialRow = page.locator('.offer-material-row:not(.offer-material-row--labor)').first()
  assert.equal(await columns(labor.first()), await columns(materialRow), 'row columns match')
  const style = (locator) => locator.evaluate((element) => { const css = getComputedStyle(element); return [css.minHeight, css.fontSize, css.borderBottomWidth, css.color].join('|') })
  // The only material is also the last row of its list, so it is compared with the last labor row.
  assert.equal(await style(labor.last()), await style(materialRow), 'row typography and spacing match')
  assert.equal(await style(heads.nth(1)), await style(heads.nth(0)), 'head style matches')
  const edge = (locator, name) => locator.locator(name).first().evaluate((element) => Math.round(element.getBoundingClientRect().right))
  for (const name of ['> span:nth-child(5)', '> strong:nth-child(6)', '.offer-resource-remove']) assert.equal(await edge(labor.first(), name), await edge(materialRow, name), `${name} lines up with the materials above`)

  // Content.
  assert.match((await labor.nth(0).innerText()).replace(/\s+/g, ' '), /^Torno CNC Hora máquina 6 h Usinagem R\$\s145,00 R\$\s870,00 ×$/)
  assert.match((await labor.nth(1).innerText()).replace(/\s+/g, ' '), new RegExp(`^${first.name} Hora homem 3,5 h ${first.sector} `))
  assert.match((await labor.nth(2).innerText()).replace(/\s+/g, ' '), /^Serviço removido do cadastro Hora homem 1 h — R\$\s50,00 R\$\s50,00 ×$/)
  assert.equal(await labor.first().locator('.material-visual svg').count(), 1)
  assert.equal(await page.locator('.offer-labor-row').count(), 0, 'old labor row is gone')
  await page.screenshot({ path: 'test-results/offer-resources-style-desktop.png', fullPage: true })

  // Removing and the empty state follow the materials pattern.
  await labor.nth(2).getByRole('button', { name: 'Remover Serviço removido do cadastro', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.offer-material-row--labor').length === 2)
  for (const name of ['Torno CNC', first.name]) await page.getByRole('button', { name: `Remover ${name}`, exact: true }).click()
  const empty = page.locator('.offer-empty-state').filter({ hasText: 'Nenhuma mão de obra adicionada' })
  await empty.waitFor()
  assert.equal(await empty.locator('svg').count(), 1)
  const emptyMaterials = await page.locator('.offer-empty-state').count()
  assert.equal(await empty.evaluate((element) => getComputedStyle(element).minHeight), '125px', `same height as the materials empty state (${emptyMaterials} empty state)`)
  await page.screenshot({ path: 'test-results/offer-resources-style-empty.png', fullPage: true })
  await api(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'material-1', name: 'Alumínio 6061', detail: 'Chapa 10 mm', quantity: 12.5, unitPrice: 40, icon: '▰' }], laborEntries: [
    { id: 'labor-1', type: 'machine', machineId: 'm-torno', resource: 'Torno CNC', hours: 6, hourlyRate: 145 },
    { id: 'labor-2', type: 'person', laborServiceId: first.id, resource: first.name, hours: 3.5, hourlyRate: first.hourlyRate },
  ], stages: ['turning'], kind: 'service' })
  await page.reload()
  await page.locator('.offer-material-row--labor').nth(1).waitFor()

  // Dark theme and phone.
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.screenshot({ path: 'test-results/offer-resources-style-dark.png', fullPage: true })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: no page overflow')
  assert.equal(await page.locator('.offer-materials-head').first().isVisible(), false)
  // The labels are drawn by the stylesheet (::before), so they are read from the computed style.
  const labels = await page.locator('.offer-material-row--labor').first().evaluate((row) => [3, 4, 5].map((index) => getComputedStyle(row.children[index - 1], '::before').content))
  assert.deepEqual(labels, ['"Tempo: "', '"Setor: "', '"Valor/hora: "'])
  assert.match((await page.locator('.offer-material-row--labor').first().innerText()).replace(/\s+/g, ' '), /Torno CNC Hora máquina 6 h Usinagem R\$\s145,00 R\$\s870,00/)
  await page.locator('.offer-material-row--labor').first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/offer-resources-style-mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('Offer resources style passed: labor list shares the materials structure, columns, typography, icon tile, remove button, empty state, dark theme and phone layout.')
} catch (error) {
  await page.screenshot({ path: 'test-results/offer-resources-style-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
