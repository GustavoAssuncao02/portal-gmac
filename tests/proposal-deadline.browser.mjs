import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'
import { deadlineDateLabel } from '../server/proposalDeadlineRules.js'

// TCK-0012 (revised 2026-11-27): "Prazo para enviar a proposta" on the manual offer (+3/+7 dias, Limpar), in Ver oferta and
// in Editar; the column "Proposta até" with "amanhã" / "vence hoje" / "atrasada há N dias" and the row highlighted; the
// urgent offers at the top; the filters Em aberto (the untaken site offers too) … Prazo vencendo, no "Site"; the notice in
// the bell opens the offer; the notices in Configurações (on by default for the CPF of the environment); the widget
// "Propostas com prazo próximo". Fictitious data only.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const cpfsBefore = process.env.PROPOSAL_DEADLINE_NOTICE_CPFS
process.env.PROPOSAL_DEADLINE_NOTICE_CPFS = env.DEMO_ADMIN_CPF
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
await mkdir('test-results', { recursive: true })
const today = todayBahia()
const shiftDay = (day, days) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const br = (day) => day.split('-').reverse().join('/')
const create = async (fields) => {
  const result = await fixture.adminRequest('/offers', 'POST', { ...offerDraft, deadline: shiftDay(today, 30), ...fields })
  assert.equal(result.status, 201, JSON.stringify(result.data))
  return result.data.item
}
async function signIn(page) {
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
}
async function openOffers(page) {
  const menu = page.getByRole('button', { name: 'Abrir menu de navegação', exact: true })
  if (await menu.isVisible()) await menu.click()
  await page.locator('.sidebar').getByRole('button', { name: 'Ofertas e serviços', exact: true }).click()
  await page.locator('.offers-table-row:not(.offers-table-header)').first().waitFor()
}
const rows = (page) => page.locator('.offers-table-row:not(.offers-table-header)')
const row = (page, service) => rows(page).filter({ hasText: service })
const pieces = async (page) => (await rows(page).locator('.offer-piece').allInnerTexts()).map((text) => text.split(/\n/)[0].trim().toLocaleLowerCase('pt-BR'))

