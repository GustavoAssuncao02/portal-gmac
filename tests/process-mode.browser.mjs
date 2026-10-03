import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { defaultStageLayout } from '../server/serviceStages.js'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Teste' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const admin = await browser.newPage({ viewport: { width: 1366, height: 900 } })
const errors = []
admin.on('pageerror', (error) => errors.push(error.message))
const waitSaved = () => admin.waitForFunction(() => !document.querySelector('.offer-proposal-button')?.disabled)
let operator
try {
  const offer = (await fixture.request('/offers', 'POST', { ...offerDraft, service: 'Projeto com processo livre', quantity: 20 })).data.item
  const layout = defaultStageLayout()
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cut-bend', 'turning', 'painting'], stageLayout: [layout[2], layout[0], layout[1]], kind: 'service' })
  await admin.goto(fixture.url)
  await admin.getByLabel('CPF', { exact: true }).fill('12345678901')
  await admin.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await admin.getByRole('button', { name: 'Entrar', exact: true }).click()
  const offersNav = admin.locator('.sidebar').getByRole('button', { name: 'Ofertas e servi\u00e7os', exact: true })
  await offersNav.click()
  await admin.locator('.offer-review-button').click()
  const checkbox = admin.getByRole('checkbox', { name: 'Processo Injessado', exact: true })
  assert.equal(await checkbox.isChecked(), true)
  const description = admin.getByLabel('Descri\u00e7\u00e3o do servi\u00e7o', { exact: true })
  await checkbox.scrollIntoViewIfNeeded()
  assert.ok((await description.boundingBox()).y + (await description.boundingBox()).height <= (await checkbox.boundingBox()).y)
  await checkbox.uncheck()
  await waitSaved()
  assert.equal((await fixture.request('/offers')).data.items[0].resources.strictProcess, false)
  await admin.reload()
  assert.equal(await checkbox.isChecked(), false)
  for (const width of [1366, 390, 320]) {
    await admin.setViewportSize({ width, height: 900 })
    await checkbox.scrollIntoViewIfNeeded()
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: offer has no page overflow`)
    await admin.screenshot({ path: `test-results/process-mode-offer-${width}.png` })
  }
  await admin.setViewportSize({ width: 1366, height: 900 })
  assert.equal((await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })).status, 200)
  const accepted = await fixture.request(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(accepted.status, 201)
  const order = accepted.data.item
  await admin.reload()
  assert.equal(await checkbox.isDisabled(), true)
  await offersNav.click()
  await admin.getByRole('button', { name: 'Ver OS', exact: true }).click()
  await admin.getByText('Etapas livres', { exact: true }).waitFor()

  const employee = (await fixture.request('/employees', 'POST', { name: 'Ana', birthDate: '1990-01-01', cpf: '00000000001', email: 'ana@example.invalid', identification: '001' })).data.item
  const started = (await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: employee.id }, { Authorization: `Bearer ${fixture.operatorToken}` })).data
  operator = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  operator.on('pageerror', (error) => errors.push(error.message))
  await operator.addInitScript(({ token, code, session }) => {
    sessionStorage.setItem('gmac-operator-token', token)
    sessionStorage.setItem(`gmac-operator-session-${code}`, JSON.stringify(session))
  }, { token: fixture.operatorToken, code: order.code, session: { id: started.operation.activeSession.id, token: started.sessionToken } })
  await operator.goto(fixture.url)
  await operator.locator('.operator-project').click()
  const group = (name) => operator.getByRole('region', { name: `Etapas de ${name}`, exact: true })
  await group('Pintura').waitFor()
  assert.deepEqual(await operator.locator('.operator-stage-group-heading h4').allTextContents(), ['Caldeiraria', 'Usinagem', 'Pintura'])
  assert.ok(await operator.locator('.operator-stage-action button').evaluateAll((items) => items.every((item) => !item.disabled)))
  const register = async (name, quantity, passages) => {
    await group(name).locator('input').fill(String(quantity))
    await group(name).getByRole('button', { name: 'Registrar', exact: true }).click()
    await operator.waitForFunction((expected) => document.querySelector('.operator-stages-heading strong').textContent === expected, `${passages}/60 passagens`)
  }
  await register('Pintura', 20, 20)
  assert.equal(await operator.getByRole('button', { name: 'Concluir servi\u00e7o', exact: true }).isDisabled(), true)
  await operator.getByRole('button', { name: 'Mostrar projetos', exact: true }).click()
  assert.equal(await operator.locator('.operator-project-bottom > div').nth(2).locator('strong').innerText(), '0/20')
  await operator.getByRole('button', { name: 'Visualizar informa\u00e7\u00f5es do projeto', exact: true }).click()
  assert.equal(await operator.locator('.operator-info-facts > div').filter({ has: operator.locator('dt', { hasText: 'Pe\u00e7as conclu\u00eddas' }) }).locator('dd').innerText(), '0/20')
  await operator.getByRole('button', { name: 'Voltar aos projetos', exact: true }).click()
  await admin.locator('.sidebar').getByRole('button', { name: 'Servi\u00e7os em andamento', exact: true }).click()
  await admin.reload()
  const row = admin.locator('.admin-os-table tbody tr').filter({ hasText: order.service })
  await row.waitFor()
  assert.equal(await row.locator('td').nth(4).innerText(), '0/20')
  await admin.screenshot({ path: 'test-results/process-mode-admin-count.png' })
  for (const width of [1366, 390, 320]) {
    await operator.setViewportSize({ width, height: 900 })
    assert.ok(await operator.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: operator has no page overflow`)
    assert.equal(await group('Caldeiraria').getByRole('button', { name: 'Registrar', exact: true }).isEnabled(), true)
    assert.equal(await group('Usinagem').getByRole('button', { name: 'Registrar', exact: true }).isEnabled(), true)
    await operator.screenshot({ path: `test-results/process-mode-operator-${width}.png`, fullPage: true })
  }
  await operator.setViewportSize({ width: 1366, height: 900 })
  await register('Caldeiraria', 20, 40)
  await register('Usinagem', 5, 45)
  assert.equal(await operator.locator('.operator-project-bottom > div').nth(2).locator('strong').innerText(), '5/20')
  assert.equal(await operator.getByRole('button', { name: 'Concluir servi\u00e7o', exact: true }).isDisabled(), true)
  await register('Usinagem', 15, 60)
  assert.equal(await operator.locator('.operator-project-bottom > div').nth(2).locator('strong').innerText(), '20/20')
  await operator.getByRole('button', { name: 'Concluir servi\u00e7o', exact: true }).click()
  await operator.getByRole('button', { name: 'Confirmar conclus\u00e3o', exact: true }).click()
  await operator.locator('.operator-detail-heading').getByText('Conclu\u00eddo', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Process mode browser passed: default checked, autosave/reload, offer/OS snapshot, unordered stages, min-stage finished pieces, completion guard and responsive layouts.')
} catch (error) {
  await admin.screenshot({ path: 'test-results/process-mode-failure-admin.png', fullPage: true })
  if (operator) await operator.screenshot({ path: 'test-results/process-mode-failure-operator.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
