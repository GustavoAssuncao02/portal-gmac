import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { currentVersion, releaseNotes } from '../src/releaseNotes.js'

const env = { DEMO_ADMIN_CPF: '02427847550', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Dev' }
const fixture = await createWorkflowFixture({ accountsEnv: env, developerRoutes: true })
const browser = await chromium.launch()
const errors = []
async function openPortal(viewport, cpf = env.DEMO_ADMIN_CPF) {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(fixture.url, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('CPF', { exact: true }).fill(cpf)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  return page
}
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await openPortal(viewport)
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
    assert.deepEqual(await dialog.locator('.release-notes > li ul li').allTextContents(), releaseNotes.flatMap((entry) => entry.notes))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal page scroll')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await footer.getByRole('button', { name: 'Notas de atualização', exact: true }).click()
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.close()
  }

  const [latest, older] = releaseNotes
  const { announceRelease } = await fixture.serverModule('notificationEvents.js')
  await fixture.mutateStore((store) => { announceRelease(store, latest); announceRelease(store, older) })
  const readerCpf = '52998224725'
  assert.equal((await fixture.adminRequest('/admins', 'POST', { cpf: readerCpf, name: 'Financeiro', password: env.DEMO_ADMIN_PASSWORD, email: 'financeiro@example.invalid', birthDate: '1990-01-01' })).status, 200)
  const { data: { token } } = await fixture.request('/auth/login', 'POST', { cpf: readerCpf, password: env.DEMO_ADMIN_PASSWORD })
  assert.equal((await fixture.request('/account/home-layout', 'PUT', { layout: [{ id: 'release-notes', w: 2, h: 2 }] }, { Authorization: `Bearer ${token}` })).status, 200)

  const reader = await openPortal({ width: 1440, height: 900 }, readerCpf)
  const developer = await openPortal({ width: 390, height: 844 })
  await reader.locator('.home-notes').getByText(latest.notes[0], { exact: true }).waitFor()
  assert.equal(await reader.locator('.sidebar').getByRole('button', { name: 'Desenvolvedor', exact: true }).count(), 0)
  await developer.getByRole('button', { name: /menu/i }).first().click()
  await developer.locator('.sidebar').getByRole('button', { name: 'Desenvolvedor', exact: true }).click()
  const editButton = developer.getByRole('button', { name: 'Editar notas de atualização', exact: true })
  await editButton.click()
  const editor = developer.getByRole('dialog', { name: 'Editar notas de atualização' })
  const versions = editor.getByRole('combobox', { name: 'Versão', exact: true })
  const text = editor.getByRole('textbox', { name: 'Texto da nota', exact: true })
  await versions.waitFor()
  assert.equal(await versions.locator('option').count(), releaseNotes.length)
  assert.equal(await versions.inputValue(), latest.version)
  assert.equal(await text.inputValue(), latest.notes.join('\n'))
  assert.ok(await editor.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth))

  const save = editor.getByRole('button', { name: 'Salvar nota', exact: true })
  const currentEdit = 'Texto corrigido da versão atual'
  const oldEdit = 'Texto corrigido de uma versão anterior'
  await text.fill(currentEdit)
  await versions.selectOption(older.version)
  assert.equal(await text.inputValue(), older.notes.join('\n'))
  await text.fill(oldEdit)
  await save.click()
  await editor.getByText(`Nota da versão ${older.version} salva.`, { exact: true }).waitFor()
  await versions.selectOption(latest.version)
  assert.equal(await text.inputValue(), currentEdit)
  await save.click()
  await editor.getByText(`Nota da versão ${latest.version} salva.`, { exact: true }).waitFor()
  await editor.getByRole('button', { name: 'Fechar', exact: true }).click()
  await editButton.click()
  await text.waitFor()
  assert.equal(await text.inputValue(), currentEdit)

  await reader.locator('.home-notes').getByText(currentEdit, { exact: true }).waitFor({ timeout: 12000 })
  await reader.getByRole('button', { name: 'Notificações', exact: true }).click()
  const bell = reader.getByRole('dialog', { name: 'Notificações' })
  await bell.getByText(currentEdit, { exact: true }).waitFor()
  await bell.getByText(oldEdit, { exact: true }).click()
  const history = reader.getByRole('dialog', { name: 'Notas de atualização' })
  await history.getByText(oldEdit, { exact: true }).waitFor()
  await history.getByText(currentEdit, { exact: true }).waitFor()
  assert.equal(await history.locator('h3').first().textContent(), `Versão ${currentVersion}`)
  assert.deepEqual(errors, [])
  console.log('Notas de atualização: histórico, editor no celular, gravação, cartão do Início e sino conferidos.')
} finally {
  await browser.close()
  await fixture.close()
}
