import { createHash } from 'node:crypto'
import { deviceOf, headerValue } from './systemLog.js'

const DAY = 24 * 60 * 60 * 1000
const SAMPLE_MS = 30000
export const sharedOperatorKey = 'operator:shared'
const tokenId = (token) => createHash('sha256').update(token).digest('hex')
const rangesOf = (value) => typeof value === 'string' ? JSON.parse(value) : value

function mergeRanges(ranges) {
  const merged = []
  for (const [start, end] of ranges.slice().sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

export function summarizeUserActivity(rows, at) {
  const logins = new Map(), windows = []
  let lastActivityAt = null
  for (const row of rows) {
    const ranges = rangesOf(row.activity)
    windows.push(...ranges)
    if (ranges.length) lastActivityAt = Math.max(lastActivityAt ?? 0, ranges.at(-1)[1])
    if (row.loginAt == null) continue
    const login = logins.get(row.loginId) || { at: Number(row.loginAt), ranges: [] }
    login.ranges.push(...ranges)
    logins.set(row.loginId, login)
  }
  const latest = [...logins.values()].sort((a, b) => b.at - a.at)[0]
  const lastSeen = rows.reduce((best, row) => !best || Number(row.lastSeenAt) > Number(best.lastSeenAt) ? row : best, null)
  const duration = (ranges, since) => mergeRanges(ranges).reduce((total, [start, end]) => total + Math.max(0, Math.min(at, end) - Math.max(since, start)), 0)
  return {
    lastLoginAt: latest?.at ?? null,
    lastLoginActiveMs: latest?.ranges.length ? duration(latest.ranges, latest.at) : null,
    usage24hMs: windows.length ? duration(windows, at - DAY) : null,
    logins24h: latest ? [...logins.values()].filter((entry) => entry.at >= at - DAY && entry.at <= at).length : null,
    lastActivityAt,
    lastSeenAt: lastSeen ? Number(lastSeen.lastSeenAt) : null,
    lastConnection: lastSeen ? { ip: lastSeen.ip, device: lastSeen.device, version: lastSeen.version, build: lastSeen.build } : null,
  }
}

export function createUserActivity(pool, { now = Date.now, reportError = (error) => console.error('Falha ao registrar atividade de usuários:', error.message) } = {}) {
  let ready
  const pending = new Map()
  const initialize = () => ready ||= pool.query(`CREATE TABLE IF NOT EXISTS developer_user_sessions (
    session_id CHAR(64) PRIMARY KEY,
    account_key VARCHAR(96) NOT NULL,
    login_id CHAR(64) NOT NULL,
    login_at BIGINT NULL,
    last_seen_at BIGINT NOT NULL,
    activity JSON NOT NULL,
    ip VARCHAR(64) NULL,
    device VARCHAR(160) NULL,
    version VARCHAR(20) NULL,
    build VARCHAR(40) NULL,
    KEY developer_user_sessions_account (account_key),
    KEY developer_user_sessions_seen (last_seen_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch((error) => { ready = null; throw error })

  const connectionOf = (request) => [
    String(request.ip || '').slice(0, 64) || null,
    deviceOf(String(request.headers['user-agent'] || '').slice(0, 300)) || null,
    headerValue(request.headers['x-portal-release'], 20),
    headerValue(request.headers['x-portal-version'], 40),
  ]
  const insertSession = (target, id, key, loginId, loginAt, at, metadata) => target.execute(`INSERT INTO developer_user_sessions
    (session_id, account_key, login_id, login_at, last_seen_at, activity, ip, device, version, build)
    VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?) ON DUPLICATE KEY UPDATE session_id = session_id`, [id, key, loginId, loginAt, at, ...metadata])

  function register(request, token, user, previousToken = null) {
    const id = tokenId(token), at = now(), metadata = connectionOf(request)
    const key = user ? `${user.role || 'admin'}:${user.id}` : sharedOperatorKey
    const previousId = previousToken ? tokenId(previousToken) : null
    const task = (async () => {
      await initialize()
      if (!previousId) return insertSession(pool, id, key, id, at, at, metadata)
      await pending.get(previousId)?.catch(() => {})
      const [[previous]] = await pool.execute('SELECT login_id, login_at FROM developer_user_sessions WHERE session_id = ? AND account_key = ?', [previousId, key])
      return insertSession(pool, id, key, previous?.login_id ?? previousId, previous?.login_at ?? null, at, metadata)
    })()
    pending.set(id, task)
    return task.catch(reportError).finally(() => { if (pending.get(id) === task) pending.delete(id) })
  }

  async function record(request) {
    const token = request.adminToken || request.operatorToken
    if (!token) return
    const duration = request.body?.durationMs, age = request.body?.ageMs
    if (!Number.isInteger(duration) || duration < 1 || duration > SAMPLE_MS || !Number.isInteger(age) || age < 0 || age > SAMPLE_MS) return
    const end = now() - age, id = tokenId(token)
    const key = request.adminToken ? `${request.adminRole}:${request.adminId}` : sharedOperatorKey
    const metadata = connectionOf(request)
    await pending.get(id)?.catch(() => {})
    await initialize()
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      await insertSession(connection, id, key, id, null, end, metadata)
      const [[session]] = await connection.execute('SELECT login_at, last_seen_at, activity FROM developer_user_sessions WHERE session_id = ? AND account_key = ? FOR UPDATE', [id, key])
      const start = Math.max(end - duration, Number(session.login_at) || 0)
      if (start < end) {
        const activity = mergeRanges([...rangesOf(session.activity), [start, end]])
        if (end >= Number(session.last_seen_at)) {
          await connection.execute('UPDATE developer_user_sessions SET activity = ?, last_seen_at = ?, ip = ?, device = ?, version = ?, build = ? WHERE session_id = ?', [JSON.stringify(activity), end, ...metadata, id])
        } else {
          await connection.execute('UPDATE developer_user_sessions SET activity = ? WHERE session_id = ?', [JSON.stringify(activity), id])
        }
      }
      await connection.commit()
    } catch (error) {
      await connection.rollback().catch(() => {})
      throw error
    } finally { connection.release() }
  }

  async function read(keys) {
    if (!keys.length) return new Map()
    await initialize()
    const [rows] = await pool.query(`SELECT account_key AS accountKey, login_id AS loginId, login_at AS loginAt, last_seen_at AS lastSeenAt,
      activity, ip, device, version, build FROM developer_user_sessions WHERE account_key IN (?)`, [keys])
    const groups = new Map()
    for (const row of rows) {
      if (!groups.has(row.accountKey)) groups.set(row.accountKey, [])
      groups.get(row.accountKey).push(row)
    }
    const at = now()
    return new Map([...groups].map(([key, items]) => [key, summarizeUserActivity(items, at)]))
  }

  async function prune() {
    await initialize()
    await pool.execute(`DELETE sessions FROM developer_user_sessions AS sessions
      JOIN (SELECT account_key, MAX(login_at) AS last_login, MAX(last_seen_at) AS last_seen FROM developer_user_sessions GROUP BY account_key) AS latest
        ON sessions.account_key = latest.account_key
      WHERE sessions.last_seen_at < ? AND sessions.last_seen_at <> latest.last_seen
        AND (sessions.login_at IS NULL OR sessions.login_at <> latest.last_login)`, [now() - 2 * DAY])
  }

  async function heartbeat(request, response) {
    try { await record(request) } catch (error) { reportError(error) }
    response.status(204).end()
  }

  return { register, heartbeat, read, prune }
}
