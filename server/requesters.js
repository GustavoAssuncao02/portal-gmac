import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'

// Cadastros > Solicitantes: the people who ask for the services on behalf of a client (Nestlé asks, but who at Nestlé?).
// Cadastros > Compradores: the people who buy them (the client's purchasing department), kept the same way.
// A client has many requesters and buyers, and every one belongs to exactly one client. The name and the client are
// required; CPF, e-mail and phone are optional. The client's name is read from Cadastros > Clientes each time, so a
// renamed client shows up renamed here too.
export const clientContactKinds = {
  requesters: { singular: 'solicitante', plural: 'solicitantes', screen: 'Solicitantes' },
  buyers: { singular: 'comprador', plural: 'compradores', screen: 'Compradores' },
}
const clean = (value, limit = 160) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, limit)
const digits = (value) => String(value ?? '').replace(/\D/g, '')
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const sameText = (left, right) => left.localeCompare(right, 'pt-BR', { sensitivity: 'base' }) === 0
const capitalized = (text) => text[0].toUpperCase() + text.slice(1)

export function requesterFields(body = {}, clients = [], singular = clientContactKinds.requesters.singular) {
  const name = clean(body.name)
  if (!name) fail(400, `Informe o nome do ${singular}.`)
  const clientId = String(body.clientId ?? '').trim()
  if (!clientId) fail(400, `Selecione o cliente do ${singular}.`)
  if (!clients.some((client) => String(client.id) === clientId)) fail(400, 'Cliente não encontrado. Confira o cadastro em Cadastros > Clientes.')
  const cpf = digits(body.cpf)
  if (cpf && cpf.length !== 11) fail(400, 'Informe um CPF com 11 dígitos ou deixe o campo em branco.')
  const email = clean(body.email).toLowerCase()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Informe um e-mail válido ou deixe o campo em branco.')
  const phone = digits(body.phone)
  if (phone && (phone.length < 10 || phone.length > 11)) fail(400, 'Informe o telefone com DDD (10 ou 11 dígitos) ou deixe o campo em branco.')
  return { name, clientId, cpf, email, phone }
}

// An offer names who asked for it and who buys it. When the offer's client is registered, the name is looked up among
// that client's requesters (or buyers) and registered there when it is new (inside the offer's own change); `created`
// tells the screen to show it. Without a registered client the name stays only on the offer.
export function registerOfferContact(store, kind, client, value) {
  const name = clean(value)
  if (!name || !client) return { name, id: null, created: false }
  store[kind] ||= []
  const found = store[kind].find((row) => String(row.clientId) === String(client.id) && sameText(row.name, name))
  if (found) return { name: found.name, id: found.id, created: false }
  const now = new Date().toISOString()
  const row = { id: randomUUID(), createdAt: now, name, clientId: String(client.id), cpf: '', email: '', phone: '', updatedAt: now, source: 'offer' }
  store[kind].push(row)
  return { name, id: row.id, created: true }
}

// Requesters and buyers linked to a client: the client cannot be deleted while it has them.
export const clientRequesters = (store, clientId, kind = 'requesters') => (store[kind] || []).filter((row) => String(row.clientId) === String(clientId)).length

export default function createRequestersRouter(accounts, requireAdmin) {
  const router = express.Router()
  const handle = (task) => async (request, response, next) => {
    try { await task(request, response) } catch (error) { error.status ? response.status(error.status).json({ message: error.message }) : next(error) }
  }
  for (const [kind, { singular }] of Object.entries(clientContactKinds)) {
    const notFound = `${capitalized(singular)} não encontrado.`
    router.get(`/${kind}`, requireAdmin, handle(async (_request, response) => {
      const names = new Map((await accounts.clients()).map((client) => [String(client.id), client.name]))
      const items = ((await readStore())[kind] || []).map((row) => ({ ...row, clientName: names.get(String(row.clientId)) || '' })).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
      response.set('Cache-Control', 'no-store').json({ items })
    }))
    for (const method of ['post', 'put']) router[method](method === 'post' ? `/${kind}` : `/${kind}/:id`, requireAdmin, handle(async (request, response) => {
      const clients = await accounts.clients()
      const fields = requesterFields(request.body, clients, singular)
      const item = await mutateStore((store) => {
        store[kind] ||= []
        const others = store[kind].filter((row) => row.id !== request.params.id && String(row.clientId) === fields.clientId)
        if (others.some((row) => sameText(row.name, fields.name))) fail(409, `Este cliente já tem um ${singular} com esse nome.`)
        if (fields.cpf && others.some((row) => row.cpf === fields.cpf)) fail(409, `Este cliente já tem um ${singular} com esse CPF.`)
        let row = store[kind].find((entry) => entry.id === request.params.id)
        if (method === 'put' && !row) fail(404, notFound)
        if (!row) { row = { id: randomUUID(), createdAt: new Date().toISOString() }; store[kind].push(row) }
        Object.assign(row, fields, { updatedAt: new Date().toISOString() })
        return row
      })
      const client = clients.find((entry) => String(entry.id) === item.clientId)
      response.status(method === 'post' ? 201 : 200).json({ item: { ...item, clientName: client?.name || '' } })
    }))
    router.delete(`/${kind}/:id`, requireAdmin, handle(async (request, response) => {
      await mutateStore((store) => {
        if (!(store[kind] || []).some((row) => row.id === request.params.id)) fail(404, notFound)
        store[kind] = store[kind].filter((row) => row.id !== request.params.id)
      })
      response.status(204).end()
    }))
  }
  return router
}
