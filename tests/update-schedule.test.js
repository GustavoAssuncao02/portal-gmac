import test from 'node:test'
import assert from 'node:assert/strict'
import { createUpdateScheduler, scheduleMoment, momentLabel, deployConfig, requestDeploy, nextUpdateView, MIN_LEAD_MS } from '../server/updateSchedule.js'
import { alwaysShownNotices } from '../server/notificationRules.js'

const MINUTE = 60000
// 26/11/2026 19:00 in Bahia (UTC-3).
const AT = Date.parse('2026-11-26T22:00:00.000Z')
const developer = { id: 7, name: 'DEV' }

function memoryStore(initial = {}) {
  let store = structuredClone(initial)
  return {
    readStore: async () => structuredClone(store),
    mutateStore: async (fn) => { const draft = structuredClone(store); const result = await fn(draft); store = draft; return result === undefined ? undefined : structuredClone(result) },
    current: () => store,
  }
}
function setup({ now = AT - 60 * MINUTE, env = {}, deploy, version = '1.0.24', initial } = {}) {
  const clock = { now }
  const memory = memoryStore(initial)
  const calls = []
  const scheduler = createUpdateScheduler({ ...memory, version, env, now: () => clock.now, developerIds: async () => [7, 9], deploy: deploy || (async (config) => { calls.push(config); return { result: 0 } }) })
  return { scheduler, memory, clock, calls }
}
const notices = (memory) => memory.current().operationalNotifications || []

test('the date and hour are read in Bahia and shown as people say them', () => {
  assert.equal(scheduleMoment('2026-11-26', '19:00'), AT)
  assert.equal(scheduleMoment('2026-02-30', '19:00'), null)
  assert.equal(scheduleMoment('2026-11-26', '24:00'), null)
  assert.equal(scheduleMoment('26/11/2026', '19:00'), null)
  assert.equal(momentLabel(AT), '26/11 às 19:00')
  assert.ok(alwaysShownNotices.has('system-update'), 'everybody sees the update notices, whatever the preferences')
})

test('scheduling tells everybody, needs 10 minutes of notice and allows one update at a time', async () => {
  const { scheduler, memory, clock } = setup()
  clock.now = AT - MIN_LEAD_MS + MINUTE
  await assert.rejects(scheduler.create({ date: '2026-11-26', time: '19:00' }, developer), /10 minutos/)
  clock.now = AT - 60 * MINUTE
  await assert.rejects(scheduler.create({ date: '2027-06-01', time: '19:00' }, developer), /90 dias/)
  const item = await scheduler.create({ date: '2026-11-26', time: '19:00', message: '  Melhorias   no Contas a Receber ' }, developer)
  assert.equal(item.status, 'scheduled')
  assert.equal(item.at, new Date(AT).toISOString())
  assert.equal(item.message, 'Melhorias no Contas a Receber')
  const [notice] = notices(memory)
  assert.equal(notice.type, 'system-update')
  assert.equal(notice.recipientIds, undefined, 'goes to everybody')
  assert.equal(notice.authorId, undefined, 'the developer who scheduled sees it too')
  assert.match(notice.description, /26\/11 às 19:00/)
  assert.match(notice.description, /Melhorias no Contas a Receber/)
  await assert.rejects(scheduler.create({ date: '2026-11-27', time: '19:00' }, developer), (error) => error.status === 409 && /Remarque ou cancele/.test(error.message))
  assert.deepEqual(nextUpdateView(memory.current()), { id: item.id, at: item.at, status: 'scheduled', message: 'Melhorias no Contas a Receber' })
})

test('rescheduling and canceling tell everybody; a new hour gets its own 5-minute notice', async () => {
  const { scheduler, memory, clock } = setup()
  const item = await scheduler.create({ date: '2026-11-26', time: '19:00' }, developer)
  clock.now = AT - 4 * MINUTE
  await scheduler.sweep()
  assert.equal(notices(memory).filter((notice) => /5 minutos/.test(notice.title)).length, 1)
  await assert.rejects(scheduler.reschedule(item.id, { date: '2026-11-26', time: '19:05' }, developer), /10 minutos/)
  const moved = await scheduler.reschedule(item.id, { date: '2026-11-26', time: '20:00' }, developer)
  assert.equal(moved.at, new Date(AT + 60 * MINUTE).toISOString())
  assert.match(notices(memory).at(-1).description, /19:00 passou para 26\/11 às 20:00/)
  await scheduler.reschedule(item.id, { date: '2026-11-26', time: '20:00', message: 'Novo texto' }, developer)
  assert.equal(notices(memory).length, 3, 'only the message changed: no notice')
  clock.now = AT + 56 * MINUTE
  await scheduler.sweep()
  assert.equal(notices(memory).filter((notice) => /5 minutos/.test(notice.title)).length, 2)
  const canceled = await scheduler.cancel(item.id, developer)
  assert.equal(canceled.status, 'canceled')
  assert.equal(notices(memory).at(-1).title, 'Atualização do portal cancelada')
  await assert.rejects(scheduler.cancel(item.id, developer), /ainda programada/)
  assert.equal(nextUpdateView(memory.current()), null)
})

