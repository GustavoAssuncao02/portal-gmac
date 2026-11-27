import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { openSidebarItem } from './sidebarNavigation.js'
import { todayBahia } from '../server/payableRules.js'

// Ações em massa in Contas a Pagar and Contas a Receber (Excluir, Desfazer baixa, Alterar classificação), the Excel menu
// (Completo / Resumo) and 500 accounts per page.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const inDays = (days) => new Date(Date.parse(todayBahia()) + days * 86400000).toISOString().slice(0, 10)
try {
  const paid = { date: todayBahia(), method: 'pix', interestCents: 0, discountCents: 0, finalCents: 10000, receipts: [] }
  await fixture.mutateStore((store) => {
    store.suppliers = [{ id: 's1', name: 'Fornecedor Teste', document: '12345678000190' }]
    store.classifications = [{ id: 'c1', name: 'Juros de tributos' }, { id: 'c2', name: 'Parcelamentos tributários' }, { id: 'r1', name: 'Receita de serviços', dreLine: 'gross_revenue' }]
    store.payables = Array.from({ length: 25 }, (_, index) => ({ id: `PAG-${String(index + 1).padStart(6, '0')}`, supplierId: 's1', supplierName: 'Fornecedor Teste', classificationId: 'c1', classificationName: 'Juros de tributos', description: `Parcela ${index + 1}`, documentNumber: '', issueDate: todayBahia(), dueDate: inDays(10 + index), kind: 'normal', valueCents: 10000, attachments: [], ...(index === 0 ? { payment: paid } : {}) }))
    store.payableSequence = 25
    store.receivables = [1, 2, 3].map((number) => ({ id: `REC-00000${number}`, clientId: '1', customerName: 'Cliente Teste', classificationId: 'r1', classificationName: 'Receita de serviços', description: `Serviço ${number}`, documentNumber: '', issueDate: todayBahia(), dueDate: inDays(5 + number), kind: 'single', valueCents: 10000, issCents: 500, attachments: [], ...(number === 3 ? { receipt: { ...paid, issCents: 500, finalCents: 9500 } } : {}) }))
    store.receivableSequence = 3
  })
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await openSidebarItem(page, 'Contas a Pagar')
  const rows = page.locator('.payable-table tbody tr')
  await rows.first().waitFor()

  // 500 per page.
  const perPage = page.getByLabel('Por página', { exact: true })
  assert.deepEqual(await perPage.locator('option').allTextContents(), ['20', '50', '100', '500'])
  await perPage.selectOption('500')
  assert.equal(await rows.count(), 24, 'every open account on one page')
  await page.getByRole('button', { name: 'Filtros', exact: true }).click()
  await page.getByLabel('Status', { exact: true }).selectOption('all')
  assert.equal(await rows.count(), 25)

  // Excel menu: Completo or Resumo.
  await page.locator('.payable-toolbar').getByRole('button', { name: 'Excel', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'Excel' })
  assert.deepEqual(await menu.getByRole('menuitem').evaluateAll((items) => items.map((item) => item.firstChild.textContent)), ['Completo', 'Resumo'])
  const summaryDownload = page.waitForEvent('download')
  await menu.getByRole('menuitem', { name: /^Resumo/ }).click()
  assert.equal((await summaryDownload).suggestedFilename(), 'gmac-contas-a-pagar-resumo.xlsx')
  await menu.waitFor({ state: 'detached' })

  // Selecting every account of the filter and opening Excluir: the preview names the blocked one and asks to confirm.
  await page.locator('.payable-table thead input[type="checkbox"]').check()
  await page.locator('.payable-bulk-actions').getByRole('button', { name: /^Selecionar todas as contas do filtro atual/ }).click()
  const bar = page.locator('.payable-bulk-actions')
  assert.deepEqual(await bar.getByRole('button').allTextContents(), ['Selecionar todas as contas do filtro atual (25)', 'Dar baixa', 'Desativar', 'Excluir', 'Desfazer baixa', 'Alterar classificação', 'PDF', 'Excel'])
  await bar.getByRole('button', { name: 'Excluir', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Excluir lançamentos', exact: true })
  await dialog.getByText('Você vai excluir 24 lançamentos.', { exact: true }).waitFor()
  await dialog.getByText('R$ 2.400,00', { exact: true }).waitFor()
  await dialog.getByText(/PAG-000001 · Fornecedor Teste · R\$\s100,00 · Conta com pagamento/).waitFor()
  const confirm = dialog.getByRole('button', { name: 'Excluir 24 lançamentos', exact: true })
  assert.equal(await confirm.isDisabled(), true, 'the checkbox comes first')
  await page.screenshot({ path: 'test-results/bulk-accounts-delete.png' })
  await dialog.getByLabel('Confirmo a exclusão de 24 lançamentos. Os dados ficam guardados no histórico.').check()
  await confirm.click()
  await dialog.waitFor({ state: 'detached' })
  await rows.filter({ hasText: 'PAG-000001' }).waitFor()
  assert.equal(await rows.count(), 1, 'only the paid account stays')
  assert.equal(await page.locator('.payable-bulk-actions').count(), 0, 'the selection is cleared')

  // Desfazer baixa asks for the reason.
  await rows.filter({ hasText: 'PAG-000001' }).getByRole('checkbox').check()
  await bar.getByRole('button', { name: 'Desfazer baixa', exact: true }).click()
  const reverse = page.getByRole('dialog', { name: 'Desfazer baixa', exact: true })
  await reverse.getByText('Você vai desfazer a baixa de 1 conta. O valor volta a ficar em aberto.', { exact: true }).waitFor()
  await reverse.getByLabel('Confirmo desfazer a baixa de 1 conta.').check()
  const undo = reverse.getByRole('button', { name: 'Desfazer 1 baixa', exact: true })
  assert.equal(await undo.isDisabled(), true, 'the reason comes first')
  await reverse.getByLabel('Motivo', { exact: true }).fill('Pagamento lançado por engano')
  await undo.click()
  await reverse.waitFor({ state: 'detached' })

  // Alterar classificação on the account open again.
  await rows.filter({ hasText: 'PAG-000001' }).getByRole('checkbox').check()
  await bar.getByRole('button', { name: 'Alterar classificação', exact: true }).click()
  const classify = page.getByRole('dialog', { name: 'Alterar classificação', exact: true })
  await classify.getByLabel('Nova classificação', { exact: true }).selectOption({ label: 'Parcelamentos tributários' })
  await classify.getByText('Classificação atual: Juros de tributos (1)', { exact: true }).waitFor()
  await classify.getByLabel('Confirmo a alteração da classificação de 1 conta.').check()
  await classify.getByRole('button', { name: 'Alterar 1 conta', exact: true }).click()
  await classify.waitFor({ state: 'detached' })
  await rows.filter({ hasText: 'PAG-000001' }).getByText('Parcelamentos tributários', { exact: true }).waitFor()

  // Contas a Receber: gross, ISS and net; the received account stays.
  await openSidebarItem(page, 'Contas a Receber')
  const receivables = page.locator('.receivable-table tbody tr')
  await receivables.first().waitFor()
  assert.deepEqual(await page.getByLabel('Por página', { exact: true }).locator('option').allTextContents(), ['20', '50', '100', '500'])
  await page.locator('.payable-status-filters').getByRole('button', { name: /^Todas/ }).click()
  await page.locator('.receivable-table thead input[type="checkbox"]').check()
  await page.locator('.payable-bulk-actions').getByRole('button', { name: 'Excluir', exact: true }).click()
  const receivableDelete = page.getByRole('dialog', { name: 'Excluir lançamentos', exact: true })
  await receivableDelete.getByText('Você vai excluir 2 lançamentos.', { exact: true }).waitFor()
  assert.deepEqual((await receivableDelete.locator('.bulk-action-amounts > div').allInnerTexts()).map((text) => text.replace(/\s+/g, ' ')), ['Valor bruto total R$ 200,00', 'ISS total R$ 10,00', 'Valor líquido total R$ 190,00'])
  await receivableDelete.getByText(/REC-000003 · Cliente Teste · R\$\s100,00 · Conta com recebimento/).waitFor()
  await receivableDelete.getByLabel('Confirmo a exclusão de 2 lançamentos. Os dados ficam guardados no histórico.').check()
  await receivableDelete.getByRole('button', { name: 'Excluir 2 lançamentos', exact: true }).click()
  await receivableDelete.waitFor({ state: 'detached' })
  await receivables.filter({ hasText: 'REC-000003' }).waitFor()
  assert.equal(await receivables.count(), 1)
  // The bar wraps on a narrow screen instead of overflowing.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.payable-mobile-select input').check()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the bar fits 390')
  await page.screenshot({ path: 'test-results/bulk-accounts-mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('Bulk accounts passed: 500 per page, Excel Completo/Resumo, bulk delete with blocked accounts and confirmation, bulk reversal with reason, bulk classification, gross/ISS/net in Contas a Receber, narrow bar.')
} catch (error) {
  await page.screenshot({ path: 'test-results/bulk-accounts-failure.png', fullPage: true })
  throw error
} finally { await browser.close(); await fixture.close() }