try {
  // The list: late (a retroactive offer), due today, tomorrow, far away, none, a proposal already generated (stopped)
  // and a site offer nobody took over.
  const far = await create({ service: 'Eixo prazo longe', proposalDeadline: shiftDay(today, 10) })
  await create({ service: 'Eixo prazo sem data' })
  const soon = await create({ service: 'Eixo prazo amanhã', proposalDeadline: shiftDay(today, 1) })
  const due = await create({ service: 'Eixo prazo hoje', proposalDeadline: today })
  const late = await create({ service: 'Eixo prazo atrasado', requestedAt: shiftDay(today, -20), deadline: shiftDay(today, 5), proposalDeadline: shiftDay(today, -3) })
  const proposed = await create({ service: 'Eixo prazo com proposta', requestedAt: shiftDay(today, -10), proposalDeadline: shiftDay(today, -1) })
  const site = await create({ service: 'Eixo prazo do site' })
  await fixture.mutateStore((store) => {
    store.offers.find((item) => item.id === proposed.id).status = 'proposed'
    const fromSite = store.offers.find((item) => item.id === site.id)
    // The fixture finishes the manual offers: a site offer waits as "creating" with nobody in charge.
    Object.assign(fromSite, { origin: 'Site', status: 'creating' })
    delete fromSite.editingBy
  })
  // The 1º aviso (3 days before) of this one and the notice of the day of the other come today at 07:30: both set the
  // day before.
  const noticed = await create({ service: 'Eixo prazo aviso', proposalDeadline: shiftDay(today, 3) })
  await fixture.mutateStore((store) => { for (const id of [noticed.id, due.id]) store.offers.find((item) => item.id === id).proposalDeadlineSetAt = `${shiftDay(today, -1)}T15:00:00.000Z` })
  const sent = await fixture.proposalDeadlineSweep(Date.parse(`${today}T07:30:00-03:00`))
  assert.ok(sent.some((id) => id.startsWith(`proposal-deadline:${noticed.id}:0:first:`)), JSON.stringify(sent))
  assert.ok(sent.some((id) => id.startsWith(`proposal-deadline:${due.id}:0:due:`)), 'on by default for the CPF of the environment')

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signIn(page)
  await openOffers(page)

  // The filters: Em aberto first (the site offer counted), no "Site", Prazo vencendo last (2 days before to late).
  const chips = page.locator('.offer-filter')
  assert.deepEqual(await chips.locator('span').allInnerTexts(), ['Em aberto', 'Em análise', 'Propostas', 'Aceitas', 'Recusadas', 'Prazo vencendo'])
  assert.equal(await page.locator('.offer-filter--new strong').innerText(), '1')
  assert.equal(await page.locator('.offer-filter--late strong').innerText(), '3')

  // The default order: late, today, tomorrow first; then the others as before. Highlight and badge on each.
  const order = (await pieces(page)).filter((text) => text.includes('eixo prazo'))
  assert.deepEqual(order.slice(0, 3), ['eixo prazo atrasado', 'eixo prazo hoje', 'eixo prazo amanhã'], JSON.stringify(order))
  assert.equal(await row(page, 'Eixo prazo atrasado').getAttribute('class'), 'offers-table-row offers-table-row--deadline-late')
  assert.equal(await row(page, 'Eixo prazo hoje').getAttribute('class'), 'offers-table-row offers-table-row--deadline-today')
  assert.equal(await row(page, 'Eixo prazo amanhã').getAttribute('class'), 'offers-table-row offers-table-row--deadline-soon')
  assert.equal(await row(page, 'Eixo prazo longe').getAttribute('class'), 'offers-table-row')
  assert.equal(await row(page, 'Eixo prazo atrasado').locator('.offer-response-badge--late').innerText(), 'atrasada há 3 dias')
  assert.equal(await row(page, 'Eixo prazo hoje').locator('.offer-response-badge--today').innerText(), 'vence hoje')
  assert.match(await row(page, 'Eixo prazo amanhã').locator('[data-label="Proposta até"]').innerText(), new RegExp(`${br(soon.proposalDeadline)}\\s+amanhã`))
  assert.equal(await row(page, 'Eixo prazo longe').locator('[data-label="Proposta até"]').innerText(), br(far.proposalDeadline))
  assert.equal(await row(page, 'Eixo prazo sem data').locator('[data-label="Proposta até"]').innerText(), '—')
  assert.equal(await row(page, 'Eixo prazo com proposta').locator('.offer-response-badge').count(), 0, 'the proposal stopped it')
  assert.equal(await row(page, 'Eixo prazo com proposta').getAttribute('class'), 'offers-table-row')
  await page.screenshot({ path: 'test-results/proposal-deadline-list-1440.png' })

  // A title chosen orders by it: Proposta até, the nearest first and the offers without one last.
  const header = page.locator('.offers-table-header [role="columnheader"]').filter({ hasText: 'Proposta até' })
  await header.getByRole('button').click()
  assert.equal(await header.getAttribute('aria-sort'), 'ascending')
  const sorted = (await pieces(page)).filter((text) => text.includes('eixo prazo'))
  assert.deepEqual(sorted.slice(0, 4), ['eixo prazo atrasado', 'eixo prazo com proposta', 'eixo prazo hoje', 'eixo prazo amanhã'], JSON.stringify(sorted))
  await header.getByRole('button').click()
  await header.getByRole('button').click()

  // Prazo vencendo: from 2 days before to late (not the ones 3 and 10 days away); Em aberto: the site offer.
  await page.locator('.offer-filter--late').click()
  assert.deepEqual((await pieces(page)).sort(), ['eixo prazo amanhã', 'eixo prazo atrasado', 'eixo prazo hoje'])
  await page.locator('.offer-filter--new').click()
  assert.deepEqual(await pieces(page), ['eixo prazo do site'])
  await page.locator('.offer-filter--new').click()

  // The form: shortcuts from today, Limpar, a day before the request says so.
  await page.getByRole('button', { name: 'Inserir Oferta Manualmente', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Inserir oferta manualmente' })
  await form.getByLabel('CNPJ/CPF *', { exact: true }).fill('12345678000190')
  await form.getByLabel('Empresa *', { exact: true }).fill('Cliente fictício')
  await form.getByLabel('Peça/Serviço *', { exact: true }).fill('Eixo prazo novo')
  await form.getByLabel('Quantidade *', { exact: true }).fill('4')
  await form.getByLabel('Descrição do serviço *', { exact: true }).fill('Usinar eixo de teste')
  const field = form.getByLabel('Prazo para enviar a proposta', { exact: true })
  const hint = form.locator('.offer-response-field small')
  assert.match(await hint.innerText(), /Em branco, sem prazo e sem avisos/)
  assert.equal(await form.getByRole('button', { name: 'Limpar', exact: true }).count(), 0)
  await form.getByRole('button', { name: '+7 dias', exact: true }).click()
  assert.equal(await field.inputValue(), shiftDay(today, 7))
  await hint.getByText(`Enviar até ${deadlineDateLabel(shiftDay(today, 7))} · em 7 dias`, { exact: true }).waitFor()
  await form.getByRole('button', { name: 'Limpar', exact: true }).click()
  assert.equal(await field.inputValue(), '')
  await field.fill(shiftDay(today, -1))
  await hint.getByText('Escolha uma data a partir da data da solicitação.', { exact: true }).waitFor()
  await form.getByRole('button', { name: '+3 dias', exact: true }).click()
  await hint.getByText(`Enviar até ${deadlineDateLabel(shiftDay(today, 3))} · em 3 dias`, { exact: true }).waitFor()
  await page.screenshot({ path: 'test-results/proposal-deadline-form-1440.png' })
  await form.getByRole('button', { name: 'Adicionar solicitação', exact: true }).click()
  await form.waitFor({ state: 'detached' })

  // Ver oferta: the day, without a badge while it is 3 days away.
  const detail = page.locator('.offer-response-detail')
  await detail.getByText(`até ${deadlineDateLabel(shiftDay(today, 3))}`).waitFor()
  assert.equal(await detail.locator('h3').textContent(), 'Prazo para enviar a proposta')
  assert.equal(await detail.locator('.offer-response-badge').count(), 0)
  const created = (await fixture.adminRequest('/offers')).data.items.find((item) => item.service === 'Eixo prazo novo')
  assert.equal(created.proposalDeadline, shiftDay(today, 3))

  // Editar: the field comes filled; tomorrow gives the badge.
  await page.locator('.offer-information-heading').getByRole('button', { name: 'Editar', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Editar informações do serviço' })
  const editField = edit.getByLabel('Prazo para enviar a proposta', { exact: true })
  assert.equal(await editField.inputValue(), shiftDay(today, 3))
  await editField.fill(shiftDay(today, 1))
  await edit.getByText(`Enviar até ${deadlineDateLabel(shiftDay(today, 1))} · amanhã`, { exact: true }).waitFor()
  await edit.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await edit.waitFor({ state: 'detached' })
  await detail.locator('.offer-response-badge--soon').getByText('amanhã', { exact: true }).waitFor()

  // The bell: the notice opens the offer.
  await page.reload()
  await page.getByRole('button', { name: 'Notificações', exact: true }).click()
  const popup = page.getByRole('dialog', { name: 'Notificações', exact: true })
  const notice = popup.getByRole('button').filter({ hasText: `${noticed.code} · Teste de fluxo: faltam 3 dias para enviar a proposta` })
  await notice.waitFor()
  assert.equal(await popup.getByRole('button').filter({ hasText: 'Prazo da proposta vence hoje' }).count(), 1)
  await page.screenshot({ path: 'test-results/proposal-deadline-bell-1440.png' })
  await notice.click()
  await page.locator('.offer-details-header').getByText(noticed.code).waitFor()
  await page.locator('.offer-response-detail').getByText(`até ${deadlineDateLabel(noticed.proposalDeadline)}`).waitFor()

  // A generated proposal: Ver oferta says so instead of the badge.
  await page.getByRole('button', { name: 'Voltar para ofertas', exact: true }).click()
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent('gmac-offer-open', { detail: id })), proposed.id)
  await page.locator('.offer-details-header').getByText(proposed.code).waitFor()
  await page.locator('.offer-response-detail .offer-response-answered').getByText('Proposta gerada', { exact: true }).waitFor()

  // Configurações › Notificações › Comercial: on for the CPF of the environment, days before beside each switch.
  await page.locator('.sidebar').getByRole('button', { name: 'Configurações', exact: true }).click()
  await page.locator('.account-settings-menu').getByRole('button', { name: /^Notificações/ }).click()
  await page.getByRole('region', { name: 'Comercial' }).getByText('Prazo para enviar a proposta', { exact: true }).waitFor()
  const first = page.getByLabel('1º aviso: dias antes do prazo', { exact: true })
  const second = page.getByLabel('2º aviso: dias antes do prazo', { exact: true })
  assert.deepEqual([await first.inputValue(), await second.inputValue()], ['3', '1'])
  assert.equal(await first.locator('option').count(), 30)
  for (const name of ['1º aviso do prazo da proposta', '2º aviso do prazo da proposta', 'Avisar no dia do vencimento']) assert.equal(await page.getByRole('switch', { name, exact: true }).getAttribute('aria-checked'), 'true', name)
  const patched = () => page.waitForResponse((response) => response.url().endsWith('/api/account/notifications') && response.request().method() === 'PATCH')
  let saved = patched()
  await second.selectOption('3')
  assert.equal((await saved).status(), 200)
  await page.getByText('Mesmo número de dias do 1º aviso: chega um aviso só.', { exact: true }).waitFor()
  saved = patched()
  await page.getByRole('switch', { name: 'Avisar no dia do vencimento', exact: true }).click()
  assert.equal((await saved).status(), 200)
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const auth = { Authorization: `Bearer ${token}` }
  const settings = (await fixture.request('/account/notifications', 'GET', undefined, auth)).data.settings
  assert.deepEqual([settings.proposalDeadlineFirst, settings.proposalDeadlineSecondDays, settings.proposalDeadlineDueDay], [true, 3, false])
  const card = page.locator('.account-settings-section').filter({ has: page.getByRole('switch', { name: '1º aviso do prazo da proposta', exact: true }) }).first()
  const rights = await card.getByRole('switch').evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().right)))
  assert.ok(Math.max(...rights) - Math.min(...rights) <= 1, JSON.stringify(rights))
  await card.screenshot({ path: 'test-results/proposal-deadline-settings-1440.png' })

  // The widget (in the catalog only): the late one first and in red; a row opens the offer; Ver todas, Prazo vencendo.
  assert.equal((await fixture.request('/account/home-layout', 'PUT', { layout: [{ id: 'proposal-deadlines', w: 2, h: 2 }] }, auth)).status, 200)
  await page.locator('.sidebar').getByRole('button', { name: 'Início', exact: true }).click()
  const widget = page.locator('[data-widget="proposal-deadlines"]')
  await widget.getByRole('heading', { name: 'Propostas com prazo próximo', exact: true }).waitFor()
  const items = widget.locator('.home-rows li')
  assert.match(await items.first().innerText(), /Eixo prazo atrasado[\s\S]*atrasada há 3 dias/)
  assert.equal(await items.first().getAttribute('class'), 'home-rows-item--late')
  assert.equal(await widget.locator('.home-rows-item--late').count(), 1)
  assert.match(await items.nth(1).innerText(), /Eixo prazo hoje[\s\S]*vence hoje/)
  assert.equal(await widget.getByText('Eixo prazo com proposta').count(), 0)
  assert.match(await widget.locator('.home-card-heading div > span').innerText(), /^1 atrasada de \d+ ofertas$/)
  await widget.screenshot({ path: 'test-results/proposal-deadline-widget-1440.png' })
  await items.first().getByRole('button').click()
  await page.locator('.offer-details-header').getByText(late.code).waitFor()
  await page.locator('.sidebar').getByRole('button', { name: 'Início', exact: true }).click()
  await widget.getByRole('button', { name: 'Ver todas', exact: true }).click()
  await page.locator('.offer-filter--late.offer-filter--selected').waitFor()
  assert.deepEqual((await pieces(page)).sort(), ['eixo prazo amanhã', 'eixo prazo atrasado', 'eixo prazo hoje', 'eixo prazo novo'])
  await page.close()
  assert.deepEqual(errors, [])

  // Layouts: no cell over another, the column readable, nothing out of the screen.
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1600, height: 900 }, { width: 1366, height: 768 }, { width: 1004, height: 628 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    const view = await browser.newPage({ viewport })
    await signIn(view)
    await openOffers(view)
    await rows(view).filter({ hasText: 'Eixo prazo longe' }).waitFor()
    const report = await view.evaluate(() => {
      const list = [...document.querySelectorAll('.offers-table-row:not(.offers-table-header)')].filter((item) => /eixo prazo/i.test(item.textContent))
      const overlaps = []
      for (const item of list) {
        const cells = [...item.children].filter((cell) => getComputedStyle(cell).display !== 'none').map((cell) => [cell.dataset.label || cell.className, cell.getBoundingClientRect()])
        for (let a = 0; a < cells.length; a += 1) for (let b = a + 1; b < cells.length; b += 1) {
          const [one, x] = cells[a], [two, y] = cells[b]
          if (x.width && y.width && x.left < y.right - 1 && y.left < x.right - 1 && x.top < y.bottom - 1 && y.top < x.bottom - 1) overlaps.push(`${one} × ${two}`)
        }
      }
      const cells = list.map((item) => item.querySelector('[data-label="Proposta até"]')).filter(Boolean)
      return { overlaps, scroll: document.documentElement.scrollWidth - window.innerWidth, narrowest: Math.min(...cells.map((cell) => cell.getBoundingClientRect().width)), badges: [...document.querySelectorAll('.offer-response-badge')].map((badge) => badge.scrollWidth - badge.clientWidth) }
    })
    await view.screenshot({ path: `test-results/proposal-deadline-list-${viewport.width}.png` })
    assert.deepEqual(report.overlaps, [], `${viewport.width}: ${report.overlaps.join(', ')}`)
    assert.ok(report.scroll <= 0, `${viewport.width}: the page runs ${report.scroll}px off the screen`)
    assert.ok(report.narrowest >= 80, `${viewport.width}: Proposta até is ${report.narrowest}px wide`)
    assert.ok(report.badges.every((extra) => extra <= 0), `${viewport.width}: a badge is cut`)
    await view.close()
  }
  console.log('proposal deadline browser test passed')
} finally {
  await browser.close()
  await fixture.close()
  if (cpfsBefore === undefined) delete process.env.PROPOSAL_DEADLINE_NOTICE_CPFS
  else process.env.PROPOSAL_DEADLINE_NOTICE_CPFS = cpfsBefore
}
