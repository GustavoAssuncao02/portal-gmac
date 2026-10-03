import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const modulePath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')
const fixture = await createWorkflowFixture()
const downloadsPath = path.resolve('test-results/downloads')
await mkdir(downloadsPath, { recursive: true })
const browser = await chromium.launch({ headless: true, downloadsPath })
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, timezoneId: 'America/Bahia', acceptDownloads: true })
await context.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
const page = await context.newPage()
const errors = []
const requestedPaths = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('request', (request) => {
  const pathname = new URL(request.url()).pathname
  if (pathname.startsWith('/api/')) requestedPaths.push(pathname)
})

try {
  const offer = (await fixture.request('/offers', 'POST', { ...offerDraft, description: 'Fabricacao do suporte conforme desenho tecnico.\nConferir medidas e acabamento antes da montagem.' })).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'material', name: 'Aluminio', detail: 'Chapa 10 mm', quantity: 12.5, unitPrice: 999, stockStatus: 'partial', stockAvailable: 8, purchaseQuantity: 4.5 }], laborEntries: [{ id: 'machine', type: 'machine', resource: 'Torno CNC 01', hours: 2.5, hourlyRate: 777 }, { id: 'person', type: 'person', resource: 'Montagem e acabamento', hours: 1, hourlyRate: 300 }], stages: ['cutting', 'assembly'], kind: 'product' })
  const attachmentData = Buffer.from('Desenho tecnico de teste\nMaterial: aluminio; espessura: 10 mm')
  await fetch(`${fixture.url}/api/offers/${offer.id}/attachments?name=desenho-tecnico.txt&type=text/plain`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: attachmentData })
  await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Proposta de teste', deadline: '2026-12-19', serviceValue: 98765, materials: 12487.5, labor: 2242.5, margin: 25, discount: 10, profit: 12345, machine: '2,5 horas', serviceTime: '3,5 horas' } })
  const order = (await fixture.request(`/offers/${offer.id}/accept`, 'POST')).data.item
  await fixture.request(`/operations/orders/${order.code}/stages`, 'PUT', { stages: ['Corte', 'Montagem'] })
  await page.goto(fixture.url)
  await page.getByRole('button', { name: 'Visualizar informa\u00e7\u00f5es do projeto' }).click()
  const information = page.locator('.operator-project-info')
  await information.waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0)
  const text = await information.innerText()
  for (const expected of ['Dados do projeto', 'Descri\u00e7\u00e3o do servi\u00e7o', 'Materiais necess\u00e1rios', 'M\u00e1quinas e servi\u00e7os previstos', 'Andamento e etapas', 'Arquivos da OS', 'Hist\u00f3rico de atividades', offerDraft.company, offerDraft.cnpj, 'Chapa 10 mm', '12,5 kg', '4,5 kg', 'Torno CNC 01', 'Montagem e acabamento', '2,5 horas', '3,5 horas', 'Etapas configuradas', 'Produto']) assert.ok(text.includes(expected), expected)
  assert.doesNotMatch(text, /R\$|98765|999|777|12487|or\u00e7amento|lucro|desconto|valor unit\u00e1rio|valor da hora|proposta/i)
  assert.equal(await information.locator('a[href*="proposal"]').count(), 0)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Baixar desenho-tecnico.txt' }).click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(), 'desenho-tecnico.txt')
  assert.deepEqual(await readFile(await download.path()), attachmentData)
  for (const [name, width, height] of [['desktop', 1366, 768], ['mobile', 390, 844], ['mobile-small', 320, 740]]) {
    await page.setViewportSize({ width, height })
    await page.screenshot({ path: `test-results/operator-project-information-${name}.png`, fullPage: true })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), name)
    assert.ok(await information.locator('.operator-info-files').evaluate((element) => element.scrollWidth <= element.clientWidth), `${name} file list`)
  }
  await page.getByRole('button', { name: 'Voltar aos projetos' }).click()
  await page.getByRole('button', { name: 'Visualizar informa\u00e7\u00f5es do projeto' }).waitFor()
  assert.equal(await information.count(), 0)
  assert.ok(requestedPaths.includes('/api/operations/operator/orders'))
  assert.ok(!requestedPaths.includes('/api/offers') && !requestedPaths.includes('/api/operations/orders'))
  assert.deepEqual(errors, [])
  console.log('Operator project screen passed: full nonfinancial information, real file download, activity history, return navigation, and desktop/mobile layout.')
} catch (error) {
  await page.screenshot({ path: 'test-results/operator-project-information-failure.png', fullPage: true })
  throw error
} finally {
  await context.close()
  await browser.close()
  await fixture.close()
}
