import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { enterOperatorCode } from './operatorEntry.js'
import { SLOT_MS, clockTime, dayStart, localDay } from '../server/planningRules.js'

// Planejamento: the day of each machine, the moment clicked on the ruler, planning from the list (with the clash of a
// machine), moving a block, the week and the month, and the queue of the operator's sector on the tablet.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const tabletContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, hasTouch: true })
const tablet = await tabletContext.newPage()
const errors = []
for (const target of [page, tablet]) target.on('pageerror', (error) => errors.push(error.message))
await mkdir('test-results/planning', { recursive: true })
try {
  const sectors = {}
  for (const name of ['Usinagem', 'Caldeiraria']) sectors[name] = (await fixture.adminRequest('/sectors', 'POST', { name })).data.item
  await fixture.mutateStore((store) => {
    store.machines = [
      { id: 'torno', name: 'Torno 01', sectors: ['Usinagem'], sector: 'Usinagem', hourlyRate: 80 },
      { id: 'fresa', name: 'Fresa 02', sectors: ['Usinagem'], sector: 'Usinagem', hourlyRate: 90, maintenance: { since: new Date().toISOString(), reason: 'Troca de correia', startedBy: 'Gustavo' } },
      { id: 'plasma', name: 'Plasma 01', sectors: ['Caldeiraria'], sector: 'Caldeiraria', hourlyRate: 95 },
    ]
  })
  const ana = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001', sectorIds: [sectors.Usinagem.id] })).data.item
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Eixo planejado', quantity: 10 })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning', 'plasma-cut'], stageTimes: { turning: 240, 'plasma-cut': 90 }, stageResources: { turning: { type: 'machine', id: 'torno' } } })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offerDraft.deadline } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  // Two hours of the Torno from the current quarter: nobody started it, so it is late.
  const slot = Math.floor(Date.now() / SLOT_MS) * SLOT_MS, today = localDay(slot)
  assert.equal((await fixture.adminRequest('/planning/blocks', 'POST', { orderCode: order.code, stageCode: 'turning', resourceType: 'machine', resourceId: 'torno', start: new Date(slot).toISOString(), minutes: 120 })).status, 201)

  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Planejamento', exact: true }).click()
  await page.getByRole('heading', { name: 'Planejamento', exact: true }).waitFor()
  const agenda = page.getByRole('region', { name: 'Agenda por máquina' })
  const torno = agenda.getByLabel('Agenda de Torno 01')
  const block = torno.locator('.planning-block').first()
  await block.waitFor()
  assert.match(await block.innerText(), new RegExp(`${order.code} · Tornearia`))
  assert.match(await block.getAttribute('class'), /planning-block--late/)
  assert.match(await agenda.locator('.planning-label').filter({ hasText: 'Fresa 02' }).innerText(), /Em manutenção/)
  assert.match(await page.locator('.planning-indicators').innerText(), /1 atrasado/)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow: the day scrolls inside the agenda')

  // The moment now, then one chosen on the clock: busy, idle (with the free time) and in maintenance.
  const snapshot = page.getByRole('region', { name: /Agora|às/ })
  assert.match(await snapshot.innerText(), /Ocupadas \(1 de 3\)[\s\S]*Torno 01[\s\S]*Ociosas \(1 de 3\)[\s\S]*Plasma 01[\s\S]*Em manutenção \(1 de 3\)[\s\S]*Troca de correia/)
  assert.match(await snapshot.innerText(), /Real: parada/, 'up to now it tells what really happened')
  const later = clockTime(slot + 3 * 3600000)
  if (localDay(slot + 3 * 3600000) === today) {
    await page.locator('#planning-snapshot-time').selectOption(later)
    await page.getByRole('heading', { name: `Previsão às ${later}` }).waitFor()
    assert.match(await page.locator('.planning-snapshot').innerText(), /Ociosas \(2 de 3\)/)
  }
  await page.screenshot({ path: 'test-results/planning/dia.png', fullPage: true })

  // Planning from the list: one row per OS with its stages; Planejar OS brings all of them, each with its machine.
  const backlog = page.getByRole('region', { name: 'Serviços para planejar' })
  const row = backlog.locator('tr').filter({ hasText: order.code })
  assert.match(await row.innerText(), /Tornearia · Torno 01[\s\S]*2h a planejar[\s\S]*Corte a plasma · Sem máquina definida[\s\S]*1h30 a planejar/, 'two of the four hours of turning are still to plan')
  await row.getByRole('button', { name: 'Planejar' }).click()
  const modal = page.getByRole('dialog', { name: 'Planejar OS' })
  const stages = modal.locator('.planning-stage-row')
  await modal.getByLabel('Início da etapa Tornearia').waitFor()
  // The Tornearia stays on the Torno (no choice) and starts right after the block already planned on it.
  assert.match(await stages.nth(0).innerText(), /Tornearia[\s\S]*Torno 01[\s\S]*falta planejar 2h/)
  assert.equal(await modal.getByLabel('Máquina ou serviço da etapa Tornearia').count(), 0, 'the machine of a planned stage is not chosen again')
  assert.equal(await modal.getByLabel('Início da etapa Tornearia').inputValue(), clockTime(slot + 2 * 3600000))
  assert.match(await stages.nth(0).locator('.planning-strip-wrap').innerText(), new RegExp(`Torno 01 em .*: ocupada ${clockTime(slot)}`))
  // The Corte a plasma has no machine in this older OS: it is chosen here, and on the same Torno it follows the Tornearia.
  await modal.getByLabel('Máquina ou serviço da etapa Corte a plasma').selectOption('machine:torno')
  assert.equal(await modal.getByLabel('Início da etapa Corte a plasma').inputValue(), clockTime(slot + 4 * 3600000))
  await modal.getByLabel('Planejar a etapa Tornearia').uncheck()
  assert.equal(await modal.getByLabel('Início da etapa Corte a plasma').inputValue(), clockTime(slot + 2 * 3600000), 'without the Tornearia it takes the first free time of the Torno')
  // Put over the block of the Torno, the clash shows at once and the server refuses it too.
  await modal.getByLabel('Dia da etapa Corte a plasma').fill(today)
  await modal.getByLabel('Início da etapa Corte a plasma').selectOption(clockTime(slot))
  await stages.nth(1).getByText(/Torno 01 já tem a .* das/).waitFor()
  assert.equal(await stages.nth(1).locator('.planning-strip-new--clash').count(), 1)
  await page.screenshot({ path: 'test-results/planning/planejar.png' })
  await modal.getByRole('button', { name: 'Planejar etapa', exact: true }).click()
  await modal.getByRole('alert').getByText(/Torno 01 já tem a .* das/).waitFor()
  await modal.getByLabel('Máquina ou serviço da etapa Corte a plasma').selectOption('machine:plasma')
  assert.equal(await stages.nth(1).locator('.planning-strip-new--clash').count(), 0)
  await modal.getByRole('button', { name: 'Planejar etapa', exact: true }).click()
  await modal.waitFor({ state: 'detached' })
  await agenda.getByLabel('Agenda de Plasma 01').locator('.planning-block').filter({ hasText: 'Corte a plasma' }).waitFor()
  assert.doesNotMatch(await backlog.locator('tr').filter({ hasText: order.code }).innerText(), /Corte a plasma/, 'only the Tornearia is left to plan')

  // Dragging the Torno block one hour later moves it on the server.
  const box = await block.boundingBox()
  await page.mouse.move(box.x + 20, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 4 })
  await page.mouse.move(box.x + 20 + 88, box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()
  await page.waitForFunction((start) => document.querySelector('[aria-label="Agenda de Torno 01"] .planning-block span')?.textContent.startsWith(start), clockTime(slot + 3600000))
  const moved = (await fixture.adminRequest(`/planning?from=${today}`)).data.blocks.find((item) => item.resourceId === 'torno')
  assert.equal(moved.start, new Date(slot + 3600000).toISOString())

  // A click on the block opens it.
  await torno.locator('.planning-block').first().click()
  await page.getByRole('dialog', { name: 'Bloco do planejamento' }).getByRole('button', { name: 'Cancelar' }).click()

  // Week and month.
  await page.getByRole('group', { name: 'Período' }).getByRole('button', { name: 'Semana' }).click()
  await page.getByRole('heading', { name: 'Semana por máquina' }).waitFor()
  // The moved block runs from one to three hours from now: late in the evening part of it falls on the next day.
  const todayMinutes = Math.max(0, Math.min(slot + 3 * 3600000, dayStart(today) + 86400000) - (slot + 3600000)) / 60000
  const weekText = `${Math.floor(todayMinutes / 60) ? `${Math.floor(todayMinutes / 60)}h${todayMinutes % 60 ? String(todayMinutes % 60).padStart(2, '0') : ''}` : `${todayMinutes}min`} · ${Math.round(todayMinutes / 1440 * 100)}%`
  if (todayMinutes) assert.match(await page.locator('.planning-week tbody tr').filter({ hasText: 'Torno 01' }).innerText(), new RegExp(weekText))
  await page.screenshot({ path: 'test-results/planning/semana.png', fullPage: true })
  await page.getByRole('group', { name: 'Período' }).getByRole('button', { name: 'Mês' }).click()
  await page.getByRole('heading', { name: 'Calendário do mês' }).waitFor()
  const day = page.locator('.planning-day--today')
  for (const name of ['Usinagem', 'Caldeiraria', 'atraso']) assert.match(await day.innerText(), new RegExp(name))
  await page.screenshot({ path: 'test-results/planning/mes.png', fullPage: true })
  await day.click()
  await page.getByRole('heading', { name: 'Agenda por máquina' }).waitFor()

  // Dark modes and the phone width.
  for (const tone of ['dark', 'black']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = 'dark'; if (value === 'black') document.documentElement.dataset.tone = 'black' }, tone)
    await page.screenshot({ path: `test-results/planning/dia-${tone}.png`, fullPage: true })
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; delete document.documentElement.dataset.tone })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: no page overflow')
  await page.screenshot({ path: 'test-results/planning/celular.png', fullPage: true })

  // The tablet: Ana (Usinagem) sees the Torno block first; a tap opens the OS with the stage and the machine chosen.
  await tabletContext.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
  await tablet.goto(fixture.url)
  await enterOperatorCode(tablet, ana.accessCode)
  const plan = tablet.getByRole('region', { name: /Planejado para você/ })
  await plan.getByText(`${order.code} · Tornearia`).waitFor()
  assert.match(await plan.innerText(), /Usinagem/)
  assert.doesNotMatch(await plan.innerText(), /Corte a plasma/, 'the Plasma is Caldeiraria')
  await tablet.screenshot({ path: 'test-results/planning/tablet.png' })
  await plan.getByRole('button', { name: new RegExp(`${order.code} · Tornearia`) }).click()
  await tablet.locator('.operator-steps').getByText('Máquina: Torno 01').waitFor()
  assert.match(await tablet.locator('.operator-step--resource').innerText(), /Tornearia/)
  assert.deepEqual(errors, [])
  console.log('Planning passed: day agenda with live status and maintenance, snapshot of a moment, planning from the list with the machine clash, drag to move, week, month, dark modes, phone, and the sector queue on the tablet.')
} catch (error) {
  await page.screenshot({ path: 'test-results/planning/falha.png', fullPage: true }).catch(() => {})
  await tablet.screenshot({ path: 'test-results/planning/falha-tablet.png' }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await fixture.close()
}
