import express from 'express'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readdir, stat, statfs } from 'node:fs/promises'
import { isDeveloper } from './developers.js'
import { cut, deviceOf, errorDetails, logLevels, logSources } from './systemLog.js'
import { missingStoredFiles, storedFileInventory } from './storedFiles.js'
import { editReleaseNotes, listReleaseNotes } from './releaseNoteEdits.js'
import { mutateStore } from './store.js'
import { operatorConfigured } from './operatorAuth.js'
import { developerUsers } from './developerUsers.js'

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
// The codes of OS mentioned in a log ("OS-2026-0019", "OS-2026-TREINO").
const orderCodes = /\bOS-\d{4}-[0-9A-Z]{3,}\b/g
export const validOrderCode = (code) => /^OS-\d{4}-[0-9A-Z]{3,}$/.test(String(code || ''))
const DIAGNOSTIC_LIMIT = 30
// Nothing secret goes into a diagnosis: the hashes of the tablet sessions and anything named like a token or password.
const secretField = /token|hash|password|senha|secret/i
export function withoutSecrets(value) {
  if (Array.isArray(value)) return value.map(withoutSecrets)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !secretField.test(key)).map(([key, item]) => [key, withoutSecrets(item)]))
}
const parseJson = (value) => { if (value && typeof value === 'object') return value; try { return JSON.parse(value) } catch { return null } }
// The fields of an OS a diagnosis needs (no prices, no attachments).
const orderFields = ['code', 'offerId', 'createdAt', 'registeredAt', 'deadline', 'quantity', 'quantityUnit', 'service', 'company', 'entryMode', 'status', 'completedAt', 'acknowledgedAt', 'reopenedAt']

