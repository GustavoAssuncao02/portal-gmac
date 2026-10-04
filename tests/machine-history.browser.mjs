import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, webkit, devices } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const directory = 'test-results/machine-history'
await mkdir(directory, { recursive: true })
let browser
try {
  const started = new Date(Date.now() - 120000).toISOString()
  await fixture.mutateStore((store) => {
    store.machines = [{ id: 'torno', name: 'Torno histórico', type: 'Torno CNC', sector: 'Usinagem', hourlyRate: 100 }, { id: 'fresa', name: 'Fresa sem uso', type: 'Fresa', sector: 'Usinagem', hourlyRate: 100 }]
    store.orders = [{ code: 'OS-1', service: 'Eixo mecanico', quantity: 10, operation: { activeSession: { id: 'current', machineId: 'torno', employeeId: 1, employeeName: 'Ana Teste', startedAt: started } }, operationEvents: [{ type: 'started', sessionId: 'current', machineId: 'torno', employeeId: 1, employeeName: 'Ana Teste', at: started }] }, { code: 'OS-2', service: 'Conjunto metalico', operationEvents: [{ type: 'started', sessionId: 'old', machineId: 'torno', employeeId: 2, employeeName: 'Bruno Teste', at: '2026-09-02T08:00:00-03:00' }, { type: 'paused', sessionId: 'old', machineId: 'torno', employeeId: 2, employeeName: 'Bruno Teste', reason: 'Descanso', at: '2026-09-02T10:00:00-03:00' }] }]
    for (const order of store.orders) {
      order.quantity = 10
      order.operation = { status: 'paused', stages: [{ key: 'turning', name: 'Tornearia' }], stageCounts: { turning: 0 }, accumulatedMs: 0, activeSession: null, ...order.operation }
    }
  })
  const errors = []
  for (const [engine, device] of [[chromium, null], [webkit, 'iPhone 15'], [webkit, 'iPhone 15 Pro Max']]) {
    browser = await engine.launch()
    const context = await browser.newContext(device ? devices[device] : { viewport: { width: 1366, height: 900 } })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    const opener = page.getByRole('button', { name: 'Abrir menu de navegação', exact: true })
    if (await opener.isVisible()) await opener.click()
    await page.locator('.sidebar').getByRole('button', { name: 'Máquinas', exact: true }).click()
    const icon = page.getByRole('button', { name: 'Ver histórico de uso de Torno histórico', exact: true })
    await icon.waitFor()
    assert.ok(await icon.evaluate((element) => element.getBoundingClientRect().left >= element.previousElementSibling.getBoundingClientRect().right))
    await icon.click()
    const modal = page.getByRole('dialog', { name: 'Torno histórico', exact: true })
    await modal.getByText('Bruno Teste', { exact: true }).waitFor()
    assert.equal(await modal.getByLabel('Período').inputValue(), 'all')
    assert.equal(await modal.getByText('Ana Teste', { exact: true }).count(), 1)
    assert.equal(await modal.getByText('Em uso', { exact: true }).count(), 1)
    assert.equal(await modal.getByText('02:00:00', { exact: true }).count(), 1)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.ok(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    assert.equal(await modal.locator('tbody tr').evaluateAll((rows) => rows.some((row) => row.scrollWidth > row.clientWidth + 1)), false)
    await modal.screenshot({ path: `${directory}/${device || 'desktop'}-all.png` })
    await modal.getByLabel('Período').selectOption('date')
    await modal.getByLabel('Data específica', { exact: true }).fill('2026-09-02')
    await modal.getByText('Bruno Teste', { exact: true }).waitFor()
    assert.equal(await modal.getByText('Ana Teste', { exact: true }).count(), 0)
    await modal.getByLabel('Data específica', { exact: true }).fill('2026-09-03')
    await modal.getByText('Nenhuma utilização registrada neste período.', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await modal.waitFor({ state: 'hidden' })
    assert.equal(await icon.evaluate((element) => document.activeElement === element), true)
    await page.getByRole('button', { name: 'Ver histórico de uso de Fresa sem uso', exact: true }).click()
    const empty = page.getByRole('dialog', { name: 'Fresa sem uso', exact: true })
    await empty.getByText('Nenhuma utilização registrada neste período.', { exact: true }).waitFor()
    await empty.getByRole('button', { name: 'Fechar histórico', exact: true }).click()
    let failOnce = true
    await page.route('**/api/machines/torno/history?**', async (route) => {
      if (!failOnce) return route.continue()
      failOnce = false
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Falha temporaria de teste' }) })
    })
    await icon.click()
    await modal.getByRole('alert').waitFor()
    await modal.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
    await modal.getByText('Ana Teste', { exact: true }).waitFor()
    if (device === 'iPhone 15 Pro Max') {
      await fixture.mutateStore((store) => {
        const order = store.orders.find((order) => order.code === 'OS-1')
        order.operation.activeSession = null
        order.operationEvents.push({ type: 'paused', sessionId: 'current', machineId: 'torno', employeeId: 1, employeeName: 'Ana Teste', reason: 'Descanso', at: new Date().toISOString() })
      })
      await modal.getByText('Em uso', { exact: true }).waitFor({ state: 'hidden', timeout: 13000 })
      assert.equal(await modal.getByText('Ana Teste', { exact: true }).count(), 1)
    }
    await modal.getByRole('button', { name: 'Fechar histórico', exact: true }).click()
    await page.screenshot({ path: `${directory}/${device || 'desktop'}-icon.png`, fullPage: true })
    await browser.close()
    browser = null
  }
  assert.deepEqual(errors, [])
  console.log('Machine history: correct operators/time/active sessions, date/empty/error/retry states, Escape/focus restoration and desktop/iPhone 15/Pro Max passed.')
} finally {
  if (browser) await browser.close()
  await fixture.close()
}
