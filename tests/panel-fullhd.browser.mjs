import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { serviceStageGroups, stageLabel } from '../server/serviceStages.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const directory = 'test-results/panel-fullhd'
const errors = [], results = []
page.on('pageerror', (error) => errors.push(error.message))
await mkdir(directory, { recursive: true })
try {
  const headers = { Authorization: `Bearer ${fixture.adminToken}` }
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft, headers)).data.item
  const seven = ['turning', 'milling', 'cnc-turning', 'painting', 'cut-bend', 'torch-cut', 'grinding']
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { stages: seven, materials: [], laborEntries: [], kind: 'service' }, headers)
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: '2026-12-20', serviceValue: 500, materials: 0, labor: 0, margin: 15 } }, headers)
  await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST', {}, headers)
  await fixture.mutateStore((store) => {
    const base = store.orders[0]
    const variants = [seven, ['painting', 'turning'], ['turning', 'cnc-turning', 'machining-center', 'torch-cut', 'structural-assembly', 'mechanical-assembly', 'disassembly', 'grinding'], serviceStageGroups.flatMap(([, group]) => group.map(([key]) => key))]
    store.orders = variants.map((stages, index) => ({
      ...base, code: `OS-2026-${String(index + 1).padStart(4, '0')}`, service: ['Estrutura metalica industrial', 'Pintura e usinagem', 'Conjunto mecanico', 'Projeto com todas as etapas'][index], company: 'Industria de Estruturas Teste',
      resources: { ...base.resources, stages }, proposal: { ...base.proposal, stages },
      operation: { status: 'paused', accumulatedMs: 3600000, activeSession: null, stages: stages.map((key, i) => ({ key: `stage-${i}`, name: stageLabel(key) })), stageCounts: Object.fromEntries(stages.map((_, i) => [`stage-${i}`, index === 1 ? 10 : i < 3 ? 7 : 4])) },
    }))
  })
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Serviços em andamento', exact: true }).click()
  await page.locator('.admin-os-table tbody tr').nth(3).waitFor()
  async function check(name, minFont = 0) {
    await page.waitForTimeout(100)
    const metrics = await page.evaluate(() => {
      const table = document.querySelector('.admin-os-table-wrap')
      return { width: innerWidth, scroll: document.documentElement.scrollWidth, table: [table.scrollWidth, table.clientWidth], labels: [...document.querySelectorAll('.admin-os-stage-label')].map((el) => ({ text: el.textContent, width: el.clientWidth, scroll: el.scrollWidth, font: parseFloat(getComputedStyle(el).fontSize), whiteSpace: getComputedStyle(el).whiteSpace })) }
    })
    results.push({ name, ...metrics })
    await page.screenshot({ path: `${directory}/${name}.png` })
    assert.equal(metrics.scroll, metrics.width, `${name}: page overflow`)
    assert.ok(metrics.table[0] <= metrics.table[1] + 1, `${name}: table overflow`)
    for (const label of metrics.labels) {
      assert.equal(label.whiteSpace, 'nowrap')
      assert.ok(label.scroll <= label.width + 1, `${name}: ${JSON.stringify(label)}`)
      assert.ok(label.font >= minFont, `${name}: illegible font ${label.font}`)
    }
    // The pieces already made keep the color of their bar (green, or dark blue while in production) in every theme and size.
    const colors = await page.locator('.piece-track .piece-track-filled').evaluateAll((pieces) => {
      const context = document.createElement('canvas').getContext('2d')
      return pieces.map((piece) => {
        context.fillStyle = getComputedStyle(piece).backgroundColor
        const actual = context.fillStyle
        context.fillStyle = getComputedStyle(piece.parentElement).getPropertyValue('--piece-fill').trim()
        return { actual, expected: context.fillStyle, visible: piece.getBoundingClientRect().width > 0 && piece.getBoundingClientRect().height > 0 }
      })
    })
    assert.ok(colors.length)
    for (const color of colors) {
      assert.equal(color.actual, color.expected, `${name}: colored progress must remain visible`)
      assert.ok(color.visible, `${name}: piece slot has size`)
    }
  }
  for (const [theme, fontSize, minimum] of [['light', 'default', 13], ['dark', 'default', 13], ['light', 'large', 14.9], ['dark', 'small', 11.7]]) {
    await page.evaluate(({ theme, fontSize }) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.fontSize = fontSize }, { theme, fontSize })
    await check(`fullhd-${theme}-${fontSize}`, minimum)
  }
  await page.evaluate(() => { document.documentElement.dataset.fontSize = 'default'; document.documentElement.dataset.theme = 'light' })
  await page.getByRole('button', { name: 'Modo de exibição', exact: true }).click()
  await page.waitForFunction(() => Boolean(document.fullscreenElement))
  await check('fullhd-tv', 13)
  await page.getByRole('button', { name: 'Sair do modo de exibição', exact: true }).click()
  for (const width of [2560, 1800, 1680, 1366, 1280, 1024, 430, 393]) {
    await page.setViewportSize({ width, height: width >= 1800 ? 1080 : 900 })
    await check(`panel-${width}`, width >= 1800 ? 13 : 0)
  }
  await writeFile(`${directory}/metrics.json`, JSON.stringify(results, null, 2))
  assert.deepEqual(errors, [])
  console.log('Full HD panel: readable stages, light/dark and font preferences, TV mode, 2/7/8/all stages, responsive layouts and no overflow verified.')
} finally { await browser.close(); await fixture.close() }