// `live`: the live updates (who holds a connection); `readStore`: the portal data; `config()`: the settings in force,
// without the value of any secret; `version`: the newest entry of the release notes.
// `interfaceDirectory`: the built interface (dist/), whose version.json says the version the server publishes now.
export default function createDeveloperRouter({ accounts, requireAdmin, requireSession, systemLog, live, pool, readStore, dataDirectory, interfaceDirectory = null, config = () => ({}), version = null, updates = null, now = Date.now, changeStore = mutateStore, userActivity = null }) {
  const router = express.Router()
  // The build of the interface published now (the same one "Nova versão" compares), read again once a minute.
  let buildCache = null
  function currentBuild() {
    if (!interfaceDirectory) return null
    if (buildCache && now() - buildCache.at < MINUTE) return buildCache.value
    let value = null
    try { value = JSON.parse(readFileSync(path.join(interfaceDirectory, 'version.json'), 'utf8')).version || null } catch { value = null }
    buildCache = { at: now(), value }
    return value
  }
  const handle = (fn) => async (request, response, next) => { try { await fn(request, response) } catch (error) { next(error) } }

  router.get('/release-notes', requireAdmin, handle(async (_request, response) => {
    response.set('Cache-Control', 'no-store').json({ items: listReleaseNotes(await readStore()) })
  }))

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
      const row = people.get(key) || { key, name: peer.name || (peer.role === 'operator' ? 'Operador (tablet)' : 'Sem nome'), role: peer.role, tabs: 0, since: peer.since, lastAt: null, ip: peer.ip, device: deviceOf(peer.userAgent), requests: 0, version: null, build: null }
      row.tabs += 1
      row.since = Math.min(row.since, peer.since)
      if (peer.build) Object.assign(row, { version: peer.version || null, build: peer.build })
      people.set(key, row)
    }
    for (const item of systemLog.activity(60)) {
      const row = people.get(item.key) || { key: item.key, name: item.name, role: item.role, tabs: 0, since: item.firstAt, lastAt: null, ip: item.ip, device: deviceOf(item.userAgent), requests: 0, version: null, build: null }
      row.lastAt = item.lastAt
      row.requests = item.requests
      // The latest request says the version open now (a reload after an update changes it).
      if (item.build || !row.build) Object.assign(row, { version: item.version || null, build: item.build || null })
      people.set(item.key, row)
    }
    const at = now(), build = currentBuild()
    // Outdated: a build different from the one published now, or none at all (a tab opened before the version was sent).
    const rows = [...people.values()].map((row) => ({ ...row, online: row.tabs > 0 || (row.lastAt != null && at - row.lastAt <= ONLINE_MS), outdated: Boolean(build) && row.build !== build }))
      .sort((a, b) => Number(b.online) - Number(a.online) || (b.lastAt || b.since) - (a.lastAt || a.since))
    const online = rows.filter((row) => row.online)
    const outdated = online.filter((row) => row.outdated)
    return {
      people: rows, online: online.filter((row) => row.role !== 'operator').length, tablets: online.filter((row) => row.role === 'operator').length, connections: live?.connections || 0, rule: 'Online: com o portal aberto e visível (conexão ao vivo) ou com atividade nos últimos 5 minutos.',
      build, outdated: { people: outdated.filter((row) => row.role !== 'operator').length, tablets: outdated.filter((row) => row.role === 'operator').length },
    }
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

  async function overview({ fresh = false, includeUsers = false, includeMetricWindow = false } = {}) {
    const memory = process.memoryUsage(), at = now()
    const store = await readStore()
    const [database, { through, ...logs24 }, logs1, storage] = await Promise.all([databaseInfo(), systemLog.summary(at - DAY, includeMetricWindow ? at : 0), systemLog.summary(at - HOUR), storageInfo(store, fresh)])
    const online = onlineUsers()
    const users = includeUsers && userActivity ? await developerUsers(accounts, online, userActivity, Boolean(store.operatorAccount) || operatorConfigured()).catch(() => null) : null
    return {
      generatedAt: at, version,
      server: { startedAt: systemLog.startedAt, uptimeSeconds: Math.round(process.uptime()), node: process.version, platform: `${os.type()} ${os.release()} (${process.arch})`, hostname: os.hostname(), pid: process.pid, cpus: os.cpus().length, loadAverage: os.loadavg().map((value) => Math.round(value * 100) / 100), memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external }, systemMemory: { free: os.freemem(), total: os.totalmem() }, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, serverTime: bahia(at) },
      config: config(), database, storage, data: storeInfo(store), online, ...(includeUsers && { users }), logs: { day: logs24, hour: logs1 },
      ...(includeMetricWindow && { logWindow: { since: at - DAY, until: at, through } }), traffic: systemLog.traffic(60, includeMetricWindow ? at : undefined),
    }
  }

  const logCursor = (value) => typeof value === 'string' && /^(?:\d{1,20}|m-[a-z0-9]{1,16}-[a-z0-9]{1,16})$/.test(value) ? value : null
  const timestamp = (value) => /^\d{1,15}$/.test(String(value || '')) ? Number(value) : 0
  const filtersOf = (query) => ({
    levels: String(query.level || '').split(',').filter((level) => logLevels.includes(level)),
    source: logSources.includes(query.source) ? query.source : '',
    search: String(query.search || '').trim().slice(0, 120),
    since: Number(query.since) || 0,
    until: timestamp(query.until),
    before: logCursor(query.before),
    through: logCursor(query.through),
    limit: Math.min(500, Number(query.limit) || 200),
  })

  router.get('/developer/overview', handle(async (request, response) => {
    response.set('Cache-Control', 'no-store').json(await overview({ fresh: request.query.fresh === '1', includeUsers: Boolean(userActivity), includeMetricWindow: true }))
  }))
  router.get('/developer/logs', handle(async (request, response) => {
    const filters = filtersOf(request.query)
    const items = await systemLog.list(filters)
    response.set('Cache-Control', 'no-store').json({ items, more: items.length === filters.limit })
  }))
  router.put('/developer/release-notes/:version', handle(async (request, response) => {
    const { item, changed } = await changeStore((store) => editReleaseNotes(store, request.params.version, request.body || {}))
    if (changed) systemLog.record({ level: 'info', source: 'system', user: request.developer.name, message: `Notas de atualização da versão ${item.version} editadas.` })
    response.json({ item })
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
  // Diagnóstico da OS: its basic data, the state of the operation and every event (MySQL or the portal data), to find
  // out why something about it was refused or failed.
  async function orderDiagnostic(code, store) {
    const order = (store.orders || []).find((item) => item.code === code)
    if (!order) return { codigo: code, encontrada: false }
    let operation = order.operation || null, events = order.operationEvents || []
    if (pool) {
      const [[stored]] = await pool.execute('SELECT data FROM order_operations WHERE order_code = ?', [code]).catch(() => [[]])
      operation = stored ? parseJson(stored.data) : null
      events = (await pool.execute('SELECT data FROM order_operation_events WHERE order_code = ? ORDER BY seq', [code]).catch(() => [[]]))[0].map((row) => parseJson(row.data)).filter(Boolean)
    }
    const offer = (store.offers || []).find((item) => item.id === order.offerId)
    return {
      codigo: code, encontrada: true,
      os: { ...Object.fromEntries(orderFields.filter((key) => order[key] !== undefined).map((key) => [key, order[key]])), offerCode: offer?.code || null, stages: order.resources?.stages || [], urgency: order.resources?.urgency || null },
      operacao: withoutSecrets(operation), totalEventos: events.length, eventos: withoutSecrets(events),
    }
  }
  // The OS that appear in the warnings and errors of the period, the most mentioned first.
  async function diagnostics(logs, store) {
    const counts = new Map()
    for (const entry of logs) {
      if (entry.level === 'info') continue
      for (const code of new Set(`${entry.message} ${JSON.stringify(entry.details || '')}`.match(orderCodes) || [])) counts.set(code, (counts.get(code) || 0) + 1)
    }
    const codes = [...counts].sort((a, b) => b[1] - a[1]).slice(0, DIAGNOSTIC_LIMIT)
    return Promise.all(codes.map(async ([code, mentions]) => ({ ...(await orderDiagnostic(code, store)), mencoesNosLogs: mentions })))
  }
  const stampOf = (at) => new Date(at - 3 * HOUR).toISOString().slice(0, 16).replace('T', '-').replace(':', '')
  router.get('/developer/diagnostics/:code', handle(async (request, response) => {
    const code = String(request.params.code || '').trim().toUpperCase()
    if (!validOrderCode(code)) return response.status(400).json({ message: 'Informe o código da OS, por exemplo OS-2026-0001.' })
    const at = now(), store = await readStore()
    const item = await orderDiagnostic(code, store)
    if (!item.encontrada) return response.status(404).json({ message: `${code} não encontrada.` })
    const logs = (await systemLog.list({ search: code, since: at - 30 * DAY, limit: 500 })).map((entry) => ({ quando: bahia(entry.at), ...entry }))
    systemLog.record({ level: 'info', source: 'system', user: request.developer.name, message: `Diagnóstico da ${code} exportado na tela Desenvolvedor.` })
    response.set({ 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="diagnostico-${code}-${stampOf(at)}.json"` }).type('application/json').send(JSON.stringify({
      about: `Diagnóstico da ${code} exportado na tela Desenvolvedor: dados básicos da OS, estado da operação, todos os eventos e os logs dos últimos 30 dias que citam a OS. Horários em ISO (UTC) ou milissegundos desde 1970; "quando" traz o horário da Bahia.`,
      exportedAt: at, exportedAtBahia: bahia(at), exportedBy: request.developer.name, version, diagnostico: item, logs,
    }, null, 2))
  }))
  router.get('/developer/requests', handle(async (request, response) => {
    const until = timestamp(request.query.until)
    const items = until ? systemLog.recentRequests().filter((item) => item.at >= until - HOUR && item.at <= until) : systemLog.recentRequests(300)
    response.set('Cache-Control', 'no-store').json({ items })
  }))
  // Everything in one file: the state of the system, who is online, the saved logs of the period and the latest requests.
  router.get('/developer/export', handle(async (request, response) => {
    const days = Math.min(30, Math.max(1, Number(request.query.days) || 7)), at = now()
    systemLog.record({ level: 'info', source: 'system', user: request.developer.name, message: `Logs exportados na tela Desenvolvedor (últimos ${days} ${days === 1 ? 'dia' : 'dias'}).` })
    const [state, logs, store] = await Promise.all([overview({ fresh: true }), systemLog.list({ since: at - days * DAY, limit: 20000 }), readStore()])
    const stamp = stampOf(at)
    response.set({ 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="logs-portal-gmac-${stamp}.json"` }).type('application/json').send(JSON.stringify({
      about: 'Logs do Portal GMAC exportados na tela Desenvolvedor. Horários em milissegundos desde 1970 (UTC); "quando" traz o horário da Bahia. Senhas, tokens e o conteúdo das requisições nunca são registrados.',
      exportedAt: at, exportedAtBahia: bahia(at), exportedBy: request.developer.name, period: { days, since: at - days * DAY },
      system: state, logs: logs.map((entry) => ({ quando: bahia(entry.at), ...entry })),
      // Sessions still refused again and again (counted, not yet in the logs above).
      sessoesRecusadasEmAndamento: systemLog.unauthorizedGroups().map((group) => ({ desde: bahia(group.firstAt), ultima: bahia(group.lastAt), ...group })),
      diagnosticos: await diagnostics(logs, store),
      recentRequests: systemLog.recentRequests(3000).map((item) => ({ quando: bahia(item.at), ...item })),
    }, null, 2))
  }))
  return router
}
