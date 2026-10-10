import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { sampleOfx, sampleRows } from './ofxSample.js'

// Stands in for Claude: uses the injected data and Chart.js, and probes the sandbox (network and parent access).
const report = `<!DOCTYPE html><html lang="pt-BR"><head><title>Conciliação</title><style>:root{--bg:#fff;--ink:#0b315d}html[data-theme="dark"]{--bg:#0d1c2e;--ink:#e4edf7}body{margin:0;padding:24px;font-family:system-ui;background:var(--bg);color:var(--ink)}.chart{height:260px}.tall{height:1200px}</style></head>
<body><h1>Conciliação do extrato</h1><p id="resumo"></p><div class="chart"><canvas id="grafico"></canvas></div><p id="rede">testando</p><p id="pai"></p><div class="tall"></div><script>
const dados = window.GMAC_DADOS
document.getElementById('resumo').textContent = dados.extrato.movimentacoes.length + ' movimentações de ' + dados.extrato.arquivo
new Chart(document.getElementById('grafico'), { type: 'bar', data: { labels: dados.extrato.movimentacoes.map((row) => row.fitId), datasets: [{ label: 'Valor', data: dados.extrato.movimentacoes.map((row) => row.valorCentavos / 100) }] }, options: { maintainAspectRatio: false, animation: false } })
fetch('https://example.com/vazamento').then(() => { document.getElementById('rede').textContent = 'rede liberada' }).catch(() => { document.getElementById('rede').textContent = 'rede bloqueada' })
try { parent.document.title; document.getElementById('pai').textContent = 'sistema acessível' } catch { document.getElementById('pai').textContent = 'sistema isolado' }
</script></body></html>`

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env, aiAnalyze: async (_data, onProgress) => { onProgress(4096); await new Promise((resolve) => setTimeout(resolve, 2500)); return { html: report, model: 'claude-opus-5-5', usage: { inputTokens: 30000, outputTokens: 12000 } } } })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  const items = await page.locator('#sidebar-finance-menu .nav-item').allTextContents()
  assert.deepEqual(items.slice(2, 4), ['Conciliação bancária', 'Conciliação bancária com IA'], 'The new item sits right below Conciliação bancária')
  await page.locator('.sidebar').getByRole('button', { name: 'Conciliação bancária com IA', exact: true }).click()
  await page.getByRole('heading', { name: 'Conciliação bancária com IA' }).waitFor()
  await page.getByText('Nenhuma análise feita ainda').waitFor()
  await page.locator('input[aria-label="Arquivo OFX"]').setInputFiles({ name: 'extrato.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(sampleOfx(sampleRows), 'latin1') })
  await page.getByRole('status').getByText('O Claude está escrevendo o relatório (4 KB)').waitFor()
  assert.ok(await page.getByRole('button', { name: 'Analisar extrato OFX' }).isDisabled(), 'A second paid analysis cannot start while one is running')
  await page.screenshot({ path: 'test-results/ai-reconciliation-running.png' })
  const frame = page.frameLocator('iframe.ai-report-frame')
  await frame.getByText('6 movimentações de extrato.ofx').waitFor({ timeout: 15000 })
  await frame.getByText('rede bloqueada').waitFor()
  await frame.getByText('sistema isolado').waitFor()
  assert.ok(await frame.locator('canvas#grafico').evaluate((canvas) => canvas.width > 0 && canvas.height > 0), 'Chart.js drew the chart from the injected data')
  await page.waitForFunction(() => document.querySelector('iframe.ai-report-frame').getBoundingClientRect().height > 1400)
  await page.getByText(/claude-opus-5-5 · 42\.000 tokens \(≈ US\$\s0,36\)/).waitFor()
  await page.screenshot({ path: 'test-results/ai-reconciliation.png', fullPage: false })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No horizontal scroll on a phone')
  await page.screenshot({ path: 'test-results/ai-reconciliation-mobile.png' })
  assert.deepEqual(errors, [])
  console.log('Conciliação com IA no navegador: OK')
} finally {
  await browser.close()
  await fixture.close()
}
