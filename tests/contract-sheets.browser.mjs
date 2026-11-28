import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// Ofertas com planilha do cliente (server/contractTables.js) na tela de detalhes: etiqueta da Belgo mostra só as linhas da
// planilha (com o valor da hora), pede a máquina e escolhe os materiais na lista da planilha; uma oferta normal não vê nada
// disso.
const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' } })
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const waitSaved = () => page.waitForFunction(() => !document.querySelector('.offer-proposal-button')?.disabled)
const groups = () => page.locator('.offer-stage-heading h3').allTextContents()
const saved = async (id) => (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items.find((row) => row.id === id).resources
try {
  await (await fixture.serverModule('stageCatalog.js')).ensureStageCatalog()
  const machine = (await fixture.adminRequest('/machines', 'POST', { name: 'Torno CNC 02', type: 'Torno', sector: 'Usinagem', hourlyRate: 100 }, fixture.admin)).data.item
  const label = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, quantity: 1, cnpj: '61.074.506/0026-98', labelNumber: '5319' }, fixture.admin)).data.item
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill('12345678901')
  await page.getByLabel('Senha', { exact: true }).fill('teste123')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
  await page.locator('.offer-review-button').first().click()

  // Only the lines of the Etiqueta sheet, with the normal rate.
  await page.locator('.offer-stage-sheet').waitFor()
  assert.deepEqual(await groups(), ['ETIQUETA BELGO'])
  const cnc = page.getByRole('checkbox', { name: /SERV USINAGEM EM TORNO CNC \(ETIQUETA\)/ })
  assert.match(await page.locator('.offer-stage-item', { has: cnc }).locator('.offer-stage-rate').textContent(), /206,80\/h/)
  await cnc.check()
  await waitSaved()
  await page.getByLabel('Horas previstas de Serv Usinagem em Torno CNC (Etiqueta)').fill('1')
  await page.getByLabel('Minutos previstos de Serv Usinagem em Torno CNC (Etiqueta)').fill('30')
  await page.getByLabel('Minutos previstos de Serv Usinagem em Torno CNC (Etiqueta)').press('Enter')
  await waitSaved()
  await page.getByLabel('Máquina ou serviço de Serv Usinagem em Torno CNC (Etiqueta)').selectOption(`machine:${machine.id}`)
  await waitSaved()

  // Materials from the list of the sheet: description, unit and price of the sheet.
  await page.getByRole('button', { name: 'Adicionar material', exact: true }).first().click()
  await page.getByLabel('Material da planilha').selectOption('et-m1')
  await page.locator('.offer-inline-form').getByLabel(/^Quantidade.*\(kg\)/).fill('3')
  await page.locator('.offer-inline-form').getByRole('button', { name: 'Adicionar material', exact: true }).click()
  await waitSaved()
  await page.locator('.offer-material-sheet-row').first().waitFor()
  assert.match(await page.locator('.offer-sheet-total').textContent(), /419,76/, 'R$ 310,20 (1,5 h × 206,80) + R$ 109,56 (3 kg × 36,52)')
  await page.screenshot({ path: 'test-results/contract-sheet-offer.png', fullPage: true })
  const resources = await saved(label.id)
  assert.deepEqual(resources.stages, ['ct-etiqueta-et-l4'])
  assert.deepEqual(resources.materials.map((row) => [row.name, row.contractRow, row.unit, row.quantity, row.unitPrice]), [['Barra Metalica Aco Inox Aisi304 1M', 'et-m1', 'kg', 3, 36.52]])
  assert.equal(String(resources.stageResources['ct-etiqueta-et-l4'].id), String(machine.id))

  // A normal offer never sees the lines of the sheets.
  const normal = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, quantity: 1, service: 'Peca normal' }, fixture.admin)).data.item
  await page.reload()
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
  // The newest offer comes first in the list.
  await page.locator('.offer-review-button').first().click()
  await page.getByRole('heading', { name: `Detalhes da oferta ${normal.code}` }).waitFor()
  await page.getByRole('checkbox', { name: 'TORNEARIA', exact: true }).waitFor()
  assert.equal(await page.locator('.offer-stage-sheet').count(), 0)
  assert.ok(!(await groups()).some((name) => /ETIQUETA|NESTLÉ/.test(name)), (await groups()).join())
  assert.equal(await page.getByLabel('Material da planilha').count(), 0)

  // Nestlé: 4 h of Tratamento Térmico at the sheet rate (R$ 128,87, not the R$ 100 of the machine); in the PDF form 2 h
  // stay normal and 2 h go to noturna with "Dividir horas", and the PDF prints the line once per situation.
  const stage = 'ct-nestle-fs-l1'
  const nestleOffer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, quantity: 1, cnpj: '60.409.075/0120-88', service: 'Cilindro Nestle' }, fixture.admin)).data.item
  const planned = await fixture.adminRequest(`/offers/${nestleOffer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', description: nestleOffer.description, stages: [stage], stageTimes: { [stage]: 240 }, stageResources: { [stage]: { type: 'machine', id: machine.id } } }, fixture.admin)
  assert.deepEqual(planned.data.item.resources.laborEntries.map((entry) => [entry.hours, entry.hourlyRate]), [[4, 128.87]])
  await fixture.adminRequest(`/offers/${nestleOffer.id}/finish`, 'POST', {}, fixture.admin)
  await page.reload()
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
  await page.locator('.offer-review-button').first().click()
  await page.getByRole('heading', { name: `Detalhes da oferta ${nestleOffer.code}` }).waitFor()
  await page.locator('.offer-material-row--labor', { hasText: 'R$ 515,48' }).waitFor()
  await page.getByRole('button', { name: 'Fazer proposta', exact: true }).click()
  await page.getByRole('heading', { name: 'Fazer proposta', exact: true }).waitFor()
  await page.locator('.proposal-card').filter({ hasText: 'PROPOSTA A' }).click()
  await page.getByRole('button', { name: 'Gerar proposta em PDF', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Proposta · Nestlé (FS-3055)', exact: true })
  const line = 'Serv Restauracao Tratamento Termico'
  assert.equal(await form.getByLabel(`Horas de ${line}`, { exact: true }).inputValue(), '4')
  await form.getByText('Mostrar só linhas preenchidas').click()
  await form.locator('tr', { hasText: line }).getByRole('button', { name: 'Dividir horas', exact: true }).click()
  await form.getByLabel(`Horas normal de ${line}`, { exact: true }).fill('2')
  await form.getByLabel(`Horas noturna de ${line}`, { exact: true }).fill('2')
  const row = form.locator('tr', { hasText: line })
  assert.match((await row.locator('.proposal-line-total').innerText()).replace(/\s/g, ' '), /^R\$ 689,70/, '2 × 128,87 + 2 × 215,98')
  assert.match((await row.locator('.proposal-split-foot').innerText()).replace(/\s/g, ' '), /Total da linha: 4 h/)
  await page.screenshot({ path: 'test-results/contract-sheet-split.png' })
  const download = page.waitForEvent('download')
  await form.getByRole('button', { name: 'Gerar PDF', exact: true }).click()
  await download
  await form.waitFor({ state: 'detached' })
  const documentLabor = (await fixture.adminRequest('/offers', 'GET', undefined, fixture.admin)).data.items.find((item) => item.id === nestleOffer.id).proposal.document.labor
  assert.deepEqual(documentLabor.filter((entry) => entry.id === 'fs-l1').map((entry) => [entry.situation, entry.quantity]), [['normal', 2], ['night', 2]])

  assert.deepEqual(errors, [])
  console.log('Contract sheets passed: sheet stages with sheet rates and machine, sheet materials and total, normal offer untouched, Dividir horas in the PDF form.')
} finally { await browser.close(); await fixture.close() }
