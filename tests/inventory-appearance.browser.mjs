import 'dotenv/config'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import sharp from 'sharp'
import { chromium, webkit, devices } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = path.join(root, 'test-results')
await mkdir(results, { recursive: true })
const directory = await mkdtemp(path.join(results, 'inventory-appearance-'))
const database = `gmac_test_appearance_${Date.now()}`
assert.match(database, /^gmac_test_appearance_\d+$/)
assert.ok(directory.startsWith(results + path.sep))
const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true })
let api, web, browser
let logs = ''
try {
  const schema = (await readFile(path.join(root, 'database/schema.sql'), 'utf8')).replaceAll('portal_gmac', database)
  await connection.query(schema)
  // Start from the old schema to exercise the non-destructive startup migration.
  await connection.query('ALTER TABLE inventory_materials DROP COLUMN icon, DROP COLUMN photo')
  await connection.execute("INSERT INTO users (name, birth_date, cpf, email, password_hash, role) VALUES ('Admin Teste', '1990-01-01', '12345678901', 'admin@test.invalid', ?, 'admin')", [await bcrypt.hash('teste123', 4)])
  await connection.execute("INSERT INTO inventory_materials (name, detail, quantity_kg, minimum_kg, unit_price) VALUES ('Chapa de teste', 'Aco 1020', 10, 2, 20)")
  for (const name of (await readdir(path.join(root, 'server'))).filter((name) => name.endsWith('.js'))) await copyFile(path.join(root, 'server', name), path.join(directory, name))
  const probe = express().listen(0, '127.0.0.1')
  await new Promise((resolve) => probe.once('listening', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  api = spawn(process.execPath, [path.join(directory, 'index.js')], { cwd: root, env: { ...process.env, DB_NAME: database, PORT: String(port), API_HOST: '127.0.0.1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  api.stdout.on('data', (chunk) => { logs += chunk })
  api.stderr.on('data', (chunk) => { logs += chunk })
  const apiUrl = `http://127.0.0.1:${port}`
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(`${apiUrl}/api/health`)).ok } catch {}
    if (ready) break
    if (api.exitCode != null) throw new Error(logs)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(ready, logs)
  const login = await fetch(`${apiUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cpf: '12345678901', password: 'teste123' }) })
  const { token } = await login.json()
  assert.ok(token)
  const send = (route, body, auth = true, method = 'PATCH') => fetch(`${apiUrl}/api${route}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  const details = { name: 'Chapa de teste', detail: 'Aco 1020', minimum: 2, unitPrice: 20 }
  assert.equal((await send('/inventory/1', { ...details, icon: 'tube' }, false)).status, 401)
  assert.equal((await send('/inventory/1', { ...details, icon: 'bad' })).status, 400)
  assert.equal((await send('/inventory/1', { ...details, photo: 'data:image/svg+xml;base64,PHN2Zy8+' })).status, 400)
  web = express().use(express.static(path.join(root, 'dist'))).listen(0, '127.0.0.1')
  await new Promise((resolve) => web.once('listening', resolve))
  const url = `http://127.0.0.1:${web.address().port}`
  const screenshotDirectory = path.join(results, 'inventory-appearance-review')
  await mkdir(screenshotDirectory, { recursive: true })
  const errors = []
  const fixtureImage = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#8e9ba8' } }).composite([{ input: Buffer.from('<svg width="2400" height="1600"><rect x="300" y="350" width="1800" height="800" fill="#35536f"/><rect x="300" y="350" width="1800" height="180" fill="#bac6d0"/></svg>') }]).jpeg({ quality: 95 }).toBuffer()
  for (const [engine, device] of [[chromium, null], [webkit, 'iPhone 15'], [webkit, 'iPhone 15 Pro Max']]) {
    browser = await engine.launch()
    const context = await browser.newContext(device ? devices[device] : { viewport: { width: 1366, height: 900 } })
    await context.route('**/api/**', async (route) => {
      const response = await route.fetch({ url: apiUrl + new URL(route.request().url()).pathname + new URL(route.request().url()).search })
      await route.fulfill({ response })
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(url)
    await page.getByLabel('CPF', { exact: true }).fill('12345678901')
    await page.getByLabel('Senha', { exact: true }).fill('teste123')
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    async function inventory() {
      const opener = page.getByRole('button', { name: 'Abrir menu de navegação', exact: true })
      if (await opener.isVisible()) await opener.click()
      await page.locator('.sidebar').getByRole('button', { name: 'Estoque', exact: true }).click()
      await page.getByRole('button', { name: 'Editar Chapa de teste', exact: true }).waitFor()
    }
    await inventory()
    await page.getByRole('button', { name: 'Editar Chapa de teste', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Editar material' })
    assert.equal(await dialog.locator('.material-icon-grid button').count(), 14)
    await dialog.getByRole('button', { name: 'Tubos', exact: true }).click()
    assert.equal(await dialog.getByRole('button', { name: 'Tubos', exact: true }).getAttribute('aria-pressed'), 'true')
    await dialog.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.reload()
    await page.locator('.inventory-main').waitFor()
    await inventory()
    assert.equal(await page.locator('.inventory-material-name svg').getAttribute('aria-label'), 'Tubos')
    await page.getByRole('button', { name: 'Editar Chapa de teste', exact: true }).click()
    await dialog.getByLabel('Foto personalizada do material').setInputFiles({ name: 'material.jpg', mimeType: 'image/jpeg', buffer: fixtureImage })
    await dialog.locator('.material-appearance-preview img').waitFor()
    await dialog.getByRole('button', { name: 'Salvar alterações', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    const overflow = await dialog.locator('.material-icon-grid button').evaluateAll((buttons) => buttons.filter((button) => button.scrollWidth > button.clientWidth + 1).length)
    assert.equal(overflow, 0)
    await dialog.screenshot({ path: path.join(screenshotDirectory, `${device || 'desktop'}-edit.png`) })
    await dialog.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.locator('.inventory-material-name img').waitFor()
    const [rows] = await connection.execute('SELECT icon, photo, quantity_kg FROM inventory_materials WHERE id = 1')
    assert.equal(rows[0].icon, 'tube')
    assert.equal(Number(rows[0].quantity_kg), 10)
    const thumbnail = Buffer.from(rows[0].photo.split(',')[1], 'base64')
    const metadata = await sharp(thumbnail).metadata()
    assert.equal(metadata.format, 'webp')
    assert.ok(metadata.width <= 256 && metadata.height <= 256 && thumbnail.length < fixtureImage.length)
    // An older client editing metadata must not erase a stored photo or icon.
    assert.equal((await send('/inventory/1', details)).status, 200)
    const stored = (await (await fetch(`${apiUrl}/api/inventory`, { headers: { Authorization: `Bearer ${token}` } })).json()).items[0]
    assert.equal(stored.photo, rows[0].photo)
    assert.equal(stored.icon, 'tube')
    const secondContext = await browser.newContext()
    // Another computer, with its own administrator session, sees the same photo.
    const shared = await secondContext.request.get(`${apiUrl}/api/inventory`, { headers: { Authorization: `Bearer ${token}` } })
    assert.equal((await shared.json()).items[0].photo, stored.photo)
    await secondContext.close()
    await page.reload()
    await page.locator('.inventory-main').waitFor()
    await inventory()
    await page.locator('.inventory-material-name img').waitFor()
    await page.getByRole('button', { name: 'Editar Chapa de teste', exact: true }).click()
    await dialog.getByLabel('Foto personalizada do material').setInputFiles({ name: 'bad.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not an image') })
    await dialog.getByRole('alert').waitFor()
    assert.equal(await dialog.locator('.material-appearance-preview img').count(), 1)
    await dialog.getByRole('button', { name: 'Remover foto', exact: true }).click()
    await dialog.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.locator('.inventory-material-name svg').waitFor()
    assert.equal((await (await fetch(`${apiUrl}/api/inventory`, { headers: { Authorization: `Bearer ${token}` } })).json()).items[0].photo, null)
    await page.screenshot({ path: path.join(screenshotDirectory, `${device || 'desktop'}-inventory.png`), fullPage: true })
    await browser.close()
    browser = null
  }
  const photo = `data:image/jpeg;base64,${(await sharp(fixtureImage).resize(256, 256, { fit: 'inside' }).jpeg().toBuffer()).toString('base64')}`
  assert.equal((await send('/inventory', { ...details, quantity: 3, icon: 'gear', photo }, false, 'POST')).status, 401)
  const created = await send('/inventory', { ...details, name: 'Novo material', quantity: 3, icon: 'gear', photo }, true, 'POST')
  assert.equal(created.status, 201)
  const { id } = await created.json()
  const [createdRows] = await connection.execute('SELECT quantity_kg, icon, photo FROM inventory_materials WHERE id = ?', [id])
  assert.equal(Number(createdRows[0].quantity_kg), 3)
  assert.equal(createdRows[0].icon, 'gear')
  assert.ok(createdRows[0].photo.startsWith('data:image/webp;base64,'))
  const [history] = await connection.execute('SELECT movement_type, quantity_kg FROM inventory_movements WHERE material_id = ?', [id])
  assert.equal(history[0].movement_type, 'creation')
  assert.equal(Number(history[0].quantity_kg), 3)
  assert.deepEqual(errors, [])
  console.log('Inventory appearance: SQL migration, authentication/validation, 14 icons, photo compression/persistence/removal, shared reads and desktop/iPhone 15/Pro Max passed.')
} finally {
  if (browser) await browser.close()
  if (web) await new Promise((resolve) => web.close(resolve))
  if (api && api.exitCode == null) {
    const stopped = new Promise((resolve) => api.once('exit', resolve))
    api.kill()
    await stopped
  }
  await connection.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await connection.end()
  await rm(directory, { recursive: true, force: true })
}
