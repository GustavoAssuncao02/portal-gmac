import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.LAN_URL
if (!base || !process.env.DEMO_ADMIN_CPF || !process.env.DEMO_ADMIN_PASSWORD) throw new Error('Informe LAN_URL e as credenciais locais no .env.')
const materialName = `TESTE-REDE-${randomUUID()}`
const browser = await chromium.launch({ headless: true })
const errors = []
const tokens = []
const request = async (path, method = 'GET', body, token) => {
  const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = response.status === 204 ? {} : await response.json()
  assert.ok(response.ok, `${path}: ${response.status}`)
  return data
}

try {
  assert.equal((await request('/health')).databaseConnected, true)
  const pages = []
  for (let i = 0; i < 2; i++) {
    const { token, user } = await request('/auth/login', 'POST', { cpf: process.env.DEMO_ADMIN_CPF, password: process.env.DEMO_ADMIN_PASSWORD })
    tokens.push(token)
    if (i === 0) {
      const body = { items: [{ name: `${materialName}-IMPORT`, detail: 'Importacao temporaria', quantity: 8, minimum: 2, unitPrice: 23.75, history: [
        { type: 'creation', date: '2026-10-03T10:00:00Z', quantity: 5, balance: 5, unitPrice: 20 },
        { type: 'entry', date: '2026-10-03T11:00:00Z', quantity: 3, balance: 8, unitPrice: 30 },
      ] }] }
      const imports = await Promise.all([request('/inventory/import', 'POST', body, token), request('/inventory/import', 'POST', body, token)])
      assert.deepEqual(imports.map((result) => result.imported).sort(), [0, 1])
      const imported = (await request('/inventory')).items.find((item) => item.name === `${materialName}-IMPORT`)
      assert.equal(Number(imported.quantity), 8)
      assert.equal(Number(imported.unitPrice), 23.75)
      assert.equal(imported.history.length, 2)
      await request(`/inventory/${imported.id}`, 'DELETE', undefined, token)
    }
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
    await context.addInitScript(({ token, user }) => {
      sessionStorage.setItem('gmac-admin-token', token)
      sessionStorage.setItem('gmac-admin-workspace', JSON.stringify({ userId: user.id, activeNav: 'Estoque', tabs: ['Estoque'] }))
      // Do not initialize the real stock from this empty, disposable browser profile.
      localStorage.setItem('gmac-inventory-migrated-v1', 'true')
    }, { token, user })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(base)
    await page.getByRole('heading', { name: 'Estoque', exact: true }).waitFor()
    await page.waitForResponse((response) => response.url().endsWith('/api/inventory') && response.ok())
    pages.push(page)
  }
  const [first, second] = pages
  await first.getByRole('button', { name: 'Adicionar material', exact: true }).click()
  const dialog = first.getByRole('dialog')
  await dialog.getByLabel('Nome do material').fill(materialName)
  await dialog.getByLabel('Especifica\u00e7\u00e3o', { exact: true }).fill('Material temporario de verificacao')
  await dialog.getByLabel('Quantidade dispon\u00edvel').fill('5')
  await dialog.getByLabel('Valor por kg').fill('20')
  await dialog.getByRole('button', { name: 'Adicionar material', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const otherRow = second.locator('.inventory-row:not(.inventory-row--header)').filter({ hasText: materialName })
  await otherRow.waitFor({ timeout: 15000 })
  await second.getByRole('button', { name: 'Adicionar material', exact: true }).click()
  const entry = second.getByRole('dialog')
  await entry.getByLabel('Nome do material').fill(materialName)
  await entry.locator('.material-suggestions button').filter({ hasText: materialName }).click()
  await entry.getByLabel('Quantidade de entrada').fill('3')
  await entry.getByLabel('Valor por kg').fill('30')
  await entry.getByRole('button', { name: 'Registrar entrada' }).click()
  await entry.waitFor({ state: 'hidden' })
  const row = first.locator('.inventory-row:not(.inventory-row--header)').filter({ hasText: materialName })
  await first.waitForFunction((name) => [...document.querySelectorAll('.inventory-row')].some((row) => row.textContent.includes(name) && row.textContent.includes('8 kg')), materialName, { timeout: 15000 })
  const material = (await request('/inventory')).items.find((item) => item.name === materialName)
  assert.equal(Number(material.quantity), 8)
  assert.equal(Number(material.unitPrice), 23.75)
  assert.equal(material.history.length, 2)
  await first.reload()
  await first.getByRole('heading', { name: 'Estoque', exact: true }).waitFor()
  assert.equal(await first.getByLabel('CPF', { exact: true }).count(), 0)
  await row.waitFor()
  await mkdir('test-results', { recursive: true })
  await first.screenshot({ path: 'test-results/local-network-desktop.png', fullPage: true })
  await second.setViewportSize({ width: 390, height: 844 })
  await second.screenshot({ path: 'test-results/local-network-mobile.png', fullPage: true })
  const employees = (await request('/employees')).items
  assert.ok(employees.length >= 3)
  const orders = (await request('/operations/orders')).items
  assert.ok(orders.length >= 4)
  const histories = await request(`/operations/orders/${encodeURIComponent(orders[0].code)}/events`)
  assert.ok(histories.items.length)
  assert.deepEqual(errors, [])
  console.log('LAN/MySQL: two independent clients share stock, weighted entry/history, OS and employees; reload keeps the session.')
} finally {
  try {
    const inventory = (await request('/inventory')).items
    for (const item of inventory.filter((item) => item.name === materialName || item.name === `${materialName}-IMPORT`)) await request(`/inventory/${item.id}`, 'DELETE', undefined, tokens[0])
    for (const token of tokens) await request('/auth/logout', 'POST', undefined, token)
  } finally { await browser.close() }
}
