import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// A material or labor row is edited in place (pencil beside the ×): the form opens filled in and saving replaces the row.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  await api('/machines/import', 'POST', { items: [{ id: 'm-torno', name: 'Torno Convencional 1', type: 'Torno', sector: 'Usinagem', hourlyRate: 20 }, { id: 'm-fresa', name: 'Fresadora', type: 'Fresa', sector: 'Usinagem', hourlyRate: 35 }] })
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Peça para editar recursos' })).data.item
  await api(`/offers/${offer.id}/resources`, 'PUT', {
    materials: [{ id: 'material-1', name: 'teste', detail: '10mm', unit: 'kg', quantity: 100, unitPrice: 20, icon: '▰' }, { id: 'material-2', name: 'Bucha', detail: '', unit: 'un', quantity: 4, unitPrice: 3, icon: '▰' }],
    // The first labor row is an older one, with only the machine name.
    laborEntries: [{ id: 'labor-1', type: 'machine', resource: 'Torno Convencional 1', hours: 5, hourlyRate: 20 }], stages: ['turning'], kind: 'service',
  })
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
  await page.locator('.offers-table-row').filter({ hasText: 'Peça para editar recursos' }).locator('.offer-review-button').click()
  await page.getByRole('heading', { name: `Detalhes da oferta ${offer.code}`, exact: true }).waitFor()

  // Material: the form comes filled in, the row is marked, and saving keeps one row with the new values.
  await page.getByRole('button', { name: 'Editar teste', exact: true }).click()
  const materialForm = page.getByRole('form', { name: 'Editar material' })
  await materialForm.waitFor()
  assert.equal(await page.locator('.offer-material-row--editing').count(), 1)
  assert.equal(await materialForm.locator('.material-autocomplete input').inputValue(), 'teste')
  assert.equal(await materialForm.getByLabel('Especificação').inputValue(), '10mm')
  assert.equal(await materialForm.getByLabel('Quantidade (kg) *').inputValue(), '100')
  assert.equal(await materialForm.getByLabel('Valor unitário').inputValue(), '20')
  await page.screenshot({ path: 'test-results/offer-resource-edit-material.png', fullPage: true })
  await materialForm.getByLabel('Quantidade (kg) *').fill('120')
  await materialForm.getByLabel('Valor unitário').fill('25')
  await materialForm.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await materialForm.waitFor({ state: 'detached' })
  const materialRows = page.locator('.offer-material-row:not(.offer-material-row--labor)')
  await page.waitForFunction(() => /R\$\s3\.000,00/.test(document.querySelector('.offer-materials-list')?.innerText || ''))
  assert.equal(await materialRows.count(), 2)
  assert.match((await materialRows.first().innerText()).replace(/\s+/g, ' '), /^▰ teste 10mm 120 kg .* R\$\s25,00 R\$\s3\.000,00 ×$/)

  // Cancel leaves the row as it was; "Adicionar material" while editing switches the form back to an empty new row.
  await page.getByRole('button', { name: 'Editar Bucha', exact: true }).click()
  await page.getByRole('form', { name: 'Editar material' }).getByLabel('Quantidade (un) *').fill('9')
  await page.getByRole('button', { name: 'Adicionar material', exact: true }).first().click()
  const addForm = page.getByRole('form', { name: 'Adicionar material' })
  await addForm.waitFor()
  assert.equal(await addForm.locator('.material-autocomplete input').inputValue(), '')
  assert.equal(await page.locator('.offer-material-row--editing').count(), 0)
  await addForm.getByRole('button', { name: 'Cancelar', exact: true }).click()
  assert.match(await materialRows.nth(1).innerText(), /4 un/)

  // Labor: the older row finds its machine by name; the hours change in place.
  await page.getByRole('button', { name: 'Editar Torno Convencional 1', exact: true }).click()
  const laborForm = page.getByRole('form', { name: 'Editar mão de obra' })
  await laborForm.waitFor()
  assert.equal(await laborForm.getByLabel('Máquina', { exact: true }).inputValue(), 'm-torno')
  assert.equal(await laborForm.getByLabel('Tempo (horas)').inputValue(), '5')
  await laborForm.getByLabel('Tempo (horas)').fill('8')
  await laborForm.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await laborForm.waitFor({ state: 'detached' })
  await page.waitForFunction(() => /8 h/.test(document.querySelector('.offer-labor-list')?.innerText || ''))
  // Switching the machine also takes its name and rate.
  await page.getByRole('button', { name: 'Editar Torno Convencional 1', exact: true }).click()
  await page.getByRole('form', { name: 'Editar mão de obra' }).getByLabel('Máquina', { exact: true }).selectOption('m-fresa')
  await page.getByRole('form', { name: 'Editar mão de obra' }).getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await page.locator('.offer-material-row--labor').filter({ hasText: 'Fresadora' }).waitFor()
  assert.equal(await page.locator('.offer-material-row--labor').count(), 1)
  assert.match((await page.locator('.offer-material-row--labor').innerText()).replace(/\s+/g, ' '), /^Fresadora Hora máquina 8 h Usinagem R\$\s35,00 R\$\s280,00/)

  const saved = (await api('/offers')).data.items.find((item) => item.id === offer.id).resources
  assert.deepEqual(saved.materials.map((material) => [material.id, material.quantity, material.unitPrice]), [['material-1', 120, 25], ['material-2', 4, 3]])
  assert.deepEqual(saved.laborEntries.map((entry) => [entry.id, entry.machineId, entry.resource, entry.hours, entry.hourlyRate]), [['labor-1', 'm-fresa', 'Fresadora', 8, 35]])
  await page.screenshot({ path: 'test-results/offer-resource-edit-done.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('offer resource edit: ok')
} finally {
  await browser.close()
  await fixture.close()
}
