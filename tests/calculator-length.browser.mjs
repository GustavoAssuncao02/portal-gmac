import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'

// Calculadora de pesos e medidas: a "Peso por metro" result has a length beside it, 1.000 mm by default; typing 800 or 80
// shows the weight of that piece and keeps the weight per meter as a note. Results per piece have no such field.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    const mobile = viewport.width < 761
    const opener = page.getByRole('button', { name: 'Abrir menu de navegação', exact: true })
    if (await opener.isVisible()) await opener.click()
    const item = page.locator('.sidebar').getByRole('button', { name: 'Calculadora de pesos e medidas', exact: true })
    if (!await item.isVisible()) await page.locator('.sidebar').getByRole('button', { name: 'Gestão Financeira', exact: true }).click()
    await item.click()
    await page.locator('.calculator-main').waitFor()

    // Aço carbono (8 g/cm³), barra chata 10 x 100 mm: 8 kg per meter.
    const result = page.locator('.weight-result')
    const length = page.getByLabel('Comprimento (mm)', { exact: true })
    assert.equal(await length.inputValue(), '1000', 'one meter by default')
    await page.getByLabel('Espessura (mm)', { exact: false }).fill('10')
    await page.getByLabel('Largura (mm)', { exact: false }).fill('100')
    assert.equal(await result.locator('span').first().innerText(), 'Peso por metro')
    assert.equal(await result.locator('strong').innerText(), '8 kg')
    assert.equal(await result.locator('small').count(), 0)

    await length.fill('800')
    assert.equal(await result.locator('span').first().innerText(), 'Peso em 800 mm')
    assert.equal(await result.locator('strong').innerText(), '6,4 kg')
    assert.equal(await result.locator('small').innerText(), '8 kg por metro')
    await length.fill('80')
    assert.equal(await result.locator('strong').innerText(), '0,64 kg')
    await length.fill('2500')
    assert.equal(await result.locator('span').first().innerText(), 'Peso em 2.500 mm')
    assert.equal(await result.locator('strong').innerText(), '20 kg')
    const [resultBox, lengthBox] = await Promise.all([result.locator('strong').boundingBox(), length.boundingBox()])
    const middle = (box) => box.y + box.height / 2
    assert.ok(Math.abs(middle(resultBox) - middle(lengthBox)) < 6 && lengthBox.x > resultBox.x + resultBox.width, 'the length field sits beside the result')
    await page.screenshot({ path: `test-results/calculator-length-${viewport.width}.png`, fullPage: true })

    // An empty field goes back to one meter; "Limpar medidas" also resets it.
    await length.fill('')
    await length.blur()
    assert.equal(await length.inputValue(), '1000')
    await length.fill('800')
    await page.getByRole('button', { name: 'Limpar medidas', exact: true }).click()
    assert.equal(await length.inputValue(), '1000')
    assert.equal(await result.locator('strong').innerText(), '-')

    // Chapa is weighed per piece (its own Comprimento): no extra field.
    if (mobile) await page.locator('.calculator-mobile-choices').getByLabel('Formato', { exact: true }).selectOption('plate')
    else await page.locator('.format-option').filter({ hasText: /^Chapa$/ }).click()
    assert.equal(await page.locator('.weight-length').count(), 0)
    assert.equal(await result.locator('span').innerText(), 'Peso por peça')
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Calculator length passed: 1.000 mm by default, weight for 800/80/2.500 mm with the per-meter note, reset, desktop and phone.')
} finally {
  await browser.close()
  await fixture.close()
}
