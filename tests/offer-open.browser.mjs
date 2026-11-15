import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

// "Deixar oferta em aberto e notificar": checked by default only for the CPFs of OPEN_OFFER_DEFAULT_CPFS. The offer stays on
// the list as "Em aberto · Aguardando responsável" (the details do not open) and whoever clicks it first takes it.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
process.env.OPEN_OFFER_DEFAULT_CPFS = env.DEMO_ADMIN_CPF
const fixture = await createWorkflowFixture({ accountsEnv: env })
fixture.finishCreatedOffers = false
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()

  const service = 'Oferta em aberto para a equipe'
  await page.getByRole('button', { name: 'Inserir Oferta Manualmente', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Inserir oferta manualmente' })
  const open = form.getByRole('checkbox', { name: /Deixar oferta em aberto e notificar/ })
  await open.waitFor()
  assert.equal(await open.isChecked(), true, 'checked by default for a CPF of OPEN_OFFER_DEFAULT_CPFS')
  await form.getByLabel('CNPJ/CPF *', { exact: true }).fill('12345678000190')
  await form.getByLabel('Empresa *', { exact: true }).fill('Cliente teste')
  await form.getByLabel('Peça/Serviço *', { exact: true }).fill(service)
  await form.getByLabel('Quantidade *', { exact: true }).fill('2')
  await form.getByLabel('Descrição do serviço *', { exact: true }).fill('Cadastrada por um auxiliar')
  await page.screenshot({ path: 'test-results/offer-open-form.png' })
  await form.getByRole('button', { name: 'Adicionar solicitação', exact: true }).click()
  await form.waitFor({ state: 'detached' })

  // The details do not open: the list shows the offer waiting, in orange, and a notice.
  const offer = (await fixture.adminRequest('/offers')).data.items.find((item) => item.service === service)
  assert.deepEqual([offer.status, offer.openForTeam, offer.editingBy], ['creating', true, undefined])
  await page.getByRole('status').filter({ hasText: `Oferta ${offer.code} em aberto: os responsáveis foram notificados` }).waitFor()
  assert.equal(await page.locator('.offer-details-creating').count(), 0, 'the details do not open')
  const row = page.locator('.offers-table-row').filter({ hasText: service.toLocaleUpperCase('pt-BR') })
  const badge = row.locator('.offer-creating-badge--open')
  assert.match(await badge.innerText(), /Em aberto[\s\S]*Aguardando responsável/)
  assert.equal(await page.locator('.offer-filter--new').filter({ hasText: 'Em aberto' }).locator('strong').innerText(), '1')
  await page.screenshot({ path: 'test-results/offer-open-list.png' })

  // Whoever clicks first takes it, without the "editar mesmo assim" question.
  await badge.click()
  await page.locator('.offer-details-creating').getByText('Criando oferta · Gustavo').waitFor()
  assert.equal((await fixture.adminRequest('/offers')).data.items.find((item) => item.id === offer.id).editingBy?.name, 'Gustavo')

  // The next time the form opens, the box keeps its default.
  await page.getByRole('button', { name: 'Voltar para ofertas', exact: true }).click()
  await page.getByRole('button', { name: 'Inserir Oferta Manualmente', exact: true }).click()
  assert.equal(await page.getByRole('dialog', { name: 'Inserir oferta manualmente' }).getByRole('checkbox', { name: /Deixar oferta em aberto/ }).isChecked(), true)
  assert.deepEqual(errors, [])
  console.log('Open offer passed: default by CPF, list badge, notice and take-over on first click.')
} finally {
  delete process.env.OPEN_OFFER_DEFAULT_CPFS
  await browser.close()
  await fixture.close()
}
