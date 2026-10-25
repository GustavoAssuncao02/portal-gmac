import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { typeOperatorCode, openOrder, stagePlans } from './operatorEntry.js'

// The production panels are 2560x1600 Android tablets (12.8"). Chrome shows them at 2x (1280x800) or, on some, 1.75x (1463x914); at 100% scale the operator
// screen is enlarged 1.4x. Every step of the operator flow must fit the width, keep its text readable and its buttons
// big enough for a finger.
const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
await mkdir('test-results/operator-2560', { recursive: true })
const errors = []

async function check(page, label, { zoom }) {
  const found = await page.evaluate(() => {
    const zoom = Number(getComputedStyle(document.querySelector('.operator-app')).zoom) || 1
    const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 }
    // Text size as it reaches the screen, in CSS pixels of the page (the zoom included).
    const tiny = [...document.querySelectorAll('.operator-app *')].filter((element) => visible(element) && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()) && parseFloat(getComputedStyle(element).fontSize) * zoom < 11)
      .map((element) => `${element.className || element.tagName} ${getComputedStyle(element).fontSize}: ${element.textContent.trim().slice(0, 30)}`)
    const small = [...document.querySelectorAll('.operator-app button')].filter(visible).map((element) => [element.textContent.trim().slice(0, 30) || element.getAttribute('aria-label'), element.getBoundingClientRect()])
      .filter(([, box]) => box.height < 44 || box.width < 44).map(([name, box]) => `${name} ${Math.round(box.width)}x${Math.round(box.height)}`)
    return { zoom, overflow: document.documentElement.scrollWidth > innerWidth, tiny, small }
  })
  await page.screenshot({ path: `test-results/operator-2560/${label}.png` })
  assert.equal(found.zoom, zoom, `${label}: zoom`)
  assert.equal(found.overflow, false, `${label}: page overflow`)
  assert.deepEqual(found.tiny, [], `${label}: text below 11px`)
  assert.deepEqual(found.small, [], `${label}: touch targets below 44px`)
}

try {
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno CNC 01', sector: 'Usinagem' }, { id: 'fresa', name: 'Fresadora 02', sector: 'Usinagem' }, { id: 'serra', name: 'Serra fita 03', sector: 'Usinagem' }] })
  const people = {
    monitor: (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Paula Teste', cpf: '00000000001' })).data.item,
    tablet: (await fixture.adminRequest('/employees', 'POST', { name: 'Bruno Teste', cpf: '00000000002' })).data.item,
    'tablet-175': (await fixture.adminRequest('/employees', 'POST', { name: 'Carla Teste', cpf: '00000000003' })).data.item,
  }
  // The three screens work on the same stage at once: it is planned on a labor service, which is shared.
  const shared = { type: 'labor-service', id: (await fixture.adminRequest('/labor-services')).data.items[0].id }
  for (const [service, stages] of [['Eixo de transmissão usinado', ['cutting', 'turning', 'machining', 'welding', 'painting', 'assembly']], ['Suporte soldado para esteira', ['welding', 'painting']]]) {
    const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service, company: 'Metalúrgica Cliente Exemplo Ltda' })).data.item
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages, stageResources: stagePlans(stages, shared) })
    await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
    await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')
  }
  for (const [name, width, height, scale, zoom] of [['monitor', 2560, 1600, 1, 1.4], ['tablet', 1280, 800, 2, 1], ['tablet-175', 1463, 914, 1.75, 1]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, hasTouch: scale > 1, timezoneId: 'America/Bahia' })
    await context.addInitScript((token) => sessionStorage.setItem('gmac-operator-token', token), fixture.operatorToken)
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(fixture.url)
    await page.getByRole('button', { name: 'Entrar', exact: true }).waitFor()
    await check(page, `${name}-1-entrada`, { zoom })
    if (name === 'monitor') assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), height, 'the enlarged screen still fills exactly one screen height')
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    const keypad = page.locator('.operator-entry-card--keypad')
    await keypad.waitFor()
    await check(page, `${name}-2-teclado`, { zoom })
    const box = await keypad.boundingBox()
    assert.ok(box.y >= 0 && box.y + box.height <= height, `${name}: the whole keypad is in view`)
    await typeOperatorCode(page, people[name].accessCode)
    await page.locator('.operator-project').first().waitFor()
    await check(page, `${name}-3-lista`, { zoom })
    await openOrder(page, 'Eixo de transmissão')
    await check(page, `${name}-4-os`, { zoom })
    await page.getByRole('button', { name: /Selecionar etapa/ }).click()
    await page.getByRole('region', { name: 'Etapas', exact: true }).waitFor()
    await check(page, `${name}-5-etapas`, { zoom })
    await page.getByRole('region', { name: 'Etapas', exact: true }).locator('.operator-picker-option--current').click()
    await page.locator('.operator-steps').waitFor()
    await page.getByRole('button', { name: /Iniciar trabalho/ }).click()
    await page.getByRole('button', { name: /^Pausar trabalho/ }).waitFor()
    await check(page, `${name}-7-trabalhando`, { zoom })
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('Operator 2560x1600 passed: tablet at 2x and 1.75x, panel at 100% (enlarged 1.4x), entry, keypad in view, list, OS, stage picker and running work, with no overflow, text from 11px and 44px touch targets.')
} finally {
  await browser.close()
  await fixture.close()
}
