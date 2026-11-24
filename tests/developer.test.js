import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import createDeveloperRouter from '../server/developer.js'
import { isDeveloper } from '../server/developers.js'
import { createSystemLog, routeKey, safePath } from '../server/systemLog.js'
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

async function developerServer(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gmac-developer-'))
  const people = { 1: { id: 1, name: 'Dev', cpf: '02427847550' }, 2: { id: 2, name: 'Financeiro', cpf: '11122233344' } }
  // As in server/index.js, who made the request comes from its session header (any route, with or without the guard).
  const identify = (request) => { const id = Number(request.headers['x-admin']); return people[id] ? { key: `admin:${id}`, name: people[id].name, role: 'admin' } : null }
  const systemLog = createSystemLog({ identify })
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
  app.use('/api', createDeveloperRouter({ accounts: { account: (id) => people[id] }, requireAdmin: session, requireSession: session, systemLog, live, pool: null, readStore: async () => ({ offers: [{}, {}], orders: [{}], supportTickets: [{ status: 'open' }, { status: 'closed' }] }), dataDirectory: directory, config: () => ({ mail: true }), version: '1.0.21' }))
  app.get('/api/broken', (_request, response) => response.status(500).json({ message: 'Falha de teste' }))
  const server = await new Promise((resolve) => { const item = app.listen(0, '127.0.0.1', () => resolve(item)) })
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }) })
  const url = `http://127.0.0.1:${server.address().port}/api`
  const call = async (route, { admin = 1, method = 'GET', body } = {}) => {
    const response = await fetch(`${url}${route}`, { method, headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-admin': String(admin) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
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

  // A restart reads the same saved logs.
  assert.equal((await createSystemLog({ pool: database.pool, now }).list()).length, 6)
  clock += 31 * 86400000
  assert.equal(await systemLog.prune(), 6)
  assert.equal((await systemLog.list()).length, 0)
})
