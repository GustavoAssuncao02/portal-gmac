import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { topicOfName, topicOfRoute } from '../server/liveUpdates.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Teste' }

// Opens GET /api/live and returns `next(ms)`: the kinds of data of the next message, or null if none arrives in time.
async function listen(fixture, headers) {
  const controller = new AbortController()
  const response = await fetch(`${fixture.url}/api/live`, { headers, signal: controller.signal })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /^text\/event-stream/)
  const reader = response.body.getReader(), decoder = new TextDecoder(), messages = []
  let buffer = '', waiting = null
  ;(async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        let end
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const data = buffer.slice(0, end).split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5)).join('')
          buffer = buffer.slice(end + 2)
          if (data) { messages.push(JSON.parse(data).topics.sort()); waiting?.() }
        }
      }
    } catch { /* closed by the test */ }
  })()
  return {
    async next(ms = 1000) {
      if (!messages.length) await new Promise((resolve) => { waiting = resolve; setTimeout(resolve, ms) })
      waiting = null
      return messages.shift() ?? null
    },
    close: () => controller.abort(),
  }
}

test('each change is told by kind: the bell, Gestão Financeira or the rest of the data', () => {
  assert.equal(topicOfName('offers'), 'data')
  assert.equal(topicOfName('orders'), 'data')
  assert.equal(topicOfName('machines'), 'data')
  assert.equal(topicOfName('stageCatalog'), 'data')
  for (const name of ['payables', 'payableEvents', 'receivables', 'bankTransactions', 'dreSettings', 'accountGroups', 'classifications', 'suppliers']) assert.equal(topicOfName(name), 'finance', name)
  for (const name of ['operationalNotifications', 'payableNotifications', 'receivableNotifications', 'adminNotificationPreferences', 'notificationInventory']) assert.equal(topicOfName(name), 'notifications', name)
  assert.equal(topicOfName('adminAppearancePreferences'), null, 'the look of one account changes nobody\'s screen')
  assert.equal(topicOfRoute('/operations/orders/OS-1/start'), 'data')
  assert.equal(topicOfRoute('/inventory/5/movements'), 'data')
  assert.equal(topicOfRoute('/payables/7/pay'), 'finance')
  assert.equal(topicOfRoute('/notifications/read-all'), 'notifications')
  for (const path of ['/auth/login', '/account', '/live']) assert.equal(topicOfRoute(path), null, path)
})

test('the open screens hear of a change in a fraction of a second, only when something really changed', async (t) => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  assert.equal((await fetch(`${fixture.url}/api/live`)).status, 401, 'only with a session')
  const admin = await listen(fixture, fixture.admin)
  const operator = await listen(fixture, { Authorization: `Bearer ${fixture.operatorToken}` })
  t.after(() => { admin.close(); operator.close() })

  // A screen saves an offer: both connections hear of it, quickly.
  const started = Date.now()
  assert.equal((await fixture.adminRequest('/offers', 'POST', offerDraft)).status, 201)
  assert.deepEqual(await admin.next(), ['data'])
  const elapsed = Date.now() - started
  assert.ok(elapsed < 1000, `${elapsed} ms`)
  assert.deepEqual(await operator.next(), ['data'], 'the tablets too')

  // A change of the server itself (a reminder, a stock check) goes through the store: the bell and the finance screens.
  await fixture.mutateStore((store) => { store.operationalNotifications = [...(store.operationalNotifications || []), { id: 'aviso-teste', type: 'release', at: new Date().toISOString() }] })
  assert.deepEqual(await admin.next(), ['notifications'])
  // Each kind is told (in one message when the saves are close together, in two when the database takes longer).
  await fixture.mutateStore((store) => { store.suppliers = [...(store.suppliers || []), { id: 'fornecedor-teste', name: 'Fornecedor' }] })
  await fixture.mutateStore((store) => { store.machines = [...(store.machines || []), { id: 'torno-teste', name: 'Torno' }] })
  const told = new Set(await admin.next())
  if (told.size < 2) for (const topic of await admin.next() || []) told.add(topic)
  assert.deepEqual([...told].sort(), ['data', 'finance'])

  // Nothing changed, nothing is told: a save that changes nothing, a refused request, reading.
  await fixture.mutateStore((store) => { store.machines = [...store.machines] })
  assert.equal((await fixture.adminRequest('/offers', 'POST', {})).status >= 400, true)
  await fixture.adminRequest('/offers')
  assert.equal(await admin.next(400), null)
})

test('changes close together go as one message', async () => {
  const { createLiveUpdates } = await import('../server/liveUpdates.js')
  const live = createLiveUpdates({ coalesceMs: 30 })
  const received = []
  // A connection without HTTP: the router's writer is what receives the messages.
  const router = live.router((_request, _response, next) => next())
  const request = Object.assign(new (await import('node:events')).EventEmitter(), { method: 'GET', url: '/live', headers: {} })
  const response = Object.assign(new (await import('node:events')).EventEmitter(), { set() {}, flushHeaders() {}, write: (text) => { received.push(text) } })
  await new Promise((resolve) => { router.handle(request, response, resolve); setTimeout(resolve, 10) })
  live.publish(['data'])
  live.publish(['finance'])
  live.publish(['data', 'desconhecido'])
  await new Promise((resolve) => setTimeout(resolve, 80))
  const messages = received.filter((text) => text.startsWith('data:')).map((text) => JSON.parse(text.slice(5)).topics.sort())
  assert.deepEqual(messages, [['data', 'finance']])
  request.emit('close')
  assert.equal(live.connections, 0)
})

test('a quiet connection gets a sign of life, so the hosting balancer does not close it', async (t) => {
  const { createLiveUpdates } = await import('../server/liveUpdates.js')
  const { default: express } = await import('express')
  const live = createLiveUpdates({ heartbeatMs: 100 })
  const app = express()
  app.use('/api', live.router((_request, _response, next) => next()))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() }))
  const controller = new AbortController()
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/live`, { signal: controller.signal })
  assert.equal(response.headers.get('cache-control'), 'no-store, no-transform')
  assert.equal(response.headers.get('x-accel-buffering'), 'no')
  const reader = response.body.getReader()
  let text = ''
  while (!text.includes(': ok')) text += new TextDecoder().decode((await reader.read()).value)
  assert.equal(live.connections, 1)
  controller.abort()
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(live.connections, 0, 'a closed tab leaves nothing behind')
})
