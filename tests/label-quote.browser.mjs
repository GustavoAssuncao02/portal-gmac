import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createTestDatabase, createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { openSidebarItem } from './sidebarNavigation.js'
import { yearsOfExperience } from '../server/emailSignature.js'

// An etiqueta (server/labelQuotes.js): its OS opens without proposal, "Aguardando NF-e" opens the hours and the material
// really used, the material is corrected (back to the stock), the quote is generated and only then the OS is concluded with
// the quote value. Also the e-mail with the "Medição de etiqueta" template and the signature, and Cadastros › Modelos de e-mail.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Lola Marilia' }
const stock = await createTestDatabase('gmac_test_label_browser')
const fixture = await createWorkflowFixture({ accountsEnv: env, inventoryPool: stock.pool })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = (route, method = 'GET', body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  const balance = async (id) => Number((await api('/inventory')).data.items.find((item) => item.id === id).quantity)
  const steel = (await api('/inventory', 'POST', { name: 'Aço SAE 1045', unit: 'kg', quantity: 10, unitPrice: 20 })).data
  const offer = (await api('/offers', 'POST', { ...offerDraft, company: 'Belgo Bekaert', service: 'Eixo do redutor', labelNumber: '4521', quantity: 1 })).data.item
  await api(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'aco', name: 'Aço SAE 1045', unit: 'kg', quantity: 3, unitPrice: 20, inventoryId: steel.id, stockAvailable: 10, stockStatus: 'available', purchaseQuantity: 0 }], laborEntries: [], kind: 'service', stages: ['turning'] })
  await api(`/offers/${offer.id}/finish`, 'POST', {})
  await api('/account/email-signature', 'PATCH', { jobTitle: 'Assistente Comercial' })

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()

  // The offer list marks it and opens the OS straight away, without proposal.
  await openSidebarItem(page, 'Ofertas e serviços')
  const offerRow = page.locator('.offers-table-row').filter({ hasText: 'Etiqueta 4521' })
  await offerRow.locator('.offer-review-button').click()
  await page.getByRole('button', { name: 'Abrir OS da etiqueta', exact: true }).click()
  const opening = page.getByRole('dialog', { name: 'Abrir a OS da etiqueta?', exact: true })
  await opening.getByText('Orçamento pendente').first().waitFor()
  // The client has no price yet, so usually no purchase order either: the OS opens without it.
  await opening.getByLabel('Nº do pedido de compra').waitFor()
  await opening.getByRole('button', { name: 'Abrir OS com informações pendentes', exact: true }).click()
  await opening.waitFor({ state: 'hidden' })
  const order = (await api('/operations/orders')).data.items.find((item) => item.offerId === offer.id)
  assert.ok(order, 'the OS was opened')
  assert.equal(await balance(steel.id), 7, 'the estimate leaves the stock as in any OS')

  // The operators finish every piece (1 h estimated, 1,5 h real).
  await fixture.mutateStore((store) => { const row = store.orders.find((item) => item.code === order.code); row.operation = { ...order.operation, status: 'completed', startedAt: '2026-11-10T10:00:00Z', completedAt: '2026-11-10T12:00:00Z', completionAcknowledgedAt: null, activeSession: null, stageTimeMs: { [order.operation.stages[0].key]: 90 * 60000 } } })
  // Written straight into the store, so no live event: the page is loaded again.
  await page.reload()
  await page.locator('.sidebar').waitFor()

  await openSidebarItem(page, 'Serviços em andamento')
  const row = page.locator('.admin-invoice-table tbody tr').filter({ hasText: order.code })
  await row.getByRole('button', { name: 'Aguardando NF-e', exact: true }).waitFor()
  await row.screenshot({ path: 'test-results/label-quote-row.png' })
  await row.getByRole('button', { name: 'Aguardando NF-e', exact: true }).click()
  const modal = page.getByRole('dialog', { name: `Aguardando NF-e · ${order.code}`, exact: true })
  await modal.getByText('Orçamento pendente: gere o orçamento').waitFor()
  assert.match(await modal.locator('.label-quote-table').first().innerText(), /1 h[\s\S]*1,5 h/)
  assert.equal(await modal.getByRole('button', { name: 'Concluir OS', exact: true }).isDisabled(), true, 'blocked until the quote exists')
  assert.equal(await modal.getByRole('button', { name: 'Enviar por e-mail', exact: true }).isDisabled(), true)

  // Less material than estimated: the difference returns to the stock.
  await modal.getByLabel('Quantidade usada de Aço SAE 1045', { exact: true }).fill('2')
  assert.equal(await modal.getByRole('button', { name: 'Gerar orçamento', exact: true }).isDisabled(), true, 'save the material first')
  await modal.getByRole('button', { name: 'Salvar material', exact: true }).click()
  await modal.getByText('Material salvo e estoque atualizado.').waitFor()
  assert.equal(await balance(steel.id), 8)

  // The quote, Etiqueta model by default, with the real hours.
  await modal.getByRole('button', { name: 'Gerar orçamento', exact: true }).click()
  const quote = page.getByRole('dialog', { name: 'Orçamento da etiqueta · Etiqueta', exact: true })
  await quote.waitFor()
  assert.equal(await quote.getByLabel('Etiqueta', { exact: true }).inputValue(), '4521')
  // This OS has no machine on its stage, so the user picks the sheet line of the real hours (the portal remembers it).
  const line = quote.getByLabel(/^Linha da planilha para/).first()
  const option = (await line.locator('option').allInnerTexts()).find((text) => /Torno CNC/.test(text))
  await line.selectOption({ label: option })
  assert.equal(await quote.getByLabel('Horas de Serv Usinagem em Torno CNC', { exact: true }).inputValue(), '1,5')
  await quote.getByLabel('Requisitante', { exact: true }).fill('Joaci')
  await page.screenshot({ path: 'test-results/label-quote-form.png' })
  const download = page.waitForEvent('download')
  await quote.getByRole('button', { name: 'Gerar PDF', exact: true }).click()
  assert.equal((await download).suggestedFilename(), 'Etiqueta-4521.pdf')
  await quote.waitFor({ state: 'hidden' })
  await modal.getByText('Orçamento gerado. Envie por e-mail e conclua a OS.').waitFor()
  const generated = (await api(`/orders/${order.code}/label-quote`)).data.quote
  assert.equal(generated.pending, false)
  assert.ok(generated.total > 0)
  await page.screenshot({ path: 'test-results/label-quote-modal.png' })

  // The e-mail comes with the etiqueta template and the signature with name and role.
  await modal.getByRole('button', { name: 'Enviar por e-mail', exact: true }).click()
  const email = page.locator('.proposal-email-modal, [role="dialog"]').filter({ has: page.getByLabel('Modelo', { exact: true }) }).last()
  const picker = email.getByLabel('Modelo', { exact: true })
  await picker.waitFor()
  assert.equal(await picker.locator('option:checked').innerText(), 'Medição de etiqueta')
  assert.equal(await email.getByLabel('Assunto', { exact: true }).inputValue(), 'MEDIÇÃO ETIQUETA Nº 4521')
  const signature = email.getByLabel('Assinatura do e-mail', { exact: true })
  const signed = await signature.innerText()
  for (const part of [new RegExp(`${yearsOfExperience()} anos de experiência`), /Lola Marilia\s+Assistente Comercial/, /comercial@gmacmetalurgica\.com\.br/]) assert.match(signed, part)
  await picker.selectOption({ label: 'Proposta comercial' })
  assert.match(await email.getByLabel('Assunto', { exact: true }).inputValue(), /^Proposta comercial nº/)
  await page.keyboard.press('Escape')
  await email.waitFor({ state: 'hidden' }).catch(async () => { await email.getByRole('button', { name: 'Fechar janela', exact: true }).first().click() })

  // Concluir OS opens the receivable with the quote value.
  await modal.getByRole('button', { name: 'Concluir OS', exact: true }).click()
  const schedule = page.getByRole('dialog', { name: 'Recebimento do serviço', exact: true })
  await schedule.getByRole('button', { name: /^Ainda vai receber/ }).click()
  const value = await schedule.getByLabel('Valor a receber', { exact: true }).inputValue()
  assert.equal(value, generated.total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 'defaults to the quote value')
  await schedule.getByRole('button', { name: 'Fechar janela', exact: true }).click()

  // Cadastros › Modelos de e-mail: the two templates of the portal and a new one.
  await openSidebarItem(page, 'Modelos de e-mail')
  const table = page.locator('.email-templates-table tbody')
  await table.getByText('Medição de etiqueta', { exact: true }).waitFor()
  assert.equal(await table.getByText('Padrão do portal').count(), 2)
  await page.getByRole('button', { name: 'Novo modelo', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Novo modelo de e-mail', exact: true })
  await form.getByLabel('Nome do modelo', { exact: true }).fill('Medição Belgo FAI')
  await form.getByLabel('Assunto', { exact: true }).fill('MEDIÇÃO FAI ')
  await form.getByRole('button', { name: '{etiqueta}', exact: true }).click()
  assert.equal(await form.getByLabel('Assunto', { exact: true }).inputValue(), 'MEDIÇÃO FAI {etiqueta}', 'the field goes where the cursor was')
  await form.getByLabel('Texto do e-mail', { exact: true }).fill('{saudacao},\n\nSegue a medição.')
  await form.getByRole('button', { name: 'Salvar modelo', exact: true }).click()
  await form.waitFor({ state: 'hidden' })
  await table.getByText('Medição Belgo FAI', { exact: true }).waitFor()
  await page.screenshot({ path: 'test-results/email-templates.png' })

  assert.deepEqual(errors, [])
  console.log('Etiqueta: OS without proposal, real hours, material back to the stock, quote before concluding, e-mail template and signature, Modelos de e-mail passed.')
} finally {
  await browser.close()
  await fixture.close()
  await stock.drop()
}
