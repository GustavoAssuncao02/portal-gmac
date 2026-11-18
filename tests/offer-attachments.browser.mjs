import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

// "Inserir Oferta Manualmente" takes several attachments: picked together or in more than one pick, each with an X to take
// it out before saving; all of them go to the new offer.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
fixture.finishCreatedOffers = false
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const file = (name, content) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(content) })
try {
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

    const service = `Oferta com anexos ${viewport.width}`
    await page.getByRole('button', { name: 'Inserir Oferta Manualmente', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Inserir oferta manualmente' })
    await form.getByLabel('CNPJ/CPF *', { exact: true }).fill('12345678000190')
    await form.getByLabel('Empresa *', { exact: true }).fill('Cliente teste')
    await form.getByLabel('Peça/Serviço *', { exact: true }).fill(service)
    await form.getByLabel('Quantidade *', { exact: true }).fill('2')
    await form.getByLabel('Descrição do serviço *', { exact: true }).fill('Teste dos anexos')

    // Two files at once, then one more and a repeated one in a second pick.
    const picker = form.locator('.offer-attachment-field input[type="file"]')
    assert.match(await form.locator('.offer-attachment-field label').innerText(), /^Anexos/)
    assert.equal(await picker.getAttribute('multiple'), '')
    await picker.setInputFiles([file('desenho.txt', 'cotas'), file('foto.txt', 'imagem')])
    await picker.setInputFiles([file('pedido.txt', 'pedido de compra'), file('desenho.txt', 'cotas')])
    const list = form.getByRole('list', { name: 'Anexos selecionados' })
    assert.deepEqual(await list.getByRole('listitem').allInnerTexts(), ['desenho.txt', 'foto.txt', 'pedido.txt'])
    await form.getByText('3 arquivos selecionados', { exact: true }).waitFor()
    assert.ok(await form.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1), 'no horizontal overflow')
    await page.screenshot({ path: `test-results/offer-attachments-form-${viewport.width}.png` })

    // The X takes one out without opening the file picker.
    await form.getByRole('button', { name: 'Tirar o anexo foto.txt', exact: true }).click()
    assert.deepEqual(await list.getByRole('listitem').allInnerTexts(), ['desenho.txt', 'pedido.txt'])
    await form.getByText('2 arquivos selecionados', { exact: true }).waitFor()

    await form.getByRole('button', { name: 'Adicionar solicitação', exact: true }).click()
    await form.waitFor({ state: 'detached' })
    await page.locator('.offer-details-creating').waitFor()
    const offer = (await fixture.adminRequest('/offers')).data.items.find((item) => item.service === service)
    assert.deepEqual(offer.attachments.map((item) => item.name), ['desenho.txt', 'pedido.txt'])
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Offer attachments: several files at once and in more picks, repeated file once, X takes one out, all saved on the new offer (desktop and phone) passed.')
} finally { await browser.close(); await fixture.close() }
