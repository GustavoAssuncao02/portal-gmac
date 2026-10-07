import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
try {
  const employee = (await fixture.request('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001', birthDate: '1990-01-01', email: 'ana@example.invalid', identification: '001' })).data.item
  const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['turning', 'milling', 'painting', 'cut-bend'], kind: 'service' })
  await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offer.deadline, serviceValue: 100 } })
  const base = (await fixture.request(`/offers/${offer.id}/accept`, 'POST')).data.item
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 393, height: 852 }, { width: 430, height: 932 }]) {
    const errors = []
    await fixture.mutateStore((store) => {
      store.orders = [10, 0].map((purchaseQuantity, index) => ({
        ...base, code: `OS-2026-000${6 + index}`, service: index ? 'Projeto sem pendencia' : 'Projeto com material pendente',
        resources: { ...base.resources, materials: [{ id: 'inox', inventoryId: 7, name: 'A\u00e7o Inox 304', detail: 'Chapa inoxidavel', quantity: 10, purchaseQuantity, stockAvailable: purchaseQuantity ? 0 : 10, stockStatus: purchaseQuantity ? 'missing' : 'available' }] },
      }))
    })
    const admin = await browser.newPage({ viewport })
    admin.on('pageerror', (error) => errors.push(error.message))
    await admin.goto(fixture.url)
    await admin.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await admin.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await admin.getByRole('button', { name: 'Entrar', exact: true }).click()
    await admin.locator('.admin-home-main').waitFor()
    if (viewport.width < 760) await admin.getByRole('button', { name: 'Abrir menu de navega\u00e7\u00e3o', exact: true }).click()
    await admin.locator('.sidebar').getByRole('button', { name: 'Servi\u00e7os em andamento', exact: true }).click()
    const row = admin.locator('.admin-os-table tbody tr').filter({ hasText: 'OS-2026-0006' })
    await row.locator('.admin-os-material-alert').waitFor()
    assert.equal(await row.getAttribute('class'), 'admin-os-row--material-pending')
    assert.ok((await row.locator('.admin-os-material-alert').getAttribute('title')).includes('10 kg'))
    assert.equal(await admin.locator('.admin-os-table tbody tr').filter({ hasText: 'OS-2026-0007' }).locator('.admin-os-material-alert').count(), 0)
    assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await admin.screenshot({ path: `test-results/pending-material-panel-${viewport.width}.png`, fullPage: true })
    await admin.close()

    const context = await browser.newContext({ viewport })
    await context.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    let starts = 0
    page.on('request', (request) => { if (request.url().endsWith('/start')) starts++ })
    await page.goto(fixture.url)
    await page.locator('.operator-detail').waitFor()
    async function openWarning() {
      await page.getByRole('button', { name: 'Trabalhar neste projeto', exact: true }).click()
      await page.getByRole('combobox', { name: 'Funcion\u00e1rio', exact: true }).selectOption(String(employee.id))
      await page.getByRole('radio', { name: 'Servi\u00e7o de hora homem', exact: true }).check()
      await page.getByRole('combobox', { name: 'Servi\u00e7o de hora homem', exact: true }).selectOption({ index: 1 })
      await page.getByRole('button', { name: 'Iniciar trabalho', exact: true }).click()
      await page.getByRole('dialog', { name: 'Material pendente', exact: true }).waitFor()
    }
    await openWarning()
    const warning = page.getByRole('dialog', { name: 'Material pendente', exact: true })
    assert.ok((await warning.innerText()).includes('10 kg'))
    assert.ok((await warning.innerText()).includes('Deseja come\u00e7ar o servi\u00e7o mesmo assim?'))
    assert.ok((await warning.innerText()).includes('A\u00e7o Inox 304'))
    assert.equal(starts, 0, 'Showing the modal must not create a session')
    const modalBox = await warning.boundingBox()
    assert.ok(modalBox.x >= 0 && modalBox.x + modalBox.width <= viewport.width)
    await page.screenshot({ path: `test-results/pending-material-modal-${viewport.width}.png` })
    await warning.getByRole('button', { name: 'Cancelar', exact: true }).click()
    assert.equal(starts, 0)
    assert.equal((await fixture.request('/operations/orders')).data.items.find((item) => item.code === 'OS-2026-0006').operation.activeSession, null)
    await openWarning()
    await page.keyboard.press('Escape')
    await warning.waitFor({ state: 'detached' })
    assert.equal(starts, 0)
    await openWarning()
    if (viewport.width === 1920) {
      await fixture.mutateStore((store) => { store.orders[0].resources.materials[0].purchaseQuantity = 12 })
      await warning.getByRole('button', { name: 'Sim, iniciar servi\u00e7o', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('.pending-material-total')?.textContent.includes('12 kg'))
      assert.equal((await fixture.request('/operations/orders')).data.items.find((item) => item.code === 'OS-2026-0006').operation.activeSession, null)
    }
    await warning.getByRole('button', { name: 'Sim, iniciar servi\u00e7o', exact: true }).click()
    await warning.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Pausar trabalho', exact: true }).waitFor()
    const state = (await fixture.request('/operations/orders')).data.items.find((item) => item.code === 'OS-2026-0006')
    assert.equal(state.operation.status, 'running')
    const events = (await fixture.request('/operations/orders/OS-2026-0006/events')).data.items
    assert.equal(events.length, 1)
    assert.equal(events[0].pendingMaterialsAccepted, true)
    assert.equal(events[0].employeeName, 'Ana Teste')
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('Pending materials verified: amber panel row, 10 kg warning, cancel/Escape without start, stale quantity re-confirmation, successful start and audit on desktop/iPhone 15/Pro Max.')
} finally { await browser.close(); await fixture.close() }
