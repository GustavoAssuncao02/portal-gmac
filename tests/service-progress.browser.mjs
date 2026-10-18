import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const names = ['Corte', 'Dobras', 'Solda', 'Pintura', 'Montagem', 'Caldeiraria']
const samples = [
  ['green', '2026-10-01T12:00:00-03:00', '2026-10-05', 'rgb(85, 185, 86)'],
  ['yellow', '2026-09-22T12:00:00-03:00', '2026-10-03', 'rgb(232, 180, 43)'],
  ['orange', '2026-09-20T12:00:00-03:00', '2026-10-02', 'rgb(239, 139, 54)'],
  ['red', '2026-09-20T12:00:00-03:00', '2026-10-01', 'rgb(221, 77, 85)'],
]
function order(code, createdAt, deadline, counts, active = true) {
  const stages = counts.map((_, index) => ({ key: `stage-${index}`, name: names[index] }))
  return { code, service: `Projeto ${code}`, company: 'Cliente de teste', labelNumber: code, createdAt, deadline, quantity: 10, operation: { status: active ? 'running' : 'waiting', progress: counts.length ? Math.round(counts.reduce((a, b) => a + b, 0) / counts.length * 10) : 0, accumulatedMs: 3600000, activeSession: active ? { employeeName: 'Operador de teste', startedAt: createdAt } : null, activeSessions: active ? [{ id: `session-${code}`, employeeName: 'Operador de teste', startedAt: createdAt }] : [], stages, stageCounts: Object.fromEntries(stages.map((stage, index) => [stage.key, counts[index]])) } }
}
const orders = samples.map(([code, start, due]) => order(code, start, due, [10, 10, 4, 0, 0]))
orders.push(order('single', samples[0][1], samples[0][2], [0], false))
orders.push(order('active-zero', samples[0][1], samples[0][2], [0, 0, 0]))
orders.push(order('six', samples[0][1], samples[0][2], [10, 10, 10, 10, 10, 10]))
orders.push(order('no-stages', samples[0][1], samples[0][2], [], false))
for (const [code, counts] of [['piece-eight', [8, 7]], ['piece-nine', [8, 8]], ['last-piece', [10, 9]], ['all-pieces', [10, 10]]]) {
  const sample = order(code, samples[0][1], samples[0][2], counts)
  sample.operation.stages[0].name = 'Soldagem'
  sample.operation.stages[1].name = 'Pintura'
  orders.push(sample)
}
for (const [code, name] of [['machining', 'Freza'], ['boilermaking', 'Esmirilhamento'], ['painting', 'Pintura']]) {
  const sample = order(code, samples[0][1], samples[0][2], [0])
  sample.operation.stages[0].name = name
  orders.push(sample)
}

