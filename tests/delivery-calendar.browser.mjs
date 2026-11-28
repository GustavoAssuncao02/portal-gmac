import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { openSidebarItem } from './sidebarNavigation.js'
import { SLOT_MS, clockTime, localDay } from '../server/planningRules.js'
import { monthTitle, shiftDay, shiftMonth, sundayOf } from '../src/calendarDays.js'

// Planejamento › Entregas (2026-11-24): the open OS on their delivery day (the date of the accepted proposal), month by
// month from Sunday: what the month has to deliver (OS, services and products, quantities by measure), the late ones,
// the list of a day, the OS opened from the calendar, the type filter and the next months; light, dark, black and phone;
// and the month of the machines, also from Sunday.
// 2026-11-28: the delivery deadline in red and, when every stage is planned, the forecast end of the OS in green (orange
// when it ends after the deadline); the list of a day tells the forecast, or how much of the OS is planned.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await mkdir('test-results/delivery-calendar', { recursive: true })
const shot = (name, options = {}) => page.screenshot({ path: `test-results/delivery-calendar/${name}.png`, ...options })
async function order({ service, quantity, quantityUnit = 'un', kind = 'service', deadline }) {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service, quantity, quantityUnit })).data.item
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind, stages: ['turning'], stageTimes: { turning: 60 } })).status, 200)
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offerDraft.deadline } })).status, 200)
  const item = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  // The agreed delivery day (a past one too, for the late OS).
  await fixture.mutateStore((store) => { store.orders.find((row) => row.code === item.code).proposal.deadline = deadline })
  return item.code
}
try {
  const today = localDay(Date.now()), month = today.slice(0, 7)
  // A day of this month for two deliveries (today when the month is ending), the day before today for a late one, and the
  // 15th of the next month.
  const day = shiftDay(today, 2).slice(0, 7) === month ? shiftDay(today, 2) : today
  const lateDay = shiftDay(today, -1), nextDay = `${shiftMonth(month, 1)}-15`
  const shaft = await order({ service: 'Eixo de transmissão', quantity: 10, deadline: day })
  const support = await order({ service: 'Suporte soldado', quantity: 4, quantityUnit: 'par', kind: 'product', deadline: day })
  const flange = await order({ service: 'Flange', quantity: 25, deadline: lateDay })
  const plate = await order({ service: 'Chapa cortada', quantity: 100, deadline: nextDay })
  // The Tornearia of the shaft (1 h) planned from the next quarter, then the one of the late flange right after it.
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno 01', sectors: ['Usinagem'], sector: 'Usinagem', hourlyRate: 80 }] })
  const start = Math.ceil(Date.now() / SLOT_MS) * SLOT_MS + SLOT_MS, shaftEnd = start + 3600000, flangeEnd = shaftEnd + 3600000
  for (const [code, at] of [[shaft, start], [flange, shaftEnd]]) assert.equal((await fixture.adminRequest('/planning/blocks', 'POST', { orderCode: code, stageCode: 'turning', resourceType: 'machine', resourceId: 'torno', start: new Date(at).toISOString(), minutes: 60 })).status, 201)
  const forecasts = new Map((await fixture.adminRequest('/planning/forecasts')).data.items.map((item) => [item.orderCode, item]))
  assert.deepEqual([forecasts.get(shaft).end, forecasts.get(flange).end, forecasts.get(support).end], [new Date(shaftEnd).toISOString(), new Date(flangeEnd).toISOString(), null])
  assert.deepEqual([forecasts.get(support).planned, forecasts.get(support).total], [0, 1])
  const shaftTone = localDay(shaftEnd) <= day ? 'forecast' : 'forecast-late'

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await openSidebarItem(page, 'Planejamento')
  await page.getByRole('heading', { name: 'Planejamento', exact: true }).waitFor()
  await page.getByRole('group', { name: 'Período' }).getByRole('button', { name: 'Entregas' }).click()
  const calendar = page.getByRole('region', { name: 'Calendário de entregas' })
  await calendar.waitFor()
  const grid = calendar.getByRole('group', { name: `Entregas de ${monthTitle(month)}` })
  const cell = (date) => grid.locator(`.calendar-day[data-day="${date}"]`)
  assert.deepEqual(await grid.locator('.calendar-weekday').allTextContents(), ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'], 'the week starts on Sunday')
  assert.equal(await grid.locator('.calendar-day').first().getAttribute('data-day'), sundayOf(`${month}-01`))
  assert.equal(await page.getByLabel('Setor', { exact: true }).count(), 0, 'the machine filters give place to the type')

  // The month: the OS, of which kind, and how much (each measure apart).
  const indicators = page.getByRole('region', { name: 'Indicadores das entregas' })
  const inMonth = lateDay.slice(0, 7) === month ? 3 : 2
  assert.match(await indicators.innerText(), new RegExp(`Entregas em ${monthTitle(month)}\\s+${inMonth} OS\\s+${inMonth === 3 ? 2 : 1} serviços? · 1 produto`))
  assert.match(await indicators.innerText(), new RegExp(`Quantidade a entregar no mês\\s+${inMonth === 3 ? 35 : 10} unidades · 4 pares`))
  assert.match(await indicators.innerText(), new RegExp(`Atrasadas\\s+1 OS\\s+${flange}`))
  for (const code of [shaft, support]) await cell(day).locator('.calendar-chip').filter({ hasText: code }).first().waitFor()
  assert.match(await cell(day).locator('.calendar-day-summary').innerText(), /10 un · 4 pares/)
  // The delivery deadline is always red.
  assert.match(await cell(day).locator('.calendar-chip').filter({ hasText: shaft }).first().getAttribute('class'), /calendar-chip--deadline/)
  if (lateDay.slice(0, 7) === month) assert.match(await cell(lateDay).locator('.calendar-chip').filter({ hasText: flange }).getAttribute('class'), /calendar-chip--deadline/)
  // The forecast end: green within the deadline, orange ("Vai atrasar") after it.
  if (localDay(shaftEnd).slice(0, 7) === month) {
    const chip = cell(localDay(shaftEnd)).locator(`.calendar-chip--${shaftTone}`).filter({ hasText: shaft })
    assert.match(await chip.innerText(), new RegExp(`${shaftTone === 'forecast' ? 'Previsão' : 'Vai atrasar'} · ${clockTime(shaftEnd)}`))
  }
  if (localDay(flangeEnd).slice(0, 7) === month) assert.match(await cell(localDay(flangeEnd)).locator('.calendar-chip--forecast-late').filter({ hasText: flange }).innerText(), new RegExp(`Vai atrasar · ${clockTime(flangeEnd)}`))
  assert.match(await calendar.locator('.planning-delivery-legend').innerText(), /Prazo de entrega[\s\S]*Previsão de término[\s\S]*vai atrasar/)
  await shot('mes', { fullPage: true })

  // A click on an OS opens it whole, without leaving the planning.
  await cell(day).locator('.calendar-chip').filter({ hasText: shaft }).click()
  const window = page.getByRole('dialog', { name: `Ordem de serviço ${shaft}`, exact: true })
  await window.locator('.os-detail').getByText('Proposta aceita', { exact: true }).waitFor()
  assert.equal(await window.getByRole('button', { name: 'Voltar ao bloco' }).count(), 0)
  await window.locator('footer').getByRole('button', { name: 'Fechar', exact: true }).click()
  await window.waitFor({ state: 'detached' })

  // A click on a day lists its OS; the late ones and the next months.
  await cell(day).locator('.calendar-day-number').click()
  const panel = calendar.locator('.planning-delivery-panel')
  const supportRow = panel.locator('.planning-delivery-list li').filter({ hasText: support })
  assert.match(await supportRow.innerText(), /SUPORTE SOLDADO[\s\S]*Produto · 4 pares · Prontas: 0 de 4[\s\S]*Ainda não planejada \(0 de 1 etapas\)/)
  const shaftRow = panel.locator('.planning-delivery-list li').filter({ hasText: shaft })
  assert.match(await shaftRow.locator('.planning-forecast').innerText(), new RegExp(`Previsão de término: ${localDay(shaftEnd).split('-').reverse().join('/')} às ${clockTime(shaftEnd)}`))
  assert.match(await shaftRow.locator('.planning-forecast').getAttribute('class'), new RegExp(`planning-forecast--${shaftTone}$`))
  // The flange ends on this day too when the day is today: the list brings it with the deliveries.
  assert.equal(await panel.locator('.planning-delivery-list li').count(), localDay(flangeEnd) === day ? 3 : 2)
  await panel.getByRole('button', { name: 'Ver atrasadas (1)' }).click()
  await panel.locator('.planning-delivery-list li').filter({ hasText: flange }).waitFor()
  assert.match(await panel.locator('.planning-delivery-list li').innerText(), /vai atrasar[\s\S]*Atrasado/)
  await shot('atrasadas', { fullPage: true })
  const next = calendar.getByRole('group', { name: 'Próximos meses' }).getByRole('button').first()
  assert.match(await next.innerText(), /1 OS · 100 un/)
  await next.click()
  await calendar.getByRole('group', { name: `Entregas de ${monthTitle(shiftMonth(month, 1))}` }).locator(`.calendar-day[data-day="${nextDay}"] .calendar-chip`).filter({ hasText: plate }).waitFor()
  await page.getByRole('button', { name: 'Hoje', exact: true }).click()
  await grid.waitFor()

  // Only products.
  await page.getByLabel('Tipo', { exact: true }).selectOption('product')
  await page.waitForFunction(() => document.querySelectorAll('.planning-deliveries .calendar-chip').length === 1)
  assert.match(await indicators.innerText(), /1 OS\s+1 produto/)
  await page.getByLabel('Tipo', { exact: true }).selectOption('')

  // Dark, black and the phone.
  for (const tone of ['dark', 'black']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = 'dark'; if (value === 'black') document.documentElement.dataset.tone = 'black'; else delete document.documentElement.dataset.tone }, tone)
    await shot(`mes-${tone}`, { fullPage: true })
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; delete document.documentElement.dataset.tone })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: no page overflow')
  assert.ok(await cell(day).locator('.calendar-dots').isVisible(), 'the phone shows dots')
  await cell(day).locator('.calendar-day-number').click()
  await panel.locator('.planning-delivery-list li').filter({ hasText: shaft }).waitFor()
  await shot('celular', { fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })

  // The machine views are where they were.
  await page.getByRole('group', { name: 'Período' }).getByRole('button', { name: 'Mês' }).click()
  await page.getByRole('heading', { name: 'Calendário do mês' }).waitFor()
  // The month of the machines starts on Sunday too (2026-11-24).
  assert.deepEqual(await page.locator('.planning-weekday').allTextContents(), ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'])
  assert.equal(await page.locator('.planning-day').first().getAttribute('aria-label'), `Abrir ${sundayOf(`${month}-01`).split('-').reverse().slice(0, 2).join('/')}`)
  assert.equal(await page.locator('.planning-day').count(), 42)
  assert.deepEqual(errors, [])
  console.log('Delivery calendar passed: Entregas from Sunday, month totals by kind and measure, late OS, the OS window from a chip, the day list, next months, type filter, dark/black, phone and the machine views kept.')
} catch (error) {
  await page.screenshot({ path: 'test-results/delivery-calendar/falha.png', fullPage: true }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
