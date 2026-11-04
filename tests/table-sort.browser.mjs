// The titles of the tables order the rows, the Máquinas list shows the hourly rate and Etapas shows its history.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Rafael Teste' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = async (route, method, body) => { const result = await fixture.request(route, method, body, { Authorization: `Bearer ${token}` }); assert.ok(result.status < 300, JSON.stringify(result.data)); return result.data }
  for (const [name, hourlyRate] of [['Torno A', 120], ['Fresa B', 300], ['Plaina C', 95]]) await api('/machines', 'POST', { name, type: 'Teste', sector: 'Usinagem', hourlyRate })
  for (const [name, document] of [['Banco Beta', '1'], ['Banco Alfa', '2']]) await api('/banks', 'POST', { name, agency: document, account: document })
  const { stages, sectors } = await api('/stages')
  await api(`/stages/${stages[0].code}/active`, 'PATCH', { active: false })
  await api(`/stages/${stages[0].code}/active`, 'PATCH', { active: true })
  assert.ok(sectors.length)

  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  const nav = async (name, group) => {
    const item = page.locator('.sidebar').getByRole('button', { name, exact: true })
    if (group && !await item.isVisible()) await page.locator('.sidebar').getByRole('button', { name: group, exact: true }).click()
    await item.click()
  }

  // Máquinas: the hourly rate has a column, and it sorts from the largest; a second click reverses.
  await nav('Máquinas')
  const machineNames = () => page.locator('.machine-row:not(.machine-row--header) .machine-name strong').allTextContents()
  const rate = page.locator('.machine-row--header').getByRole('button', { name: 'Valor/hora', exact: true })
  await rate.waitFor()
  await page.locator('.machine-row:not(.machine-row--header)').first().waitFor()
  assert.match(await page.locator('.machine-row', { hasText: 'Fresa B' }).innerText(), /R\$\s*300,00/)
  await rate.click()
  assert.deepEqual(await machineNames(), ['Fresa B', 'Torno A', 'Plaina C'])
  assert.equal(await page.locator('.machine-row--header [aria-sort="descending"]').count(), 1)
  await rate.click()
  assert.deepEqual(await machineNames(), ['Plaina C', 'Torno A', 'Fresa B'])
  await page.locator('.machine-row--header').getByRole('button', { name: 'Máquina', exact: true }).click()
  assert.deepEqual(await machineNames(), ['Fresa B', 'Plaina C', 'Torno A'], 'text starts from A')
  await page.screenshot({ path: 'test-results/maquinas-valor-hora.png' })

  // A registration that had no sorting.
  await nav('Bancos', 'Cadastros')
  const bankRows = page.locator('.simple-registry-count').first().locator('xpath=ancestor::table').locator('tbody tr td:first-child')
  await page.getByRole('button', { name: 'Nome do banco', exact: true }).click()
  assert.deepEqual(await bankRows.allTextContents(), ['Banco Alfa', 'Banco Beta'])
  await page.getByRole('button', { name: 'Nome do banco', exact: true }).click()
  assert.deepEqual(await bankRows.allTextContents(), ['Banco Beta', 'Banco Alfa'])

  // Every other list that gained titles opens without breaking.
  for (const [name, group, title] of [['Estoque', null, 'Disponível'], ['Ofertas e serviços', null, 'Peça / Serviço'], ['Serviços em andamento', null, 'Status'], ['Serviços', null, 'Valor/hora']]) {
    await nav(name, group)
    await page.getByRole('button', { name: title, exact: true }).first().click()
  }
  for (const [name, title] of [['Grupos de contas', 'Grupo de contas'], ['Ajustes da DRE', 'Mês']]) {
    await nav(name, 'Gestão Financeira')
    await page.getByRole('button', { name: title, exact: true }).first().click()
  }

  // Etapas: the "i" of a stage and the general one.
  await nav('Etapas')
  await page.getByRole('button', { name: `Ver histórico de ${stages[0].name}`, exact: true }).click()
  const history = page.locator('dialog[open]').last()
  await history.getByText('Etapa reativada', { exact: true }).waitFor()
  await history.getByText('Etapa desativada', { exact: true }).waitFor()
  assert.match(await history.innerText(), /Rafael Teste/)
  await page.screenshot({ path: 'test-results/etapas-historico.png' })
  await history.getByRole('button', { name: 'Fechar janela', exact: true }).click()
  await page.getByRole('button', { name: 'Histórico geral das etapas', exact: true }).click()
  await page.locator('dialog[open]').last().getByText('Etapa reativada', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Títulos ordenáveis, Valor/hora e histórico das etapas: OK')
} finally {
  await browser.close()
  await fixture.close()
}
