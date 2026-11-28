import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import createDeveloperRouter from '../server/developer.js'
import { isDeveloper } from '../server/developers.js'
import { apiErrorHandler, createSystemLog, routeKey, safePath } from '../server/systemLog.js'
import { createTestDatabase } from './workflowFixture.js'

// Tela Desenvolvedor: only the two developer CPFs open it (the server checks, the menu only hides the item); every
// session sends the errors of its browser; the export brings the logs and the state of the system in one file; the logs
// never keep a secret of the address.
test('only the developer CPFs open the screen and the logs never keep a secret of the address', () => {
  assert.deepEqual([isDeveloper({ cpf: '024.278.475-50' }), isDeveloper({ cpf: '14303355640' }), isDeveloper({ cpf: '11122233344' }), isDeveloper({}), isDeveloper(null)], [true, true, false, false, false])
  assert.equal(safePath('/api/live?token=abc&topic=orders'), '/api/live?token=***&topic=orders')
  assert.equal(safePath('/api/x?cpf=123&senha=1'), '/api/x?cpf=***&senha=***')
  assert.equal(routeKey('GET', '/api/offers/0f8fad5b-d9cb-469f-a165-70867728950e/proposal.pdf?x=1'), 'GET /api/offers/:id/proposal.pdf')
  assert.equal(routeKey('PUT', '/api/operations/orders/OS-0012'), 'PUT /api/operations/orders/:id')
})

