import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
// A short window guarantees that the home page scrolls, as in the recording.
const page = await browser.newPage({ viewport: { width: 1366, height: 560 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const bar = page.locator('.workspace-tabs')

// The bar sits at the top of the viewport and covers exactly the page area beside the sidebar.
async function assertBarPinned(label) {
  const [box, area] = await Promise.all([bar.boundingBox(), bar.evaluate((node) => node.parentElement.getBoundingClientRect().toJSON())])
  assert.equal(Math.round(box.y), 0, `${label}: bar at the top`)
  assert.ok(Math.abs(box.x - area.left) <= 1 && Math.abs(box.width - area.width) <= 1, `${label}: bar aligned with the page area`)
  assert.ok(await bar.evaluate((node) => { const { left, width } = node.getBoundingClientRect(); return document.elementFromPoint(left + width / 2, 20)?.closest('.workspace-tabs') === node }), `${label}: bar is not covered by the content`)
}

try {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()

  // Home scrolled to the bottom: the bar stays visible.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  assert.ok(await page.evaluate(() => window.scrollY > 100), 'The home page scrolls')
  await assertBarPinned('Início rolado')

  // Opening the calculator from the scrolled home starts at the top of the new screen.
  await page.locator('.home-calculator').click()
  await page.getByRole('tab', { name: 'Calculadora de pesos e medidas', exact: true, selected: true }).waitFor()
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'The calculator opens at its top')
  assert.ok((await page.getByRole('heading', { name: 'Calculadora de pesos e medidas', level: 1 }).boundingBox()).y >= 44, 'The title is not hidden behind the bar')

  // Scrolling the calculator keeps the bar; switching tabs also starts at the top.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  assert.ok(await page.evaluate(() => window.scrollY > 100))
  await assertBarPinned('Calculadora rolada')
  await page.getByRole('tab', { name: 'Início', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'Switching tabs starts at the top')

  // Collapsing the sidebar and resizing keep the bar aligned with the page area.
  await page.evaluate(() => window.scrollTo(0, 300))
  await page.getByRole('button', { name: 'Recolher menu lateral', exact: true }).click()
  await page.waitForTimeout(400)
  await assertBarPinned('Menu recolhido')
  await page.getByRole('button', { name: 'Expandir menu lateral', exact: true }).click()
  await page.waitForTimeout(400)
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
    await page.setViewportSize(viewport)
    await page.waitForTimeout(150)
    await assertBarPinned(`${viewport.width}x${viewport.height}`)
  }

  // Modals still cover the bar.
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.getByRole('tab', { name: 'Calculadora de pesos e medidas', exact: true }).click()
  await page.evaluate(() => window.scrollTo(0, 500))
  await page.screenshot({ path: 'test-results/workspace-tabs-fixed.png' })
  await page.getByRole('button', { name: 'Estoque', exact: true }).click()
  await page.locator('.inventory-add-button').click()
  await page.getByRole('dialog', { name: 'Adicionar material', exact: true }).waitFor()
  assert.ok(await bar.evaluate((node) => { const { left, width } = node.getBoundingClientRect(); return document.elementFromPoint(left + width / 2, 20)?.closest('.modal-backdrop') !== null }), 'The modal backdrop covers the bar')
  await page.getByRole('dialog', { name: 'Adicionar material', exact: true }).getByRole('button', { name: 'Fechar', exact: true }).click()

  // Phone keeps its own fixed header.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 400))
  assert.equal(Math.round((await bar.boundingBox()).y), 0, 'Phone header stays fixed')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.deepEqual(errors, [])
  console.log('Workspace tabs: fixed while scrolling (HD, Full HD, 4K, collapsed menu, phone) and every screen opens at its top passed.')
} catch (error) { await page.screenshot({ path: 'test-results/workspace-tabs-fixed-failure.png', fullPage: true }); throw error } finally { await browser.close(); await fixture.close() }
