import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { identifiedOperator } from './operatorEntry.js'
import { defaultStageLayout } from '../server/serviceStages.js'

// Usinagem, Caldeiraria and Pintura are told apart on the operator screen and in the project information: each group is a card
// with its own accent color, state and progress.
const fixture = await createWorkflowFixture()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const plain = (text) => text.replace(/\s+/g, ' ').trim()
try {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Projeto com tres processos' })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning', 'milling', 'painting', 'cut-bend', 'grinding'], stageLayout: defaultStageLayout() })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Carla Teste', birthDate: '1990-01-01', cpf: '00000000001', email: 'carla@example.invalid', identification: '001' }, fixture.admin)).data.item
  const started = (await fixture.request(`/operations/orders/${order.code}/start`, 'POST', { employeeId: employee.id }, { Authorization: `Bearer ${fixture.operatorToken}` })).data
  // Usinagem finished, Pintura half way, Caldeiraria not started.
  const counts = [10, 10, 5, 0, 0]
  await fixture.mutateStore((store) => {
    const operation = store.orders.find((item) => item.code === order.code).operation
    operation.stageCounts = Object.fromEntries(operation.stages.map((stage, index) => [stage.key, counts[index]]))
  })
  await context.addInitScript(({ token, code, session, operator }) => {
    sessionStorage.setItem('gmac-operator-token', token)
    sessionStorage.setItem(...operator)
    sessionStorage.setItem(`gmac-operator-session-${code}`, JSON.stringify(session))
  }, { token: fixture.operatorToken, operator: identifiedOperator(employee), code: order.code, session: { id: started.operation.activeSession.id, token: started.sessionToken } })
  await page.goto(fixture.url)
  await page.locator('.operator-project').filter({ hasText: order.service }).click()
  const group = (name) => page.getByRole('region', { name: `Etapas de ${name}`, exact: true })
  const toneOf = (locator) => locator.evaluate((element) => ({ line: getComputedStyle(element).borderLeftColor }))

  // Operator screen: a card per group, each with its own accent color, state and progress.
  await group('Usinagem').waitFor()
  const names = ['Usinagem', 'Pintura', 'Caldeiraria']
  assert.deepEqual(await page.locator('.operator-stage-group-heading h4').allTextContents(), names)
  const tones = await Promise.all(names.map((name) => toneOf(group(name))))
  assert.equal(new Set(tones.map((tone) => tone.line)).size, 3, 'three different group colors')
  assert.deepEqual(await Promise.all(names.map(async (name) => plain(await group(name).locator('.stage-group-state').innerText()))), ['Concluída', 'Em andamento', 'Não iniciada'])
  assert.deepEqual(await Promise.all(names.map((name) => group(name).locator('.stage-group-bar').getAttribute('aria-valuenow'))), ['20', '5', '0'])
  assert.deepEqual(await Promise.all(names.map((name) => group(name).locator('.stage-group-bar i').evaluate((bar) => Math.round(bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width * 100)))), [100, 50, 0])
  // A group with a single stage (Pintura) uses the whole width of its card, with no empty space beside the stage.
  const filled = async (cardSelector, itemSelector) => page.locator(cardSelector).filter({ has: page.getByRole('heading', { name: 'Pintura', exact: true }) }).evaluate((card, selector) => { const item = card.querySelector(selector).getBoundingClientRect(), box = card.getBoundingClientRect(); return box.right - item.right }, itemSelector)
  assert.ok(await filled('.operator-stage-group', '.operator-stage') < 40, 'operator screen: the single stage fills its card')
  await page.screenshot({ path: 'test-results/operator-stage-info-operator.png', fullPage: true })

  // Project information: the same groups, read only.
  await page.getByRole('button', { name: 'Visualizar informações do projeto', exact: true }).click()
  await page.getByRole('heading', { name: 'Informações do projeto', exact: true }).waitFor()
  const info = page.locator('.operator-project-info')
  const section = (name) => info.getByRole('region', { name: `Etapas de ${name}`, exact: true })
  assert.deepEqual(await info.locator('.operator-info-stage-heading h4').allTextContents(), names)
  assert.deepEqual(await Promise.all(names.map(async (name) => plain(await section(name).locator('.stage-group-state').innerText()))), ['Concluída', 'Em andamento', 'Não iniciada'])
  assert.deepEqual(await Promise.all(names.map(async (name) => plain(await section(name).locator('.stage-group-count').innerText()))), ['20/20 passagens', '5/10 passagens', '0/20 passagens'])
  assert.deepEqual(await section('Usinagem').locator('.operator-info-stage-list li').evaluateAll((items) => items.map((item) => item.innerText.replace(/\s+/g, ' ').trim())), ['1 Tornearia 10/10 peças', '2 Freza 10/10 peças'])
  assert.deepEqual(await section('Pintura').locator('.operator-info-stage-list li').evaluateAll((items) => items.map((item) => item.innerText.replace(/\s+/g, ' ').trim())), ['3 Pintura 5/10 peças'])
  assert.deepEqual(await section('Caldeiraria').locator('.operator-info-stage-list li').evaluateAll((items) => items.map((item) => item.innerText.replace(/\s+/g, ' ').trim())), ['4 Corte e dobra 0/10 peças', '5 Esmirilhamento 0/10 peças'])
  const infoTones = await Promise.all(names.map((name) => section(name).evaluate((element) => getComputedStyle(element).borderLeftColor)))
  assert.deepEqual(infoTones, tones.map((tone) => tone.line), 'the project information uses the same colors')
  assert.ok(await filled('.operator-info-stage-group', '.operator-info-stage-list li') < 40, 'project information: the single stage fills its card')
  await page.screenshot({ path: 'test-results/operator-stage-info-information.png', fullPage: true })
  for (const [width, height] of [[1024, 800], [768, 900], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no page overflow`)
    assert.ok(await info.locator('.operator-info-stage-group').evaluateAll((items) => items.every((item) => item.scrollWidth <= item.clientWidth)), `${width}: groups fit`)
    await info.locator('.operator-info-stage-groups').screenshot({ path: `test-results/operator-stage-info-${width}.png` })
  }
  // A project with every stage: the groups share the width of the screen and the stages wrap into rows, without scrolling.
  const all = ['turning', 'milling', 'planing', 'cnc-turning', 'machining-center', 'assembly', 'disassembly', 'painting', 'cut-bend', 'torch-cut', 'plasma-cut', 'grinding', 'structural-assembly', 'mechanical-assembly']
  const bigOffer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'Projeto com todas as etapas' })).data.item
  await fixture.adminRequest(`/offers/${bigOffer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: all, stageLayout: defaultStageLayout() })
  await fixture.adminRequest(`/offers/${bigOffer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } })
  const bigOrder = (await fixture.adminRequest(`/offers/${bigOffer.id}/accept`, 'POST')).data.item
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.getByRole('button', { name: 'Voltar aos projetos', exact: true }).click()
  await page.getByRole('button', { name: '← Voltar para as OS', exact: true }).click()
  await page.locator('.operator-project').filter({ hasText: bigOrder.service }).click()
  await page.locator('.operator-stage-groups').waitFor()
  const boxes = (selector) => page.locator(selector).evaluateAll((items) => items.map((item) => { const box = item.getBoundingClientRect(); return { top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width) } }))
  const noScroll = () => page.locator('.operator-stages').evaluateAll((items) => items.every((item) => item.scrollWidth <= item.clientWidth))
  let groups = await boxes('.operator-stage-group')
  assert.equal(new Set(groups.map((box) => box.top)).size, 1, '1920: the three groups share one row')
  assert.ok(groups.every((box) => box.width > 440), '1920: each group has room for its stages')
  assert.ok(await noScroll(), '1920: stages wrap, no horizontal scroll')
  await page.screenshot({ path: 'test-results/operator-stage-layout-1920.png' })
  await page.setViewportSize({ width: 1366, height: 900 })
  groups = await boxes('.operator-stage-group')
  assert.equal(groups[0].top, groups[1].top, '1366: Usinagem and Pintura side by side')
  assert.ok(groups[2].top > groups[0].top && groups[2].width > groups[0].width + groups[1].width - 40, '1366: Caldeiraria alone in its row takes all of it')
  assert.ok(await noScroll(), '1366: stages wrap, no horizontal scroll')
  await page.screenshot({ path: 'test-results/operator-stage-layout-1366.png' })
  await page.setViewportSize({ width: 2560, height: 1440 })
  groups = await boxes('.operator-stage-group')
  assert.equal(new Set(groups.map((box) => box.top)).size, 1, '2560: the three groups share one row')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '2560: no page overflow')
  await page.setViewportSize({ width: 390, height: 844 })
  groups = await boxes('.operator-stage-group')
  assert.equal(new Set(groups.map((box) => box.left)).size, 1, '390: one group per row')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390: no page overflow')
  // Project information of the same project: the progress section takes the width and the groups sit side by side.
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.getByRole('button', { name: 'Visualizar informações do projeto', exact: true }).click()
  await page.locator('.operator-info-stage-groups').waitFor()
  const infoGroups = await boxes('.operator-info-stage-group')
  assert.equal(new Set(infoGroups.map((box) => box.top)).size, 1, '1920: project information shows the three groups in one row')
  assert.ok(infoGroups.every((box) => box.width > 440), '1920: groups wide enough')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '1920: no page overflow')
  await page.screenshot({ path: 'test-results/operator-stage-layout-info-1920.png', fullPage: true })
  for (const width of [1366, 2560]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: information without page overflow`)
  }  assert.deepEqual(errors, [])
  console.log('Operator stage identity passed: a quiet card per group with its own accent color, state and progress, on the operator screen and in the project information, at desktop and phone sizes.')
} catch (error) {
  await page.screenshot({ path: 'test-results/operator-stage-info-failure.png', fullPage: true })
  throw error
} finally { await browser.close(); await fixture.close() }
