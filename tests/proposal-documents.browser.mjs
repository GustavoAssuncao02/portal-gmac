import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const navigate = (label) => page.locator('.sidebar').getByRole('button', { name: label, exact: true }).click()

try {
  // A small official catalog, as the weekly job would leave it.
  const { syncFiscalCatalog, fiscalSources } = await import(new URL(`file:///${path.join(fixture.directory, 'fiscalCatalog.js').replace(/\\/g, '/')}`))
  const cnae = [...Array.from({ length: 1000 }, (_, index) => ({ id: String(1000000 + index), descricao: `ATIVIDADE ${index}`, classe: {} })), { id: '2539001', descricao: 'SERVIÇOS DE USINAGEM, TORNEARIA E SOLDA', classe: {} }, { id: '4120400', descricao: 'CONSTRUÇÃO DE EDIFÍCIOS', classe: {} }]
  const ncm = Array.from({ length: 5200 }, (_, index) => ({ codigo: `${7000 + Math.floor(index / 10)}.${String(index % 10).padStart(2, '0')}.00`, descricao: `- Obra ${index}` }))
  const nbs = ['NBS 2.0;DESCRIÇÃO', '1.2001;Serviços de manutenção e reparação de produtos metálicos, maquinários e equipamentos', '1.2001.50.00;Serviços de manutenção e reparação de maquinários e equipamentos de uso industrial', ...Array.from({ length: 520 }, (_, index) => `1.30${String(10 + Math.floor(index / 100))}.${String(index % 100).padStart(2, '0')}.00;Outro serviço ${index}`)].join('\r\n')
  const company = { razao_social: 'GMAC USINAGEM LTDA', estabelecimento: { nome_fantasia: 'GMAC USINAGEM', atividade_principal: { subclasse: '2512-8/00', descricao: 'Fabricação de esquadrias de metal' }, atividades_secundarias: [{ subclasse: '2539-0/01', descricao: 'Serviços de usinagem, torneiria e solda' }] } }
  await syncFiscalCatalog({ fetcher: async (url) => ({ status: 200, body: Buffer.from(url === fiscalSources.cnae ? JSON.stringify(cnae) : url === fiscalSources.ncm ? JSON.stringify(ncm) : url === fiscalSources.nbs ? nbs : JSON.stringify(company), url === fiscalSources.nbs ? 'latin1' : 'utf8') }) })

  const offer = (await fixture.request('/offers', 'POST', { ...offerDraft, company: 'Nestlé Brasil Ltda', service: 'Tampa graxadeira', description: 'Fabricação de 20 unidades, conforme amostra', quantity: 20, labelNumber: '5319' })).data.item
  await fixture.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'm1', name: 'Aço SAE 1020', detail: 'redondo', quantity: 4, unitPrice: 10 }], laborEntries: [{ id: 'l1', type: 'machine', resource: 'Torno CNC 01', hours: 25, hourlyRate: 120 }, { id: 'l2', type: 'labor', resource: 'Ajustagem', hours: 2, hourlyRate: 50 }], stages: ['machining'] })

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await navigate('Ofertas e serviços')
  await page.locator('.offer-review-button').first().click()
  await page.getByRole('button', { name: 'Fazer proposta', exact: true }).click()
  await page.getByRole('heading', { name: 'Fazer proposta', exact: true }).waitFor()

  // Model choice.
  await page.getByRole('button', { name: 'Gerar proposta em PDF', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Escolha o modelo da proposta', exact: true })
  for (const name of ['Modelo A', 'Modelo B', 'Nestlé (FS-3055)', 'Etiqueta']) await modal.getByRole('button', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) }).waitFor()
  await page.screenshot({ path: 'test-results/proposal-models.png' })

  // Etiqueta: system hours and materials already on the right lines; the unmatched record is assigned by the user.
  await modal.getByRole('button', { name: /^Etiqueta/ }).click()
  const etiqueta = page.getByRole('dialog', { name: 'Proposta · Etiqueta', exact: true })
  assert.equal(await etiqueta.getByLabel('Horas de Serv Usinagem em Torno CNC', { exact: true }).inputValue(), '25')
  assert.equal(await etiqueta.getByLabel('Quantidade de Barra Metalica Aco Sae1020 1M', { exact: true }).inputValue(), '4')
  assert.equal(await etiqueta.getByLabel('Etiqueta', { exact: true }).inputValue(), '5319')
  await etiqueta.getByLabel('Linha da planilha para Ajustagem', { exact: true }).selectOption({ label: '11. Serv Mecânica' })
  assert.equal(await etiqueta.getByLabel('Horas de Serv Mecânica', { exact: true }).inputValue(), '2')
  await etiqueta.getByLabel('Requisitante', { exact: true }).fill('Joaci')
  await etiqueta.getByLabel('Situação de Serv Mecânica', { exact: true }).selectOption('night')
  assert.match(await etiqueta.locator('.proposal-doc-totals').innerText(), /Total do contrato\s*R\$\s5\.585,88/)
  await page.screenshot({ path: 'test-results/proposal-etiqueta-form.png' })
  const download = page.waitForEvent('download')
  await etiqueta.getByRole('button', { name: 'Gerar PDF', exact: true }).click()
  assert.equal((await download).suggestedFilename(), 'Etiqueta-5319.pdf')
  await etiqueta.waitFor({ state: 'hidden' })
  let saved = (await fixture.request('/offers')).data.items.find((item) => item.id === offer.id).proposal
  assert.deepEqual([saved.layout, saved.document.total, saved.document.requester], ['etiqueta', 5585.88, 'Joaci'])
  await page.getByRole('link', { name: /Baixar PDF da proposta · Etiqueta 5319/ }).waitFor()

  // Model A: fiscal codes picked from the official catalog and highlighted.
  await page.getByRole('button', { name: 'Gerar proposta em PDF', exact: true }).click()
  await page.getByRole('button', { name: /^Modelo A/ }).click()
  const letter = page.getByRole('dialog', { name: 'Proposta · Modelo A', exact: true })
  assert.equal(await letter.getByLabel('Nº da cotação', { exact: true }).inputValue(), '13483')
  await letter.locator('.fiscal-picker-value').filter({ hasText: '2539-0/01' }).waitFor()
  await letter.getByRole('combobox', { name: 'NBS (serviço)' }).fill('manutenção industrial')
  await letter.getByRole('option', { name: /1\.2001\.50\.00/ }).click()
  await letter.getByRole('combobox', { name: 'CNAE (código de atividade)' }).fill('construção de edifícios')
  await letter.getByRole('option', { name: /4120-4\/00/ }).getByText('Fora do CNPJ').waitFor()
  await letter.getByRole('option', { name: /4120-4\/00/ }).click()
  await letter.getByText('Não registrado no CNPJ da emissora').waitFor()
  await letter.getByRole('combobox', { name: 'CNAE (código de atividade)' }).fill('usinagem')
  await letter.getByRole('option', { name: /2539-0\/01/ }).click()
  await letter.getByLabel('Solicitante', { exact: true }).fill('Karoline')
  await letter.getByLabel('Valor unitário do item 1', { exact: true }).fill('258,50')
  await letter.getByLabel('Pagamento', { exact: true }).fill('45 DDL')
  assert.deepEqual([await letter.getByLabel('Técnico responsável', { exact: true }).inputValue(), await letter.getByLabel('Registro (CREA)', { exact: true }).inputValue(), await letter.getByLabel('Contato', { exact: true }).inputValue()], ['José Jossenilson F. Gomes', 'CREA – 53865', '(75) 99933-5645'])
  await letter.getByLabel('Técnico responsável', { exact: true }).fill('Maria Souza')
  assert.match(await letter.locator('.proposal-doc-total').innerText(), /R\$\s5\.170,00/)
  await page.screenshot({ path: 'test-results/proposal-model-a-form.png', fullPage: false })
  const letterDownload = page.waitForEvent('download')
  await letter.getByRole('button', { name: 'Gerar PDF', exact: true }).click()
  const letterFile = await letterDownload
  assert.equal(letterFile.suggestedFilename(), 'Proposta-13483.pdf')
  const pdfText = (await readFile(await letterFile.path())).toString('latin1')
  assert.ok(pdfText.startsWith('%PDF'))
  saved = (await fixture.request('/offers')).data.items.find((item) => item.id === offer.id).proposal
  assert.deepEqual([saved.document.fiscal.cnae.code, saved.document.fiscal.nbs.code, saved.serviceValue, saved.document.technician.name], ['2539-0/01', '1.2001.50.00', 5170, 'Maria Souza'])

  // Settings: price lists, companies and the catalog status.
  await page.getByRole('button', { name: 'Gerar proposta em PDF', exact: true }).click()
  await page.getByRole('button', { name: 'Empresas, tabelas de preço e catálogo fiscal', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Modelos de proposta', exact: true })
  await settings.getByRole('tab', { name: 'Catálogo fiscal', exact: true }).click()
  await settings.locator('.proposal-catalog-facts').waitFor()
  assert.equal(await settings.getByText('todo domingo à meia-noite').count(), 0)
  assert.match(await settings.locator('.proposal-catalog-facts').innerText(), /CNAE\s*1\.002/)
  await settings.getByRole('tab', { name: 'Tabela Etiqueta', exact: true }).click()
  await settings.getByLabel('Hora normal da linha 6', { exact: true }).fill('75,20')
  await page.screenshot({ path: 'test-results/proposal-settings.png' })
  await settings.getByRole('button', { name: 'Salvar configurações', exact: true }).click()
  await settings.getByText('Configurações salvas.').waitFor()
  assert.equal((await fixture.request('/proposal-settings')).data.settings.tables.etiqueta.labor[5].normal, 75.2)
  await settings.getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.getByRole('dialog', { name: 'Escolha o modelo da proposta', exact: true }).getByRole('button', { name: 'Cancelar', exact: true }).click()

  // Nestlé FS-3055: issued by GMAC Metalúrgica, with the request number of the offer.
  await page.getByRole('button', { name: 'Gerar proposta em PDF', exact: true }).click()
  await page.getByRole('button', { name: /^Nestlé/ }).click()
  const nestle = page.getByRole('dialog', { name: 'Proposta · Nestlé (FS-3055)', exact: true })
  assert.equal(await nestle.getByLabel('Nº da solicitação', { exact: true }).inputValue(), '5319')
  assert.equal(await nestle.getByLabel('Empresa emissora', { exact: true }).locator('option:checked').innerText(), 'GMAC Metalúrgica · 09.608.093/0001-06')
  assert.equal(await nestle.getByLabel('Quantidade de Barra Metalica Aco Sae1020 1M', { exact: true }).inputValue(), '4')
  await page.screenshot({ path: 'test-results/proposal-nestle-form.png' })

  // Phone: the form stays usable without horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 })
  await nestle.getByLabel('Nº da solicitação', { exact: true }).waitFor()
  assert.ok(await nestle.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1), 'No horizontal overflow on the phone')
  await page.screenshot({ path: 'test-results/proposal-nestle-mobile.png' })
  await nestle.getByRole('button', { name: 'Fechar janela', exact: true }).click()
  await nestle.waitFor({ state: 'hidden' })
  assert.deepEqual(errors, [])
  console.log('Proposal models: model chooser, etiqueta from system usage with learned assignment, model A with official CNAE/NBS, settings with catalog status, Nestlé sheet defaults and phone layout passed.')
} catch (error) { await page.screenshot({ path: 'test-results/proposal-documents-failure.png', fullPage: true }); throw error } finally { await browser.close(); await fixture.close() }
