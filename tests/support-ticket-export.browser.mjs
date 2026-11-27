import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

// Ticket › Exportar (2026-11-27): beside the X of the ticket window, for the developers only. A ticket without
// attachments: "Copiar JSON" and "Exportar (.json)"; with them, "Exportar (.zip)". Fictitious data only.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const person = { name: 'Funcionária Teste', birthDate: '1990-01-01', cpf: '00000000007', email: 'funcionaria7@example.invalid', identification: '', type: 'administrative', password: 'senha123' }
const fixture = await createWorkflowFixture({ accountsEnv: env, ticketDevelopers: [env.DEMO_ADMIN_CPF] })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })

async function signIn(page, cpf, password) {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(cpf)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
}
async function openTicket(page, id) {
  const menu = page.getByRole('button', { name: 'Abrir menu de navegação', exact: true })
  if (await menu.isVisible()) await menu.click()
  await page.locator('.sidebar').getByRole('button', { name: 'Ticket', exact: true }).click()
  await page.locator('.ticket-table').getByRole('button', { name: id, exact: true }).click()
  return page.locator('.ticket-detail-modal')
}

try {
  const plain = (await fixture.adminRequest('/support-tickets', 'POST', { urgency: 'medium', module: 'operation', submodule: 'offers', title: 'Prazo da cotação', description: 'Precisamos de um prazo limite.' })).data.item
  const upload = await fetch(`${fixture.url}/api/support-tickets/uploads?name=tela.png&type=image/png`, { method: 'POST', headers: { ...fixture.admin, 'Content-Type': 'application/octet-stream' }, body: Buffer.from('imagem de teste') })
  const fileId = (await upload.json()).item.id
  const withFile = (await fixture.adminRequest('/support-tickets', 'POST', { urgency: 'high', module: 'finance', submodule: 'payables', title: 'Erro ao baixar', description: 'Veja a tela.', fileIds: [fileId] })).data.item

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signIn(page, env.DEMO_ADMIN_CPF, env.DEMO_ADMIN_PASSWORD)

  // Without attachments: copy and the .json, beside the X.
  let modal = await openTicket(page, plain.id)
  const header = modal.locator(':scope > header')
  assert.deepEqual(await header.locator('.ticket-export button').allInnerTexts(), ['Copiar JSON', 'Exportar (.json)'])
  const [exportBox, closeBox] = await Promise.all([header.locator('.ticket-export').boundingBox(), header.getByRole('button', { name: 'Fechar janela' }).boundingBox()])
  assert.ok(exportBox.x + exportBox.width <= closeBox.x && Math.abs((exportBox.y + exportBox.height / 2) - (closeBox.y + closeBox.height / 2)) < 4)
  await header.screenshot({ path: 'test-results/ticket-export-header-1440.png' })
  await header.getByRole('button', { name: 'Copiar JSON', exact: true }).click()
  await header.getByRole('button', { name: 'Copiado', exact: true }).waitFor()
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))
  assert.deepEqual([copied.ticket.id, copied.ticket.title, copied.ticket.moduleTitle], [plain.id, 'Prazo da cotação', 'Operação › Ofertas e serviços'])
  let downloading = page.waitForEvent('download')
  await header.getByRole('button', { name: 'Exportar (.json)', exact: true }).click()
  let file = await downloading
  assert.equal(file.suggestedFilename(), `${plain.id}.json`)
  assert.equal(JSON.parse(await readFile(await file.path(), 'utf8')).ticket.description, 'Precisamos de um prazo limite.')
  await modal.getByRole('button', { name: 'Fechar janela', exact: true }).last().click()

  // With an attachment: only the .zip.
  modal = await openTicket(page, withFile.id)
  assert.deepEqual(await modal.locator(':scope > header .ticket-export button').allInnerTexts(), ['Exportar (.zip)'])
  downloading = page.waitForEvent('download')
  await modal.locator(':scope > header').getByRole('button', { name: 'Exportar (.zip)', exact: true }).click()
  file = await downloading
  assert.equal(file.suggestedFilename(), `${withFile.id}.zip`)
  assert.equal((await readFile(await file.path())).readUInt32LE(0), 0x04034b50)
  assert.deepEqual(errors, [])
  await context.close()

  // Somebody who is not a developer: no export.
  assert.equal((await fixture.adminRequest('/employees', 'POST', person)).status, 201)
  const other = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await signIn(other, person.cpf, person.password)
  const theirs = await openTicket(other, plain.id)
  await theirs.locator('.ticket-detail-meta').waitFor()
  assert.equal(await theirs.locator('.ticket-export').count(), 0)
  await other.close()

  // Phone: the header holds the title, the buttons and the X without running off the screen.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await signIn(phone, env.DEMO_ADMIN_CPF, env.DEMO_ADMIN_PASSWORD)
  const small = await openTicket(phone, plain.id)
  const buttons = await small.locator(':scope > header button').evaluateAll((items) => items.map((item) => { const box = item.getBoundingClientRect(); return [box.left, box.right] }))
  assert.ok(buttons.every(([left, right]) => left >= 0 && right <= 390), JSON.stringify(buttons))
  await small.locator(':scope > header').screenshot({ path: 'test-results/ticket-export-header-390.png' })
  await phone.close()
  console.log('support ticket export browser test passed')
} finally {
  await browser.close()
  await fixture.close()
}
