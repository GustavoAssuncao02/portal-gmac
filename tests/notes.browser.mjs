import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { openSidebarItem } from './sidebarNavigation.js'
import { bahiaDay } from '../server/noteRules.js'

// Anotações e Tarefas (2026-11-24): the round button in the corner of every screen, its side panel (quick annotation,
// Hoje, Anotações, Convites), the editor, sharing with an invitation, concluding a shared task "só para mim", the full
// screen in the menu and the notices of the bell; light, dark, black and phone.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await mkdir('test-results/notes', { recursive: true })
const shot = (name, options = {}) => page.screenshot({ path: `test-results/notes/${name}.png`, ...options })
const noOverflow = async (label) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: no page overflow`)
try {
  assert.equal((await fixture.adminRequest('/employees', 'POST', { name: 'Bia Souza', birthDate: '1990-01-01', cpf: '00000000005', email: 'bia@example.invalid', identification: '', type: 'administrative', password: 'senha123' })).status, 201)
  const biaLogin = await fixture.request('/auth/login', 'POST', { cpf: '00000000005', password: 'senha123' })
  const bia = (route, method = 'GET', body) => fixture.request(route, method, body, { Authorization: `Bearer ${biaLogin.data.token}` })

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()

  // The round button, without a label, on every screen; it opens the side panel.
  const fab = page.locator('.notes-fab')
  await fab.waitFor()
  assert.equal((await fab.innerText()).trim(), '', 'no text next to the button')
  assert.equal(await fab.getAttribute('aria-label'), 'Abrir Anotações e Tarefas')
  const box = await fab.boundingBox()
  assert.ok(box.x + box.width <= 1440 - 16 && box.y + box.height <= 900 - 16, 'in the bottom right corner')
  await shot('inicio-com-botao')
  await fab.click()
  const drawer = page.getByRole('dialog', { name: 'Anotações e Tarefas' })
  await drawer.waitFor()
  await drawer.getByText('Nenhuma tarefa atrasada ou para hoje.').waitFor()

  // Quick annotation: Enter saves it.
  const quick = drawer.getByLabel('Anotação rápida', { exact: true })
  await quick.fill('Comprar parafusos M8')
  await quick.press('Enter')
  await drawer.getByText('Anotação salva.').waitFor()
  await drawer.locator('.notes-card').filter({ hasText: 'Comprar parafusos M8' }).waitFor()

  // A shared meeting for today, from the panel.
  await drawer.getByRole('button', { name: 'Nova tarefa', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Nova tarefa' })
  await editor.getByLabel('Título', { exact: true }).fill('Reunião com a produção')
  await editor.getByRole('combobox', { name: /^Tipo/ }).selectOption('meeting')
  await editor.getByLabel('Local ou link da reunião', { exact: true }).fill('Sala 2')
  const today = bahiaDay(Date.now())
  await editor.getByLabel('Data', { exact: true }).fill(today)
  await editor.getByRole('radio', { name: /Compartilhada/ }).click()
  await editor.getByRole('button', { name: /BIA SOUZA/ }).click()
  await shot('editor-nova-tarefa')
  await editor.getByRole('button', { name: 'Criar e enviar convites', exact: true }).click()
  await editor.waitFor({ state: 'detached' })
  const row = drawer.locator('.notes-task').filter({ hasText: 'Reunião com a produção' })
  await row.waitFor()
  assert.match(await row.innerText(), /Sala 2/)
  assert.equal(await page.locator('.notes-fab-count').innerText(), '1', 'the task of today in the count')
  await shot('painel-hoje')

  // Bia accepts the invitation; the task is shared by two.
  const invite = (await bia('/notes')).data.invites[0]
  assert.equal(invite.title, 'Reunião com a produção')
  assert.equal((await bia(`/notes/${invite.id}/answer`, 'POST', { accept: true })).status, 200)
  await page.keyboard.press('Escape')
  await drawer.waitFor({ state: 'hidden' })

  // The full screen, in the menu below Configurações; the round button hides there.
  const labels = await page.locator('.sidebar').getByRole('button').allInnerTexts()
  assert.equal(labels.map((text) => text.trim()).indexOf('Anotações e Tarefas'), labels.map((text) => text.trim()).indexOf('Configurações') + 1, 'right below Configurações')
  await openSidebarItem(page, 'Anotações e Tarefas')
  await page.getByRole('heading', { name: 'Anotações e Tarefas', level: 1 }).waitFor()
  await fab.waitFor({ state: 'detached' })
  const task = page.locator('.notes-task').filter({ hasText: 'Reunião com a produção' })
  await task.waitFor()
  await task.locator('.notes-shared').getByText('Compartilhada · 2').waitFor()
  await shot('tela-tarefas', { fullPage: true })

  // Concluding a shared task asks for whom.
  await task.getByRole('checkbox', { name: 'Concluir Reunião com a produção' }).click()
  const complete = page.getByRole('dialog', { name: 'Concluir tarefa compartilhada' })
  await complete.getByRole('button', { name: /Concluir só para mim/ }).click()
  await page.locator('.notes-group--done').getByText('Reunião com a produção').waitFor()
  const seen = (await bia('/notes')).data.items[0]
  assert.equal(seen.done, false, 'still open for Bia')
  assert.ok(seen.participants.find((person) => person.role === 'owner').doneAt, 'who sees that Gustavo did his part')

  // Annotations tab and the editor of an existing one.
  await page.locator('.notes-tabs').getByRole('button', { name: /^Anotações/ }).click()
  await page.locator('.notes-card').filter({ hasText: 'Comprar parafusos M8' }).locator('.notes-card-open').click()
  const noteEditor = page.getByRole('dialog', { name: 'Anotação' })
  await noteEditor.getByRole('button', { name: 'Transformar em tarefa', exact: true }).waitFor()
  await noteEditor.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await shot('tela-anotacoes', { fullPage: true })

  // A notice of the bell opens its item.
  await bia(`/notes/${invite.id}/comments`, 'POST', { text: 'Levo o relatório de produção.' })
  await page.getByRole('button', { name: 'Notificações', exact: true }).click()
  await page.locator('.notifications-popup').getByText(/Bia Souza comentou/i).click()
  const opened = page.getByRole('dialog', { name: 'Reunião' })
  await opened.getByText('Levo o relatório de produção.').waitFor()
  await shot('editor-compartilhada')
  await opened.getByRole('button', { name: 'Cancelar', exact: true }).click()

  // Dark, black and the phone.
  for (const [theme, tone] of [['dark', null], ['dark', 'black']]) {
    await page.evaluate(([value, black]) => { document.documentElement.dataset.theme = value; if (black) document.documentElement.dataset.tone = black }, [theme, tone])
    await shot(`tela-${tone || theme}`, { fullPage: true })
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; delete document.documentElement.dataset.tone })
  await openSidebarItem(page, 'Configurações')
  await fab.waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow('390 Configurações')
  await fab.click()
  await drawer.waitFor()
  const panel = await drawer.boundingBox()
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 390, 'the panel fits the phone')
  await shot('painel-390')
  await drawer.getByRole('button', { name: 'Abrir a tela completa' }).click()
  await page.getByRole('heading', { name: 'Anotações e Tarefas', level: 1 }).waitFor()
  await noOverflow('390 Anotações e Tarefas')
  await shot('tela-390', { fullPage: true })
  assert.deepEqual(errors, [])
  console.log('Anotações e Tarefas: round button, side panel, quick annotation, shared meeting with invitation, conclusion only for me, full screen below Configurações, bell notice, themes and phone passed.')
} catch (error) {
  await page.screenshot({ path: 'test-results/notes/failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
