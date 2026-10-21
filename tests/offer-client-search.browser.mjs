import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

// The company of a manual offer is searched among the registered clients (CNPJ or CPF) and fills the document.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
try {
  for (const client of [{ name: 'Cerâmica Barro Forte Ltda.', documentType: 'cnpj', document: '56184027000136' }, { name: 'João Pereira da Silva', documentType: 'cpf', document: '52998224725' }]) {
    const created = await fixture.adminRequest('/clients', 'POST', { ...client, email: '', notes: '' })
    assert.equal(created.status, 200, JSON.stringify(created.data))
  }
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 393, height: 852 }]) {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    if (viewport.width < 760) await page.getByRole('button', { name: 'Abrir menu de navegação', exact: true }).click()
    await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
    await page.getByRole('button', { name: 'Inserir Oferta Manualmente', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Inserir oferta manualmente' })
    const company = form.getByRole('combobox', { name: 'Empresa *' })
    const documentField = form.getByLabel('CNPJ/CPF *', { exact: true })

    // Typing part of the name lists the client with its document; choosing it fills the CNPJ.
    await company.fill('cerâm')
    const option = form.getByRole('option', { name: /Cerâmica Barro Forte Ltda\./ })
    assert.match(await option.innerText(), /CNPJ 56\.184\.027\/0001-36/)
    await option.click()
    assert.equal(await company.inputValue(), 'Cerâmica Barro Forte Ltda.')
    assert.equal(await documentField.inputValue(), '56.184.027/0001-36')
    await form.getByText('Cliente cadastrado · CNPJ preenchido.').waitFor()
    if (viewport.width === 1920) await page.screenshot({ path: 'test-results/offer-client-search.png' })

    // A client with CPF, found by part of the document.
    await company.fill('')
    await documentField.fill('')
    await company.fill('529.982')
    await form.getByRole('option', { name: /João Pereira da Silva/ }).click()
    assert.equal(await documentField.inputValue(), '529.982.247-25')

    // A company that is not registered keeps the typed document, masked as CPF or CNPJ.
    await company.fill('Oficina Nova Ltda.')
    await form.getByText('Cliente não cadastrado: informe o CNPJ/CPF.').waitFor()
    await documentField.fill('11444777000161')
    assert.equal(await documentField.inputValue(), '11.444.777/0001-61')

    // Typing a registered document while the company is empty fills the company.
    await company.fill('')
    await documentField.fill('52998224725')
    assert.equal(await company.inputValue(), 'João Pereira da Silva')

    const service = `Oferta para pessoa física ${viewport.width}`
    await form.getByLabel('Prazo solicitado *', { exact: true }).fill('2026-12-20')
    await form.getByLabel('Peça/Serviço *', { exact: true }).fill(service)
    await form.getByLabel('Quantidade *', { exact: true }).fill('2')
    await form.getByLabel('Descrição do serviço *', { exact: true }).fill('Oferta de cliente com CPF')
    await form.getByRole('button', { name: 'Adicionar solicitação', exact: true }).click()
    await form.waitFor({ state: 'detached' })
    const row = page.locator('.offers-table-row').filter({ hasText: service })
    await row.getByRole('button', { name: 'Em análise', exact: true }).click()
    await page.locator('.offer-information-card').getByText('CPF: 529.982.247-25').waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(errors, [])
    await page.close()
  }
  const offers = (await fixture.adminRequest('/offers')).data.items.filter((offer) => offer.company === 'João Pereira da Silva')
  assert.deepEqual(offers.map((offer) => offer.cnpj), ['529.982.247-25', '529.982.247-25'])
  console.log('Busca de clientes na oferta manual: OK')
} finally {
  await browser.close()
  await fixture.close()
}
