import express from 'express'

// Live updates: instead of every open screen asking the server every 10 seconds whether something changed, each tab keeps
// one connection open (GET /api/live, Server-Sent Events) and the server tells it, in a fraction of a second, which kind
// of data changed. The screen then fetches what it shows, as it already did on its timer. Only the kind of change
// travels, never the data: every screen still reads through its own routes and permissions.
// The kinds ("topics"):
// - notifications: the bell (notifications, their read marks and preferences);
// - finance: Gestão Financeira (payables, receivables, banks, statements, DRE, plan of accounts, suppliers);
// - data: everything else (offers, OS, operation, stock, machines, registrations, planning...).
// One API process is assumed, as for the sessions and the request limit: the connections live in its memory.
export const topics = ['notifications', 'finance', 'data']
const COALESCE_MS = 80
const HEARTBEAT_MS = 25000

// The store names (store.js) and the first part of the API address of a change, by kind. A name that is nobody's view
// (appearance preferences, internal sequences of the migrations) changes nothing on the screens.
const notificationNames = /^(operationalNotifications|payableNotifications|receivableNotifications|adminNotificationPreferences|notificationInventory\w*)$/
const financeNames = /^(payable|receivable|bank|dre|account(Groups|PlanVersion)|classification|supplier)/
const quietNames = /^(adminAppearancePreferences|migrations)$/
export function topicOfName(name) {
  if (quietNames.test(name)) return null
  if (notificationNames.test(name)) return 'notifications'
  return financeNames.test(name) ? 'finance' : 'data'
}
const financeRoutes = new Set(['payables', 'receivables', 'bank-statements', 'dre', 'dre-adjustments', 'classifications', 'account-groups', 'suppliers', 'ai-reconciliations'])
const quietRoutes = new Set(['auth', 'account', 'live', 'password-resets'])
export function topicOfRoute(path) {
  const first = String(path).split('/').filter(Boolean)[0]?.toLowerCase()
  if (!first || quietRoutes.has(first)) return null
  if (first === 'notifications') return 'notifications'
  return financeRoutes.has(first) ? 'finance' : 'data'
}

export function createLiveUpdates({ coalesceMs = COALESCE_MS, heartbeatMs = HEARTBEAT_MS } = {}) {
  const clients = new Set()
  let pending = new Set(), timer = null
  // Changes close together (a save that touches offers, OS and notifications; several operators at once) go as one message.
  function publish(list) {
    for (const topic of list) if (topics.includes(topic)) pending.add(topic)
    if (!pending.size || timer) return
    timer = setTimeout(() => {
      const message = `data: ${JSON.stringify({ topics: [...pending] })}\n\n`
      pending = new Set()
      timer = null
      for (const client of clients) client(message)
    }, coalesceMs)
  }

  // Changes saved in the store, by whatever made them (a screen, the operator, the reminders and stock checks of the server).
  const fromStore = (names) => publish(names.map(topicOfName).filter(Boolean))

  // Changes saved through the API outside the store (OS operation, stock, employees and administrators live in their own
  // tables): every write answered with success.
  function fromRequests(request, response, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next()
    const topic = topicOfRoute(request.path)
    if (topic) response.once('finish', () => { if (response.statusCode < 400) publish([topic]) })
    next()
  }

  function router(requireSession) {
    const live = express.Router()
    live.get('/live', requireSession, (request, response) => {
      // no-transform keeps the compression (webServer.js) from holding the messages back; X-Accel-Buffering does the same
      // for an nginx in front of the portal.
      response.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' })
      response.flushHeaders()
      const send = (text) => response.write(text)
      send(': aberto\n\n')
      clients.add(send)
      // A comment every 25 s keeps the hosting balancer from closing a connection that has been quiet.
      const beat = setInterval(() => send(': ok\n\n'), heartbeatMs)
      request.on('close', () => { clearInterval(beat); clients.delete(send) })
    })
    return live
  }

  return { publish, fromStore, fromRequests, router, get connections() { return clients.size } }
}
