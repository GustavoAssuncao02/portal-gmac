import express from 'express'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'
import { notificationDefaults, notificationOptions } from './notificationRules.js'

const sessions = new Map()
const safe = ({ id, name, birthDate, cpf, email, createdAt }) => ({ id, name, birthDate, cpf, email, createdAt })
const digits = (value) => String(value || '').replace(/\D/g, '')
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error }
export function notificationSettings(store, userId) {
  const preference = store.adminNotificationPreferences?.find((item) => String(item.userId) === String(userId))
  return { payableReminderDays: preference?.payableReminderDays ?? 3, ...Object.fromEntries(notificationOptions.map(([key]) => [key, preference?.[key] ?? notificationDefaults[key]])) }
}
export function appearanceSettings(store, userId) {
  const preference = store.adminAppearancePreferences?.find((item) => String(item.userId) === String(userId))
  return { theme: preference?.theme === 'dark' ? 'dark' : 'light', fontSize: ['small', 'large'].includes(preference?.fontSize) ? preference.fontSize : 'default', fontFamily: ['system', 'verdana', 'tahoma', 'inter', 'roboto', 'open-sans', 'montserrat', 'source-sans-3'].includes(preference?.fontFamily) ? preference.fontFamily : 'default' }
}
export function issueAdminToken(user) {
  for (const [key, session] of sessions) if (session.expires < Date.now()) sessions.delete(key)
  const token = randomUUID()
  sessions.set(token, { id: user.id, name: user.name, expires: Date.now() + 12 * 3600000 })
  return token
}
export function adminIdentity(request) {
  const token = String(request.headers.authorization || '').replace(/^Bearer /, '')
  const session = sessions.get(token)
  return session && session.expires >= Date.now() ? { ...session, token } : null
}
export function requireAdmin(request, response, next) {
  const session = adminIdentity(request)
  if (!session || session.expires < Date.now()) return response.status(401).json({ message: 'Entre novamente como administrador.' })
  request.adminId = session.id
  request.adminName = session.name
  request.adminToken = session.token
  next()
}

