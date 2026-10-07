import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { stageLabel } from '../server/serviceStages.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
const stages = ['turning', 'milling', 'cnc-turning', 'painting', 'cut-bend', 'torch-cut', 'grinding']
await mkdir('test-results', { recursive: true })
try {
  const offer = (await fixture.request('/offers', 'POST', offerDraft)).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { stages, materials: [], laborEntries: [], kind: 'service' })
  await fixture.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offer.deadline, serviceValue: 100 } })
  const base = (await fixture.request(`/offers/${offer.id}/accept`, 'POST')).data.item
  const oldCode = 'OS-2026-0001', newCode = 'OS-2026-0002', pendingCode = 'OS-2026-0003', activeCode = 'OS-2026-0004'
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 393, height: 852 }, { width: 430, height: 932 }]) {
    await fixture.mutateStore((store) => {
      store.orders = [
        [oldCode, 'Estrutura antiga', '2026-10-01T15:00:00Z', '2026-10-04T12:00:00Z'],
        [activeCode, 'Projeto ativo', null, null],
        [newCode, 'Estrutura recente', '2026-10-03T15:00:00Z', '2026-10-03T16:00:00Z'],
        [pendingCode, 'Aguardando conferencia', '2026-10-04T15:00:00Z', null],
      ].map(([code, service, completedAt, completionAcknowledgedAt]) => ({ ...base, code, service, operation: {
        status: completedAt ? 'completed' : 'paused', completedAt, completionAcknowledgedAt, accumulatedMs: 3600000, activeSession: null,
        stages: stages.map((key, i) => ({ key: `stage-${i}`, name: stageLabel(key) })),
        stageCounts: Object.fromEntries(stages.map((_, i) => [`stage-${i}`, completedAt ? 10 : 0])),
      } }))
    })
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    let reads = 0
    page.on('request', (request) => { if (request.url().endsWith('/api/operations/orders')) reads++ })
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    async function navigate(name) {
      if (viewport.width < 760) await page.getByRole('button', { name: 'Abrir menu de navega\u00e7\u00e3o', exact: true }).click()
      await page.locator('.sidebar').getByRole('button', { name, exact: true }).click()
      await page.locator('.admin-os-table').waitFor()
    }
    const codes = () => page.locator('.admin-os-table tbody tr td:first-child small').allTextContents().then((rows) => rows.map((text) => text.split(' \u00b7')[0]))
    await navigate('Servi\u00e7os conclu\u00eddos')
    assert.deepEqual(await codes(), [newCode, oldCode])
    assert.equal(await page.locator('.admin-os-table').getByRole('button', { name: 'Conclu\u00eddo', exact: true }).count(), 0)
    assert.equal(await page.locator('.admin-os-stage-label').count(), 14)
    assert.ok((await page.locator('.admin-os-table tbody tr').first().innerText()).includes('10/10'))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    const searchGap = await page.evaluate(() => document.querySelector('.admin-os-table-wrap').getBoundingClientRect().top - document.querySelector('.global-search').getBoundingClientRect().bottom)
    assert.ok(searchGap >= 19, `Search must have space above table: ${searchGap}px`)
    await page.screenshot({ path: `test-results/completed-services-${viewport.width}.png`, fullPage: true })
    if (viewport.width === 1920) {
      const initialReads = reads
      await page.waitForTimeout(10500)
      assert.ok(reads > initialReads, 'Archive must refresh automatically')
    }
    await navigate('Servi\u00e7os em andamento')
    assert.deepEqual(await codes(), [activeCode, pendingCode])
    const pendingRow = page.locator('.admin-os-table tbody tr').filter({ hasText: pendingCode })
    if (viewport.width === 1920) {
      await page.route('**/acknowledge-completion', (route) => route.fulfill({ status: 409, json: { message: 'Teste de falha de confirmacao' } }))
      await pendingRow.getByRole('button', { name: 'Conclu\u00eddo', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Teste de falha' }).waitFor()
      assert.ok((await codes()).includes(pendingCode))
      await page.unroute('**/acknowledge-completion')
    }
    await pendingRow.getByRole('button', { name: 'Conclu\u00eddo', exact: true }).click()
    await pendingRow.waitFor({ state: 'detached' })
    await navigate('Servi\u00e7os conclu\u00eddos')
    assert.deepEqual(await codes(), [pendingCode, newCode, oldCode])
    await page.getByRole('searchbox', { name: 'Buscar servi\u00e7os' }).fill(oldCode)
    assert.deepEqual(await codes(), [oldCode])
    await page.reload()
    await page.getByRole('heading', { name: 'Servi\u00e7os conclu\u00eddos', exact: true }).waitFor()
    assert.deepEqual(await codes(), [pendingCode, newCode, oldCode])
    await page.locator('.admin-os-table tbody tr').filter({ hasText: pendingCode }).getByRole('button', { name: 'Ver OS' }).click()
    await page.locator('.os-detail').waitFor()
    assert.ok((await page.locator('.os-detail-heading').innerText()).includes(pendingCode))
    const reopened = await fixture.request(`/operations/orders/${pendingCode}/reopen`, 'POST', {}, { Authorization: `Bearer ${fixture.adminToken}` })
    assert.equal(reopened.status, 200)
    await page.reload()
    await page.locator('.os-detail').waitFor()
    await navigate('Servi\u00e7os conclu\u00eddos')
    assert.deepEqual(await codes(), [newCode, oldCode])
    await navigate('Servi\u00e7os em andamento')
    assert.ok((await codes()).includes(pendingCode))
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Completed services verified: explicit confirmation, newest completion first, search, reload, polling, OS access, reopen and no page overflow on desktop/iPhone 15/Pro Max.')
} finally { await browser.close(); await fixture.close() }
