import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// "Inserir Oferta Manualmente" opens the details of the new offer right away. On the list it shows only a blue box with
// who is creating it and for how long; someone else is asked before editing it ("editar mesmo assim") and becomes the one
// creating it. "Fazer proposta" puts it in analysis; "Descartar oferta" erases it.
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
    const mobile = viewport.width < 760
    const toOffers = async () => {
      if (mobile) await page.getByRole('button', { name: 'Abrir menu de navegação', exact: true }).click()
      await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
    }
    await toOffers()

    // Created by hand: the details open at once, marked "Criando oferta" with the name of who is creating it.
    const service = `Oferta em criação ${viewport.width}`
    await page.getByRole('button', { name: 'Inserir Oferta Manualmente', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Inserir oferta manualmente' })
    await form.getByLabel('CNPJ/CPF *', { exact: true }).fill('12345678000190')
    await form.getByLabel('Empresa *', { exact: true }).fill('Cliente teste')
    await form.getByLabel('Prazo solicitado *', { exact: true }).fill('2026-12-20')
    await form.getByLabel('Peça/Serviço *', { exact: true }).fill(service)
    await form.getByLabel('Quantidade *', { exact: true }).fill('3')
    await form.getByLabel('Descrição do serviço *', { exact: true }).fill('Teste da oferta em criação')
    await form.getByRole('button', { name: 'Adicionar solicitação', exact: true }).click()
    await form.waitFor({ state: 'detached' })
    await page.locator('.offer-details-creating').getByText('Criando oferta · Gustavo').waitFor()
    await page.getByRole('button', { name: 'Descartar oferta', exact: true }).waitFor()
    const offer = (await fixture.adminRequest('/offers')).data.items.find((item) => item.service === service)
    assert.equal(offer.status, 'creating')
    await page.screenshot({ path: `test-results/offer-creating-details-${viewport.width}.png` })

    // On the list: only the blue box, out of the "Em análise" count.
    await page.getByRole('button', { name: 'Voltar para ofertas', exact: true }).click()
    const row = page.locator('.offers-table-row').filter({ hasText: service })
    const badge = row.locator('.offer-creating-badge')
    await badge.getByText('Gustavo', { exact: true }).waitFor()
    assert.match(await badge.innerText(), /Criando oferta[\s\S]*Gustavo[\s\S]*agora há pouco/)
    assert.equal(await row.getByRole('button').count(), 1, 'no other action while it is being created')
    const reviewing = (await fixture.adminRequest('/offers')).data.items.filter((item) => item.status === 'review').length
    assert.equal(await page.locator('.offer-filter--review strong').innerText(), String(reviewing), 'it is not counted in "Em análise"')
    const colors = await badge.evaluate((element) => getComputedStyle(element).backgroundColor.match(/\d+/g).map(Number))
    assert.ok(colors[2] > colors[0], 'the box is blue')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await row.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `test-results/offer-creating-list-${viewport.width}.png` })

    // Who is creating it opens it directly.
    await badge.click()
    await page.getByRole('heading', { name: `Detalhes da oferta ${offer.code}`, exact: true }).waitFor()
    await page.getByRole('button', { name: 'Voltar para ofertas', exact: true }).click()

    // Someone else is creating it: asked first; cancelling keeps it with them, confirming passes it on.
    await fixture.mutateStore((store) => { store.offers.find((item) => item.id === offer.id).editingBy = { id: 'outro', name: 'Maria Souza', at: offer.createdAt } })
    await page.reload()
    await badge.getByText('Maria Souza', { exact: true }).waitFor()
    await badge.click()
    const modal = page.getByRole('dialog', { name: 'Oferta sendo criada' })
    await modal.getByText(/Maria Souza\s*está criando esta oferta .*Deseja editar mesmo assim\?/).waitFor()
    await page.screenshot({ path: `test-results/offer-creating-take-over-${viewport.width}.png` })
    await modal.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await modal.waitFor({ state: 'detached' })
    assert.equal((await fixture.adminRequest('/offers')).data.items.find((item) => item.id === offer.id).editingBy.name, 'Maria Souza')
    await badge.click()
    await modal.getByRole('button', { name: 'Editar mesmo assim', exact: true }).click()
    await page.getByRole('heading', { name: `Detalhes da oferta ${offer.code}`, exact: true }).waitFor()
    await page.locator('.offer-details-creating').getByText('Criando oferta · Gustavo').waitFor()

    // "Fazer proposta" with the stages planned: the offer goes to analysis and the proposal screen opens.
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'], stageTimes: { turning: 60 }, stageResources: { turning: { type: 'machine', id: 'torno' } } })
    await page.reload()
    await page.getByRole('button', { name: 'Fazer proposta', exact: true }).click()
    await page.getByRole('heading', { name: 'Fazer proposta', exact: true }).waitFor()
    assert.equal((await fixture.adminRequest('/offers')).data.items.find((item) => item.id === offer.id).status, 'review')
    await toOffers()
    await row.getByRole('button', { name: 'Em análise', exact: true }).waitFor()
    await row.getByRole('button', { name: 'Recusar', exact: true }).waitFor()

    // Given up: "Descartar oferta" asks, erases it and goes back to the list.
    const discarded = `Oferta descartada ${viewport.width}`
    await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: discarded })
    await page.reload()
    await page.locator('.offers-table-row').filter({ hasText: discarded }).locator('.offer-creating-badge').click()
    await page.getByRole('button', { name: 'Descartar oferta', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: 'Descartar oferta?' })
    await confirm.waitFor()
    await page.screenshot({ path: `test-results/offer-creating-discard-${viewport.width}.png` })
    await confirm.getByRole('button', { name: 'Descartar oferta', exact: true }).click()
    await page.locator('.offers-board').waitFor()
    assert.equal(await page.locator('.offers-table-row').filter({ hasText: discarded }).count(), 0)
    assert.equal((await fixture.adminRequest('/offers')).data.items.some((item) => item.service === discarded), false)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Offer being created passed at 1440 and iPhone 15: details open at once, blue box with name and time, take-over asked, Fazer proposta puts it in analysis, discard erases it.')
} finally { await browser.close(); await fixture.close() }
