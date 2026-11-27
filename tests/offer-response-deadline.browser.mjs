import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'
import { responseDateLabel } from '../server/offerResponseRules.js'

// TCK-0012: "Prazo para resposta do cliente (dias)" on the manual offer (with the day it gives), in Ver oferta and in
// Editar; the "Resposta até" column, sortable, with "em N dias" / "vence hoje" / "vencido há N dias"; the notice in the
// bell opens the offer; the notices in Configurações › Notificações › Comercial. Fictitious data only.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
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
const row = (page, service) => page.locator('.offers-table-row:not(.offers-table-header)').filter({ hasText: service })

try {
  // The list: a deadline near, one passed (a retroactive offer), one with no deadline and a refused one.
  const soon = await create({ service: 'Eixo resposta perto', responseDays: 2 })
  const late = await create({ service: 'Eixo resposta vencido', requestedAt: shiftDay(today, -20), deadline: shiftDay(today, 5), responseDays: 5 })
  await create({ service: 'Eixo resposta sem prazo' })
  const refused = await create({ service: 'Eixo resposta recusado', responseDays: 4 })
  assert.equal((await fixture.adminRequest(`/offers/${refused.id}/reject`, 'POST', {})).status, 200)
  // The 1º aviso (3 days before) of this one comes today at 07:30; it was set the day before.
  const noticed = await create({ service: 'Eixo resposta aviso', responseDays: 3 })
  await fixture.mutateStore((store) => { store.offers.find((item) => item.id === noticed.id).responseSetAt = `${shiftDay(today, -1)}T15:00:00.000Z` })
  const sent = await fixture.offerResponseSweep(Date.parse(`${today}T07:30:00-03:00`))
  assert.ok(sent.some((id) => id.startsWith(`offer-response:${noticed.id}:`) && id.includes(':first:')), JSON.stringify(sent))

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signIn(page)
  await openOffers(page)

  // The form: the day it gives beside the field, a wrong number says so; empty explains.
  await page.getByRole('button', { name: 'Inserir Oferta Manualmente', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Inserir oferta manualmente' })
  await form.getByLabel('CNPJ/CPF *', { exact: true }).fill('12345678000190')
  await form.getByLabel('Empresa *', { exact: true }).fill('Cliente fictício')
  await form.getByLabel('Peça/Serviço *', { exact: true }).fill('Eixo resposta novo')
  await form.getByLabel('Quantidade *', { exact: true }).fill('4')
  await form.getByLabel('Descrição do serviço *', { exact: true }).fill('Usinar eixo de teste')
  const days = form.getByLabel('Prazo para resposta do cliente (dias)', { exact: true })
  const hint = form.locator('.offer-response-field small')
  assert.equal(await days.getAttribute('placeholder'), 'Opcional')
  assert.match(await hint.innerText(), /Em branco: sem prazo e sem avisos/)
  await days.fill('400')
  await hint.getByText('Informe de 1 a 365 dias.', { exact: true }).waitFor()
  await days.fill('10')
  await hint.getByText(`Resposta até ${responseDateLabel(shiftDay(today, 10))}`, { exact: true }).waitFor()
  await page.screenshot({ path: 'test-results/offer-response-form-1440.png' })
  await form.getByRole('button', { name: 'Adicionar solicitação', exact: true }).click()
  await form.waitFor({ state: 'detached' })

  // Ver oferta: "10 dias · até ..." with the badge.
  const detail = page.locator('.offer-response-detail')
  await detail.getByText(`10 dias · até ${responseDateLabel(shiftDay(today, 10))}`).waitFor()
  assert.equal(await detail.locator('.offer-response-badge--ok').innerText(), 'em 10 dias')
  const created = (await fixture.adminRequest('/offers')).data.items.find((item) => item.service === 'Eixo resposta novo')
  assert.deepEqual([created.responseDays, created.responseDeadline], [10, shiftDay(today, 10)])

  // Editar: the field comes filled; a new number moves the day.
  await page.locator('.offer-information-heading').getByRole('button', { name: 'Editar', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Editar informações do serviço' })
  const editDays = edit.getByLabel('Prazo para resposta do cliente (dias)', { exact: true })
  assert.equal(await editDays.inputValue(), '10')
  await editDays.fill('12')
  await edit.getByText(`Resposta até ${responseDateLabel(shiftDay(today, 12))}`, { exact: true }).waitFor()
  await edit.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await edit.waitFor({ state: 'detached' })
  await detail.getByText(`12 dias · até ${responseDateLabel(shiftDay(today, 12))}`).waitFor()

  // The list: the column with the badges; sorted, the nearest day first and the offers without one last.
  await page.getByRole('button', { name: 'Voltar para ofertas', exact: true }).click()
  await page.locator('.offers-table-header').getByText('Resposta até', { exact: true }).waitFor()
  assert.match(await row(page, 'Eixo resposta perto').locator('.offer-response-cell').innerText(), new RegExp(`${br(soon.responseDeadline)}\\s+em 2 dias`))
  assert.equal(await row(page, 'Eixo resposta perto').locator('.offer-response-badge--soon').count(), 1)
  assert.equal(await row(page, 'Eixo resposta vencido').locator('.offer-response-badge--late').innerText(), 'vencido há 15 dias')
  assert.equal(late.responseDeadline, shiftDay(today, -15))
  assert.equal(await row(page, 'Eixo resposta sem prazo').locator('[data-label="Resposta até"]').innerText(), '—')
  await page.screenshot({ path: 'test-results/offer-response-list-1440.png' })
  const header = page.locator('.offers-table-header [role="columnheader"]').filter({ hasText: 'Resposta até' })
  await header.getByRole('button').click()
  assert.equal(await header.getAttribute('aria-sort'), 'ascending')
  const order = async () => (await page.locator('.offers-table-row:not(.offers-table-header) .offer-piece').allInnerTexts()).map((text) => text.toLocaleLowerCase('pt-BR')).filter((text) => text.includes('eixo resposta'))
  const sorted = await order()
  const position = (name) => sorted.findIndex((text) => text.includes(name))
  assert.ok(position('vencido') < position('perto') && position('perto') < position('aviso') && position('aviso') < position('novo') && position('novo') < position('sem prazo'), JSON.stringify(sorted))

  // The bell: the notice opens the offer.
  await page.reload()
  await page.getByRole('button', { name: 'Notificações', exact: true }).click()
  const popup = page.getByRole('dialog', { name: 'Notificações', exact: true })
  const notice = popup.getByRole('button').filter({ hasText: 'Prazo de resposta do cliente' })
  assert.match(await notice.innerText(), new RegExp(`${noticed.code} · Teste de fluxo: faltam 3 dias para o cliente responder a proposta`, 'i'))
  await page.screenshot({ path: 'test-results/offer-response-bell-1440.png' })
  await notice.click()
  await page.locator('.offer-details-header').getByText(noticed.code).waitFor()
  await page.locator('.offer-response-detail').getByText(`3 dias · até ${responseDateLabel(noticed.responseDeadline)}`).waitFor()

  // Configurações › Notificações › Comercial: days before beside each switch, saved as they change.
  await page.locator('.sidebar').getByRole('button', { name: 'Configurações', exact: true }).click()
  await page.locator('.account-settings-menu').getByRole('button', { name: /^Notificações/ }).click()
  const first = page.getByLabel('1º aviso: dias antes do prazo', { exact: true })
  const second = page.getByLabel('2º aviso: dias antes do prazo', { exact: true })
  assert.deepEqual([await first.inputValue(), await second.inputValue()], ['3', '1'])
  assert.equal(await first.locator('option').count(), 30)
  const patched = () => page.waitForResponse((response) => response.url().endsWith('/api/account/notifications') && response.request().method() === 'PATCH')
  let saved = patched()
  await second.selectOption('3')
  assert.equal((await saved).status(), 200)
  await page.getByText('Mesmo número de dias do 1º aviso: chega um aviso só.', { exact: true }).waitFor()
  saved = patched()
  await page.getByRole('switch', { name: '1º aviso do prazo de resposta', exact: true }).click()
  assert.equal((await saved).status(), 200)
  assert.equal(await first.isDisabled(), true, 'the days of a notice turned off are not chosen')
  assert.equal(await page.getByText('Mesmo número de dias do 1º aviso: chega um aviso só.', { exact: true }).count(), 0)
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const settings = (await fixture.request('/account/notifications', 'GET', undefined, { Authorization: `Bearer ${token}` })).data.settings
  assert.deepEqual([settings.offerResponseFirst, settings.offerResponseFirstDays, settings.offerResponseSecondDays], [false, 3, 3])
  // The switches stay in one column on the right of the card, like the others.
  const card = page.locator('.account-settings-section').filter({ has: page.getByRole('switch', { name: '1º aviso do prazo de resposta', exact: true }) }).first()
  const rights = await card.getByRole('switch').evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().right)))
  assert.ok(Math.max(...rights) - Math.min(...rights) <= 1, JSON.stringify(rights))
  await card.screenshot({ path: 'test-results/offer-response-settings-1440.png' })
  await page.close()
  assert.deepEqual(errors, [])

  // Layouts: no cell over another, the column readable, nothing out of the screen.
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1600, height: 900 }, { width: 1366, height: 768 }, { width: 1004, height: 628 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    const view = await browser.newPage({ viewport })
    await signIn(view)
    await openOffers(view)
    const report = await view.evaluate(() => {
      const rows = [...document.querySelectorAll('.offers-table-row:not(.offers-table-header)')].filter((item) => /eixo resposta/i.test(item.textContent))
      const overlaps = []
      for (const item of rows) {
        const cells = [...item.children].filter((cell) => getComputedStyle(cell).display !== 'none').map((cell) => [cell.dataset.label || cell.className, cell.getBoundingClientRect()])
        for (let a = 0; a < cells.length; a += 1) for (let b = a + 1; b < cells.length; b += 1) {
          const [one, x] = cells[a], [two, y] = cells[b]
          if (x.width && y.width && x.left < y.right - 1 && y.left < x.right - 1 && x.top < y.bottom - 1 && y.top < x.bottom - 1) overlaps.push(`${one} × ${two}`)
        }
      }
      const response = rows.map((item) => item.querySelector('[data-label="Resposta até"]')).filter(Boolean)
      return { overlaps, scroll: document.documentElement.scrollWidth - window.innerWidth, narrowest: Math.min(...response.map((cell) => cell.getBoundingClientRect().width)), badges: [...document.querySelectorAll('.offer-response-badge')].map((badge) => badge.scrollWidth - badge.clientWidth) }
    })
    assert.deepEqual(report.overlaps, [], `${viewport.width}: ${report.overlaps.join(', ')}`)
    assert.ok(report.scroll <= 0, `${viewport.width}: the page runs ${report.scroll}px off the screen`)
    await view.screenshot({ path: `test-results/offer-response-list-${viewport.width}.png` })
    assert.ok(report.narrowest >= 80, `${viewport.width}: Resposta até is ${report.narrowest}px wide`)
    assert.ok(report.badges.every((extra) => extra <= 0), `${viewport.width}: a badge is cut`)
    await view.screenshot({ path: `test-results/offer-response-list-${viewport.width}.png` })
    await view.close()
  }
  console.log('offer response deadline browser test passed')
} finally {
  await browser.close()
  await fixture.close()
}
