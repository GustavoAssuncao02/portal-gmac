import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// In the offer details the time and the machine or service of every checked stage are marked as mandatory while empty,
// and "Fazer proposta" names the stages still missing them; filled in, the proposal goes on.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env, fillStageTimes: false })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Eixo com tempo a preencher' })).data.item
  const service = (await fixture.adminRequest('/labor-services')).data.items[0]
  const resources = { materials: [], laborEntries: [], kind: 'service', stages: ['turning', 'painting'] }
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { ...resources, stageTimes: { turning: 90 } })
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  const openDetails = async () => {
    await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
    await page.locator('.offers-table-row').filter({ hasText: 'Eixo com tempo a preencher' }).locator('.offer-review-button').click()
    await page.getByRole('heading', { name: `Detalhes da oferta ${offer.code}`, exact: true }).waitFor()
  }
  await openDetails()
  const hours = (label) => page.getByLabel(`Horas previstas de ${label}`, { exact: true })
  const resource = (label) => page.getByLabel(`Máquina ou serviço de ${label}`, { exact: true })
  assert.equal(await hours('Tornearia').getAttribute('aria-invalid'), null)
  assert.equal(await hours('Pintura').getAttribute('aria-invalid'), 'true', 'the stage without time is marked')
  for (const label of ['Tornearia', 'Pintura']) assert.equal(await resource(label).getAttribute('aria-invalid'), 'true', `${label}: the stage without machine or service is marked`)
  await hours('Pintura').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/stage-times-required-details.png' })

  // The flow stops at "Fazer proposta": first the time, then the machine or service.
  const proposalButton = page.getByRole('button', { name: 'Fazer proposta', exact: true })
  await proposalButton.click()
  await page.getByText('Informe o tempo previsto de a etapa: Pintura. Preencha ao lado de cada etapa, em Etapas do serviço.').waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Fazer proposta', exact: true }).count(), 0, 'the proposal screen does not open')
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { ...resources, stageTimes: { turning: 90, painting: 30 } })
  await page.goto(fixture.url)
  await openDetails()
  assert.equal(await hours('Pintura').getAttribute('aria-invalid'), null)
  await proposalButton.click()
  await page.getByText('Escolha a máquina ou o serviço de cada etapa: Tornearia, Pintura. Preencha ao lado de cada etapa, em Etapas do serviço.').waitFor()
  await page.screenshot({ path: 'test-results/stage-resources-required-details.png' })
  for (const label of ['Tornearia', 'Pintura']) {
    const saved = page.waitForResponse((response) => response.url().endsWith(`/offers/${offer.id}/resources`) && response.request().method() === 'PUT')
    await resource(label).selectOption(`labor-service:${service.id}`)
    assert.equal((await saved).status(), 200)
    assert.equal(await resource(label).getAttribute('aria-invalid'), null)
  }

  // Filled in the details, the proposal goes on.
  await proposalButton.click()
  await page.getByRole('heading', { name: 'Fazer proposta', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Gerar proposta em PDF', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  assert.deepEqual(errors, [])
  console.log('Stage plan required passed: empty times and machines marked in the offer details, "Fazer proposta" blocked naming the stages, and allowed once filled.')
} finally {
  await browser.close()
  await fixture.close()
}
