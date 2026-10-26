import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// Ver OS: each stage shows its planned time and its machine or service, and both are edited there, for every stage at once.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await mkdir('test-results', { recursive: true })
try {
  await fixture.mutateStore((store) => {
    store.machines = [
      { id: 'torno', name: 'Torno Convencional 1', sectors: ['Usinagem'], sector: 'Usinagem', hourlyRate: 80 },
      { id: 'plasma', name: 'Plasma 01', sectors: ['Caldeiraria'], sector: 'Caldeiraria', hourlyRate: 95 },
    ]
  })
  const [service] = (await fixture.adminRequest('/labor-services')).data.items
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Peças com etapas planejadas', quantity: 10 })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning', 'painting', 'plasma-cut'], stageTimes: { turning: 1800, painting: 600, 'plasma-cut': 900 }, stageResources: { turning: { type: 'machine', id: 'torno' }, painting: { type: 'labor-service', id: service.id }, 'plasma-cut': { type: 'machine', id: 'plasma' } } })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offerDraft.deadline } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  // The fixture leaves accepted offers like the older ones; this OS gets its plan back, as a new one would have.
  await fixture.mutateStore((store) => { store.orders.find((item) => item.code === order.code).resources.stageResources = { turning: { type: 'machine', id: 'torno', name: 'Torno Convencional 1' }, painting: { type: 'labor-service', id: service.id, name: service.name }, 'plasma-cut': { type: 'machine', id: 'plasma', name: 'Plasma 01' } } })

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Serviços em andamento', exact: true }).click()
  await page.locator('.admin-os-table tbody tr').filter({ hasText: 'Peças com etapas planejadas' }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  const stages = page.getByRole('form', { name: 'Etapas da OS' })
  await stages.waitFor()
  const rows = stages.locator('fieldset > div')
  assert.match(await rows.nth(0).innerText(), /Tornearia[\s\S]*0\/10 peças[\s\S]*30h previstas · Torno Convencional 1/)
  assert.match(await rows.nth(1).innerText(), new RegExp(`Pintura[\\s\\S]*10h previstas · ${service.name}`))
  assert.match(await rows.nth(2).innerText(), /Corte a plasma[\s\S]*15h previstas · Plasma 01/)
  await page.screenshot({ path: 'test-results/order-stage-plans-view.png', fullPage: true })

  // Editing: the fields come filled in; a stage without time is refused; the change is saved for the OS.
  await page.getByRole('button', { name: 'Editar tempos e máquinas', exact: true }).click()
  assert.equal(await stages.getByLabel('Horas previstas da etapa Tornearia').inputValue(), '30')
  await stages.getByLabel('Máquina ou serviço da etapa Corte a plasma').locator('option[value="machine:torno"]').waitFor({ state: 'attached' })
  assert.equal(await stages.getByLabel('Máquina ou serviço da etapa Tornearia').inputValue(), 'machine:torno')
  await stages.getByLabel('Horas previstas da etapa Pintura').fill('')
  await stages.getByRole('button', { name: 'Salvar etapas', exact: true }).click()
  await stages.getByRole('alert').getByText('Informe o tempo previsto da etapa Pintura.').waitFor()
  await stages.getByLabel('Horas previstas da etapa Pintura').fill('8')
  await stages.getByLabel('Minutos previstos da etapa Pintura').fill('30')
  await stages.getByLabel('Máquina ou serviço da etapa Corte a plasma').selectOption('machine:torno')
  await page.screenshot({ path: 'test-results/order-stage-plans-edit.png', fullPage: true })
  await stages.getByRole('button', { name: 'Salvar etapas', exact: true }).click()
  await stages.getByRole('button', { name: 'Salvar etapas', exact: true }).waitFor({ state: 'detached' })
  await rows.nth(2).getByText('15h previstas · Torno Convencional 1').waitFor()
  assert.match(await rows.nth(1).innerText(), /8h 30min previstas/)
  const saved = (await fixture.adminRequest('/operations/orders')).data.items.find((item) => item.code === order.code).resources
  assert.deepEqual(saved.stageTimes, { turning: 1800, painting: 510, 'plasma-cut': 900 })
  assert.deepEqual(saved.stageResources['plasma-cut'], { type: 'machine', id: 'torno', name: 'Torno Convencional 1' })
  // The planning reads the new machine of the stage.
  const backlog = (await fixture.adminRequest('/planning')).data.backlog.filter((row) => row.orderCode === order.code)
  assert.deepEqual(backlog.map((row) => [row.stageCode, row.suggested?.id, row.toPlanMinutes]), [['turning', 'torno', 1800], ['painting', service.id, 510], ['plasma-cut', 'torno', 900]])
  assert.deepEqual(errors, [])
  console.log('Ver OS stage plans: ok')
} finally {
  await browser.close()
  await fixture.close()
}
