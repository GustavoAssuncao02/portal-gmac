// A supplier or client registered anywhere enters the lists that offer it, without reloading the page.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
let nextDocument = 11222333000100
const documentNumber = () => String(nextDocument++)
// Well under the 30 s of the safety timer: only the live update or the return to the tab can bring it this fast.
const FAST = 5000
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = async (route, method, body) => { const result = await fixture.request(route, method, body, { Authorization: `Bearer ${token}` }); assert.ok(result.status < 300, JSON.stringify(result.data)); return result.data }
  const newSupplier = (name) => api('/suppliers', 'POST', { name, document: documentNumber() })
  const newClient = (name) => api('/clients', 'POST', { name, documentType: 'cnpj', document: documentNumber(), email: '' })

  const errors = []
  async function open({ live = true, before } = {}) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.on('pageerror', (error) => errors.push(error.message))
    if (!live) await page.route('**/api/live', (route) => route.abort())
    await before?.(page)
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    return page
  }
  const nav = async (page, name, group) => {
    const item = page.locator('.sidebar').getByRole('button', { name, exact: true })
    if (!await item.isVisible()) await page.locator('.sidebar').getByRole('button', { name: group, exact: true }).click()
    await item.click()
  }
  const option = (page, label, text) => page.locator('dialog[open]').getByLabel(label, { exact: true }).locator('option', { hasText: text }).first().waitFor({ state: 'attached', timeout: FAST })

  // A slow read under way when the supplier is saved answers after the save, and the supplier stays on the list.
  {
    let hold = null, release
    const page = await open({ before: (target) => target.route('**/api/payables', async (route) => {
      if (!hold || route.request().method() !== 'GET') return route.continue()
      const gate = hold; hold = null
      const response = await route.fetch()
      await gate
      await route.fulfill({ response })
    }) })
    await nav(page, 'Contas a Pagar', 'Gestão Financeira')
    await page.getByRole('button', { name: 'Nova conta a pagar', exact: true }).waitFor()
    await page.locator('.payable-table').waitFor()
    hold = new Promise((resolve) => { release = resolve })
    await nav(page, 'Fornecedores', 'Cadastros')
    await page.getByRole('button', { name: 'Novo fornecedor', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Novo fornecedor', exact: true })
    await dialog.getByLabel('Nome / razão social', { exact: true }).fill('Fornecedor da corrida')
    await dialog.getByLabel('CPF/CNPJ', { exact: true }).fill(documentNumber())
    await dialog.getByRole('button', { name: 'Salvar', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    const row = page.locator('.payable-table tbody tr', { hasText: 'Fornecedor da corrida' })
    await row.waitFor()
    release()
    await page.waitForTimeout(800)
    assert.equal(await row.count(), 1, 'The older answer does not take the new supplier out of the list')
    await nav(page, 'Contas a Pagar', 'Gestão Financeira')
    await page.getByRole('button', { name: 'Nova conta a pagar', exact: true }).click()
    await option(page, 'Fornecedor', 'Fornecedor da corrida')
    await page.close()
  }

  // Contas a Pagar with the form open: a supplier registered elsewhere enters its list.
  const page = await open()
  await nav(page, 'Contas a Pagar', 'Gestão Financeira')
  await page.getByRole('button', { name: 'Nova conta a pagar', exact: true }).click()
  await page.locator('dialog[open]').getByLabel('Fornecedor', { exact: true }).waitFor()
  await newSupplier('Fornecedor de outra aba')
  await option(page, 'Fornecedor', 'Fornecedor de outra aba')
  await page.locator('dialog[open]').getByRole('button', { name: 'Cancelar', exact: true }).click()

  // Contas a Receber with the form open: the same for a client, which is a registration and not a finance change.
  await nav(page, 'Contas a Receber', 'Gestão Financeira')
  await page.getByRole('button', { name: 'Nova conta a receber', exact: true }).click()
  await page.locator('dialog[open]').getByLabel('Cliente cadastrado', { exact: true }).waitFor()
  // Opening the screen may itself cause a read: it ends first, so only the news of the client can bring it.
  await page.waitForTimeout(1500)
  await newClient('Cliente em Contas a Receber')
  await option(page, 'Cliente cadastrado', 'Cliente em Contas a Receber')
  await page.locator('dialog[open]').getByRole('button', { name: 'Cancelar', exact: true }).click()

  // Cadastros › Clientes: the list itself.
  await nav(page, 'Clientes', 'Cadastros')
  await page.getByRole('button', { name: /Novo cliente/ }).waitFor()
  await newClient('Cliente na lista de clientes')
  await page.getByText('Cliente na lista de clientes', { exact: true }).waitFor({ timeout: FAST })

  // Cadastros › Solicitantes: the form offers the clients.
  await nav(page, 'Solicitantes', 'Cadastros')
  await page.getByRole('button', { name: 'Novo solicitante', exact: true }).click()
  const requester = page.locator('dialog[open]')
  const clientField = requester.getByRole('combobox').first()
  await clientField.waitFor()
  await page.waitForTimeout(500)
  await newClient('Cliente em Solicitantes')
  await clientField.fill('Cliente em Solicitantes')
  await requester.getByText('Cliente em Solicitantes', { exact: true }).first().waitFor({ timeout: FAST })
  await requester.getByRole('button', { name: 'Cancelar', exact: true }).click()

  // Ofertas: the new-offer form searches the clients.
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
  await page.getByRole('button', { name: 'Inserir Oferta Manualmente', exact: true }).click()
  const offerForm = page.locator('.offer-modal-layer')
  const company = offerForm.getByRole('combobox', { name: 'Empresa *', exact: true })
  await company.waitFor()
  await page.waitForTimeout(500)
  await newClient('Cliente nas Ofertas')
  await page.waitForTimeout(1500)
  await company.fill('Cliente nas Ofertas')
  await offerForm.getByRole('option', { name: /Cliente nas Ofertas/ }).waitFor({ timeout: FAST })
  await page.close()

  // Without the live connection (a network that blocks it): going to another tab to register and coming back updates the list.
  const blocked = await open({ live: false })
  await nav(blocked, 'Contas a Pagar', 'Gestão Financeira')
  await blocked.getByRole('button', { name: 'Nova conta a pagar', exact: true }).click()
  await blocked.locator('dialog[open]').getByLabel('Fornecedor', { exact: true }).waitFor()
  const setVisibility = (state) => blocked.evaluate((value) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value }); document.dispatchEvent(new Event('visibilitychange')) }, state)
  await setVisibility('hidden')
  await newSupplier('Fornecedor sem tempo real')
  await blocked.waitForTimeout(500)
  await setVisibility('visible')
  await option(blocked, 'Fornecedor', 'Fornecedor sem tempo real')
  await blocked.close()

  assert.deepEqual(errors, [])
  console.log('Listas de fornecedores e clientes: OK')
} finally {
  await browser.close()
  await fixture.close()
}
