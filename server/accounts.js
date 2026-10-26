import express from 'express'
import bcrypt from 'bcryptjs'
import { createHash, randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'
import { storePool } from './store.js'
import { notificationDefaults, notificationOptions, notificationSoundDefault, validNotificationSound } from './notificationRules.js'
import { employeeRecords, staffAccountId } from './employeeAccess.js'
import { clientRequesters } from './requesters.js'

const sessions = new Map()
const safe = ({ id, name, birthDate, cpf, email, createdAt, role }) => ({ id, name, birthDate, cpf, email, createdAt, role: role || 'admin' })
const digits = (value) => String(value || '').replace(/\D/g, '')
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error }
export function notificationSettings(store, userId) {
  const preference = store.adminNotificationPreferences?.find((item) => String(item.userId) === String(userId))
  return { payableReminderDays: preference?.payableReminderDays ?? 3, receivableReminderDays: preference?.receivableReminderDays ?? 3, sound: validNotificationSound(preference?.sound) ? preference.sound : notificationSoundDefault, ...Object.fromEntries(notificationOptions.map(([key]) => [key,preference?.[key] ?? notificationDefaults[key]])) }
}
export function appearanceSettings(store, userId) {
  const preference = store.adminAppearancePreferences?.find((item) => String(item.userId) === String(userId))
  return { theme: ['dark', 'black'].includes(preference?.theme) ? preference.theme : 'light', fontSize: ['small', 'large'].includes(preference?.fontSize) ? preference.fontSize : 'default', fontFamily: ['system', 'verdana', 'tahoma', 'inter', 'roboto', 'open-sans', 'montserrat', 'source-sans-3'].includes(preference?.fontFamily) ? preference.fontFamily : 'default' }
}
// Administrator logins last 12 hours and survive a restart of the API: each one is a row of admin_sessions, which keeps
// only a hash of the token. This process keeps a copy of the open ones (`sessions`, by hash) to check every request
// without a query; the copy is loaded when the API starts (loadAdminSessions) and every login and revocation writes
// both. One API process is assumed, as for the request limit. Without the database (some tests) only the copy exists.
const SESSION_MS = 12 * 3600000
const tokenHash = (token) => createHash('sha256').update(String(token)).digest('hex')
let sessionTable = null
function sessionDatabase() {
  let pool
  try { pool = storePool() } catch { return null }
  sessionTable ||= pool.query(`CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_key VARCHAR(64) NOT NULL,
    user_id VARCHAR(80) NOT NULL,
    user_name VARCHAR(200) NULL,
    role VARCHAR(20) NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY admin_sessions_user (user_key),
    KEY admin_sessions_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).then(() => pool, (error) => { sessionTable = null; throw error })
  return sessionTable
}
export async function loadAdminSessions() {
  const database = sessionDatabase()
  if (!database) return 0
  const pool = await database
  await pool.query('DELETE FROM admin_sessions WHERE expires_at < ?', [Date.now()])
  const [rows] = await pool.query('SELECT token_hash, user_id, user_name, role, expires_at FROM admin_sessions')
  sessions.clear()
  // The id keeps its type (a number for administrators, text for administrative employees).
  for (const row of rows) sessions.set(row.token_hash, { id: JSON.parse(row.user_id), name: row.user_name ?? undefined, role: row.role, expires: Number(row.expires_at) })
  return rows.length
}
export async function issueAdminToken(user) {
  const now = Date.now()
  for (const [key, session] of sessions) if (session.expires < now) sessions.delete(key)
  const token = randomUUID()
  const session = { id: user.id, name: user.name, role: user.role || 'admin', expires: now + SESSION_MS }
  const database = sessionDatabase()
  if (database) {
    const pool = await database
    await pool.query('DELETE FROM admin_sessions WHERE expires_at < ?', [now])
    await pool.query('INSERT INTO admin_sessions (token_hash, user_key, user_id, user_name, role, expires_at) VALUES (?, ?, ?, ?, ?, ?)', [tokenHash(token), String(user.id), JSON.stringify(user.id ?? null), user.name ?? null, session.role, session.expires])
  }
  sessions.set(tokenHash(token), session)
  return token
}
// Leaving ("Sair") ends this login only.
export async function endAdminSession(token) {
  sessions.delete(tokenHash(token))
  const database = sessionDatabase()
  if (database) await (await database).query('DELETE FROM admin_sessions WHERE token_hash = ?', [tokenHash(token)])
}
export async function revokeAccountSessions(id) {
  for (const [key, session] of sessions) if (String(session.id) === String(id)) sessions.delete(key)
  const database = sessionDatabase()
  if (database) await (await database).query('DELETE FROM admin_sessions WHERE user_key = ?', [String(id)])
}
export function adminIdentity(request) {
  const token = String(request.headers.authorization || '').replace(/^Bearer /, '')
  const session = token ? sessions.get(tokenHash(token)) : null
  return session && session.expires >= Date.now() ? { ...session, token } : null
}
export function requireAdmin(request, response, next) {
  const session = adminIdentity(request)
  if (!session || session.expires < Date.now()) return response.status(401).json({ message: 'Entre novamente como administrador.' })
  request.adminId = session.id
  request.adminName = session.name
  request.adminRole = session.role
  request.adminToken = session.token
  next()
}

// Administrative employees keep the finance steps embedded in other screens (OS costs and completion, stock purchases),
// but not the Gestão Financeira screens themselves.
const financeArea = /^\/(payables|receivables|classifications|bank-statements|ai-reconciliations)(\/|$)/
const staffFinanceRoutes = [['GET', /^\/payables$/], ['POST', /^\/payables(\/uploads)?$/], ['GET', /^\/payables\/order-costs\/[^/]+$/], ['GET', /^\/receivables\/order\/[^/]+$/], ['POST', /^\/receivables$/]]
export function restrictStaffFinance(request, response, next) {
  if (!financeArea.test(request.path) || adminIdentity(request)?.role !== 'staff') return next()
  if (staffFinanceRoutes.some(([method, route]) => request.method === method && route.test(request.path))) return next()
  response.status(403).json({ message: 'Seu acesso não inclui a Gestão Financeira.' })
}

export function createAccountService(pool, env = process.env) {
  async function admins(privateFields = false) {
    let rows
    if (pool) [rows] = await pool.execute(`SELECT id, name, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birthDate, cpf, email, created_at AS createdAt${privateFields ? ', password_hash AS passwordHash' : ''} FROM users WHERE role = 'admin' ORDER BY name`)
    else {
      const store = await readStore()
      rows = store.admins || []
      if (env.DEMO_ADMIN_CPF && env.DEMO_ADMIN_PASSWORD) rows = [{ id: 0, name: store.demoAdmin?.name || env.DEMO_ADMIN_NAME?.trim() || 'Administrador de demonstração', cpf: digits(env.DEMO_ADMIN_CPF), ...store.demoAdmin }, ...rows]
    }
    return privateFields ? rows : rows.map(safe)
  }
  async function staff() {
    return (await employeeRecords(pool)).filter((item) => item.type === 'administrative' && item.active !== false).map((item) => ({ ...item, id: staffAccountId(item.id), employeeId: item.id, role: 'staff' }))
  }
  // Everyone who signs in with CPF and password: administrators first, then administrative employees.
  async function accounts() {
    return [...await admins(true), ...await staff()]
  }
  async function account(id) {
    const user = (await accounts()).find((item) => String(item.id) === String(id))
    return user ? safe(user) : null
  }
  // Test login only: the CPF chooses the account (administrator or administrative employee), without password.
  async function accountByCpf(cpf) {
    const user = (await accounts()).find((item) => digits(item.cpf) === digits(cpf))
    return user ? safe(user) : null
  }
  const passwordMatches = async (user, password) => user.passwordHash ? bcrypt.compare(password, user.passwordHash) : user.id === 0 && password === env.DEMO_ADMIN_PASSWORD
  async function authenticate(cpf, password) {
    for (const user of (await accounts()).filter((item) => digits(item.cpf) === cpf)) if (await passwordMatches(user, password)) return safe(user)
    return null
  }
  async function updateAccount(id, fields) {
    const current = (await accounts()).find((item) => String(item.id) === String(id))
    if (!current) fail(404, 'Conta não encontrada.')
    if (!String(fields.name || '').trim()) fail(400, 'Informe seu nome.')
    if (!await passwordMatches(current, fields.currentPassword || '')) fail(403, 'Senha atual incorreta.')
    if (fields.password && (typeof fields.password !== 'string' || fields.password.length < 6 || fields.password.length > 72)) fail(400, 'A nova senha deve ter entre 6 e 72 caracteres.')
    const changes = { name: fields.name.trim().slice(0, 120), ...(fields.password ? { passwordHash: await bcrypt.hash(fields.password, 12) } : {}) }
    if (current.role === 'staff') {
      if (pool) await pool.execute('UPDATE employees SET name = ?, password_hash = ? WHERE id = ?', [changes.name, changes.passwordHash || current.passwordHash, current.employeeId])
      else await mutateStore((store) => { Object.assign(store.employees.find((item) => String(item.id) === String(current.employeeId)), changes) })
    } else if (pool) await pool.execute('UPDATE users SET name = ?, password_hash = ? WHERE id = ? AND role = \'admin\'', [changes.name, changes.passwordHash || current.passwordHash, id])
    else await mutateStore((store) => {
      if (Number(id) === 0) store.demoAdmin = { ...store.demoAdmin, ...changes }
      else Object.assign(store.admins.find((item) => String(item.id) === String(id)), changes)
    })
    if (fields.password) await revokeAccountSessions(id)
    return safe({ ...current, ...changes })
  }
  // The free note of a client was added later: databases created before get the column once (existing clients stay blank).
  // If the database user cannot change tables (common on shared hosting), the clients keep working without the note and
  // the server logs how to add the column by hand. Resolves to whether the column exists.
  // The e-mail of a client became optional (the customer list has none): the column is made nullable the same way.
  let notesColumn = null
  const ensureClientNotes = () => notesColumn ||= (async () => {
    try {
      const [email] = await pool.execute("SELECT IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'email'")
      if (email[0]?.nullable === 'NO') await pool.execute('ALTER TABLE clients MODIFY email VARCHAR(160) NULL')
    } catch (error) { console.error(`O e-mail dos clientes continua obrigatório no banco (${error.code || error.message}). Rode no banco: ALTER TABLE clients MODIFY email VARCHAR(160) NULL`) }
    try {
      const [columns] = await pool.execute("SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'notes'")
      if (columns.length) return true
      try { await pool.execute('ALTER TABLE clients ADD COLUMN notes VARCHAR(1000) NULL') } catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error }
      return true
    } catch (error) {
      console.error(`A observação dos clientes ficará indisponível: não foi possível criar a coluna (${error.code || error.message}). Rode no banco: ALTER TABLE clients ADD COLUMN notes VARCHAR(1000) NULL`)
      return false
    }
  })()
  async function clients() {
    if (pool) {
      const notes = await ensureClientNotes()
      const [rows] = await pool.execute(`SELECT id, name, document_type AS documentType, document, email, ${notes ? "COALESCE(notes, '')" : "''"} AS notes, created_at AS createdAt FROM clients ORDER BY name`)
      return rows
    }
    return (await readStore()).clients || []
  }
  async function save(kind, id, body) {
    const name = String(body.name || '').trim().slice(0, 120)
    const isClient = kind === 'clients'
    // A client may have no e-mail (stored as NULL, so several blanks do not collide in the unique index); administrators need one.
    const email = String(body.email || '').trim().slice(0, 160) || (isClient ? null : '')
    if (!name || (email || !isClient) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Informe nome e e-mail válidos.')
    const fields = isClient ? { name, email, documentType: body.documentType, document: digits(body.document), notes: String(body.notes ?? '').trim().slice(0, 1000) } : { name, email, birthDate: body.birthDate, cpf: digits(body.cpf) }
    if (isClient ? !['cnpj', 'cpf'].includes(fields.documentType) || fields.document.length !== (fields.documentType === 'cnpj' ? 14 : 11) : !/^\d{11}$/.test(fields.cpf) || !/^\d{4}-\d{2}-\d{2}$/.test(fields.birthDate || '')) fail(400, 'Confira documento e data de nascimento.')
    const rows = isClient ? await clients() : await admins(true)
    const current = id == null ? null : rows.find((item) => String(item.id) === String(id))
    if (id != null && !current) fail(404, 'Cadastro não encontrado.')
    if (!isClient && Number(id) === 0 && id != null) fail(409, 'Edite esta conta em Configurações.')
    if (!isClient && (!id || body.password)) {
      if (typeof body.password !== 'string' || body.password.length < 6 || body.password.length > 72) fail(400, 'A senha deve ter entre 6 e 72 caracteres.')
      fields.passwordHash = await bcrypt.hash(body.password, 12)
    }
    if (rows.some((item) => String(item.id) !== String(id) && (email && item.email === email || (isClient ? item.document === fields.document : digits(item.cpf) === fields.cpf)))) fail(409, 'Documento ou e-mail já cadastrado.')
    let item
    if (pool) {
      const table = isClient ? 'clients' : 'users'
      const notes = isClient && await ensureClientNotes()
      const columns = isClient ? ['name', 'email', 'document_type', 'document', ...(notes ? ['notes'] : [])] : ['name', 'email', 'birth_date', 'cpf', 'password_hash']
      const values = isClient ? [name, email, fields.documentType, fields.document, ...(notes ? [fields.notes || null] : [])] : [name, email, fields.birthDate, fields.cpf, fields.passwordHash || current.passwordHash]
      if (id == null) {
        const [result] = await pool.execute(`INSERT INTO ${table} (${columns.join(', ')}${isClient ? '' : ', role'}) VALUES (${columns.map(() => '?').join(', ')}${isClient ? '' : ", 'admin'"})`, values)
        item = { id: result.insertId, ...fields }
      } else {
        await pool.execute(`UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?${isClient ? '' : " AND role = 'admin'"}`, [...values, id])
        item = { ...current, ...fields }
      }
    } else item = await mutateStore((store) => {
      store[kind] ||= []
      if (id != null) {
        const row = store[kind].find((entry) => String(entry.id) === String(id))
        Object.assign(row, fields)
        return row
      }
      const row = { id: isClient ? randomUUID() : Math.max(0, ...store.admins.map((entry) => Number(entry.id) || 0)) + 1, ...fields, createdAt: new Date().toISOString() }
      if (store[kind].some((entry) => email && entry.email === email || (isClient ? entry.document === fields.document : entry.cpf === fields.cpf))) fail(409, 'Cadastro duplicado.')
      store[kind].push(row)
      return row
    })
    if (!isClient && body.password && id != null) await revokeAccountSessions(id)
    return isClient ? item : safe(item)
  }
  async function remove(kind, id) {
    if (kind === 'admins' && String(id) === '0') fail(409, 'A conta local principal não pode ser excluída.')
    const requesters = kind === 'clients' ? clientRequesters(await readStore(), id) : 0
    if (requesters) fail(409, `Este cliente tem ${requesters} ${requesters === 1 ? 'solicitante vinculado' : 'solicitantes vinculados'}. Exclua ou troque o cliente deles em Cadastros > Solicitantes antes de excluir.`)
    if (pool) {
      const [result] = await pool.execute(kind === 'clients' ? 'DELETE FROM clients WHERE id = ?' : "DELETE FROM users WHERE id = ? AND role = 'admin'", [id])
      if (!result.affectedRows) fail(404, 'Cadastro não encontrado.')
    } else await mutateStore((store) => {
      const index = (store[kind] || []).findIndex((item) => String(item.id) === String(id))
      if (index < 0) fail(404, 'Cadastro não encontrado.')
      store[kind].splice(index, 1)
      if (kind === 'admins' && store.adminNotificationPreferences) store.adminNotificationPreferences = store.adminNotificationPreferences.filter((item) => String(item.userId) !== String(id))
    })
    if (pool && kind === 'admins') await mutateStore((store) => {
      if (store.adminNotificationPreferences) store.adminNotificationPreferences = store.adminNotificationPreferences.filter((item) => String(item.userId) !== String(id))
    })
    if (kind === 'admins') await revokeAccountSessions(id)
  }
  async function getNotificationSettings(id) {
    if (!await account(id)) fail(404, 'Conta não encontrada.')
    return notificationSettings(await readStore(), id)
  }
  async function updateNotificationSettings(id, fields) {
    const keys = notificationOptions.map(([key]) => key)
    if (!fields || fields.payableReminderDays === undefined && fields.receivableReminderDays === undefined && fields.sound === undefined && !keys.some((key) => fields[key] !== undefined)) fail(400, 'Informe uma preferencia de notificacoes.')
    for (const key of ['payableReminderDays', 'receivableReminderDays']) if (fields[key] !== undefined && ![3, 5, 7, 'never'].includes(fields[key])) fail(400, 'Escolha 3, 5, 7 dias ou nunca.')
    if (keys.some((key) => fields[key] !== undefined && typeof fields[key] !== 'boolean')) fail(400, 'Informe verdadeiro ou falso para as notificacoes.')
    if (fields.sound !== undefined && !validNotificationSound(fields.sound)) fail(400, 'Escolha um dos sons de notificação ou desligue o som.')
    await getNotificationSettings(id)
    return mutateStore((store) => {
      store.adminNotificationPreferences ||= []
      let preference = store.adminNotificationPreferences.find((item) => String(item.userId) === String(id))
      if (!preference) { preference = { userId: id }; store.adminNotificationPreferences.push(preference) }
      if (fields.payableReminderDays !== undefined) preference.payableReminderDays = fields.payableReminderDays
      if (fields.receivableReminderDays !== undefined) preference.receivableReminderDays = fields.receivableReminderDays
      if (fields.sound !== undefined) preference.sound = fields.sound
      for (const key of keys) if (fields[key] !== undefined) preference[key] = fields[key]
      return notificationSettings(store, id)
    })
  }
  async function getAppearanceSettings(id) {
    if (!await account(id)) fail(404, 'Conta não encontrada.')
    return appearanceSettings(await readStore(), id)
  }
  async function updateAppearanceSettings(id, fields) {
    if (fields?.theme === undefined && fields?.fontSize === undefined && fields?.fontFamily === undefined) fail(400, 'Informe uma preferência de aparência.')
    if (fields.theme !== undefined && !['light', 'dark', 'black'].includes(fields.theme)) fail(400, 'Escolha o modo claro, escuro ou escuro intenso.')
    if (fields.fontSize !== undefined && !['small', 'default', 'large'].includes(fields.fontSize)) fail(400, 'Escolha a fonte pequena, padrão ou grande.')
    if (fields.fontFamily !== undefined && !['default', 'system', 'verdana', 'tahoma', 'inter', 'roboto', 'open-sans', 'montserrat', 'source-sans-3'].includes(fields.fontFamily)) fail(400, 'Escolha uma das fontes disponíveis.')
    await getAppearanceSettings(id)
    return mutateStore((store) => {
      store.adminAppearancePreferences ||= []
      let preference = store.adminAppearancePreferences.find((item) => String(item.userId) === String(id))
      if (!preference) { preference = { userId: id }; store.adminAppearancePreferences.push(preference) }
      if (fields.theme !== undefined) preference.theme = fields.theme
      if (fields.fontSize !== undefined) preference.fontSize = fields.fontSize
      if (fields.fontFamily !== undefined) preference.fontFamily = fields.fontFamily
      return appearanceSettings(store, id)
    })
  }
  return { admins, clients, account, accountByCpf, authenticate, updateAccount, getNotificationSettings, updateNotificationSettings, getAppearanceSettings, updateAppearanceSettings, save, remove }
}

export function createAccountsRouter(service) {
  const router = express.Router()
  router.use(['/admins', '/clients', '/account', '/auth/logout', '/auth/session'], requireAdmin)
  router.get('/auth/session', async (request, response, next) => {
    try {
      const user = await service.account(request.adminId)
      if (!user) return response.status(401).json({ message: 'Entre novamente como administrador.' })
      response.json({ user })
    } catch (error) { next(error) }
  })
  router.post('/auth/logout', async (request, response, next) => {
    try { await endAdminSession(request.adminToken); response.json({ ok: true }) } catch (error) { next(error) }
  })
  router.get('/account/notifications', async (request, response, next) => {
    try { response.set('Cache-Control', 'no-store').json({ settings: await service.getNotificationSettings(request.adminId) }) } catch (error) { next(error) }
  })
  router.patch('/account/notifications', async (request, response, next) => {
    try { response.json({ settings: await service.updateNotificationSettings(request.adminId, request.body) }) } catch (error) { next(error) }
  })
  router.get('/account/appearance', async (request, response, next) => {
    try { response.set('Cache-Control', 'no-store').json({ settings: await service.getAppearanceSettings(request.adminId) }) } catch (error) { next(error) }
  })
  router.patch('/account/appearance', async (request, response, next) => {
    try { response.json({ settings: await service.updateAppearanceSettings(request.adminId, request.body) }) } catch (error) { next(error) }
  })
  router.patch('/account', async (request, response, next) => {
    try { const user = await service.updateAccount(request.adminId, request.body); response.json({ user, token: await issueAdminToken(user) }) } catch (error) { next(error) }
  })
  for (const kind of ['admins', 'clients']) {
    router.get(`/${kind}`, async (_request, response, next) => { try { response.json({ items: await service[kind]() }) } catch (error) { next(error) } })
    for (const method of ['post', 'put']) router[method](method === 'post' ? `/${kind}` : `/${kind}/:id`, async (request, response, next) => {
      try { response.json({ item: await service.save(kind, request.params.id, request.body) }) } catch (error) { next(error) }
    })
    router.delete(`/${kind}/:id`, async (request, response, next) => {
      try {
        if (kind === 'admins' && String(request.adminId) === request.params.id) fail(409, 'Você não pode excluir sua própria conta.')
        await service.remove(kind, request.params.id)
        response.json({ ok: true })
      } catch (error) { next(error) }
    })
  }
  return router
}
