import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// Proposal screen: materials, labor, service value and hours come from the offer and cannot be edited; the machine and the
// labor hours are kept apart, with their total; the OS value is what the customer pays.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const plain = (text) => text.replace(/\s+/g, ' ').trim()
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = (route, method, body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
  // R$ 500,00 + R$ 1.032,40 of materials and 30 machine hours (R$ 300,00): cost R$ 1.832,40.
  const resources = { materials: [{ id: 'm1', name: 'Alumínio 6061', detail: 'Chapa 10 mm', quantity: 12.5, unitPrice: 40 }, { id: 'm2', name: 'Inox 304', detail: 'Barra', quantity: 8, unitPrice: 129.05 }], laborEntries: [{ id: 'l1', type: 'machine', resource: 'Torno CNC', hours: 30, hourlyRate: 10 }], stages: ['turning'], kind: 'service' }
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, quantity: 1, service: 'Eixo da proposta' })).data.item
  await api(`/offers/${offer.id}/resources`, 'PUT', resources)

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
  await page.locator('.offers-table-row').filter({ hasText: 'Eixo da proposta' }).locator('.offer-review-button').click()
  await page.getByRole('button', { name: 'Fazer proposta', exact: true }).click()
  await page.getByRole('heading', { name: 'Fazer proposta', exact: true }).waitFor()
  const card = page.locator('.proposal-card').first()
  const field = (label) => card.locator('.proposal-card-column > div').filter({ has: page.locator('label', { hasText: new RegExp(`^${label}$`) }) })
  const value = async (label) => plain(await field(label).locator('strong').innerText())
  const price = async () => plain(await card.locator('.proposal-price b').innerText())
  const profit = async () => plain(await card.locator('.proposal-profit b').innerText())

  // The values of the example: R$ 1.832,40 of cost, 15% of gross profit, R$ 2.107,26 charged.
  assert.deepEqual(await Promise.all(['Materiais', 'Mão de obra', 'Valor do serviço', '% de lucro bruto', 'Desconto'].map(value)), ['R$ 1.532,40', 'R$ 300,00', 'R$ 1.832,40', '15,0%', '0,0%'])
  // The machine hours are not counted as labor hours; the total is their sum.
  assert.deepEqual(await Promise.all(['Tempo de máquina', 'Tempo de serviço', 'Horas totais'].map(value)), ['30 horas', '0 horas', '30 horas'])
  assert.equal(await price(), 'R$ 2.107,26')
  assert.equal(await profit(), 'R$ 274,86')
  assert.match(plain(await card.locator('.proposal-price').innerText()), /^Valor da OS valor cobrado do cliente R\$ 2\.107,26$/)

  // Only the delivery term, the gross profit and the discount are edited.
  assert.deepEqual(await card.locator('.proposal-edit-button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))).then((labels) => labels.sort()), ['Editar deadline', 'Editar discount', 'Editar margin'])
  await page.screenshot({ path: 'test-results/proposal-pricing-card.png', fullPage: true })
  const edit = async (name, text) => { await card.getByRole('button', { name: `Editar ${name}`, exact: true }).click(); await card.locator('.proposal-inline-edit').fill(text); await card.locator('.proposal-inline-edit').press('Enter') }
  // The options never cross: with B at 20%, A is blocked above 17% (3 points apart) and keeps its value.
  await edit('margin', '20')
  assert.equal(await value('% de lucro bruto'), '15,0%')
  await page.getByRole('alert').filter({ hasText: 'A opção A precisa ficar pelo menos 3 pontos abaixo da B (20%)' }).waitFor()
  await edit('margin', '17')
  assert.deepEqual([await value('% de lucro bruto'), await price(), await profit(), await value('Valor do serviço')], ['17,0%', 'R$ 2.143,91', 'R$ 311,51', 'R$ 1.832,40'])
  await edit('discount', '10')
  assert.deepEqual([await value('Desconto'), await price(), await profit()], ['10,0%', 'R$ 1.929,52', 'R$ 97,12'])
  await edit('discount', '150')
  assert.equal(await value('Desconto'), '100,0%', 'the discount stops at 100%')
  assert.equal(await price(), 'R$ 0,00')
  await edit('discount', '0')
  await edit('margin', '15')
  assert.equal(await price(), 'R$ 2.107,26')
  await edit('deadline', '2027-01-01')
  assert.equal(await value('Prazo de entrega'), '2027-01-01')
  // Every option has its own gross profit; the cost and the hours are the same in all of them.
  const prices = await page.locator('.proposal-price b').allTextContents()
  assert.deepEqual(prices.map(plain), ['R$ 2.107,26', 'R$ 2.198,88', 'R$ 2.290,50', 'R$ 2.382,12'])

  // The document of the letter models charges the OS value of the selected option.
  await page.getByRole('button', { name: 'Gerar proposta em PDF', exact: true }).click()
  const models = page.getByRole('dialog', { name: 'Escolha o modelo da proposta', exact: true })
  await models.getByRole('button', { name: /^Modelo A/ }).click()
  const letter = page.getByRole('dialog', { name: 'Proposta · Modelo A', exact: true })
  await letter.getByLabel('Valor unitário do item 1', { exact: true }).waitFor()
  assert.equal(await letter.getByLabel('Valor unitário do item 1', { exact: true }).inputValue(), '2.107,26')
  assert.equal(await letter.locator('.proposal-total-differs').count(), 0, 'the document charges exactly the OS value')
  await letter.getByLabel('Valor unitário do item 1', { exact: true }).fill('2.300,00')
  const warning = letter.locator('.proposal-total-differs')
  await warning.waitFor()
  assert.match(plain(await warning.innerText()), /O total deste documento \(R\$ 2\.300,00\) é diferente do Valor da OS desta opção \(R\$ 2\.107,26\)/)
  await page.screenshot({ path: 'test-results/proposal-pricing-model-a.png' })
  await letter.getByRole('button', { name: 'Recomeçar com dados do sistema', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="Valor unitário do item 1"]')?.value === '2.107,26')
  assert.equal(await letter.locator('.proposal-total-differs').count(), 0)
  await page.keyboard.press('Escape')

  // Phone: the card keeps every line readable.
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: no page overflow')
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/proposal-pricing-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1600, height: 1000 })

  // An accepted OS shows the OS value, the cost, the profit and the hours.
  const accepted = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Eixo aceito com Valor da OS' })).data.item
  await api(`/offers/${accepted.id}/resources`, 'PUT', resources)
  await api(`/offers/${accepted.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Opção A', deadline: '2027-01-01', serviceValue: 1832.4, osValue: 2107.26, materials: 1532.4, labor: 300, margin: 15, discount: 0, profit: 274.86, machine: '30 horas', serviceTime: '0 horas', totalTime: '30 horas' } })
  const order = (await api(`/offers/${accepted.id}/accept`, 'POST')).data.item
  await page.locator('.sidebar').getByRole('button', { name: 'Serviços em andamento', exact: true }).click()
  await page.locator('.admin-os-table tbody tr').filter({ hasText: order.service }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  const detail = page.locator('.os-detail')
  await detail.waitFor()
  const fact = async (label) => plain(await detail.locator('.os-proposal .os-facts > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd').innerText())
  assert.deepEqual(await Promise.all(['Valor da OS', 'Valor do serviço', 'Lucro bruto', 'Materiais', 'Mão de obra', 'Margem'].map(fact)), ['R$ 2.107,26', 'R$ 1.832,40', 'R$ 274,86', 'R$ 1.532,40', 'R$ 300,00', '15%'])
  assert.deepEqual(await Promise.all(['Tempo de máquina', 'Tempo de serviço', 'Horas totais'].map(fact)), ['30 horas', '0 horas', '30 horas'])
  await page.screenshot({ path: 'test-results/proposal-pricing-os.png', fullPage: true })
  // The OS value is adjusted in the edition of the OS; the profit follows it.
  await detail.getByRole('button', { name: 'Editar OS', exact: true }).click()
  await page.getByRole('dialog').getByRole('tab', { name: 'Proposta e anexos', exact: true }).click()
  const editing = page.getByRole('dialog')
  assert.equal(await editing.getByLabel('Valor da OS (R$)', { exact: true }).inputValue(), '2107.26')
  assert.equal(await editing.getByLabel('Horas totais', { exact: true }).inputValue(), '30 horas')
  await editing.getByLabel('Valor da OS (R$)', { exact: true }).fill('2200')
  await editing.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await editing.waitFor({ state: 'detached' })
  await page.waitForFunction(() => [...document.querySelectorAll('.os-proposal .os-facts dt')].some((dt) => dt.textContent === 'Lucro bruto' && /367,60/.test(dt.nextElementSibling?.textContent || '')))
  assert.equal(await fact('Valor da OS'), 'R$ 2.200,00')
  assert.equal(await fact('Lucro bruto'), 'R$ 367,60')
  assert.deepEqual(errors, [])
  console.log('Proposal pricing passed: fixed cost and hours from the offer, machine and labor hours apart with their total, OS value from margin and discount, document at the OS value, OS details and edition.')
} catch (error) {
  await page.screenshot({ path: 'test-results/proposal-pricing-failure.png', fullPage: true })
  console.error('Erros da página:', errors)
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
