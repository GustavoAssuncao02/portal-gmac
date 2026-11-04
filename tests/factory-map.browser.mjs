// Mapa da fábrica no Planejamento: postos parados em preto e branco, postos em uso em cores com pelo menos 5 quadros
// diferentes do funcionário, detalhes ao passar o mouse e ao tocar, situação de agora em qualquer data da agenda.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { factoryStations, elapsedLabel } from '../src/factoryMapData.js'

// As regras de ligação, sem navegador.
const machines = [{ id: 'a', name: 'Torno CNC' }, { id: 'b', name: 'Fresadora convencional' }, { id: 'c', name: 'Máquina nova' }, { id: 'd', name: 'Lixadeira' }, { id: 'e', name: 'Têmpera' }]
const session = (fields) => ({ id: fields.employeeName, employeeName: fields.employeeName, startedAt: '2026-01-01T10:00:00Z', ...fields })
const orders = [{ code: 'OS-1', service: 'Eixo', operation: { activeSessions: [session({ employeeName: 'Ana', machineId: 'a', machineStartedAt: '2026-01-01T11:00:00Z' }), session({ employeeName: 'Bia', laborServiceId: 's', laborServiceName: 'Serviço de pintura' }), session({ employeeName: 'Caio', machineId: 'c', machineName: 'Máquina nova' }), session({ employeeName: 'Davi', laborServiceId: 'm', laborServiceName: 'Serviço de montagem' }), session({ employeeName: 'Eva', machineId: 'd', machineName: 'Lixadeira' }), session({ employeeName: 'Fábio', machineId: 'e', machineName: 'Têmpera' })] } }]
const { stations, working, outside } = factoryStations(orders, machines)
const at = (key) => stations.find((row) => row.key === key)
assert.equal(working, 6)
assert.equal(at('lixadeira').work[0].employeeName, 'Eva', 'the Lixadeira is a post of the plan')
assert.equal(at('tempera').work[0].employeeName, 'Fábio', 'the accent of Têmpera does not break the link')
assert.equal(at('torno-cnc').work[0].employeeName, 'Ana')
assert.equal(at('ferramenteira').machineName, 'Fresadora convencional', 'the registered name is the one shown')
assert.equal(at('ferramenteira').work.length, 0)
assert.equal(at('pintura-1').work[0].employeeName, 'Bia')
assert.deepEqual(outside.map((row) => [row.employeeName, row.resourceName]), [['Caio', 'Máquina nova']], 'who is outside the plan is told, not drawn')
assert.equal(at('bancada-1').work[0].employeeName, 'Davi', 'a labor service goes to a service bench')
assert.equal(at('bancada-1').machineName, 'Serviço de montagem')
assert.equal(at('bancada-2').work.length, 0)
assert.equal(stations.length, 27, 'the machine posts of the plan, the service benches and the 4 paint posts')
assert.deepEqual(stations.filter((row) => row.art === 'booth').map((row) => row.label), ['Pintura 1', 'Pintura 2', 'Pintura 3', 'Pintura 4'])
assert.equal(stations.filter((row) => row.service).length, 5)
assert.deepEqual(stations.filter((row) => row.sector === 'Demais atividades').map((row) => row.label), ['Lixadeira', 'Têmpera', 'Bancada', 'Bancada'])
assert.equal(elapsedLabel(3725000), '1 h 02 min 05 s')
assert.equal(elapsedLabel(65000), '1 min 05 s')

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Rafael Teste' }
const fixture = await createWorkflowFixture({ accountsEnv: env })
const browser = await chromium.launch()
try {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const api = async (route, method, body, headers = { Authorization: `Bearer ${token}` }) => { const result = await fixture.request(route, method, body, headers); assert.ok(result.status < 300, `${route}: ${JSON.stringify(result.data)}`); return result.data }
  const made = {}
  for (const [name, sector] of [['Torno CNC', 'Usinagem'], ['Centro de Usinagem', 'Usinagem'], ['Fresadora convencional', 'Usinagem'], ['Solda', 'Caldeiraria'], ['Maçarico', 'Caldeiraria'], ['Prensa', 'Caldeiraria']]) made[name] = (await api('/machines', 'POST', { name, type: 'Teste', sector, hourlyRate: 100 })).item
  const painting = (await api('/labor-services')).items.find((item) => /pintura/i.test(item.name))
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  async function working(name, cpf, resource, label) {
    const employee = (await api('/employees', 'POST', { name, birthDate: '1990-01-01', cpf, email: `${cpf}@example.invalid`, identification: cpf.slice(-3) })).item
    const offer = (await api('/offers', 'POST', { ...offerDraft, service: label })).item
    await api(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', strictProcess: false, stages: ['turning'], stageResources: { turning: resource } })
    await api(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offerDraft.deadline } })
    const order = (await api(`/offers/${offer.id}/accept`, 'POST')).item
    await api(`/operations/orders/${order.code}/start`, 'POST', { employeeId: employee.id, ...(resource.type === 'machine' ? { machineId: resource.id } : { laborServiceId: resource.id }) }, operator)
  }
  await working('Ana Lima', '00000000191', { type: 'machine', id: made['Torno CNC'].id }, 'Eixo A')
  await working('Bruno Dias', '00000000272', { type: 'machine', id: made.Solda.id }, 'Suporte B')
  await working('Carla Reis', '00000000353', { type: 'labor-service', id: painting.id }, 'Tampa C')
  await working('Davi Melo', '00000000434', { type: 'machine', id: made['Maçarico'].id }, 'Chapa D')

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const writes = []
  page.on('request', (request) => { if (request.method() !== 'GET' && request.url().includes('/api/') && !request.url().includes('/auth/')) writes.push(`${request.method()} ${request.url()}`) })
  await page.goto(fixture.url)
  await page.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await page.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.admin-home-main').waitFor()
  const operation = page.locator('.sidebar').getByRole('button', { name: 'Planejamento', exact: true })
  if (!await operation.isVisible()) await page.locator('.sidebar').getByRole('button', { name: 'Operação', exact: true }).click()
  await operation.click()
  await page.locator('.factory-map-stations').waitFor()
  await page.locator('[data-station="torno-cnc"].factory-station--working').waitFor()
  await page.locator('.factory-map').scrollIntoViewIfNeeded()

  // Caldeiraria: nenhum equipamento encosta nas colunas (x de 721 a 1294 na planta) nem em outro.
  const caldeiraria = await page.locator('.factory-map-stations').evaluate((svg, keys) => {
    const unit = svg.getBoundingClientRect().width / 1740, left = svg.getBoundingClientRect().left
    return keys.map((key) => {
      const boxes = [...svg.querySelector(`[data-station="${key}"]`).children].filter((item) => !item.classList.contains('factory-hit')).map((item) => item.getBoundingClientRect())
      return { key, left: (Math.min(...boxes.map((box) => box.left)) - left) / unit, right: (Math.max(...boxes.map((box) => box.right)) - left) / unit, top: Math.min(...boxes.map((box) => box.top)), bottom: Math.max(...boxes.map((box) => box.bottom)) }
    })
  }, ['bancada-1', 'bancada-2', 'solda', 'furadeira', 'policorte', 'bancada-3', 'viradora', 'dobradeira', 'macarico', 'prensa'])
  for (const post of caldeiraria) assert.ok(post.left >= 725 && post.right <= 1290, `${post.key} entre as colunas: ${post.left} a ${post.right}`)
  for (const [index, one] of caldeiraria.entries()) for (const other of caldeiraria.slice(index + 1)) assert.ok(one.right <= other.left || other.right <= one.left || one.bottom <= other.top || other.bottom <= one.top, `${one.key} não encosta em ${other.key}`)

  // Cada posto por conta própria.
  assert.equal(await page.locator('.factory-station--working').count(), 4)
  assert.equal(await page.locator('[data-station="centro"].factory-station--idle .factory-frame').count(), 0, 'an idle post has no worker')
  assert.equal(await page.locator('[data-station="pintura-1"].factory-station--working').count(), 1)
  assert.equal(await page.locator('[data-station="bancada-1"].factory-station--idle').count(), 1, 'a service bench is free, not a missing machine')

  // Pelo menos 5 quadros realmente diferentes, um por vez, com o equipamento parado.
  const worker = page.locator('[data-station="torno-cnc"] .factory-worker')
  const frames = await worker.locator('.factory-frame').evaluateAll((items) => items.map((item) => item.innerHTML))
  assert.ok(frames.length >= 5, `${frames.length} quadros`)
  assert.equal(new Set(frames).size, frames.length, 'every frame is a different drawing')
  const seen = new Set()
  const machineBefore = await page.locator('[data-station="torno-cnc"]').evaluate((element) => element.getAttribute('transform'))
  for (let index = 0; index < 40; index++) {
    const visible = await worker.locator('.factory-frame').evaluateAll((items) => items.filter((item) => getComputedStyle(item).visibility === 'visible').map((item) => item.dataset.frame))
    assert.ok(visible.length <= 1, `um quadro por vez: ${visible}`)
    if (visible[0]) seen.add(visible[0])
    await page.waitForTimeout(90)
  }
  assert.ok(seen.size >= 5, `quadros vistos em sequência: ${[...seen]}`)
  assert.equal(await page.locator('[data-station="torno-cnc"]').evaluate((element) => element.getAttribute('transform')), machineBefore)
  await page.locator('.factory-map').screenshot({ path: 'test-results/mapa-fabrica.png' })

  // Mouse: funcionário, máquina e tempo, e o relógio anda.
  await page.locator('[data-station="torno-cnc"] .factory-hit').hover()
  const details = page.locator('.factory-details')
  await details.waitFor()
  assert.match(await details.innerText(), /Ana Lima[\s\S]*Torno CNC[\s\S]*Trabalhando há \d+ min \d+ s/)
  const first = await details.innerText()
  await page.waitForTimeout(1300)
  assert.notEqual(await details.innerText(), first, 'the time keeps running')
  await page.locator('.factory-map').screenshot({ path: 'test-results/mapa-fabrica-detalhes.png' })
  await page.mouse.move(5, 5)
  await details.waitFor({ state: 'hidden' })

  // A data da agenda não muda o mapa.
  await page.getByLabel('Data', { exact: true }).fill('2020-01-15')
  await page.waitForTimeout(600)
  assert.equal(await page.locator('.factory-station--working').count(), 4)
  await page.locator('.factory-map').getByRole('button', { name: 'Recolher', exact: true }).click()
  assert.equal(await page.locator('.factory-map-stations').count(), 0)
  await page.locator('.factory-map').getByRole('button', { name: 'Mostrar mapa', exact: true }).click()
  await page.locator('[data-station="torno-cnc"].factory-station--working').waitFor()
  assert.deepEqual(writes, [], 'the map only reads')

  // Celular: rola de lado e abre os detalhes com um toque.
  const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })
  const mobile = await phone.newPage()
  mobile.on('pageerror', (error) => errors.push(error.message))
  await mobile.goto(fixture.url)
  await mobile.getByLabel('CPF', { exact: true }).fill(env.DEMO_ADMIN_CPF)
  await mobile.getByLabel('Senha', { exact: true }).fill(env.DEMO_ADMIN_PASSWORD)
  await mobile.getByRole('button', { name: 'Entrar', exact: true }).click()
  await mobile.locator('.admin-home-main').waitFor()
  await mobile.getByRole('button', { name: 'Abrir menu de navegação', exact: true }).click()
  const planningItem = mobile.locator('.sidebar').getByRole('button', { name: 'Planejamento', exact: true })
  if (!await planningItem.isVisible()) await mobile.locator('.sidebar').getByRole('button', { name: 'Operação', exact: true }).click()
  await planningItem.click()
  const post = mobile.locator('[data-station="torno-cnc"].factory-station--working')
  await post.waitFor()
  assert.ok(await mobile.locator('.factory-map-scroll').evaluate((element) => element.scrollWidth > element.clientWidth), 'the map scrolls sideways on the phone')
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'the page itself does not')
  await post.locator('.factory-hit').tap()
  await mobile.locator('.factory-details').waitFor()
  assert.match(await mobile.locator('.factory-details').innerText(), /Ana Lima/)
  await mobile.screenshot({ path: 'test-results/mapa-fabrica-celular.png' })
  assert.deepEqual(errors, [])
  console.log('Mapa da fábrica: OK')
} finally {
  await browser.close()
  await fixture.close()
}
