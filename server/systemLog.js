import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { format } from 'node:util'

// Logs do sistema (tela Desenvolvedor): what the server says (console), what goes wrong or changes data in the API, what
// breaks in the browsers and how the process starts and stops, in one list the developers read and export to solve
// problems. Warnings, errors and changes are saved in MySQL (`system_logs`, 30 days) and survive a restart or a deploy;
// the routine reads (GET answered with success) stay only in memory (the last ones), for the request statistics.
// Never recorded: passwords, tokens, the body of the requests, the contents of files.
export const logLevels = ['error', 'warn', 'info']
export const logSources = ['server', 'request', 'browser', 'system']
const MEMORY = 3000
const RETENTION_MS = 30 * 86400000
const FLUSH_MS = 2000
export const SLOW_MS = 3000
const MINUTE = 60000

export const cut = (value, limit) => { const result = String(value ?? ''); return result.length > limit ? `${result.slice(0, limit)}…` : result }
const secretKeys = /token|password|senha|secret|authorization|cpf/i
// The address of a request without the value of anything secret in its query.
export function safePath(url) {
  const [route, query = ''] = String(url || '').split('?')
  if (!query) return cut(route, 300)
  const params = new URLSearchParams(query)
  for (const key of [...new Set(params.keys())]) if (secretKeys.test(key)) params.set(key, '***')
  return cut(`${route}?${params}`, 400)
}
// The same route whatever the record: ids, codes and numbers become ":id" (statistics by route).
export const routeKey = (method, url) => `${method} ${String(url || '').split('?')[0].split('/').map((part) => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(part) || /\d/.test(part) && part.length > 2 || /^\d+$/.test(part) ? ':id' : part).join('/')}`
export function errorDetails(error) {
  if (!error || typeof error !== 'object') return error == null ? null : { message: cut(error, 2000) }
  return { name: error.name, message: cut(error.message, 2000), ...(error.status ? { status: error.status } : {}), ...(error.code ? { code: String(error.code) } : {}), stack: cut(error.stack, 6000) }
}
// "Chrome 131 · Windows" from the user agent of a browser (enough to tell the tablet from a computer).
export function deviceOf(userAgent) {
  const ua = String(userAgent || '')
  if (!ua) return ''
  const browser = [[/Edg\/(\d+)/, 'Edge'], [/OPR\/(\d+)/, 'Opera'], [/SamsungBrowser\/(\d+)/, 'Samsung Internet'], [/Firefox\/(\d+)/, 'Firefox'], [/Chrome\/(\d+)/, 'Chrome'], [/Version\/(\d+).*Safari/, 'Safari']].find(([pattern]) => pattern.test(ua))
  const system = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android (celular)' : 'Android (tablet)') : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Outro sistema'
  return browser ? `${browser[1]} ${ua.match(browser[0])[1]} · ${system}` : system
}
const percentile = (values, share) => { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] }

