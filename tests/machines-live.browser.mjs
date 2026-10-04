import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
try {
  const login = await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })
  const admin = { Authorization: `Bearer ${login.data.token}` }
  async function request(route, body, method = 'POST', headers = admin) {
    const result = await fixture.request(route, method, body, headers)
    assert.ok(result.status < 300, JSON.stringify(result.data))
    return result.data
  }
  const machine = (await request('/machines', { name: 'Torno ao vivo', type: 'Torno', sector: 'Usinagem', hourlyRate: 100 })).item
  const second = (await request('/machines', { name: 'Fresa ao vivo', type: 'Fresa', sector: 'Usinagem', hourlyRate: 100 })).item
  const employee = (await request('/employees', { name: 'Ana Teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'ana@test.invalid', identification: '001' })).item
  const offer = (await request('/offers', offerDraft)).item
  await request(`/offers/${offer.id}/resources`, { materials: [], laborEntries: [], stages: ['turning'], kind: 'service' }, 'PUT')
  await request(`/offers/${offer.id}/proposal`, { layout: 'classic', proposal: { key: 'A', deadline: '2026-12-20', serviceValue: 100 } })
  const order = (await request(`/offers/${offer.id}/accept`, {})).item
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  const errors = []
  let reads = 0
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (req) => { if (req.url().endsWith('/api/machines') && req.method() === 'GET') reads++ })
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Máquinas', exact: true }).click()
  const row = (name) => page.locator('.machine-row:not(.machine-row--header)').filter({ has: page.getByText(name, { exact: true }) })
  await row(machine.name).waitFor()
  assert.equal(await row(machine.name).locator('.machine-status').innerText(), 'Ociosa')
  await page.getByRole('button', { name: 'Editar Torno ao vivo', exact: true }).click()
  const draft = page.getByRole('dialog').getByLabel('Nome da máquina')
  await draft.fill('Nome em edição não salvo')
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  const started = await request(`/operations/orders/${order.code}/start`, { employeeId: employee.id, machineId: machine.id }, 'POST', operator)
  const session = { sessionId: started.operation.activeSession.id, sessionToken: started.sessionToken }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(() => [...document.querySelectorAll('.machine-row')].some((row) => row.textContent.includes('Torno ao vivo') && row.textContent.includes('Em funcionamento') && row.textContent.includes('Ana Teste')), null, { timeout: 3000 })
  assert.equal(await draft.inputValue(), 'Nome em edição não salvo')
  assert.equal(await page.getByRole('dialog').getByLabel('Status atual').inputValue(), 'Em funcionamento')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click()
  await request(`/operations/orders/${order.code}/machine`, { ...session, machineId: second.id }, 'POST', operator)
  await page.waitForFunction(() => [...document.querySelectorAll('.machine-row')].some((row) => row.textContent.includes('Fresa ao vivo') && row.textContent.includes('Em funcionamento')), null, { timeout: 13000 })
  assert.equal(await row(machine.name).locator('.machine-status').innerText(), 'Ociosa')
  await request(`/operations/orders/${order.code}/pause`, { ...session, reason: 'Descanso' }, 'POST', operator)
  await page.waitForFunction(() => document.querySelectorAll('.machine-status--working').length === 0, null, { timeout: 13000 })
  const resumed = await request(`/operations/orders/${order.code}/start`, { employeeId: employee.id, machineId: machine.id }, 'POST', operator)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForFunction(() => document.querySelectorAll('.machine-status--working').length === 1, null, { timeout: 3000 })
  await request(`/operations/orders/${order.code}/pause`, { sessionId: resumed.operation.activeSession.id, sessionToken: resumed.sessionToken, reason: 'Descanso' }, 'POST', operator)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.waitForFunction(() => document.querySelectorAll('.machine-status--working').length === 0, null, { timeout: 3000 })
  assert.ok(reads >= 4)
  await mkdir('test-results/machines-live', { recursive: true })
  await page.screenshot({ path: 'test-results/machines-live/desktop.png', fullPage: true })
  for (const width of [393, 430]) {
    await page.setViewportSize({ width, height: 852 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `test-results/machines-live/mobile-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.locator('.sidebar').getByRole('button', { name: 'Início', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  const before = reads
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(10500)
  assert.equal(reads, before, 'Machine polling must stop after leaving the screen')
  assert.deepEqual(errors, [])
  console.log('Live machines: 10s polling, immediate focus/online/visibility refresh, start/change/pause, draft preservation, mobile widths and cleanup passed.')
} finally {
  await browser.close()
  await fixture.close()
}
