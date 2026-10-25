import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { enterOperatorCode, openOrder } from './operatorEntry.js'
import { localDate } from '../server/reportData.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
const auth = { Authorization: `Bearer ${fixture.adminToken}` }
const request = (route, method, body) => fixture.request(route, method, body, auth)
try {
  const service = (await request('/labor-services')).data.items[0]
  // The sector is marked from Cadastros > Setores.
  await request('/sectors', 'POST', { name: 'Montagem' })
  const employee = (await request('/employees', 'POST', { name: 'Ana Teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'ana@example.invalid', identification: '001' })).data.item
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 393, height: 852 }, { width: 430, height: 932 }, { width: 1440, height: 900, theme: 'dark' }]) {
    const suffix = `${viewport.width}${viewport.theme ? '-dark' : ''}`
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
    page.setDefaultTimeout(12000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/inventory**', (route) => route.fulfill({ status: 200, json: { items: [], movements: [] } }))
    const offer = (await request('/offers', 'POST', { ...offerDraft, service: `Teste hora homem ${suffix}` })).data.item
    await request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['painting'], stageResources: { painting: { type: 'labor-service', id: service.id } } })
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    if (viewport.theme) await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), viewport.theme)
    const navigate = async (name) => {
      if (viewport.width < 768) await page.getByRole('button', { name: 'Abrir menu de navega\u00e7\u00e3o', exact: true }).click()
      await page.locator('.sidebar').getByRole('button', { name, exact: true }).click()
    }
    await navigate('Servi\u00e7os')
    await page.locator('.labor-services-list tbody tr').filter({ hasText: service.name }).waitFor()
    assert.equal(await page.getByText('Ociosas', { exact: true }).count(), 0)
    await page.screenshot({ path: `test-results/labor-services-${suffix}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Adicionar servi\u00e7o', exact: true }).click()
    const modal = page.locator('.labor-service-dialog')
    await modal.getByLabel('Nome do servi\u00e7o', { exact: true }).fill(`Teste bancada ${suffix}`)
    await modal.getByRole('button', { name: 'Montagem', exact: true }).click()
    await modal.getByLabel('Valor da hora (R$)', { exact: true }).fill('72.50')
    await modal.getByRole('button', { name: 'Salvar servi\u00e7o', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    const row = page.locator('.labor-services-list tbody tr').filter({ hasText: `Teste bancada ${suffix}` })
    await row.getByRole('button', { name: `Editar Teste bancada ${suffix}`, exact: true }).click()
    await modal.getByLabel('Valor da hora (R$)', { exact: true }).fill('80')
    await modal.getByRole('button', { name: 'Salvar servi\u00e7o', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    assert.match(await row.innerText(), /80,00/)
    await row.getByRole('button', { name: `Remover Teste bancada ${suffix}`, exact: true }).click()
    await modal.getByRole('button', { name: 'Cancelar', exact: true }).click()
    assert.equal(await row.count(), 1)
    await row.getByRole('button', { name: `Remover Teste bancada ${suffix}`, exact: true }).click()
    await modal.getByRole('button', { name: 'Remover servi\u00e7o', exact: true }).click()
    await row.waitFor({ state: 'hidden' })

    await navigate('Ofertas e servi\u00e7os')
    await page.locator('.offers-table-row').filter({ hasText: offer.service }).getByRole('button', { name: 'Em an\u00e1lise', exact: true }).click()
    await page.getByRole('button', { name: 'Adicionar m\u00e3o de obra', exact: true }).click()
    const labor = page.locator('.offer-labor-form')
    await labor.getByLabel('Tipo', { exact: true }).selectOption('person')
    await labor.getByLabel('Servi\u00e7o do profissional', { exact: true }).selectOption(service.id)
    assert.equal(await labor.getByLabel('Valor da hora', { exact: true }).inputValue(), String(service.hourlyRate))
    await labor.getByLabel('Tempo (horas)', { exact: true }).fill('2')
    await labor.screenshot({ path: `test-results/offer-hour-person-${suffix}.png` })
    await labor.getByRole('button', { name: 'Adicionar m\u00e3o de obra', exact: true }).click()
    await page.locator('.offer-labor-list').getByText(service.name, { exact: true }).waitFor()
    const saved = (await request('/offers')).data.items.find((item) => item.id === offer.id)
    assert.equal(saved.resources.laborEntries[0].laborServiceId, service.id)
    await request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offer.deadline, serviceValue: 100 } })
    const order = (await request(`/offers/${offer.id}/accept`, 'POST')).data.item

    const operatorPage = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
    operatorPage.setDefaultTimeout(12000)
    operatorPage.on('pageerror', (error) => errors.push(error.message))
    await operatorPage.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
    await operatorPage.goto(fixture.url)
    await enterOperatorCode(operatorPage, employee.accessCode)
    await openOrder(operatorPage, order.service)
    await operatorPage.getByText(`Servi\u00e7o: ${service.name}`, { exact: true }).waitFor()
    await operatorPage.screenshot({ path: `test-results/operator-labor-service-${suffix}.png` })
    await operatorPage.getByRole('button', { name: /Iniciar trabalho/ }).click()
    await operatorPage.getByRole('button', { name: /^Pausar trabalho/ }).waitFor()
    await fixture.mutateStore((store) => {
      const current = store.orders.find((item) => item.code === order.code)
      const start = new Date(Date.now() - 3600000).toISOString()
      current.operation.activeSessions[0].startedAt = current.operation.activeSince = start; current.operationEvents[0].at = start
    })
    await operatorPage.getByRole('button', { name: /^Pausar trabalho/ }).click()
    await operatorPage.locator('.operator-dialog select').selectOption('Descanso')
    await operatorPage.getByRole('button', { name: 'Confirmar pausa', exact: true }).click()
    await operatorPage.getByRole('button', { name: /Iniciar trabalho/ }).waitFor()
    await operatorPage.close()

    await navigate('Servi\u00e7os')
    await page.getByRole('button', { name: `Ver hist\u00f3rico de ${service.name}`, exact: true }).click()
    const history = page.locator('.machine-history-modal')
    await history.getByText(order.code, { exact: true }).waitFor()
    assert.match(await history.innerText(), /Ana Teste/)
    assert.match(await history.innerText(), /01:00:/)
    await page.screenshot({ path: `test-results/labor-service-history-${suffix}.png` })
    await page.keyboard.press('Escape')
    await navigate('Relat\u00f3rios')
    await page.getByLabel('Tipo de relat\u00f3rio', { exact: true }).selectOption('service-hours')
    await page.getByLabel('Data de in\u00edcio', { exact: true }).fill(localDate(Date.now() - 3600000))
    await page.getByLabel('Data de fim', { exact: true }).fill(localDate(Date.now()))
    await page.getByLabel('Todos', { exact: true }).uncheck()
    await page.getByLabel(service.name, { exact: true }).check()
    await page.getByRole('button', { name: 'Consultar', exact: true }).click()
    await page.locator('.reports-result').waitFor()
    await page.screenshot({ path: `test-results/labor-services-report-${suffix}.png`, fullPage: true })
    for (const [button, extension] of [['Baixar PDF', 'pdf'], ['Baixar Excel', 'xlsx']]) {
      const download = page.waitForEvent('download')
      await page.getByRole('button', { name: button, exact: true }).click()
      assert.equal((await download).suggestedFilename(), `gmac-service-hours.${extension}`)
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Services CRUD/history, offer hourly-rate selection, operator actual hours and PDF/Excel reports passed on desktop, iPhone 15/Pro Max and dark mode.')
} finally { await browser.close(); await fixture.close() }