try {
  await mkdir('test-results', { recursive: true })
  const now = new Date('2026-10-02T12:00:00-03:00')
  await page.clock.install({ time: now })
  await page.clock.pauseAt(now)
  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname
    const json = pathname === '/api/operations/orders' ? { items: orders } : pathname === '/api/auth/login' ? { user: { name: 'Admin de teste' } } : { items: [] }
    return route.fulfill({ status: 200, json })
  })
  await page.goto(process.env.PREVIEW_URL || 'http://localhost:5174/')
  await page.getByLabel('CPF', { exact: true }).fill('12345678901')
  await page.getByLabel('Senha', { exact: true }).fill('teste')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Servi\u00e7os em andamento', exact: true }).click()
  await page.getByRole('heading', { name: 'Painel de servi\u00e7os em andamento' }).waitFor()
  const rowFor = (code) => page.locator('.admin-os-table tbody tr').filter({ has: page.locator('td:first-child small', { hasText: new RegExp(`^${code} `) }) })
  for (const [code, group] of [['machining', 'Usinagem'], ['boilermaking', 'Caldeiraria'], ['painting', 'Pintura'], ['piece-eight', 'Pintura'], ['piece-nine', 'Caldeiraria'], ['all-pieces', 'Etapas conclu\u00eddas'], ['no-stages', 'N\u00e3o definida']]) {
    assert.equal(await rowFor(code).locator('td').nth(3).innerText(), group)
  }
  assert.equal(await rowFor('machining').locator('.admin-os-stage-label').innerText(), '1. Freza')
  // Each stage is a bar with one slot per piece (10 pieces): finished stages are green, the stage in production (the
  // first unfinished one while someone works) is dark blue, and the pieces still missing are gray.
  const filledPerStage = (row) => row.locator('.piece-track').evaluateAll((tracks) => tracks.map((track) => track.querySelectorAll('.piece-track-filled').length))
  const tonesOf = (row) => row.locator('.piece-track').evaluateAll((tracks) => tracks.map((track) => [...track.classList].find((name) => name.startsWith('piece-track--')).replace('piece-track--', '')))
  for (const [code] of samples) {
    const row = rowFor(code)
    assert.equal(await row.locator('.admin-os-stage').count(), 5)
    assert.equal(await row.locator('.admin-os-progress').count(), 0)
    assert.deepEqual(await row.locator('.admin-os-stage-label').allTextContents(), names.slice(0, 5).map((name, index) => `${index + 1}. ${name}`))
    assert.deepEqual(await row.locator('.piece-track').evaluateAll((tracks) => tracks.map((track) => track.children.length)), [10, 10, 10, 10, 10], 'one slot per piece')
    assert.deepEqual(await filledPerStage(row), [10, 10, 4, 0, 0])
    assert.deepEqual(await tonesOf(row), ['done', 'done', 'working', 'stopped', 'stopped'])
    const boxes = await row.locator('.admin-os-stage-block').evaluateAll((elements) => elements.map((element) => { const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, height: box.height } }))
    for (let index = 1; index < boxes.length; index++) {
      assert.ok(Math.abs(boxes[index].left - boxes[index - 1].right) < 1)
      assert.equal(boxes[index].top, boxes[0].top)
      assert.equal(boxes[index].height, 30)
    }
    assert.ok(await row.locator('.admin-os-stage').evaluateAll((elements) => elements.every((element) => element.querySelector('.admin-os-stage-label').getBoundingClientRect().bottom <= element.querySelector('.admin-os-stage-block').getBoundingClientRect().top)))
  }
  assert.deepEqual(await filledPerStage(rowFor('single')), [0])
  assert.deepEqual(await tonesOf(rowFor('single')), ['stopped'], 'nobody working: no blue')
  assert.deepEqual(await filledPerStage(rowFor('active-zero')), [0, 0, 0])
  assert.deepEqual(await tonesOf(rowFor('six')), ['done', 'done', 'done', 'done', 'done', 'done'])
  assert.equal(await rowFor('no-stages').locator('.admin-os-stage-empty').count(), 1)
  for (const [code, filled, tones] of [['piece-eight', [8, 7], ['working', 'stopped']], ['piece-nine', [8, 8], ['working', 'stopped']], ['last-piece', [10, 9], ['done', 'working']], ['all-pieces', [10, 10], ['done', 'done']]]) {
    const row = rowFor(code)
    assert.deepEqual(await filledPerStage(row), filled, code)
    assert.deepEqual(await tonesOf(row), tones, code)
    await row.locator('.admin-os-stage-track').screenshot({ path: `test-results/service-progress-${code}.png` })
  }
  await rowFor('green').locator('.admin-os-stage-track').screenshot({ path: 'test-results/service-progress-reference.png' })
  for (const [name, width, height] of [['desktop', 1600, 950], ['notebook', 1366, 768], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height })
    assert.equal(await page.locator('.admin-os-table th').nth(6 - 1).evaluate((element) => getComputedStyle(element).textAlign), 'center', `${name} centered progress heading`)
    // Column widths only exist in the table; on phones the rows become two-column cards.
    if (width > 760) {
      const remainingWidth = await rowFor('green').locator('.admin-os-remaining').evaluate((element) => element.getBoundingClientRect().width)
      assert.ok(remainingWidth <= 100, `${name} compact remaining-time column: ${remainingWidth}`)
      const statusGap = await rowFor('green').evaluate((row) => {
        const cell = row.querySelector('.admin-os-remaining')
        const text = document.createRange()
        text.selectNodeContents(cell)
        return row.querySelector('.admin-os-status').getBoundingClientRect().left - text.getBoundingClientRect().right
      })
      // About 58px with the piece bars at 1600px; the columns are percentages, so a couple of pixels move with the content.
      assert.ok(statusGap <= 60, `${name} reduced remaining/status gap: ${statusGap}`)
    }
    await page.screenshot({ path: `test-results/service-progress-${name}.png`, fullPage: true })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name)
    assert.ok(await page.locator('.admin-os-stage-label').evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth)), `${name} stage labels`)
  }
  assert.deepEqual(errors, [])
  console.log('Service progress passed: one slot per piece, green finished stages, blue stage in production, gray missing pieces; connected blocks and desktop/mobile layouts.')
} catch (error) {
  await page.screenshot({ path: 'test-results/service-progress-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
}
