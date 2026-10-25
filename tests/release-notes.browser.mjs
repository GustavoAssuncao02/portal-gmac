import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { currentVersion, releaseNotes } from '../src/releaseNotes.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
const errors = []
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
    await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.locator('.admin-home-main').waitFor()
    if (name === 'mobile') await page.getByRole('button', { name: /menu/i }).first().click()
    await page.locator('.sidebar').getByRole('button', { name: 'Configurações', exact: true }).click()
    const footer = page.locator('.account-release-footer')
    await footer.getByText(`Versão ${currentVersion}`, { exact: true }).waitFor()
    await footer.getByRole('button', { name: 'Notas de atualização', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Notas de atualização' })
    await dialog.waitFor()
    assert.equal(await dialog.locator('.release-notes > li').count(), releaseNotes.length)
    assert.equal(await dialog.locator('h3').first().textContent(), `Versão ${currentVersion}`)
    assert.equal(await dialog.locator('.release-notes-current').count(), 1)
    for (const note of releaseNotes.flatMap((entry) => entry.notes)) await dialog.getByText(note, { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal page scroll')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await footer.getByRole('button', { name: 'Notas de atualização', exact: true }).click()
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.close()
  }
  assert.deepEqual(errors, [])
  console.log('Notas de atualização: versão, modal e fechamento conferidos no desktop e no celular.')
} finally {
  await browser.close()
  await fixture.close()
}
