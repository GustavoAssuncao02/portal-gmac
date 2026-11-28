import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'
import { openSidebarItem } from './sidebarNavigation.js'
import { invoicePdf } from './invoiceSample.js'
import { invoiceFor } from './orderInvoiceSteps.js'

// NF-e da OS in the browser, by an administrative employee (no finance screens): "Aguardando NF-e" asks for the PDF, the
// note is checked (another company, a value different from the OS), "Concluir OS" posts the account receivable and
// concludes the OS; in Ver OS › NF-e the same note is a possible duplicate (only attached), removing asks with two boxes,
// an OS still in production refuses the import, and an OS concluded without NF-e shows "Sem NF-e".
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results/order-invoice', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const today = todayBahia(), due = shiftMonth(today, 1)
const plain = (text) => text.replace(/\s+/g, ' ').trim()
try {
  const login = async (cpf, password) => ({ Authorization: `Bearer ${(await fixture.request('/auth/login', 'POST', { cpf, password })).data.token}` })
  const admin = await login(env.DEMO_ADMIN_CPF, env.DEMO_ADMIN_PASSWORD)
  await fixture.request('/employees', 'POST', { name: 'Funcionária Escritório', birthDate: '1990-01-01', cpf: '00000000004', email: 'escritorio@example.invalid', identification: '', type: 'administrative', password: 'senha123' }, admin)
  async function order(service, { completed = true } = {}) {
    const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service })).data.item
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cut-bend'], kind: 'service' })
    await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 1000 } })
    const item = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
    if (completed) {
      const current = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items.find((row) => row.code === item.code)
      await fixture.mutateStore((store) => { store.orders.find((row) => row.code === item.code).operation = { ...current.operation, status: 'completed', startedAt: '2026-11-20T10:00:00Z', completedAt: '2026-11-21T10:00:00Z', completionAcknowledgedAt: null } })
    }
    return item
  }
  const waiting = await order('Eixo com NF-e')
  const running = await order('Eixo em producao', { completed: false })
  const skipped = await order('Eixo sem NF-e')
  await fixture.request('/clients', 'POST', { name: 'Teste de fluxo', document: offerDraft.cnpj, documentType: 'cnpj' }, admin)
  await fixture.request('/clients', 'POST', { name: 'Outra Empresa Ltda', document: '11222333000181', documentType: 'cnpj' }, admin)
  assert.equal((await fixture.request(`/operations/orders/${skipped.code}/acknowledge-completion`, 'POST', { withoutInvoice: true }, admin)).status, 200)
  const note = { name: 'nota.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await invoiceFor({ cnpj: '11222333000181', company: 'Outra Empresa Ltda', valueCents: 150000, issued: today, due })) }
  const title = 'NFS-e 2026000000777'

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill('00000000004')
  await page.getByLabel('Senha', { exact: true }).fill('senha123')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.sidebar').waitFor()
  await openSidebarItem(page, 'Serviços em andamento')
  const row = page.locator('.admin-invoice-table tbody tr').filter({ hasText: waiting.code })
  assert.equal(plain(await page.locator('.admin-invoice-heading small').innerText()), 'Produção concluída: anexe a NF-e para concluir a OS e gerar o contas a receber.')
  await row.getByRole('button', { name: 'Aguardando NF-e', exact: true }).click()
  const modal = page.getByRole('dialog', { name: `NF-e · ${waiting.code}`, exact: true })
  await modal.getByRole('button', { name: 'Selecionar PDF da NF-e', exact: true }).waitFor()
  assert.equal(await modal.getByRole('button', { name: 'Concluir OS', exact: true }).isDisabled(), true, 'nothing to attach yet')
  await modal.getByRole('button', { name: 'Concluir sem NF-e', exact: true }).waitFor()
  assert.equal(await modal.getByText(/Ainda vai receber|Já recebido|Concluir sem lançar/).count(), 0, 'the old options are gone')
  const input = modal.locator('input[type="file"]')

  // A PDF that is not an invoice is refused with a clear message.
  await input.setInputFiles({ name: 'planilha.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await invoicePdf([{ kind: 'other' }])) })
  await modal.getByRole('alert').filter({ hasText: 'planilha.pdf: Não foi possível ler uma nota fiscal neste PDF.' }).waitFor()

  // The note of another company and a value different from the OS: warned; the note's value wins.
  await input.setInputFiles(note)
  const card = modal.getByRole('article', { name: title, exact: true })
  await card.waitFor()
  assert.match(plain(await card.innerText()), /A nota é de 11\.222\.333\/0001-81, e a OS é de Teste de fluxo \(12\.345\.678\/0001-90\)\./)
  assert.match(plain(await modal.locator('.bank-warning').innerText()), /O total da nota \(R\$ 1\.500,00\) é diferente do valor da OS \(R\$ 1\.000,00\)\. Vale o valor da nota\./)
  await card.getByLabel(`Classificação de ${title}`, { exact: true }).selectOption({ label: '98.01 · Receita de teste' })
  assert.equal(await modal.getByRole('button', { name: 'Concluir sem NF-e', exact: true }).count(), 0, 'with a note, it is concluded with it')
  await page.screenshot({ path: 'test-results/order-invoice/modal-1440.png' })
  await modal.getByRole('button', { name: 'Concluir OS', exact: true }).click()
  const other = page.getByRole('dialog', { name: 'NF-e de outra empresa', exact: true })
  await other.getByRole('button', { name: 'Continuar', exact: true }).click()
  await modal.waitFor({ state: 'detached' })
  await row.waitFor({ state: 'detached' })
  const accounts = async () => (await fixture.request('/receivables', 'GET', undefined, admin)).data.items.filter((item) => item.orderCode === waiting.code)
  const [account] = await accounts()
  assert.deepEqual([account.origin, account.valueCents, account.dueDate, account.customerDocument, account.documentNumber], ['invoice', 150000, due, '11222333000181', '2026000000777'])
  assert.ok((await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items.find((item) => item.code === waiting.code).operation.completionAcknowledgedAt, 'the OS is concluded')

  // Serviços concluídos: "Sem NF-e" only on the OS concluded without one.
  await openSidebarItem(page, 'Serviços concluídos')
  const done = page.locator('.admin-os-table tbody tr')
  await done.filter({ hasText: skipped.code }).locator('.admin-os-no-invoice').waitFor()
  assert.equal(await done.filter({ hasText: waiting.code }).locator('.admin-os-no-invoice').count(), 0)
  await done.filter({ hasText: skipped.code }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  assert.match(plain(await page.locator('.os-invoices').innerText()), /Concluída sem NF-e por Gustavo em \d{2}\/\d{2}\/\d{4}: nenhuma conta a receber foi gerada\./)
  await page.getByRole('button', { name: 'Voltar para a tela anterior', exact: true }).click()

  // Ver OS › NF-e: the same note again is a possible duplicate; "Só anexar na OS" keeps it without a second account.
  await done.filter({ hasText: waiting.code }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  const section = page.locator('.os-invoices')
  await section.getByText(title, { exact: true }).waitFor()
  await section.getByRole('button', { name: 'Importar NF-e', exact: true }).click()
  await modal.getByText('NF-e já anexada', { exact: true }).waitFor()
  await modal.locator('input[type="file"]').setInputFiles(note)
  await modal.getByRole('article', { name: title, exact: true }).getByText(/Possível lançamento duplicado: esta nota pode já estar em REC-/).waitFor()
  await modal.getByRole('article', { name: title, exact: true }).getByLabel(`Classificação de ${title}`, { exact: true }).selectOption({ label: '98.01 · Receita de teste' })
  await modal.getByRole('button', { name: 'Anexar NF-e', exact: true }).click()
  await other.getByRole('button', { name: 'Continuar', exact: true }).click()
  const duplicate = page.getByRole('dialog', { name: 'Possível lançamento duplicado', exact: true })
  await duplicate.getByText(new RegExp(account.id)).waitFor()
  assert.deepEqual(await duplicate.locator('footer button').allInnerTexts(), ['Cancelar', 'Só anexar na OS', 'Lançar mesmo assim'])
  await page.screenshot({ path: 'test-results/order-invoice/duplicate-1440.png' })
  await duplicate.getByRole('button', { name: 'Só anexar na OS', exact: true }).click()
  await modal.waitFor({ state: 'detached' })
  await section.locator('li').nth(1).waitFor()
  assert.equal((await accounts()).length, 1)

  // Removing: two boxes. The PDF and, apart, the account it generated.
  await section.getByRole('button', { name: `Remover ${title}`, exact: true }).first().click()
  const removing = page.getByRole('dialog', { name: `Remover ${title}`, exact: true })
  const accountBox = removing.getByRole('checkbox', { name: /^Excluir a conta a receber gerada por ela/ })
  await accountBox.waitFor()
  assert.deepEqual([await removing.getByRole('checkbox', { name: /^Remover a NF-e da OS/ }).isChecked(), await accountBox.isChecked(), await accountBox.isDisabled()], [true, false, false])
  await accountBox.check()
  await page.screenshot({ path: 'test-results/order-invoice/remove-1440.png' })
  await removing.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await removing.waitFor({ state: 'detached' })
  await section.locator('li').nth(1).waitFor({ state: 'detached' })
  assert.equal((await accounts()).length, 0)

  // An OS still in production: the import is refused.
  await openSidebarItem(page, 'Serviços em andamento')
  await page.locator('.admin-os-table tbody tr').filter({ hasText: running.code }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  await page.locator('.os-invoices').getByRole('button', { name: 'Importar NF-e', exact: true }).click()
  await page.locator('.os-invoices').getByRole('alert').filter({ hasText: 'A OS não está concluída, não é possível importar a NF-e.' }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: `NF-e · ${running.code}` }).count(), 0)

  // On a phone the window with a note fits the screen.
  await page.setViewportSize({ width: 390, height: 844 })
  const menu = page.getByRole('button', { name: 'Abrir menu de navegação', exact: true })
  if (await menu.isVisible()) await menu.click()
  await openSidebarItem(page, 'Serviços concluídos')
  await done.filter({ hasText: waiting.code }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  await section.getByRole('button', { name: 'Importar NF-e', exact: true }).click()
  await modal.locator('input[type="file"]').setInputFiles(note)
  await modal.getByRole('article', { name: title, exact: true }).waitFor()
  assert.ok(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth), 'no sideways scroll in the window')
  const frame = await modal.boundingBox()
  assert.ok(frame.x >= 0 && frame.x + frame.width <= 390, 'the window is inside the screen')
  await page.screenshot({ path: 'test-results/order-invoice/modal-390.png' })
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await modal.waitFor({ state: 'detached' })
  const uploads = () => fixture.mutateStore((store) => store.orderInvoiceUploads.length)
  for (let tries = 0; tries < 20 && await uploads(); tries++) await page.waitForTimeout(100)
  assert.equal(await uploads(), 0, 'a note read and not attached is let go')

  assert.deepEqual(errors, [])
  console.log('Order NF-e passed: Aguardando NF-e asks for the PDF, unreadable PDF refused, other company and value warned, Concluir OS posts the receivable (administrative employee), Sem NF-e mark, duplicate only attached, removal with two boxes, OS in production refused, phone layout.')
} catch (error) {
  await page.screenshot({ path: 'test-results/order-invoice/failure.png', fullPage: true })
  throw error
} finally { await browser.close(); await fixture.close() }
