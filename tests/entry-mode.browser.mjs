// Forma de lançamento na tela: oferta nova começa por peça, o total aparece, trocar a opção mantém os totais, o que já estava
// lançado fica em "Total do pedido" e mudar a quantidade da OS avisa o que será recalculado.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env, fillStageTimes: false })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const shot = process.argv[2]
const text = (value) => value.replace(/\s+/g, ' ').trim()
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const auth = { Authorization: `Bearer ${token}` }
  const api = async (route, method, body) => { const result = await fixture.request(route, method, body, auth); assert.ok(result.status < 300, `${route}: ${JSON.stringify(result.data)}`); return result.data }
  const machine = (await api('/machines', 'POST', { name: 'Torno teste', type: 'Teste', sector: 'Usinagem', hourlyRate: 120 })).item
  const offer = (await api('/offers', 'POST', { ...offerDraft, service: 'Peca nova' })).item
  const old = (await api('/offers', 'POST', { ...offerDraft, service: 'Peca antiga' })).item
  await api(`/offers/${old.id}/resources`, 'PUT', { materials: [{ id: 'old', name: 'Ferro antigo', unit: 'kg', quantity: 20, unitPrice: 10 }], laborEntries: [], kind: 'service', stages: ['turning'], stageTimes: { turning: 60 }, stageResources: { turning: { type: 'machine', id: machine.id } } })
  const saved = async (id) => (await api('/offers')).items.find((item) => item.id === id)

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  const navigate = async (name) => {
    const item = page.locator('.sidebar').getByRole('button', { name, exact: true })
    if (!await item.isVisible()) await page.locator('.sidebar').getByRole('button', { name: 'Operação', exact: true }).click()
    await item.click()
  }
  const openOffer = async (name) => { await navigate('Ofertas e serviços'); await page.locator('.offers-table-row').filter({ hasText: name }).getByRole('button', { name: 'Em análise', exact: true }).click(); await page.locator('.offer-entry-mode').waitFor() }
  const mode = (name) => page.locator('.offer-entry-mode').getByRole('radio', { name, exact: true })

  // O que já estava lançado continua no total do pedido.
  await openOffer('Peca antiga')
  assert.equal(await mode('Total do pedido').isChecked(), true, 'launched before: Total do pedido')
  assert.match(text(await page.locator('.offer-materials-list').first().innerText()), /20 kg/)
  assert.doesNotMatch(text(await page.locator('.offer-materials-list').first().innerText()), /no total/)

  // Oferta nova: por peça, e o sistema multiplica pelas 10 peças do pedido.
  await openOffer('Peca nova')
  assert.equal(await mode('Por peça').isChecked(), true, 'a new offer starts per piece')
  await page.getByRole('button', { name: 'Adicionar material', exact: true }).click()
  const form = page.locator('.offer-inline-form').first()
  await form.getByRole('combobox', { name: /^Material/ }).fill('Aco novo')
  await form.getByLabel('Quantidade por peça (kg) *').fill('1.5')
  await form.getByLabel('Valor unitário').fill('20')
  await form.getByRole('button', { name: 'Adicionar material', exact: true }).click()
  const row = page.locator('.offer-materials-list .offer-material-row').first()
  await row.getByText('15 kg no total').waitFor()
  assert.match(text(await row.innerText()), /1,5 kg/)
  assert.match(text(await row.innerText()), /R\$\s300,00/, 'value of the whole order')

  // Etapa: tempo de uma peça, total ao lado e mão de obra multiplicada.
  await page.getByRole('checkbox', { name: 'Tornearia' }).check()
  await page.getByLabel('Máquina ou serviço de Tornearia', { exact: true }).selectOption(`machine:${machine.id}`)
  await page.getByLabel('Minutos previstos de Tornearia', { exact: true }).fill('30')
  await page.getByLabel('Minutos previstos de Tornearia', { exact: true }).blur()
  await page.getByText('5 h no total').waitFor()
  await page.locator('.offer-labor-list').getByText('30 min').waitFor()
  await page.locator('.offer-resource-totals').getByText(/por peça/).first().waitFor()
  assert.match(text(await page.locator('.offer-resource-totals').innerText()), /R\$\s600,00.*R\$\s60,00 por peça/, 'labor: total and per piece')
  await page.waitForFunction(() => !document.querySelector('.offer-proposal-button').disabled)
  let stored = (await saved(offer.id)).resources
  assert.equal(stored.entryMode, 'piece')
  assert.equal(stored.materials[0].quantity, 15)
  assert.equal(stored.materials[0].quantityPerPiece, 1.5)
  assert.deepEqual([stored.stageTimes, stored.stageTimesPerPiece], [{ turning: 300 }, { turning: 30 }])
  assert.deepEqual(stored.laborEntries.map((entry) => entry.hours), [5])
  if (shot) await page.locator('.offer-resources-card').screenshot({ path: `${shot}/lancamento-por-peca.png` })

  // Editar o material abre com o valor de uma peça.
  await page.getByRole('button', { name: 'Editar Aco novo', exact: true }).click()
  assert.equal(await form.getByLabel('Quantidade por peça (kg) *').inputValue(), '1.5')
  await form.getByRole('button', { name: 'Cancelar', exact: true }).click()

  // Trocar a forma mantém os totais, nas duas direções.
  await mode('Total do pedido').check()
  await page.waitForFunction(() => document.querySelector('.offer-materials-list .offer-quantity-cell')?.textContent === '15 kg')
  await page.waitForFunction(() => !document.querySelector('.offer-proposal-button').disabled)
  stored = (await saved(offer.id)).resources
  assert.deepEqual([stored.entryMode, stored.materials[0].quantity, stored.materials[0].quantityPerPiece ?? null, stored.stageTimes.turning, stored.stageTimesPerPiece ?? null], ['total', 15, null, 300, null])
  assert.equal(await page.getByLabel('Horas previstas de Tornearia', { exact: true }).inputValue(), '5')
  await mode('Por peça').check()
  await row.getByText('15 kg no total').waitFor()
  await page.waitForFunction(() => !document.querySelector('.offer-proposal-button').disabled)
  stored = (await saved(offer.id)).resources
  assert.deepEqual([stored.entryMode, stored.materials[0].quantity, stored.materials[0].quantityPerPiece, stored.stageTimes.turning, stored.stageTimesPerPiece.turning], ['piece', 15, 1.5, 300, 30])

  // A recarga mantém a escolha.
  await page.reload()
  await page.locator('.offer-entry-mode').waitFor()
  assert.equal(await mode('Por peça').isChecked(), true)

  // OS: mudar a quantidade avisa o que muda e salva recalculado.
  await api(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'A', deadline: offerDraft.deadline, serviceValue: 900, materials: 300, labor: 600, margin: 15, discount: 0, machine: '5 horas', serviceTime: '0 horas' } })
  const order = (await api(`/offers/${offer.id}/accept`, 'POST')).item
  assert.equal(order.resources.materials[0].quantity, 15)
  // The acceptance came through the API: the list on the screen reads it again.
  await page.reload()
  await page.locator('.offer-entry-mode').waitFor()
  await navigate('Ofertas e serviços')
  await page.locator('.offers-table-row').filter({ hasText: 'Peca nova' }).getByRole('button', { name: 'Ver OS', exact: true }).click()
  const details = page.locator('.os-detail')
  await details.waitFor()
  await details.getByText('1,5 kg por peça').waitFor()
  await details.getByText('30 min por peça').waitFor()
  await details.getByRole('button', { name: 'Editar OS', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('heading', { name: 'Editar ordem de serviço' }).waitFor()
  assert.equal(await dialog.locator('.os-quantity-notice').count(), 0, 'no notice while the quantity is the same')
  await dialog.getByLabel('Quantidade de peças', { exact: true }).fill('20')
  const notice = text(await dialog.locator('.os-quantity-notice').innerText())
  assert.match(notice, /recalculados para 20 peças/)
  assert.match(notice, /ACO NOVO: 15 kg → 30 kg/)
  assert.match(notice, /TORNEARIA: 5 h → 10 h/)
  assert.match(notice, /O valor da OS não muda/)
  if (shot) await dialog.locator('.os-quantity-notice').screenshot({ path: `${shot}/aviso-quantidade.png` })
  await dialog.getByRole('tab', { name: 'Recursos', exact: true }).click()
  assert.equal(await dialog.locator('.offer-entry-mode').getByRole('radio', { name: 'Por peça', exact: true }).isChecked(), true)
  assert.equal(await dialog.getByLabel(/^Quantidade por peça \(kg\)/).inputValue(), '1.5')
  await dialog.getByText('30 kg no total').waitFor()
  await dialog.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  const edited = (await api('/operations/orders')).items.find((item) => item.code === order.code)
  assert.deepEqual([edited.quantity, edited.resources.materials[0].quantity, edited.resources.stageTimes.turning, edited.resources.laborEntries[0].hours, edited.proposal.serviceValue], [20, 30, 600, 10, 900])
  assert.deepEqual(errors, [])
  console.log('Forma de lançamento na tela: oferta nova por peça, antigas em total, troca mantendo os totais, recarga e aviso na OS passaram.')
} finally {
  await browser.close()
  await fixture.close()
}
