import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

// Inserir oferta manualmente: up to 5 requesters (TCK-0004) and "Sem quantidade definida" (TCK-0005). The details show
// "A definir" and "Fazer proposta" asks the quantity before the proposal options.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
fixture.finishCreatedOffers = false
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
try {
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno 01' }] })
  for (const viewport of [{ width: 1440, height: 900 }, { width: 393, height: 852 }]) {
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

    const service = `Tubo injetor ${viewport.width}`
    await page.getByRole('button', { name: 'Inserir Oferta Manualmente', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Inserir oferta manualmente' })
    await form.getByLabel('CNPJ/CPF *', { exact: true }).fill('12345678000190')
    await form.getByLabel('Empresa *', { exact: true }).fill('Cliente teste')

    // Requesters: one field at first; "Adicionar solicitante" up to 5, the X removes one.
    const add = form.getByRole('button', { name: /Adicionar solicitante/ })
    const names = ['Ana Lima', 'Bruno Dias', 'Carla Reis', 'Diego Santos', 'Elaine Moura']
    await form.getByRole('combobox', { name: 'Solicitante', exact: true }).fill(names[0])
    for (let index = 1; index < names.length; index += 1) {
      await add.click()
      await form.getByRole('combobox', { name: `Solicitante ${index + 1}`, exact: true }).fill(names[index])
    }
    assert.equal(await add.count(), 0, 'no sixth requester')
    await form.getByRole('button', { name: 'Remover solicitante 5', exact: true }).click()
    await add.waitFor()
    assert.match(await add.innerText(), /4\/5/)

    // "Sem quantidade definida": the quantity field shows "A definir" and is no longer required.
    await form.getByLabel('Peça/Serviço *', { exact: true }).fill(service)
    const quantity = form.getByLabel('Quantidade', { exact: true })
    await form.getByRole('checkbox', { name: 'Sem quantidade definida', exact: true }).check()
    assert.equal(await quantity.isDisabled(), true)
    assert.equal(await quantity.getAttribute('placeholder'), 'A definir')
    await form.getByLabel('Descrição do serviço *', { exact: true }).fill('Confeccionar tubos injetores para o rolo prensa')
    await page.screenshot({ path: `test-results/offer-requesters-quantity-form-${viewport.width}.png` })
    await form.getByRole('button', { name: 'Adicionar solicitação', exact: true }).click()
    await form.waitFor({ state: 'detached' })

    // Details: all the requesters and "A definir".
    const facts = page.locator('.offer-detail-facts')
    await facts.getByText('Solicitantes: ANA LIMA, BRUNO DIAS, CARLA REIS, DIEGO SANTOS').waitFor()
    await facts.getByText('A definir', { exact: true }).waitFor()
    const offer = (await fixture.adminRequest('/offers')).data.items.find((item) => item.service === service)
    assert.deepEqual([offer.quantityPending, offer.requesters.length], [true, 4])

    // "Fazer proposta" asks the quantity first; confirming goes to the proposal options with it.
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'], stageTimes: { turning: 60 }, stageResources: { turning: { type: 'machine', id: 'torno' } } })
    await page.reload()
    await page.getByRole('button', { name: 'Fazer proposta', exact: true }).click()
    const ask = page.getByRole('dialog', { name: 'Quantidade de peças' })
    await ask.waitFor()
    await page.screenshot({ path: `test-results/offer-requesters-quantity-modal-${viewport.width}.png` })
    await ask.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await ask.waitFor({ state: 'detached' })
    assert.equal((await fixture.adminRequest('/offers')).data.items.find((item) => item.id === offer.id).status, 'creating', 'cancelling keeps it being created')
    await page.getByRole('button', { name: 'Fazer proposta', exact: true }).click()
    await ask.getByLabel('Quantidade *', { exact: true }).fill('3')
    await ask.getByRole('button', { name: 'Confirmar quantidade', exact: true }).click()
    await page.getByRole('heading', { name: 'Fazer proposta', exact: true }).waitFor()
    const saved = (await fixture.adminRequest('/offers')).data.items.find((item) => item.id === offer.id)
    assert.deepEqual([saved.quantity, saved.quantityPending, saved.status], [3, undefined, 'review'])
    await page.locator('.proposal-service-summary').getByText('3 unidades', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Requesters and pending quantity passed at 1440 and iPhone 15: 5 requesters at most, "A definir", quantity asked before the proposal.')
} finally {
  await browser.close()
  await fixture.close()
}