export function createAccountService(pool, env = process.env) {
  async function admins(privateFields = false) {
    let rows
    if (pool) [rows] = await pool.execute("SELECT id, name, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birthDate, cpf, email, created_at AS createdAt, password_hash AS passwordHash FROM users WHERE role = 'admin' ORDER BY name")
    else {
      const store = await readStore()
      rows = store.admins || []
      if (env.DEMO_ADMIN_CPF && env.DEMO_ADMIN_PASSWORD) rows = [{ id: 0, name: store.demoAdmin?.name || env.DEMO_ADMIN_NAME?.trim() || 'Administrador de demonstração', cpf: digits(env.DEMO_ADMIN_CPF), ...store.demoAdmin }, ...rows]
    }
    return privateFields ? rows : rows.map(safe)
  }
  async function authenticate(cpf, password) {
    const user = (await admins(true)).find((item) => digits(item.cpf) === cpf)
    const matches = user && (user.passwordHash ? await bcrypt.compare(password, user.passwordHash) : user.id === 0 && password === env.DEMO_ADMIN_PASSWORD)
    return matches ? safe(user) : null
  }
  async function updateAccount(id, fields) {
    const current = (await admins(true)).find((item) => String(item.id) === String(id))
    if (!current) fail(404, 'Conta não encontrada.')
    if (!String(fields.name || '').trim()) fail(400, 'Informe seu nome.')
    if (!await authenticate(digits(current.cpf), fields.currentPassword || '')) fail(403, 'Senha atual incorreta.')
    if (fields.password && (typeof fields.password !== 'string' || fields.password.length < 6 || fields.password.length > 72)) fail(400, 'A nova senha deve ter entre 6 e 72 caracteres.')
    const changes = { name: fields.name.trim().slice(0, 120), ...(fields.password ? { passwordHash: await bcrypt.hash(fields.password, 12) } : {}) }
    if (pool) await pool.execute('UPDATE users SET name = ?, password_hash = ? WHERE id = ? AND role = \'admin\'', [changes.name, changes.passwordHash || current.passwordHash, id])
    else await mutateStore((store) => {
      if (Number(id) === 0) store.demoAdmin = { ...store.demoAdmin, ...changes }
      else Object.assign(store.admins.find((item) => String(item.id) === String(id)), changes)
    })
    if (fields.password) for (const [token, session] of sessions) if (String(session.id) === String(id)) sessions.delete(token)
    return safe({ ...current, ...changes })
  }
  async function clients() {
    if (pool) { const [rows] = await pool.execute('SELECT id, name, document_type AS documentType, document, email, created_at AS createdAt FROM clients ORDER BY name'); return rows }
    return (await readStore()).clients || []
  }
  async function save(kind, id, body) {
    const name = String(body.name || '').trim().slice(0, 120)
    const email = String(body.email || '').trim().slice(0, 160)
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Informe nome e e-mail válidos.')
    const isClient = kind === 'clients'
    const fields = isClient ? { name, email, documentType: body.documentType, document: digits(body.document) } : { name, email, birthDate: body.birthDate, cpf: digits(body.cpf) }
    if (isClient ? !['cnpj', 'cpf'].includes(fields.documentType) || fields.document.length !== (fields.documentType === 'cnpj' ? 14 : 11) : !/^\d{11}$/.test(fields.cpf) || !/^\d{4}-\d{2}-\d{2}$/.test(fields.birthDate || '')) fail(400, 'Confira documento e data de nascimento.')
    const rows = isClient ? await clients() : await admins(true)
    const current = id == null ? null : rows.find((item) => String(item.id) === String(id))
    if (id != null && !current) fail(404, 'Cadastro não encontrado.')
    if (!isClient && Number(id) === 0 && id != null) fail(409, 'Edite esta conta em Configurações.')
    if (!isClient && (!id || body.password)) {
      if (typeof body.password !== 'string' || body.password.length < 6 || body.password.length > 72) fail(400, 'A senha deve ter entre 6 e 72 caracteres.')
      fields.passwordHash = await bcrypt.hash(body.password, 12)
    }
    if (rows.some((item) => String(item.id) !== String(id) && (item.email === email || (isClient ? item.document === fields.document : digits(item.cpf) === fields.cpf)))) fail(409, 'Documento ou e-mail já cadastrado.')
    let item
    if (pool) {
      const table = isClient ? 'clients' : 'users'
      const columns = isClient ? ['name', 'email', 'document_type', 'document'] : ['name', 'email', 'birth_date', 'cpf', 'password_hash']
      const values = isClient ? [name, email, fields.documentType, fields.document] : [name, email, fields.birthDate, fields.cpf, fields.passwordHash || current.passwordHash]
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
      if (store[kind].some((entry) => entry.email === email || (isClient ? entry.document === fields.document : entry.cpf === fields.cpf))) fail(409, 'Cadastro duplicado.')
      store[kind].push(row)
      return row
    })
    if (!isClient && body.password && id != null) for (const [token, session] of sessions) if (String(session.id) === String(id)) sessions.delete(token)
    return isClient ? item : safe(item)
  }
  async function remove(kind, id) {
    if (kind === 'admins' && String(id) === '0') fail(409, 'A conta local principal não pode ser excluída.')
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
    if (kind === 'admins') for (const [token, session] of sessions) if (String(session.id) === String(id)) sessions.delete(token)
  }
  async function getNotificationSettings(id) {
    if (!(await admins()).some((item) => String(item.id) === String(id))) fail(404, 'Conta não encontrada.')
    return notificationSettings(await readStore(), id)
  }
  async function updateNotificationSettings(id, fields) {
    const keys = notificationOptions.map(([key]) => key)
    if (!fields || fields.payableReminderDays === undefined && !keys.some((key) => fields[key] !== undefined)) fail(400, 'Informe uma preferencia de notificacoes.')
    if (fields.payableReminderDays !== undefined && ![3, 5, 7, 'never'].includes(fields.payableReminderDays)) fail(400, 'Escolha 3, 5, 7 dias ou nunca.')
    if (keys.some((key) => fields[key] !== undefined && typeof fields[key] !== 'boolean')) fail(400, 'Informe verdadeiro ou falso para as notificacoes.')
    await getNotificationSettings(id)
    return mutateStore((store) => {
      store.adminNotificationPreferences ||= []
      let preference = store.adminNotificationPreferences.find((item) => String(item.userId) === String(id))
      if (!preference) { preference = { userId: id }; store.adminNotificationPreferences.push(preference) }
      if (fields.payableReminderDays !== undefined) preference.payableReminderDays = fields.payableReminderDays
      for (const key of keys) if (fields[key] !== undefined) preference[key] = fields[key]
      return notificationSettings(store, id)
    })
  }
  async function getAppearanceSettings(id) {
    if (!(await admins()).some((item) => String(item.id) === String(id))) fail(404, 'Conta não encontrada.')
    return appearanceSettings(await readStore(), id)
  }
  async function updateAppearanceSettings(id, fields) {
    if (fields?.theme === undefined && fields?.fontSize === undefined && fields?.fontFamily === undefined) fail(400, 'Informe uma preferência de aparência.')
    if (fields.theme !== undefined && !['light', 'dark'].includes(fields.theme)) fail(400, 'Escolha o modo claro ou escuro.')
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
  return { admins, clients, authenticate, updateAccount, getNotificationSettings, updateNotificationSettings, getAppearanceSettings, updateAppearanceSettings, save, remove }
}

export function createAccountsRouter(service) {
  const router = express.Router()
  router.use(['/admins', '/clients', '/account', '/auth/logout', '/auth/session'], requireAdmin)
  router.get('/auth/session', async (request, response, next) => {
    try {
      const user = (await service.admins()).find((item) => String(item.id) === String(request.adminId))
      if (!user) return response.status(401).json({ message: 'Entre novamente como administrador.' })
      response.json({ user })
    } catch (error) { next(error) }
  })
  router.post('/auth/logout', (request, response) => { sessions.delete(request.adminToken); response.json({ ok: true }) })
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
    try { const user = await service.updateAccount(request.adminId, request.body); response.json({ user, token: issueAdminToken(user) }) } catch (error) { next(error) }
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
