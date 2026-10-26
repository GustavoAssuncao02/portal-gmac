import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'

// Cadastros > Solicitantes: the people who ask for the services on behalf of a client (Nestlé asks, but who at Nestlé?).
// A client has many requesters and every requester belongs to exactly one client. The name and the client are required;
// CPF, e-mail and phone are optional. The client's name is read from Cadastros > Clientes each time, so a renamed client
// shows up renamed here too.
const clean = (value, limit = 160) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, limit)
const digits = (value) => String(value ?? '').replace(/\D/g, '')
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const sameText = (left, right) => left.localeCompare(right, 'pt-BR', { sensitivity: 'base' }) === 0

export function requesterFields(body = {}, clients = []) {
  const name = clean(body.name)
  if (!name) fail(400, 'Informe o nome do solicitante.')
  const clientId = String(body.clientId ?? '').trim()
  if (!clientId) fail(400, 'Selecione o cliente do solicitante.')
  if (!clients.some((client) => String(client.id) === clientId)) fail(400, 'Cliente não encontrado. Confira o cadastro em Cadastros > Clientes.')
  const cpf = digits(body.cpf)
  if (cpf && cpf.length !== 11) fail(400, 'Informe um CPF com 11 dígitos ou deixe o campo em branco.')
  const email = clean(body.email).toLowerCase()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Informe um e-mail válido ou deixe o campo em branco.')
  const phone = digits(body.phone)
  if (phone && (phone.length < 10 || phone.length > 11)) fail(400, 'Informe o telefone com DDD (10 ou 11 dígitos) ou deixe o campo em branco.')
  return { name, clientId, cpf, email, phone }
}

// An offer names who asked for it. When the offer's client is registered, the name is looked up among that client's
// requesters and registered there when it is new (inside the offer's own change); `created` tells the screen to show it.
// Without a registered client the name stays only on the offer.
export function registerOfferRequester(store, client, value) {
  const name = clean(value)
  if (!name || !client) return { name, id: null, created: false }
  store.requesters ||= []
  const found = store.requesters.find((row) => String(row.clientId) === String(client.id) && sameText(row.name, name))
  if (found) return { name: found.name, id: found.id, created: false }
  const now = new Date().toISOString()
  const row = { id: randomUUID(), createdAt: now, name, clientId: String(client.id), cpf: '', email: '', phone: '', updatedAt: now, source: 'offer' }
  store.requesters.push(row)
  return { name, id: row.id, created: true }
}

// Requesters linked to a client: the client cannot be deleted while it has them.
export const clientRequesters = (store, clientId) => (store.requesters || []).filter((row) => String(row.clientId) === String(clientId)).length

export default function createRequestersRouter(accounts, requireAdmin) {
  const router = express.Router()
  const handle = (task) => async (request, response, next) => {
    try { await task(request, response) } catch (error) { error.status ? response.status(error.status).json({ message: error.message }) : next(error) }
  }
  router.get('/requesters', requireAdmin, handle(async (_request, response) => {
    const names = new Map((await accounts.clients()).map((client) => [String(client.id), client.name]))
    const items = ((await readStore()).requesters || []).map((row) => ({ ...row, clientName: names.get(String(row.clientId)) || '' })).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
    response.set('Cache-Control', 'no-store').json({ items })
  }))
  for (const method of ['post', 'put']) router[method](method === 'post' ? '/requesters' : '/requesters/:id', requireAdmin, handle(async (request, response) => {
    const clients = await accounts.clients()
    const fields = requesterFields(request.body, clients)
    const item = await mutateStore((store) => {
      store.requesters ||= []
      const others = store.requesters.filter((row) => row.id !== request.params.id && String(row.clientId) === fields.clientId)
      if (others.some((row) => sameText(row.name, fields.name))) fail(409, 'Este cliente já tem um solicitante com esse nome.')
      if (fields.cpf && others.some((row) => row.cpf === fields.cpf)) fail(409, 'Este cliente já tem um solicitante com esse CPF.')
      let row = store.requesters.find((entry) => entry.id === request.params.id)
      if (method === 'put' && !row) fail(404, 'Solicitante não encontrado.')
      if (!row) { row = { id: randomUUID(), createdAt: new Date().toISOString() }; store.requesters.push(row) }
      Object.assign(row, fields, { updatedAt: new Date().toISOString() })
      return row
    })
    const client = clients.find((entry) => String(entry.id) === item.clientId)
    response.status(method === 'post' ? 201 : 200).json({ item: { ...item, clientName: client?.name || '' } })
  }))
  router.delete('/requesters/:id', requireAdmin, handle(async (request, response) => {
    await mutateStore((store) => {
      if (!(store.requesters || []).some((row) => row.id === request.params.id)) fail(404, 'Solicitante não encontrado.')
      store.requesters = store.requesters.filter((row) => row.id !== request.params.id)
    })
    response.status(204).end()
  }))
  return router
}
