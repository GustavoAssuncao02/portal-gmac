import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'

// Início: the widgets of Anotações e Tarefas (Minhas tarefas, Anotações recentes, Anotação rápida, Convites pendentes),
// with the calls of the full screen: conclude (a shared task asks "só para mim" or "para todos"), accept an invitation,
// create an annotation or a task, and a click opens the item in Anotações e Tarefas.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Bahia' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const today = todayBahia()
const inDays = (days) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
try {
  const login = async (cpf, password) => ({ Authorization: `Bearer ${(await fixture.request('/auth/login', 'POST', { cpf, password })).data.token}` })
  const admin = await login(env.DEMO_ADMIN_CPF, env.DEMO_ADMIN_PASSWORD)
  await fixture.adminRequest('/employees', 'POST', { name: 'Funcionária Escritório', birthDate: '1990-01-01', cpf: '00000000004', email: 'escritorio@example.invalid', identification: '', type: 'administrative', password: 'senha123' }, fixture.admin)
  const staff = await login('00000000004', 'senha123')
  const note = (headers, body) => fixture.request('/notes', 'POST', body, headers)
  const adminId = (await fixture.request('/notes/people', 'GET', undefined, staff)).data.items.find((person) => /Gustavo/i.test(person.name)).id
  const staffId = (await fixture.request('/notes/people', 'GET', undefined, admin)).data.items.find((person) => /Escrit/i.test(person.name)).id
  for (const [title, dueDate] of [['Pagar fornecedor atrasado', inDays(-1)], ['Ligar para o cliente', today], ['Revisar orçamento', inDays(3)], ['Sem data definida', '']]) assert.equal((await note(admin, { kind: 'task', title, dueDate })).status, 201)
  // A task shared with the administrative employee, who accepted it.
  const shared = (await note(admin, { kind: 'task', title: 'Conferir estoque juntos', dueDate: inDays(2), share: [staffId] })).data.item
  assert.equal((await fixture.request(`/notes/${shared.id}/answer`, 'POST', { accept: true }, staff)).status, 200)
  assert.equal((await note(admin, { kind: 'note', title: 'Anotação fixada', pinned: true })).status, 201)
  assert.equal((await note(admin, { kind: 'note', title: 'Anotação comum' })).status, 201)
  // An invitation for the administrator.
  const invite = (await note(staff, { kind: 'note', title: 'Lista de compras do escritório', share: [adminId] })).data.item
  assert.equal((await fixture.request('/account/home-layout', 'PUT', { layout: [{ id: 'my-tasks', w: 2, h: 2 }, { id: 'note-invites', w: 2, h: 1 }, { id: 'recent-notes', w: 2, h: 2 }, { id: 'quick-note', w: 2, h: 1 }] }, admin)).status, 200)

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  const tasks = page.locator('[data-widget="my-tasks"]'), invites = page.locator('[data-widget="note-invites"]'), notes = page.locator('[data-widget="recent-notes"]'), quick = page.locator('[data-widget="quick-note"]')
  await tasks.locator('.home-tasks li').first().waitFor()
  // Minhas tarefas: late, today and the next days (no task without a day).
  assert.deepEqual(await tasks.locator('.home-tasks-heading').evaluateAll((items) => items.map((item) => [item.firstChild.textContent, item.querySelector('span').textContent])), [['Atrasadas', '1'], ['Hoje', '1'], ['Próximos dias', '2']])
  assert.deepEqual(await tasks.locator('.home-task-body strong').allInnerTexts(), ['Pagar fornecedor atrasado', 'Ligar para o cliente', 'Conferir estoque juntos', 'Revisar orçamento'])
  assert.match(await tasks.locator('.home-card-heading > div > span').innerText(), /1 atrasada · 1 para hoje/)
  await page.screenshot({ path: 'test-results/home-notes.png', fullPage: true })

  // The box concludes a personal task at once.
  await tasks.getByRole('checkbox', { name: 'Concluir Ligar para o cliente', exact: true }).click()
  await tasks.getByText('Tarefa concluída.', { exact: true }).waitFor()
  await tasks.getByText('Ligar para o cliente', { exact: true }).waitFor({ state: 'detached' })
  // A shared task asks how to conclude.
  await tasks.getByRole('checkbox', { name: 'Concluir Conferir estoque juntos', exact: true }).click()
  const choose = page.getByRole('dialog', { name: 'Concluir tarefa compartilhada', exact: true })
  await choose.getByRole('button', { name: /^Concluir só para mim/ }).click()
  await tasks.getByText('Concluída para você. Os outros veem que você concluiu a sua parte.', { exact: true }).waitFor()
  await tasks.getByText('Conferir estoque juntos', { exact: true }).waitFor({ state: 'detached' })
  const staffView = (await fixture.request('/notes', 'GET', undefined, staff)).data.items.find((item) => item.id === shared.id)
  assert.equal(staffView.done, false, 'still open for the other person')

  // Convites pendentes: accepting brings the annotation to Anotações recentes.
  await invites.getByText('Lista de compras do escritório', { exact: true }).waitFor()
  assert.match(await invites.locator('.home-invite-body small').innerText(), /^FUNCIONÁRIA ESCRITÓRIO convidou você · Anotação$/)
  await invites.getByRole('button', { name: 'Aceitar o convite de Lista de compras do escritório', exact: true }).click()
  await invites.getByText('Convite aceito.', { exact: true }).waitFor()
  await invites.getByText('Nenhum convite esperando resposta.', { exact: true }).waitFor()
  await notes.getByText('Lista de compras do escritório', { exact: true }).waitFor()
  assert.equal((await notes.locator('.home-rows-main strong').allInnerTexts())[0], 'Anotação fixada', 'the pinned one first')
  assert.ok((await fixture.request('/notes', 'GET', undefined, admin)).data.items.some((item) => item.id === invite.id))

  // Anotação rápida: an annotation, then a task for today.
  await quick.getByLabel('Anotação', { exact: true }).fill('Comprar luvas novas')
  await quick.getByLabel('Anotação', { exact: true }).press('Enter')
  await quick.getByText('Anotação salva.').waitFor()
  await notes.getByText('Comprar luvas novas', { exact: true }).waitFor()
  await quick.getByRole('button', { name: 'Tarefa', exact: true }).click()
  await quick.getByLabel('Título da tarefa', { exact: true }).fill('Enviar relatório')
  await quick.getByLabel('Data da tarefa', { exact: true }).fill(today)
  await quick.getByRole('button', { name: 'Criar tarefa', exact: true }).click()
  await quick.getByText('Tarefa criada.').waitFor()
  await tasks.getByText('Enviar relatório', { exact: true }).waitFor()
  await page.screenshot({ path: 'test-results/home-notes-after.png', fullPage: true })

  // A click opens the item in Anotações e Tarefas.
  await tasks.getByRole('button', { name: /^Revisar orçamento/ }).click()
  const editor = page.getByRole('dialog', { name: 'Tarefa', exact: true })
  await editor.waitFor()
  assert.equal(await editor.getByRole('textbox').first().inputValue(), 'Revisar orçamento')

  // Narrow screens.
  await page.keyboard.press('Escape')
  await page.locator('.sidebar').getByRole('button', { name: 'Início', exact: true }).click()
  for (const width of [1004, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await tasks.waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal scroll at ${width}`)
    await page.screenshot({ path: `test-results/home-notes-${width}.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log('Home notes passed: Minhas tarefas by late/today/next days, the box concludes (shared asks só para mim), invitation accepted on the Início, quick annotation and task, a click opens the item, narrow screens.')
} catch (error) {
  await page.screenshot({ path: 'test-results/home-notes-failure.png', fullPage: true })
  throw error
} finally { await browser.close(); await fixture.close() }
