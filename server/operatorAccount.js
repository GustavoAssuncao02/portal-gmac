import express from 'express'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './store.js'
import { operatorConfigured, operatorCredentialsMatch, setOperatorTokenVersion } from './operatorAuth.js'

// The shared operator account (the tablets of the shop floor). Its user and password are set by an administrator in
// Configurações and kept in the database; until the first change, OPERATOR_USERNAME/OPERATOR_PASSWORD of the .env apply.
// Every change requires a reason and is kept in the history; a new password ends the operator sessions already open.
const digits = (value) => String(value ?? '').replace(/\D/g, '')
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }

export async function loadOperatorAccount() {
  const account = (await readStore()).operatorAccount
  setOperatorTokenVersion(account?.version || 0)
  return account || null
}

export async function operatorAccountConfigured() {
  return Boolean(await loadOperatorAccount()) || operatorConfigured()
}

export async function operatorLoginMatches(username, password) {
  if (typeof username !== 'string' || !/^\d{11}$/.test(username) || typeof password !== 'string') return false
  const account = await loadOperatorAccount()
  if (!account) return operatorCredentialsMatch(username, password)
  return username === account.username && bcrypt.compare(password, account.passwordHash)
}

function publicAccount(store) {
  const account = store.operatorAccount
  const history = (store.operatorAccountHistory || []).slice().sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
  return {
    username: account?.username || (operatorConfigured() ? digits(process.env.OPERATOR_USERNAME) : ''),
    source: account ? 'database' : operatorConfigured() ? 'env' : 'none',
    passwordChangedAt: history.find((row) => row.changes.includes('password'))?.at || null,
    history,
  }
}

export async function saveOperatorAccount(body, actor) {
  const username = digits(body?.username)
  const password = typeof body?.password === 'string' ? body.password : ''
  const reason = String(body?.reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 1000)
  if (!/^\d{11}$/.test(username)) fail(400, 'O usuário do operador deve ter 11 dígitos.')
  if (password && (password.length < 6 || password.length > 72)) fail(400, 'A senha do operador deve ter entre 6 e 72 caracteres.')
  if (reason.length < 10) fail(400, 'Escreva a justificativa da alteração (pelo menos 10 caracteres).')
  const passwordHash = password ? await bcrypt.hash(password, 12) : null
  const result = await mutateStore((store) => {
    const current = store.operatorAccount
    const before = publicAccount(store).username
    if (!current && !password) fail(400, 'Defina a senha do operador.')
    const changes = [...(username !== before ? ['username'] : []), ...(password ? ['password'] : [])]
    if (!changes.length) fail(400, 'Nada foi alterado: informe um novo usuário ou uma nova senha.')
    store.operatorAccount = { username, passwordHash: passwordHash || current.passwordHash, version: (current?.version || 0) + (password ? 1 : 0), updatedAt: new Date().toISOString(), updatedBy: actor.name }
    store.operatorAccountHistory = [...(store.operatorAccountHistory || []), { id: randomUUID(), at: store.operatorAccount.updatedAt, userId: actor.id, userName: actor.name, reason, changes, ...(changes.includes('username') ? { usernameBefore: before || null, usernameAfter: username } : {}) }]
    return { version: store.operatorAccount.version, view: publicAccount(store) }
  })
  setOperatorTokenVersion(result.version)
  return result.view
}

// Only administrators (not the administrative employees) manage the operator account.
export default function createOperatorAccountRouter(requireAdmin) {
  const router = express.Router()
  const onlyAdministrators = (request, response, next) => request.adminRole === 'staff' ? response.status(403).json({ message: 'Somente administradores alteram o acesso do operador.' }) : next()
  router.get('/operator-account', requireAdmin, onlyAdministrators, async (_request, response, next) => {
    try { response.set('Cache-Control', 'no-store').json(publicAccount(await readStore())) } catch (error) { next(error) }
  })
  router.put('/operator-account', requireAdmin, onlyAdministrators, async (request, response, next) => {
    try { response.json(await saveOperatorAccount(request.body, { id: request.adminId, name: request.adminName || 'Administrador' })) } catch (error) { error.status ? response.status(error.status).json({ message: error.message }) : next(error) }
  })
  return router
}