test('without the SaveInCloud token, the hour tells the developers to update by hand', async () => {
  const { scheduler, memory, clock, calls } = setup()
  const item = await scheduler.create({ date: '2026-11-26', time: '19:00' }, developer)
  clock.now = AT + 5000
  await scheduler.sweep()
  const row = memory.current().updateSchedules[0]
  assert.equal(row.status, 'started')
  assert.equal(row.mode, 'manual')
  assert.equal(row.versionBefore, '1.0.24')
  assert.equal(calls.length, 0)
  const manual = notices(memory).find((notice) => notice.id === `update:${item.id}:manual`)
  assert.deepEqual(manual.recipientIds, [7, 9])
  assert.equal(manual.developer, true)
  assert.equal(notices(memory).filter((notice) => /5 minutos/.test(notice.title)).length, 0, 'no 5-minute notice once the hour has come')
  const done = await scheduler.finish(item.id, developer)
  assert.equal(done.status, 'done')
})

test('with the token, the server asks the SaveInCloud for the update once; a refusal warns the developers', async () => {
  const env = { SAVEINCLOUD_TOKEN: 'segredo', SAVEINCLOUD_ENV: 'env-2648028' }
  const { scheduler, memory, clock, calls } = setup({ env })
  await scheduler.create({ date: '2026-11-26', time: '19:00' }, developer)
  clock.now = AT
  await scheduler.sweep()
  await scheduler.sweep()
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { token: 'segredo', envName: 'env-2648028', api: 'https://app.paas.saveincloud.net.br', context: 'ROOT', nodeGroup: 'cp' })
  assert.equal(memory.current().updateSchedules[0].mode, 'auto')
  assert.equal(memory.current().updateSchedules[0].deployAnswer, 'ok')

  const failing = setup({ env, deploy: async () => { throw new Error('access denied for method') } })
  await failing.scheduler.create({ date: '2026-11-26', time: '19:00' }, developer)
  failing.clock.now = AT
  await failing.scheduler.sweep()
  const row = failing.memory.current().updateSchedules[0]
  assert.equal(row.status, 'started')
  assert.match(row.error, /recusou a atualização: access denied for method/)
  const warning = notices(failing.memory).at(-1)
  assert.deepEqual(warning.recipientIds, [7, 9])
  assert.doesNotMatch(JSON.stringify(failing.memory.current()), /segredo/, 'the token is never saved')
})

test('the restart after the hour closes the update; an hour missed while the server was down is not run later', async () => {
  const { scheduler, memory, clock } = setup()
  await scheduler.create({ date: '2026-11-26', time: '19:00' }, developer)
  clock.now = AT
  await scheduler.sweep()
  const restarted = createUpdateScheduler({ ...memory, version: '1.0.25', now: () => AT + 3 * MINUTE, developerIds: async () => [7] })
  await restarted.boot()
  const done = memory.current().updateSchedules[0]
  assert.equal(done.status, 'done')
  assert.equal(done.versionBefore, '1.0.24')
  assert.equal(done.versionAfter, '1.0.25')

  const missed = setup({ env: { SAVEINCLOUD_TOKEN: 't', SAVEINCLOUD_ENV: 'e' } })
  await missed.scheduler.create({ date: '2026-11-26', time: '19:00' }, developer)
  missed.clock.now = AT + 2 * 60 * MINUTE
  await missed.scheduler.boot()
  await missed.scheduler.sweep()
  assert.equal(missed.memory.current().updateSchedules[0].status, 'expired')
  assert.equal(missed.calls.length, 0, 'no surprise update hours later')
  assert.equal(notices(missed.memory).at(-1).title, 'Atualização programada não executada')

  // Updated by hand a few minutes early: the new version is already running, so the schedule is closed.
  const early = setup()
  await early.scheduler.create({ date: '2026-11-26', time: '19:00' }, developer)
  const newer = createUpdateScheduler({ ...early.memory, version: '1.0.25', now: () => AT - 3 * MINUTE, developerIds: async () => [] })
  await newer.boot()
  assert.equal(early.memory.current().updateSchedules[0].status, 'done')
})