// `identify(request)`: who made a request ({ key, name, role } or null); `crashFile`: where the last words of a process
// that stops go (read back on the next start).
export function createSystemLog({ pool: database = null, identify = () => null, crashFile = null, now = Date.now } = {}) {
  let pool = database
  const startedAt = now()
  const memory = [], requests = [], seen = new Map()
  let queue = [], timer = null, chain = Promise.resolve(), table = null, sequence = 0, failing = false
  const original = Object.fromEntries(['log', 'info', 'warn', 'error'].map((method) => [method, console[method].bind(console)]))
  const keep = (list, item) => { list.push(item); if (list.length > MEMORY) list.splice(0, list.length - MEMORY) }

  function record({ level = 'info', source = 'server', message, user = null, details = null, at = now(), persist = true }) {
    const entry = { id: `m-${startedAt.toString(36)}-${(++sequence).toString(36)}`, at, level: logLevels.includes(level) ? level : 'info', source: logSources.includes(source) ? source : 'server', message: cut(message, 1000) || '(sem mensagem)', user: user ? cut(user, 160) : null, details: details || null }
    keep(memory, entry)
    // What comes before the database is connected waits in the queue (the start of the server).
    if (persist) {
      queue.push(entry)
      if (queue.length > 5000) queue.splice(0, queue.length - 5000)
      if (pool && !timer) { timer = setTimeout(() => { timer = null; flush() }, FLUSH_MS); timer.unref?.() }
    }
    return entry
  }

  const ready = () => (table ||= pool.query(`CREATE TABLE IF NOT EXISTS system_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    at BIGINT NOT NULL,
    level VARCHAR(8) NOT NULL,
    source VARCHAR(16) NOT NULL,
    message VARCHAR(1200) NOT NULL,
    user_name VARCHAR(160) NULL,
    details MEDIUMTEXT NULL,
    INDEX system_logs_at (at),
    INDEX system_logs_level (level, at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch((error) => { table = null; throw error }))

  async function writeQueue() {
    while (queue.length && pool) {
      const batch = queue.splice(0, 300)
      try {
        await ready()
        await pool.query('INSERT INTO system_logs (at, level, source, message, user_name, details) VALUES ?', [batch.map((entry) => [entry.at, entry.level, entry.source, entry.message, entry.user, entry.details ? cut(JSON.stringify(entry.details), 60000) : null])])
        failing = false
      } catch (error) {
        // Told once, on the server's own output (never through the captured console, which would log it again).
        if (!failing) original.error('Falha ao gravar os logs do sistema no banco:', error.message)
        failing = true
        return
      }
    }
  }
  function flush() { chain = chain.then(writeQueue, writeQueue); return chain }
  // The database of the portal, once it is configured: what waited in the queue is saved.
  function connect(nextPool) { pool = nextPool; return flush() }

  // Everything the server writes on its output also goes to the logs, as before on the screen of the hosting.
  function captureConsole() {
    let inside = false
    for (const [method, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) {
      console[method] = (...args) => {
        original[method](...args)
        if (inside) return
        inside = true
        try {
          const error = args.find((arg) => arg instanceof Error)
          record({ level, source: 'server', message: format(...args), details: error ? errorDetails(error) : null })
        } catch { /* a log never breaks the server */ } finally { inside = false }
      }
    }
  }

  // The API requests: all of them in memory (statistics), and the failed, slow or changing ones in the saved logs.
  function requestLogger(request, response, next) {
    const started = process.hrtime.bigint()
    const json = response.json.bind(response)
    response.json = (body) => {
      if (response.statusCode >= 400 && body && typeof body.message === 'string') response.locals.logMessage = body.message
      return json(body)
    }
    response.once('finish', () => { try { finished(request, response, Number(process.hrtime.bigint() - started) / 1e6) } catch { /* a log never breaks a request */ } })
    next()
  }
  function finished(request, response, elapsed) {
    const url = request.originalUrl || request.url
    // The live connection stays open for as long as the tab: it is not a request to measure.
    if (/^\/api\/live(\?|$)/.test(url)) return
    const ms = Math.round(elapsed), status = response.statusCode, route = safePath(url), method = request.method
    const who = (() => { try { return identify(request) } catch { return null } })()
    const userAgent = String(request.headers['user-agent'] || '')
    keep(requests, { at: now(), method, route, key: routeKey(method, url), status, ms, user: who?.name || null, role: who?.role || null })
    if (who?.key && status < 400) {
      const previous = seen.get(who.key)
      seen.set(who.key, { ...who, firstAt: previous?.firstAt || now(), lastAt: now(), requests: (previous?.requests || 0) + 1, ip: request.ip, userAgent: cut(userAgent, 300) })
    }
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(method)
    const level = status >= 500 ? 'error' : status >= 400 || ms >= SLOW_MS ? 'warn' : 'info'
    // Routine reads, the browser logs themselves and the reads of the Desenvolvedor screen stay out of the saved logs.
    if (level === 'info' && (!write || route.startsWith('/api/client-logs'))) return
    const said = response.locals.logMessage ? `: ${response.locals.logMessage}` : status < 400 && ms >= SLOW_MS ? ' (resposta lenta)' : ''
    record({
      level, source: 'request', user: who?.name || null, message: `${method} ${route} → ${status} em ${ms} ms${said}`,
      details: { method, route, status, ms, role: who?.role || null, ip: request.ip, ...(level !== 'info' ? { device: deviceOf(userAgent), userAgent: cut(userAgent, 300) } : {}), ...(response.locals.logError ? { error: errorDetails(response.locals.logError) } : {}) },
    })
  }

  // How the process ends: its last words are written to a file at once (an async write would never finish) and saved
  // as logs on the next start. Listening does not change what Node does: the monitor leaves the crash as it was.
  function watchProcess() {
    const lastWords = (entry) => {
      if (!crashFile) return
      try { mkdirSync(path.dirname(crashFile), { recursive: true }); appendFileSync(crashFile, `${JSON.stringify({ ...entry, at: now() })}\n`) } catch { /* nothing else to do while stopping */ }
    }
    process.on('uncaughtExceptionMonitor', (error, origin) => lastWords({ level: 'error', source: 'system', message: `O servidor parou por um erro não tratado (${origin === 'unhandledRejection' ? 'promessa rejeitada' : 'exceção'}): ${error?.message || error}`, details: errorDetails(error) }))
    process.on('exit', (code) => lastWords({ level: code ? 'error' : 'info', source: 'system', message: `Servidor encerrado (código de saída ${code}).`, details: { code, uptimeMinutes: Math.round((now() - startedAt) / MINUTE) } }))
    process.on('warning', (warning) => record({ level: 'warn', source: 'system', message: `Aviso do Node.js: ${warning.name}: ${warning.message}`, details: errorDetails(warning) }))
  }
  function importLastWords() {
    if (!crashFile || !existsSync(crashFile)) return 0
    let lines = []
    try { lines = readFileSync(crashFile, 'utf8').split('\n').filter(Boolean); rmSync(crashFile, { force: true }) } catch { return 0 }
    for (const line of lines) { try { const entry = JSON.parse(line); record({ ...entry, at: Number(entry.at) || now() }) } catch { /* a broken line is skipped */ } }
    return lines.length
  }

  const parse = (value) => { if (!value) return null; try { return JSON.parse(value) } catch { return { texto: value } } }
  const matches = (entry, { levels, source, search, since, until }) => (!levels?.length || levels.includes(entry.level)) && (!source || entry.source === source) && (!since || entry.at >= since) && (!until || entry.at <= until)
    && (!search || `${entry.message} ${entry.user || ''} ${JSON.stringify(entry.details || '')}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))
  // Newest first. `before`: the id of the last row already shown (the next page).
  async function list({ levels = [], source = '', search = '', since = 0, until = 0, before = null, limit = 200 } = {}) {
    const size = Math.max(1, Math.min(20000, Number(limit) || 200))
    if (!pool) return memory.filter((entry) => matches(entry, { levels, source, search, since, until })).reverse().slice(0, size)
    await flush()
    await ready()
    const where = [], values = []
    if (since) { where.push('at >= ?'); values.push(since) }
    if (until) { where.push('at <= ?'); values.push(until) }
    if (levels.length) { where.push(`level IN (${levels.map(() => '?').join(', ')})`); values.push(...levels) }
    if (source) { where.push('source = ?'); values.push(source) }
    if (search) { where.push('(message LIKE ? OR user_name LIKE ? OR details LIKE ?)'); const like = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`; values.push(like, like, like) }
    if (before) { where.push('id < ?'); values.push(Number(before)) }
    const [rows] = await pool.query(`SELECT id, at, level, source, message, user_name, details FROM system_logs${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${size}`, values)
    return rows.map((row) => ({ id: String(row.id), at: Number(row.at), level: row.level, source: row.source, message: row.message, user: row.user_name, details: parse(row.details) }))
  }
  // How many errors and warnings came in a period, by origin.
  async function summary(since) {
    const counts = { error: 0, warn: 0, info: 0, bySource: {} }
    const rows = pool ? (await flush(), await ready(), (await pool.query('SELECT level, source, COUNT(*) AS total FROM system_logs WHERE at >= ? GROUP BY level, source', [since]))[0])
      : Object.values(memory.filter((entry) => entry.at >= since).reduce((all, entry) => { const key = `${entry.level}|${entry.source}`; all[key] ||= { level: entry.level, source: entry.source, total: 0 }; all[key].total += 1; return all }, {}))
    for (const row of rows) {
      counts[row.level] = (counts[row.level] || 0) + Number(row.total)
      counts.bySource[row.source] ||= { error: 0, warn: 0, info: 0 }
      counts.bySource[row.source][row.level] = Number(row.total)
    }
    if (pool) {
      const [[size]] = await pool.query('SELECT COUNT(*) AS total, MIN(at) AS oldest FROM system_logs')
      counts.saved = Number(size.total)
      counts.oldest = size.oldest == null ? null : Number(size.oldest)
    }
    return counts
  }
  async function prune() {
    if (!pool) return 0
    await ready()
    const [result] = await pool.query('DELETE FROM system_logs WHERE at < ?', [now() - RETENTION_MS])
    return result.affectedRows || 0
  }

  // Requests of the last `minutes`: totals, time and the routes that are slow or fail the most.
  function traffic(minutes = 60) {
    const since = now() - minutes * MINUTE
    const recent = requests.filter((item) => item.at >= since)
    const routes = new Map()
    for (const item of recent) {
      const row = routes.get(item.key) || { route: item.key, count: 0, clientErrors: 0, serverErrors: 0, times: [] }
      row.count += 1
      if (item.status >= 500) row.serverErrors += 1
      else if (item.status >= 400) row.clientErrors += 1
      row.times.push(item.ms)
      routes.set(item.key, row)
    }
    const stats = [...routes.values()].map(({ times, ...row }) => ({ ...row, averageMs: Math.round(times.reduce((sum, value) => sum + value, 0) / times.length), p95Ms: percentile(times, 0.95), maxMs: Math.max(...times) }))
    const times = recent.map((item) => item.ms)
    return {
      minutes, total: recent.length, perMinute: Math.round(recent.length / minutes * 10) / 10,
      clientErrors: recent.filter((item) => item.status >= 400 && item.status < 500).length, serverErrors: recent.filter((item) => item.status >= 500).length,
      averageMs: times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : 0, p95Ms: percentile(times, 0.95), slow: recent.filter((item) => item.ms >= SLOW_MS).length,
      busiest: [...stats].sort((a, b) => b.count - a.count).slice(0, 12), slowest: [...stats].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 12), failing: stats.filter((row) => row.clientErrors + row.serverErrors).sort((a, b) => b.serverErrors - a.serverErrors || b.clientErrors - a.clientErrors).slice(0, 12),
    }
  }
  const recentRequests = (limit = MEMORY) => requests.slice(-limit).reverse()
  // Who made requests in the last `minutes` (accounts and the operator's tablets).
  const activity = (minutes) => [...seen.values()].filter((item) => item.lastAt >= now() - minutes * MINUTE)

  return { startedAt, record, flush, connect, captureConsole, requestLogger, watchProcess, importLastWords, list, summary, prune, traffic, recentRequests, activity, original }
}
