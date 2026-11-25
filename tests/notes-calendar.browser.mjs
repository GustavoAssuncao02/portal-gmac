import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture } from './workflowFixture.js'
import { openSidebarItem } from './sidebarNavigation.js'
import { addDays, bahiaDay } from '../server/noteRules.js'
import { monthDays, sundayOf } from '../src/calendarDays.js'

// Tarefas › Calendário (2026-11-24): Lista | Calendário, the month and the week from Sunday, a task moved by dragging it
// (at once, before the server answers; back with the reason when the server refuses), the question before moving a
// shared task, Sem data, the next days of a repeated task, Nova tarefa neste dia; light, dark, black and phone.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await mkdir('test-results/notes-calendar', { recursive: true })
const shot = (name, options = {}) => page.screenshot({ path: `test-results/notes-calendar/${name}.png`, ...options })
const noOverflow = async (label) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: no page overflow`)
try {
  assert.equal((await fixture.adminRequest('/employees', 'POST', { name: 'Bia Souza', birthDate: '1990-01-01', cpf: '00000000005', email: 'bia@example.invalid', identification: '', type: 'administrative', password: 'senha123' })).status, 201)
  const login = async (cpf, password) => { const token = (await fixture.request('/auth/login', 'POST', { cpf, password })).data.token; return (route, method = 'GET', body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` }) }
  const me = await login(env.DEMO_ADMIN_CPF, env.DEMO_ADMIN_PASSWORD)
  const bia = await login('00000000005', 'senha123')
  const biaId = (await me('/notes/people')).data.items.find((person) => /Bia/.test(person.name)).id
  const today = bahiaDay(Date.now())
  const month = today.slice(0, 7)
  // Two other days of this month, so nothing needs to change the month.
  const others = monthDays(month).filter((day) => day.slice(0, 7) === month && day !== today)
  const [first, second] = [others.find((day) => day > today) || others[0], others.findLast((day) => day < today) || others.at(-1)]
  const task = async (body, as = me) => { const result = await as('/notes', 'POST', { kind: 'task', ...body }); assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data.item }
  const call = await task({ title: 'Ligar para o fornecedor', dueDate: today, dueTime: '10:00' })
  const review = await task({ title: 'Revisão do orçamento', dueDate: today, share: [biaId] })
  assert.equal((await bia(`/notes/${review.id}/answer`, 'POST', { accept: true })).status, 200)
  const stock = await task({ title: 'Conferir estoque', dueDate: today, repeat: 'weekly' })
  const files = await task({ title: 'Organizar arquivos' })
  const report = await task({ title: 'Enviar relatório', dueDate: first })
  assert.equal((await me(`/notes/${report.id}/complete`, 'POST', { scope: 'me' })).status, 200)

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await openSidebarItem(page, 'Anotações e Tarefas')
  const toggle = page.getByRole('group', { name: 'Ver tarefas em' })
  assert.equal(await toggle.getByRole('button', { name: 'Lista', exact: true }).getAttribute('aria-pressed'), 'true', 'the list stays the first view')
  await toggle.getByRole('button', { name: 'Calendário', exact: true }).click()
  const grid = page.getByRole('group', { name: /^Tarefas (de|da semana de) / })
  await grid.waitFor()
  const cell = (day) => grid.locator(`.calendar-day[data-day="${day}"]`)
  const chip = (day, title) => cell(day).locator('.calendar-chip').filter({ hasText: title })
  assert.deepEqual(await grid.locator('.calendar-weekday').allTextContents(), ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'], 'the week starts on Sunday')
  assert.equal(await grid.locator('.calendar-day').first().getAttribute('data-day'), sundayOf(`${month}-01`))
  assert.match(await cell(today).getAttribute('class'), /calendar-day--today/)
  for (const title of ['Ligar para o fornecedor', 'Revisão do orçamento', 'Conferir estoque']) await chip(today, title).waitFor()
  assert.match(await chip(today, 'Ligar para o fornecedor').innerText(), /10:00/)
  assert.match(await chip(first, 'Enviar relatório').getAttribute('class'), /calendar-chip--muted/, 'a concluded task shows faded')
  if (addDays(today, 7) <= (await grid.locator('.calendar-day').last().getAttribute('data-day'))) {
    assert.match(await chip(addDays(today, 7), 'Conferir estoque').getAttribute('class'), /calendar-chip--projected/, 'the next week of a repeated task, lighter')
    assert.equal(await chip(addDays(today, 7), 'Conferir estoque').getAttribute('draggable'), 'false')
  }
  const undated = page.getByRole('group', { name: /^Sem data/ })
  await undated.getByText('Organizar arquivos').waitFor()
  // The chosen day (today at first) lists its tasks below the calendar.
  const dayPanel = page.locator('.notes-calendar-day')
  await dayPanel.locator('.notes-task').filter({ hasText: 'Ligar para o fornecedor' }).waitFor()
  await shot('mes')

  // Dragging: the task is on the new day at once, while the server still has not answered.
  let release
  await page.route(`**/api/notes/${call.id}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    await new Promise((resolve) => { release = resolve })
    await route.continue()
  })
  await chip(today, 'Ligar para o fornecedor').dragTo(cell(first))
  await chip(first, 'Ligar para o fornecedor').waitFor({ timeout: 1000 })
  assert.equal(await chip(today, 'Ligar para o fornecedor').count(), 0, 'it left its day before the answer')
  assert.equal((await me('/notes')).data.items.find((item) => item.id === call.id).dueDate, today, 'the server has not saved it yet')
  const saved = page.waitForResponse((response) => response.url().endsWith(`/api/notes/${call.id}`) && response.request().method() === 'PUT')
  release()
  assert.equal((await saved).status(), 200)
  await page.getByRole('status').filter({ hasText: `“Ligar para o fornecedor” passou para ${first.split('-').reverse().join('/')}.` }).waitFor()
  const moved = (await me('/notes')).data.items.find((item) => item.id === call.id)
  assert.deepEqual([moved.dueDate, moved.dueTime], [first, '10:00'], 'the day changes, the time stays')
  await page.unroute(`**/api/notes/${call.id}`)

  // A refused move: back to its day, with the reason.
  await page.route(`**/api/notes/${call.id}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    await new Promise((resolve) => setTimeout(resolve, 700))
    await route.fulfill({ status: 503, json: { message: 'Falha temporaria de teste.' } })
  })
  await chip(first, 'Ligar para o fornecedor').dragTo(cell(second))
  await chip(second, 'Ligar para o fornecedor').waitFor({ timeout: 600 })
  await page.getByRole('alert').filter({ hasText: 'Falha temporaria de teste. A tarefa voltou para o dia anterior.' }).waitFor()
  await chip(first, 'Ligar para o fornecedor').waitFor()
  assert.equal(await chip(second, 'Ligar para o fornecedor').count(), 0)
  assert.equal((await me('/notes')).data.items.find((item) => item.id === call.id).dueDate, first)
  await page.unroute(`**/api/notes/${call.id}`)

  // A shared task asks first: Cancelar keeps it; Mudar para todos moves it for Bia too.
  await chip(today, 'Revisão do orçamento').dragTo(cell(first))
  const question = page.getByRole('dialog', { name: 'Mudar o dia da tarefa compartilhada' })
  await question.waitFor()
  assert.match(await question.innerText(), /BIA SOUZA[\s\S]*muda para todos/)
  await shot('compartilhada-pergunta')
  await question.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await chip(today, 'Revisão do orçamento').waitFor()
  assert.equal((await me('/notes')).data.items.find((item) => item.id === review.id).dueDate, today)
  await chip(today, 'Revisão do orçamento').dragTo(cell(first))
  await question.getByRole('button', { name: 'Mudar para todos', exact: true }).click()
  await chip(first, 'Revisão do orçamento').waitFor()
  await page.getByRole('status').filter({ hasText: 'passou para' }).filter({ hasText: 'Revisão do orçamento' }).waitFor()
  assert.equal((await bia('/notes')).data.items.find((item) => item.id === review.id).dueDate, first, 'the day changed for everybody')

  // Sem data: a dated task dropped there loses its day (and its time); an undated one dropped on a day gets it.
  await chip(first, 'Ligar para o fornecedor').dragTo(undated)
  await undated.getByText('Ligar para o fornecedor').waitFor()
  await page.getByRole('status').filter({ hasText: '“Ligar para o fornecedor” ficou sem data.' }).waitFor()
  assert.deepEqual((({ dueDate, dueTime }) => [dueDate, dueTime])((await me('/notes')).data.items.find((item) => item.id === call.id)), ['', ''])
  await undated.locator('.calendar-chip').filter({ hasText: 'Organizar arquivos' }).dragTo(cell(second))
  await chip(second, 'Organizar arquivos').waitFor()
  await page.getByRole('status').filter({ hasText: 'Organizar arquivos' }).waitFor()
  assert.equal((await me('/notes')).data.items.find((item) => item.id === files.id).dueDate, second)
  // A repeated task needs a day: it is not taken out of the calendar.
  await chip(today, 'Conferir estoque').dragTo(undated)
  await page.getByRole('alert').filter({ hasText: 'Uma tarefa que se repete precisa de data.' }).waitFor()
  await chip(today, 'Conferir estoque').waitFor()
  assert.equal((await me('/notes')).data.items.find((item) => item.id === stock.id).dueDate, today)

  // A click on a day lists it; Nova tarefa neste dia opens the editor on that day. A click on a task opens it.
  await cell(second).locator('.calendar-day-number').click()
  await dayPanel.locator('.notes-task').filter({ hasText: 'Organizar arquivos' }).waitFor()
  await dayPanel.getByRole('button', { name: 'Nova tarefa neste dia', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Nova tarefa' })
  assert.equal(await editor.getByLabel('Data', { exact: true }).inputValue(), second)
  await editor.getByLabel('Título', { exact: true }).fill('Visita ao cliente')
  await editor.getByRole('button', { name: 'Criar tarefa' }).click()
  await chip(second, 'Visita ao cliente').waitFor()
  await chip(first, 'Revisão do orçamento').click()
  const opened = page.getByRole('dialog', { name: 'Tarefa' })
  assert.equal(await opened.getByLabel('Título', { exact: true }).inputValue(), 'Revisão do orçamento')
  await opened.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await opened.waitFor({ state: 'detached' })

  // Mostrar concluídas, the next month and the week (from Sunday).
  await page.getByLabel('Mostrar concluídas', { exact: true }).uncheck()
  assert.equal(await chip(first, 'Enviar relatório').count(), 0)
  await page.getByLabel('Mostrar concluídas', { exact: true }).check()
  const title = page.locator('.notes-calendar-title')
  const current = await title.innerText()
  await page.getByRole('button', { name: 'Próximo mês', exact: true }).click()
  assert.notEqual(await title.innerText(), current)
  await page.locator('.notes-calendar-nav').getByRole('button', { name: 'Hoje', exact: true }).click()
  assert.equal(await title.innerText(), current)
  await page.getByRole('group', { name: 'Ver o calendário por' }).getByRole('button', { name: 'Semana', exact: true }).click()
  await grid.locator('.calendar-day').nth(6).waitFor()
  assert.equal(await grid.locator('.calendar-day').count(), 7)
  assert.equal(await grid.locator('.calendar-day').first().getAttribute('data-day'), sundayOf(today))
  await chip(today, 'Conferir estoque').waitFor()
  await shot('semana')
  // The view and the mode stay after reloading the page.
  await page.reload()
  await page.getByRole('group', { name: /^Tarefas da semana/ }).waitFor()

  // Dark and black, then the phone: dots on the month, the week one day under the other.
  for (const tone of ['dark', 'black']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = 'dark'; if (value === 'black') document.documentElement.dataset.tone = 'black'; else delete document.documentElement.dataset.tone }, tone)
    await shot(`semana-${tone}`)
  }
  await page.getByRole('group', { name: 'Ver o calendário por' }).getByRole('button', { name: 'Mês', exact: true }).click()
  for (const tone of ['dark', 'black']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = 'dark'; if (value === 'black') document.documentElement.dataset.tone = 'black'; else delete document.documentElement.dataset.tone }, tone)
    await shot(`mes-${tone}`)
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; delete document.documentElement.dataset.tone })
  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow('phone month')
  assert.ok(await page.locator('.calendar-day .calendar-dots').first().isVisible(), 'the phone shows dots')
  assert.equal(await page.locator('.calendar-day .calendar-chips').first().isVisible(), false)
  await shot('celular-mes', { fullPage: true })
  await page.getByRole('group', { name: 'Ver o calendário por' }).getByRole('button', { name: 'Semana', exact: true }).click()
  await noOverflow('phone week')
  const days = await page.locator('.calendar-grid--week .calendar-day').evaluateAll((list) => list.map((item) => item.getBoundingClientRect().top))
  assert.ok(days.every((top, index) => !index || top > days[index - 1]), 'the week on a phone: one day under the other')
  await shot('celular-semana', { fullPage: true })
  assert.deepEqual(errors, [])
  console.log('Notes calendar passed: Lista | Calendário, month and week from Sunday, optimistic drag (before the answer), refusal back to the day, shared question, Sem data both ways, repeated task kept dated, day list with Nova tarefa neste dia, concluded on/off, navigation, dark/black and phone.')
} catch (error) {
  await page.screenshot({ path: 'test-results/notes-calendar/falha.png', fullPage: true }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
