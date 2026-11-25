import express from 'express'
import os from 'node:os'
import path from 'node:path'
import { readdir, stat, statfs } from 'node:fs/promises'
import { isDeveloper } from './developers.js'
import { cut, deviceOf, errorDetails, logLevels, logSources } from './systemLog.js'
import { missingStoredFiles, storedFileInventory } from './storedFiles.js'

// Tela Desenvolvedor (only the accounts of developers.js): the logs of the system, who is online, the state of the
// server, database and storage, and the export of everything in one JSON file to hand over when solving a problem.
// POST /client-logs is open to every session (administrators, administrative employees and the operator's tablet): the
// browsers send their errors there.
const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR
const ONLINE_MS = 5 * MINUTE
const CLIENT_LIMIT = 40, CLIENT_WINDOW_MS = 5 * MINUTE
// What else a browser sent about its error, kept small.
const extraOf = (value) => {
  if (!value || typeof value !== 'object') return undefined
  try { const text = JSON.stringify(value); return text.length > 3000 ? { texto: cut(text, 3000) } : value } catch { return undefined }
}
const bahia = (ms) => new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })

// `live`: the live updates (who holds a connection); `readStore`: the portal data; `config()`: the settings in force,
// without the value of any secret; `version`: the newest entry of the release notes.
export default function createDeveloperRouter({ accounts, requireAdmin, requireSession, systemLog, live, pool, readStore, dataDirectory, config = () => ({}), version = null, updates = null, now = Date.now }) {
  const router = express.Router()
  const handle = (fn) => async (request, response, next) => { try { await fn(request, response) } catch (error) { next(error) } }

  // Programar atualização: every screen of the administrative portal reads the next update for its countdown.
  if (updates) router.get('/update-schedule', requireAdmin, handle(async (_request, response) => {
    response.set('Cache-Control', 'no-store').json({ item: await updates.next(), now: now() })
  }))

  // Errors of the browsers (screen crashes, failed promises): a few per minute per address, so a loop cannot flood the logs.
  const clientWindows = new Map()
  router.post('/client-logs', requireSession, (request, response) => {
    const key = request.ip, at = now()
    const window = clientWindows.get(key)
    const current = window && at - window.start < CLIENT_WINDOW_MS ? window : { start: at, count: 0 }
    const entries = (Array.isArray(request.body?.entries) ? request.body.entries : []).slice(0, 10)
    const room = Math.max(0, CLIENT_LIMIT - current.count)
    current.count += Math.min(room, entries.length)
    clientWindows.set(key, current)
    if (clientWindows.size > 2000) for (const [address, item] of clientWindows) if (at - item.start >= CLIENT_WINDOW_MS) clientWindows.delete(address)
    const who = request.adminName ? `${request.adminName}` : request.adminId == null ? 'Operador (tablet)' : null
    const userAgent = String(request.headers['user-agent'] || '')
    for (const entry of entries.slice(0, room)) {
      if (!entry || typeof entry !== 'object') continue
      systemLog.record({
        level: logLevels.includes(entry.level) ? entry.level : 'error', source: 'browser', user: who, message: cut(entry.message, 900),
        details: { screen: cut(entry.screen, 120), page: cut(entry.page, 300), kind: cut(entry.kind, 40), stack: cut(entry.stack, 6000), version: cut(entry.version, 20), viewport: cut(entry.viewport, 40), language: cut(entry.language, 20), online: entry.online !== false, at: Number(entry.at) || null, device: deviceOf(userAgent), userAgent: cut(userAgent, 300), ip: request.ip, extra: extraOf(entry.extra) },
      })
    }
    response.status(204).end()
  })

  // Only developers, checked here by the CPF of the account (the menu just hides the item for the others).
  router.use('/developer', requireAdmin, async (request, response, next) => {
    try {
      const account = await accounts.account(request.adminId)
      if (!isDeveloper(account)) return response.status(403).json({ message: 'Somente os desenvolvedores acessam esta área.' })
      request.developer = account
      next()
    } catch (error) { next(error) }
  })

  // Who is online: tabs with the live connection open (the portal in view) and whoever made requests in the last minutes.
  function onlineUsers() {
    const people = new Map()
    const keyOf = (item) => item.role === 'operator' ? `operator:${item.ip}|${item.userAgent}` : `${item.role}:${item.userId}`
    for (const peer of live?.peers || []) {
      const key = keyOf(peer)
      const row = people.get(key) || { key, name: peer.name || (peer.role === 'operator' ? 'Operador (tablet)' : 'Sem nome'), role: peer.role, tabs: 0, since: peer.since, lastAt: null, ip: peer.ip, device: deviceOf(peer.userAgent), requests: 0 }
      row.tabs += 1
      row.since = Math.min(row.since, peer.since)
      people.set(key, row)
    }
    for (const item of systemLog.activity(60)) {
      const row = people.get(item.key) || { key: item.key, name: item.name, role: item.role, tabs: 0, since: item.firstAt, lastAt: null, ip: item.ip, device: deviceOf(item.userAgent), requests: 0 }
      row.lastAt = item.lastAt
      row.requests = item.requests
      people.set(item.key, row)
    }
    const at = now()
    const rows = [...people.values()].map((row) => ({ ...row, online: row.tabs > 0 || (row.lastAt != null && at - row.lastAt <= ONLINE_MS) }))
      .sort((a, b) => Number(b.online) - Number(a.online) || (b.lastAt || b.since) - (a.lastAt || a.since))
    const online = rows.filter((row) => row.online)
    return { people: rows, online: online.filter((row) => row.role !== 'operator').length, tablets: online.filter((row) => row.role === 'operator').length, connections: live?.connections || 0, rule: 'Online: com o portal aberto e visível (conexão ao vivo) ou com atividade nos últimos 5 minutos.' }
  }

  async function databaseInfo() {
    if (!pool) return { connected: false }
    const started = process.hrtime.bigint()
    try {
      await pool.query('SELECT 1')
      const latencyMs = Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10
      const [[server]] = await pool.query('SELECT VERSION() AS version, @@time_zone AS timeZone, @@max_connections AS maxConnections')
      const [[store]] = await pool.query('SELECT revision, updated_at AS updatedAt FROM portal_store WHERE id = 1').catch(() => [[{}]])
      const [[threads]] = await pool.query("SHOW STATUS LIKE 'Threads_connected'").catch(() => [[{}]])
      return { connected: true, latencyMs, version: server.version, timeZone: server.timeZone, maxConnections: Number(server.maxConnections), connectedThreads: Number(threads?.Value) || null, storeRevision: store?.revision != null ? Number(store.revision) : null, storeUpdatedAt: store?.updatedAt ? new Date(store.updatedAt).getTime() : null, poolLimit: pool.pool?.config?.connectionLimit ?? null }
    } catch (error) { return { connected: false, error: errorDetails(error) } }
  }

  // Disk space, backups and attachments whose document is missing: heavier, kept for 10 minutes.
  let storageCache = null
  async function storageInfo(store, fresh = false) {
    if (!fresh && storageCache && now() - storageCache.at < 10 * MINUTE) return storageCache.value
    const value = { dataDirectory, dataDirConfigured: Boolean(process.env.DATA_DIR) }
    try { const disk = await statfs(dataDirectory); value.disk = { freeBytes: Number(disk.bavail) * Number(disk.bsize), totalBytes: Number(disk.blocks) * Number(disk.bsize) } } catch (error) { value.diskError = error.message }
    try {
      const folder = path.join(dataDirectory, 'backups')
      const names = (await readdir(folder)).filter((name) => name.endsWith('.json')).sort()
      const last = names.at(-1)
      value.backups = { count: names.length, last: last || null, lastAt: last ? (await stat(path.join(folder, last))).mtimeMs : null }
    } catch { value.backups = { count: 0, last: null, lastAt: null } }
    try { value.attachments = (await missingStoredFiles(storedFileInventory(store, dataDirectory))).map(({ label, total, missing }) => ({ label, total, missing: missing.length, examples: missing.slice(0, 5).map((file) => `${file.where} · ${file.name}`) })) } catch (error) { value.attachmentsError = error.message }
    storageCache = { at: now(), value }
    return value
  }

  // The size of each part of the portal data (many items, or a heavy one, explain a slow screen). The total size is
  // measured once a minute.
  let sizeCache = null
  function storeInfo(store) {
    if (!sizeCache || now() - sizeCache.at >= MINUTE) { try { sizeCache = { at: now(), bytes: Buffer.byteLength(JSON.stringify(store)) } } catch { sizeCache = { at: now(), bytes: null } } }
    const collections = Object.entries(store).filter(([, value]) => Array.isArray(value)).map(([name, value]) => ({ name, items: value.length })).sort((a, b) => b.items - a.items)
    return { collections, bytes: sizeCache.bytes, openTickets: (store.supportTickets || []).filter((ticket) => ticket.status !== 'closed').length }
  }

  async function overview({ fresh = false } = {}) {
    const memory = process.memoryUsage(), at = now()
    const store = await readStore()
    const [database, logs24, logs1, storage] = await Promise.all([databaseInfo(), systemLog.summary(at - DAY), systemLog.summary(at - HOUR), storageInfo(store, fresh)])
    return {
      generatedAt: at, version,
      server: { startedAt: systemLog.startedAt, uptimeSeconds: Math.round(process.uptime()), node: process.version, platform: `${os.type()} ${os.release()} (${process.arch})`, hostname: os.hostname(), pid: process.pid, cpus: os.cpus().length, loadAverage: os.loadavg().map((value) => Math.round(value * 100) / 100), memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external }, systemMemory: { free: os.freemem(), total: os.totalmem() }, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, serverTime: bahia(at) },
      config: config(), database, storage, data: storeInfo(store), online: onlineUsers(), logs: { day: logs24, hour: logs1 }, traffic: systemLog.traffic(60),
    }
  }

  const filtersOf = (query) => ({
    levels: String(query.level || '').split(',').filter((level) => logLevels.includes(level)),
    source: logSources.includes(query.source) ? query.source : '',
    search: String(query.search || '').trim().slice(0, 120),
    since: Number(query.since) || 0,
    before: /^\d+$/.test(String(query.before || '')) ? query.before : null,
    limit: Math.min(500, Number(query.limit) || 200),
  })

  router.get('/developer/overview', handle(async (request, response) => {
    response.set('Cache-Control', 'no-store').json(await overview({ fresh: request.query.fresh === '1' }))
  }))
  router.get('/developer/logs', handle(async (request, response) => {
    const filters = filtersOf(request.query)
    const items = await systemLog.list(filters)
    response.set('Cache-Control', 'no-store').json({ items, more: items.length === filters.limit })
  }))
  // Programar atualização (server/updateSchedule.js): list, schedule, reschedule, cancel and close an update by hand.
  if (updates) {
    const note = (request, message) => systemLog.record({ level: 'info', source: 'system', user: request.developer.name, message })
    const actor = (request) => ({ id: request.developer.id, name: request.developer.name })
    router.get('/developer/updates', handle(async (_request, response) => { response.set('Cache-Control', 'no-store').json(await updates.list()) }))
    router.post('/developer/updates', handle(async (request, response) => {
      const item = await updates.create(request.body, actor(request))
      note(request, `Atualização do portal programada para ${bahia(Date.parse(item.at))}.`)
      response.status(201).json({ item })
    }))
    router.put('/developer/updates/:id', handle(async (request, response) => {
      const item = await updates.reschedule(request.params.id, request.body, actor(request))
      note(request, `Atualização programada alterada: ${bahia(Date.parse(item.at))}.`)
      response.json({ item })
    }))
    router.post('/developer/updates/:id/cancel', handle(async (request, response) => {
      const item = await updates.cancel(request.params.id, actor(request))
      note(request, `Atualização programada para ${bahia(Date.parse(item.at))} cancelada.`)
      response.json({ item })
    }))
    router.post('/developer/updates/:id/finish', handle(async (request, response) => {
      const item = await updates.finish(request.params.id, actor(request))
      note(request, 'Atualização programada marcada como concluída.')
      response.json({ item })
    }))
  }
  router.get('/developer/requests', handle(async (_request, response) => {
    response.set('Cache-Control', 'no-store').json({ items: systemLog.recentRequests(300) })
  }))
  // Everything in one file: the state of the system, who is online, the saved logs of the period and the latest requests.
  router.get('/developer/export', handle(async (request, response) => {
    const days = Math.min(30, Math.max(1, Number(request.query.days) || 7)), at = now()
    systemLog.record({ level: 'info', source: 'system', user: request.developer.name, message: `Logs exportados na tela Desenvolvedor (últimos ${days} ${days === 1 ? 'dia' : 'dias'}).` })
    const [state, logs] = await Promise.all([overview({ fresh: true }), systemLog.list({ since: at - days * DAY, limit: 20000 })])
    const stamp = new Date(at - 3 * HOUR).toISOString().slice(0, 16).replace('T', '-').replace(':', '')
    response.set({ 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="logs-portal-gmac-${stamp}.json"` }).type('application/json').send(JSON.stringify({
      about: 'Logs do Portal GMAC exportados na tela Desenvolvedor. Horários em milissegundos desde 1970 (UTC); "quando" traz o horário da Bahia. Senhas, tokens e o conteúdo das requisições nunca são registrados.',
      exportedAt: at, exportedAtBahia: bahia(at), exportedBy: request.developer.name, period: { days, since: at - days * DAY },
      system: state, logs: logs.map((entry) => ({ quando: bahia(entry.at), ...entry })), recentRequests: systemLog.recentRequests(3000).map((item) => ({ quando: bahia(item.at), ...item })),
    }, null, 2))
  }))
  return router
}