test('the SaveInCloud request: the configuration, the call and its refusals', async () => {
  assert.equal(deployConfig({}), null)
  assert.equal(deployConfig({ SAVEINCLOUD_TOKEN: 't' }), null)
  assert.equal(deployConfig({ SAVEINCLOUD_TOKEN: 't', SAVEINCLOUD_ENV: 'e', SAVEINCLOUD_API_URL: 'http://app.example.com' }), null, 'only https')
  assert.deepEqual(deployConfig({ SAVEINCLOUD_TOKEN: ' t ', SAVEINCLOUD_ENV: 'env-1', SAVEINCLOUD_API_URL: 'https://app.example.com/', SAVEINCLOUD_CONTEXT: 'APP' }), { token: 't', envName: 'env-1', api: 'https://app.example.com', context: 'APP', nodeGroup: 'cp' })
  const seen = []
  const fetchImpl = async (url, options) => { seen.push({ url, body: Object.fromEntries(options.body) }); return { ok: true, status: 200, json: async () => ({ result: 0 }) } }
  await requestDeploy(deployConfig({ SAVEINCLOUD_TOKEN: 'tok', SAVEINCLOUD_ENV: 'env-2648028' }), { fetchImpl })
  assert.equal(seen[0].url, 'https://app.paas.saveincloud.net.br/1.0/environment/vcs/rest/update')
  assert.deepEqual(seen[0].body, { envName: 'env-2648028', session: 'tok', context: 'ROOT', project: 'ROOT', nodeGroup: 'cp' })
  const refuse = async () => ({ ok: true, status: 200, json: async () => ({ result: 702, error: 'invalid token' }) })
  await assert.rejects(requestDeploy({ token: 'x', envName: 'e', api: 'https://a.b', context: 'ROOT', nodeGroup: 'cp' }, { fetchImpl: refuse }), /invalid token/)
  const broken = async () => ({ ok: false, status: 502, json: async () => { throw new Error('html') } })
  await assert.rejects(requestDeploy({ token: 'x', envName: 'e', api: 'https://a.b', context: 'ROOT', nodeGroup: 'cp' }, { fetchImpl: broken }), /HTTP 502/)
})

test('the routes: every administrative session reads the countdown; only developers schedule', async (t) => {
  const { default: express } = await import('express')
  const { default: createDeveloperRouter } = await import('../server/developer.js')
  const { createSystemLog } = await import('../server/systemLog.js')
  const people = { 1: { id: 1, name: 'Dev', cpf: '02427847550' }, 2: { id: 2, name: 'Financeiro', cpf: '11122233344' } }
  const session = (request, response, next) => {
    const id = Number(request.headers['x-admin'])
    if (!people[id]) return response.status(401).json({ message: 'Sessão expirada.' })
    Object.assign(request, { adminId: id, adminName: people[id].name })
    next()
  }
  const clock = { now: AT - 60 * MINUTE }
  const memory = memoryStore()
  const updates = createUpdateScheduler({ ...memory, version: '1.0.24', now: () => clock.now, developerIds: async () => [1] })
  const app = express()
  app.use(express.json())
  app.use('/api', createDeveloperRouter({ accounts: { account: (id) => people[id] }, requireAdmin: session, requireSession: session, systemLog: createSystemLog({ identify: () => null }), live: null, pool: null, readStore: memory.readStore, dataDirectory: '.', updates, now: () => clock.now }))
  app.use((error, _request, response, _next) => response.status(error.status || 500).json({ message: error.message }))
  const server = await new Promise((resolve) => { const item = app.listen(0, '127.0.0.1', () => resolve(item)) })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/api`
  const call = async (route, admin, method = 'GET', body) => {
    const response = await fetch(`${url}${route}`, { method, headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-admin': String(admin) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, data: await response.json().catch(() => null) }
  }
  assert.equal((await call('/update-schedule', null)).status, 401)
  assert.deepEqual((await call('/update-schedule', 2)).data, { item: null, now: clock.now })
  assert.equal((await call('/developer/updates', 2)).status, 403)
  assert.equal((await call('/developer/updates', 2, 'POST', { date: '2026-11-26', time: '19:00' })).status, 403)
  const created = await call('/developer/updates', 1, 'POST', { date: '2026-11-26', time: '19:00', message: 'Teste' })
  assert.equal(created.status, 201)
  const listed = await call('/developer/updates', 1)
  assert.equal(listed.data.automatic, false)
  assert.equal(listed.data.items[0].createdBy, 'Dev')
  const next = (await call('/update-schedule', 2)).data.item
  assert.deepEqual(next, { id: created.data.item.id, at: new Date(AT).toISOString(), status: 'scheduled', message: 'Teste' })
  assert.equal(next.createdBy, undefined, 'the countdown does not tell who scheduled')
  assert.equal((await call(`/developer/updates/${next.id}`, 1, 'PUT', { date: '2026-11-26', time: '19:30' })).status, 200)
  assert.equal((await call(`/developer/updates/${next.id}/cancel`, 2, 'POST')).status, 403)
  assert.equal((await call(`/developer/updates/${next.id}/cancel`, 1, 'POST')).data.item.status, 'canceled')
  assert.equal((await call('/update-schedule', 2)).data.item, null)
})