// `build`: the interface published now (dist/version.json); `store`: the portal data; `now`: the clock of the logs.
async function developerServer(t, { build = null, store = null, now = Date.now } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gmac-developer-'))
  if (build) await writeFile(path.join(directory, 'version.json'), `${JSON.stringify({ version: build })}\n`)
  const people = { 1: { id: 1, name: 'Dev', cpf: '02427847550' }, 2: { id: 2, name: 'Financeiro', cpf: '11122233344' } }
  // As in server/index.js, who made the request comes from its session header (any route, with or without the guard).
  const identify = (request) => { const id = Number(request.headers['x-admin']); return people[id] ? { key: `admin:${id}`, name: people[id].name, role: 'admin' } : null }
  const systemLog = createSystemLog({ identify, now })
  const session = (request, response, next) => {
    const id = Number(request.headers['x-admin'])
    if (!people[id]) return response.status(401).json({ message: 'Sessão expirada.' })
    Object.assign(request, { adminId: id, adminName: people[id].name })
    next()
  }
  const live = { connections: 1, peers: [{ since: Date.now() - 60000, userId: 2, name: 'Financeiro', role: 'admin', ip: '10.0.0.9', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36' }] }
  const app = express()
  app.use(express.json())
  app.use('/api', systemLog.requestLogger)
  app.use('/api', createDeveloperRouter({ accounts: { account: (id) => people[id] }, requireAdmin: session, requireSession: session, systemLog, live, pool: null, readStore: async () => store || ({ offers: [{}, {}], orders: [{}], supportTickets: [{ status: 'open' }, { status: 'closed' }] }), dataDirectory: directory, interfaceDirectory: build ? directory : null, config: () => ({ mail: true }), version: '1.0.21', now }))
  app.get('/api/broken', (_request, response) => response.status(500).json({ message: 'Falha de teste' }))
  // A refusal with the record it involved, a session refused, and errors thrown to the last handler of the API.
  app.post('/api/refused', (_request, response) => { response.locals.logDetails = { conflito: { motivo: 'período sobreposto', registro: { sessao: 's1', inicio: '2026-10-01T08:00:00.000Z' } } }; response.status(409).json({ message: 'OS-2026-0007: Ana já tem um período.' }) })
  app.get('/api/expired', (_request, response) => response.status(401).json({ message: 'Entre novamente como administrador.' }))
  app.get('/api/thrown/:status', (request, _response, next) => { const error = new Error(`Recusa ${request.params.status}`); if (request.params.status !== '500') error.status = Number(request.params.status); error.logDetails = { validacao: { campo: 'Margem', recebido: 1001, aceito: 'número de 0 a 1000%' } }; next(error) })
  app.use('/api', apiErrorHandler)
  const server = await new Promise((resolve) => { const item = app.listen(0, '127.0.0.1', () => resolve(item)) })
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }) })
  const url = `http://127.0.0.1:${server.address().port}/api`
  const call = async (route, { admin = 1, method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`${url}${route}`, { method, headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-admin': String(admin) } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    return { status: response.status, headers: response.headers, data: text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text }
  }
  // The request log is written when the answer ends; a moment for it.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
  return { call, settle, systemLog }
}

test('the Desenvolvedor screen: access, browser errors, failed requests, online users and the export', async (t) => {
  const { call, settle } = await developerServer(t)

  for (const route of ['/developer/overview', '/developer/logs', '/developer/requests', '/developer/export']) {
    assert.equal((await call(route, { admin: 2 })).status, 403, `${route} is only for developers`)
    assert.equal((await call(route, { admin: null })).status, 401)
  }

  // Any session sends the errors of its browser, a limited number per address.
  const entry = (index) => ({ level: 'error', kind: 'erro', message: `Tela quebrou ${index}`, stack: 'TypeError: x is undefined\n at Tela', screen: 'Ofertas', page: '/#ofertas', version: '1.0.21', viewport: '1366x768@1', language: 'pt-BR', online: true })
  assert.equal((await call('/client-logs', { admin: 2, method: 'POST', body: { entries: [entry(0)] } })).status, 204)
  for (let round = 0; round < 5; round += 1) await call('/client-logs', { admin: 2, method: 'POST', body: { entries: Array.from({ length: 10 }, (_, index) => entry(`${round}-${index}`)) } })
  await call('/broken?token=segredo', { admin: 2 })
  await settle()

  const browser = (await call('/developer/logs?source=browser&limit=500')).data.items
  assert.equal(browser.length, 40, 'at most 40 browser entries per address every 5 minutes')
  assert.equal(browser.at(-1).message, 'Tela quebrou 0')
  assert.deepEqual([browser.at(-1).user, browser.at(-1).details.screen, browser.at(-1).details.viewport], ['Financeiro', 'Ofertas', '1366x768@1'])

  const failed = (await call('/developer/logs?level=error&source=request')).data.items
  assert.equal(failed.length, 1)
  assert.match(failed[0].message, /^GET \/api\/broken\?token=\*\*\* → 500 em \d+ ms: Falha de teste$/)
  assert.equal(failed[0].user, 'Financeiro')
  assert.ok(!(await call('/developer/logs?limit=500')).data.items.some((item) => JSON.stringify(item).includes('segredo')), 'the token is never in the logs')
  // The reads of the screen itself stay out of the saved logs.
  const screenReads = (await call('/developer/logs?source=request')).data.items.filter((item) => item.message.includes('/developer/'))
  assert.deepEqual(screenReads.map((item) => item.level), Array(8).fill('warn'), 'only the refused reads (4 without permission, 4 without a session)')

  const overview = (await call('/developer/overview')).data
  assert.equal(overview.version, '1.0.21')
  assert.deepEqual([overview.online.online, overview.online.people.find((row) => row.name === 'Financeiro').tabs], [2, 1], 'the open tab and whoever made requests')
  assert.deepEqual([overview.data.openTickets, overview.data.collections[0]], [1, { name: 'offers', items: 2 }])
  assert.equal(overview.config.mail, true)
  assert.ok(overview.logs.day.error >= 41)
  assert.ok(overview.traffic.failing.some((row) => row.route === 'GET /api/broken' && row.serverErrors === 1))

  const exported = await call('/developer/export?days=1')
  assert.equal(exported.status, 200)
  assert.match(exported.headers.get('content-disposition'), /^attachment; filename="logs-portal-gmac-\d{4}-\d{2}-\d{2}-\d{4}\.json"$/)
  assert.deepEqual([exported.data.exportedBy, exported.data.period.days], ['Dev', 1])
  assert.ok(exported.data.logs.some((item) => item.message === 'Tela quebrou 0' && item.quando))
  assert.match(exported.data.logs[0].message, /Logs exportados na tela Desenvolvedor \(últimos 1 dia\)/)
  assert.ok(exported.data.recentRequests.some((item) => item.route === '/api/broken?token=***'))
  assert.doesNotMatch(JSON.stringify(exported.data), /segredo/)
})

test('metric details use the same log snapshot and request period as the card', async (t) => {
  let clock = Date.parse('2026-11-28T15:00:00Z')
  const { call, systemLog } = await developerServer(t, { now: () => clock })
  const day = 86400000
  systemLog.record({ level: 'error', message: 'Fora do período', at: clock - day - 1 })
  systemLog.record({ level: 'error', message: 'Primeiro erro', at: clock - day })
  systemLog.record({ level: 'warn', message: 'Aviso do período' })
  systemLog.record({ level: 'error', message: 'Último erro do cartão' })

  await call('/developer/logs?level=info')
  const overview = (await call('/developer/overview')).data
  assert.equal(overview.logs.day.error, 2)
  assert.equal(overview.logs.day.warn, 1)
  assert.equal(overview.logWindow.until, clock)
  systemLog.record({ level: 'error', message: 'Erro incluído depois, na mesma hora' })
  clock += 1
  await call('/broken')
  const params = new URLSearchParams({ ...overview.logWindow, level: 'error', limit: '1' })
  const page = (await call(`/developer/logs?${params}`)).data
  assert.deepEqual(page.items.map((item) => item.message), ['Último erro do cartão'])
  params.set('before', page.items[0].id)
  assert.deepEqual((await call(`/developer/logs?${params}`)).data.items.map((item) => item.message), ['Primeiro erro'])
  params.delete('before')
  params.set('level', 'warn')
  assert.deepEqual((await call(`/developer/logs?${params}`)).data.items.map((item) => item.message), ['Aviso do período'])
  const requests = (await call(`/developer/requests?until=${overview.generatedAt}`)).data.items
  assert.ok(requests.some((item) => item.route === '/api/developer/logs?level=info'))
  assert.ok(requests.every((item) => item.at <= overview.generatedAt && item.route !== '/api/broken'))
})

test('the logs are saved in MySQL, paged from the newest and kept for 30 days', async (t) => {
  const database = await createTestDatabase('gmac_test_system_logs')
  t.after(() => database.drop())
  let clock = Date.parse('2026-11-24T12:00:00Z')
  const now = () => clock
  // What is recorded before the database is connected (the start of the server) waits and is saved too.
  const systemLog = createSystemLog({ now })
  systemLog.record({ level: 'info', source: 'system', message: 'Servidor iniciado' })
  await systemLog.connect(database.pool)
  for (let index = 1; index <= 5; index += 1) { clock += 1000; systemLog.record({ level: index % 2 ? 'warn' : 'error', source: 'server', message: `Mensagem ${index}`, details: { index } }) }
  systemLog.record({ level: 'info', source: 'request', message: 'Rotina', persist: false })

  const all = await systemLog.list()
  assert.deepEqual(all.map((item) => item.message), ['Mensagem 5', 'Mensagem 4', 'Mensagem 3', 'Mensagem 2', 'Mensagem 1', 'Servidor iniciado'], 'the routine read only in memory')
  assert.deepEqual(all[0].details, { index: 5 })
  const next = await systemLog.list({ before: all[1].id, limit: 2 })
  assert.deepEqual(next.map((item) => item.message), ['Mensagem 3', 'Mensagem 2'])
  assert.deepEqual((await systemLog.list({ levels: ['error'], search: 'mensagem' })).map((item) => item.message), ['Mensagem 4', 'Mensagem 2'])
  const summary = await systemLog.summary(0)
  assert.deepEqual([summary.error, summary.warn, summary.info, summary.saved, summary.bySource.server.warn], [2, 3, 1, 6, 3])

  const snapshot = await systemLog.summary(clock - 4000, clock)
  assert.equal(snapshot.through, all[0].id)
  systemLog.record({ level: 'warn', message: 'Gravado depois do resumo, no mesmo milissegundo' })
  const shown = await systemLog.list({ since: clock - 4000, until: clock, through: snapshot.through, levels: ['warn'] })
  assert.deepEqual(shown.map((item) => item.message), ['Mensagem 5', 'Mensagem 3', 'Mensagem 1'])

  // A restart reads the same saved logs.
  assert.equal((await createSystemLog({ pool: database.pool, now }).list()).length, 7)
  clock += 31 * 86400000
  assert.equal(await systemLog.prune(), 7)
  assert.equal((await systemLog.list()).length, 0)
})

// Logs mais completos (1.0.26): what a refusal involved, 401 grouped, 4xx without "Falha na API", the version of each
// browser (Usuários online and the logs) and the diagnosis of the OS in the export.
test('the logs keep what a refusal involved, group repeated 401 and know the version of each browser', async (t) => {
  let clock = Date.parse('2026-11-26T15:00:00Z')
  const now = () => clock
  const store = {
    offers: [{ id: 'of1', code: 'OF-2026-0003' }],
    orders: [{ code: 'OS-2026-0007', offerId: 'of1', service: 'Corte de chapas', company: 'Cliente Teste', quantity: 10, createdAt: '2026-11-20T11:00:00.000Z', deadline: '2026-12-01', resources: { stages: ['cut-bend'], urgency: 'normal' }, proposal: { serviceValue: 900 },
      operation: { status: 'running', stages: [{ key: 'stage-1', name: 'Corte' }], stageCounts: { 'stage-1': 2 }, activeSessions: [{ id: 's1', employeeId: 3, employeeName: 'Ana', tokenHash: 'hash-secreto', deviceTokenHashes: ['outro-hash'] }] },
      operationEvents: [{ id: 'e1', type: 'started', at: '2026-11-26T11:00:00.000Z', sessionId: 's1', employeeId: 3, employeeName: 'Ana' }] }],
    supportTickets: [],
  }
  const { call, settle, systemLog } = await developerServer(t, { build: 'build-novo', store, now })
  const current = { 'X-Portal-Release': '1.0.26', 'X-Portal-Version': 'build-novo' }

  // (1, 2, 6) The refusal keeps the record it involved and the version of the portal that asked.
  assert.equal((await call('/refused', { admin: 2, method: 'POST', body: {}, headers: current })).status, 409)
  // (5) An expected refusal is a warning of the request, not "Falha na API"; a real failure still is.
  const said = [], consoleError = console.error
  console.error = (...args) => said.push(args.join(' '))
  try { assert.equal((await call('/thrown/400', { admin: 2 })).status, 400); assert.equal((await call('/thrown/500', { admin: 2 })).status, 500) } finally { console.error = consoleError }
  assert.deepEqual(said.filter((line) => line.startsWith('Falha na API')), ['Falha na API: Recusa 500'])
  await settle()
  const [refused] = await systemLog.list({ search: '/api/refused' })
  assert.equal(refused.level, 'warn')
  assert.deepEqual(refused.details.conflito, { motivo: 'período sobreposto', registro: { sessao: 's1', inicio: '2026-10-01T08:00:00.000Z' } })
  assert.deepEqual([refused.details.version, refused.details.build], ['1.0.26', 'build-novo'])
  const thrown = await systemLog.list({ search: '/api/thrown' })
  assert.deepEqual(thrown.map((item) => [item.level, item.details.validacao?.campo]), [['error', 'Margem'], ['warn', 'Margem']])
  assert.deepEqual(thrown[1].details.validacao, { campo: 'Margem', recebido: 1001, aceito: 'número de 0 a 1000%' })
  // A version that is not a version (spaces, symbols) is not kept.
  await call('/refused', { admin: 2, method: 'POST', body: {}, headers: { 'X-Portal-Release': '<b>1.0</b>', 'X-Portal-Version': 'a b' } })
  await settle()
  assert.deepEqual([(await systemLog.list({ search: '/api/refused' }))[0].details.version, (await systemLog.list({ search: '/api/refused' }))[0].details.build], [undefined, undefined])

  // (4) The same session refused again and again (same route, address and device): the first one, then the count.
  for (let index = 0; index < 5; index += 1) { clock += 15000; await call('/expired', { admin: null }) }
  await call('/thrown/401', { admin: null })
  await settle()
  assert.equal((await systemLog.list({ search: '/api/expired' })).length, 1, 'only the first one while it repeats')
  assert.equal((await systemLog.list({ search: '/api/thrown/401' })).length, 1, 'another route is another group')
  const open = (await call('/developer/export?days=1')).data.sessoesRecusadasEmAndamento.find((group) => group.route === '/api/expired')
  assert.deepEqual([open.repeats, open.message], [4, 'Entre novamente como administrador.'])
  // Ten quiet minutes: one record with how many times and when.
  clock += 11 * 60000
  const grouped = await systemLog.list({ search: '/api/expired' })
  assert.equal(grouped.length, 2)
  assert.match(grouped[0].message, /^GET \/api\/expired → 401 repetido mais 4 vezes \(de 26\/11 12:00 a 26\/11 12:01\): Entre novamente como administrador\.$/)
  assert.deepEqual([grouped[0].level, grouped[0].details.repeticoes, grouped[0].details.status], ['warn', 4, 401])
  // After that a new refusal starts again with its own record.
  await call('/expired', { admin: null })
  await settle()
  assert.equal((await systemLog.list({ search: '/api/expired' })).length, 3)

  // (12) Usuários online: the version open in each browser; without the build of the published interface, outdated.
  await call('/developer/overview', { admin: 1, headers: { 'X-Portal-Release': '1.0.25', 'X-Portal-Version': 'build-antigo' } })
  await call('/client-logs', { admin: 2, method: 'POST', body: { entries: [] }, headers: current })
  await settle()
  const online = (await call('/developer/overview', { admin: 1, headers: { 'X-Portal-Release': '1.0.25', 'X-Portal-Version': 'build-antigo' } })).data.online
  const row = (name) => online.people.find((person) => person.name === name)
  assert.equal(online.build, 'build-novo')
  assert.deepEqual([row('Financeiro').version, row('Financeiro').outdated], ['1.0.26', false])
  assert.deepEqual([row('Dev').version, row('Dev').outdated], ['1.0.25', true])
  assert.deepEqual(online.outdated, { people: 1, tablets: 0 })

  // (3) The export brings the diagnosis of each OS of the warnings and errors, without any secret of the sessions.
  const exported = (await call('/developer/export?days=1')).data
  const diagnosis = exported.diagnosticos.find((item) => item.codigo === 'OS-2026-0007')
  assert.deepEqual([diagnosis.encontrada, diagnosis.os.offerCode, diagnosis.os.service, diagnosis.os.quantity, diagnosis.totalEventos, diagnosis.eventos[0].id], [true, 'OF-2026-0003', 'Corte de chapas', 10, 1, 'e1'])
  assert.deepEqual(diagnosis.operacao.activeSessions, [{ id: 's1', employeeId: 3, employeeName: 'Ana' }])
  assert.equal(diagnosis.os.proposal, undefined, 'no prices in the diagnosis')
  assert.ok(diagnosis.mencoesNosLogs >= 2)
  assert.doesNotMatch(JSON.stringify(exported), /hash-secreto|outro-hash|tokenHash/)
  // The diagnosis of one OS chosen on the screen.
  const single = await call('/developer/diagnostics/os-2026-0007')
  assert.equal(single.status, 200)
  assert.match(single.headers.get('content-disposition'), /^attachment; filename="diagnostico-OS-2026-0007-\d{4}-\d{2}-\d{2}-\d{4}\.json"$/)
  assert.deepEqual([single.data.diagnostico.codigo, single.data.diagnostico.operacao.stageCounts['stage-1']], ['OS-2026-0007', 2])
  assert.ok(single.data.logs.some((entry) => entry.message.includes('OS-2026-0007: Ana já tem um período')))
  assert.doesNotMatch(JSON.stringify(single.data), /hash-secreto|outro-hash/)
  assert.deepEqual([(await call('/developer/diagnostics/qualquer')).status, (await call('/developer/diagnostics/OS-2026-9999')).data.message], [400, 'OS-2026-9999 não encontrada.'])
  assert.equal((await call('/developer/diagnostics/OS-2026-0007', { admin: 2 })).status, 403)
})
