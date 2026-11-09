import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore } from './store.js'

// Cadastros: who created, changed or deleted each registration and when, with each field before and after. One list in
// the store (registryEvents) for clients, administrators, sectors, banks, pause reasons, requesters and buyers. The
// suppliers already keep theirs in the Contas a Pagar history (payableEvents) and are read here in the same shape.
export const registryNames = ['clients', 'admins', 'sectors', 'banks', 'pauseReasons', 'requesters', 'buyers', 'suppliers']
// Not shown as changes: identifiers, dates kept by the system and secrets (a new password shows only as "Senha alterada").
const hidden = new Set(['id', 'createdAt', 'updatedAt', 'passwordHash', 'password', 'source', 'clientId', 'role'])
const text = (value) => value == null ? '' : String(value)

export function registryChanges(before, after) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter((key) => !hidden.has(key))
  return keys.filter((key) => text(before?.[key]) !== text(after?.[key])).map((key) => ({ field: key, before: text(before?.[key]), after: text(after?.[key]) }))
}

// `actor` is who did it ({ id, name }); without one the change was made by the system. `extra` adds changes that are not
// fields of the record (the password). An edit that changed nothing is not recorded.
export function recordRegistryChange(store, { registry, recordId, type, actor = null, before = null, after = null, note = '', extra = [] }) {
  const changes = type === 'deleted' ? [] : [...registryChanges(type === 'created' ? null : before, after), ...extra]
  if (type === 'edited' && !changes.length) return null
  const event = { id: randomUUID(), at: new Date().toISOString(), registry, recordId: String(recordId), type, userId: actor?.id ?? null, userName: actor?.name || 'Sistema', name: after?.name || before?.name || '', changes, note }
  store.registryEvents ||= []
  store.registryEvents.push(event)
  return event
}

export const actorOf = (request) => request.adminName ? { id: request.adminId ?? null, name: request.adminName } : null

const supplierTypes = { supplier_created: 'created', supplier_edited: 'edited', supplier_deleted: 'deleted' }
// Older supplier events kept the supplier itself as their "after", so a later edit also changed them; each "before" was
// always a copy. The "after" of an event is therefore read from the "before" of the next one, and only the last event
// uses its own (which matches the supplier as it was then).
function supplierHistory(store, id) {
  const events = (store.payableEvents || []).filter((event) => supplierTypes[event.type]).map((event) => {
    const type = supplierTypes[event.type]
    const before = type === 'deleted' ? event.details : event.details?.before || null
    const after = type === 'deleted' ? null : event.details?.after || null
    return { event, type, before, after, recordId: String(after?.id ?? before?.id ?? '') }
  }).filter((item) => item.recordId === String(id))
  return events.map((item, index) => {
    const after = item.type === 'deleted' ? null : events[index + 1]?.before || item.after
    return { id: item.event.id, at: item.event.at, type: item.type, userName: item.event.userName, recordId: item.recordId, changes: item.type === 'deleted' ? [] : registryChanges(item.type === 'created' ? null : item.before, after), note: '' }
  })
}

export default function createRegistryHistoryRouter(requireAdmin) {
  const router = express.Router()
  router.get('/registry-history/:registry/:id', requireAdmin, async (request, response, next) => {
    try {
      const { registry, id } = request.params
      if (!registryNames.includes(registry)) return response.status(404).json({ message: 'Cadastro não encontrado.' })
      // Same rule as the list of administrators: their history is for administrators only.
      if (registry === 'admins' && request.adminRole !== 'admin') return response.status(403).json({ message: 'Somente administradores veem o histórico dos administradores.' })
      const store = await readStore()
      const items = registry === 'suppliers' ? supplierHistory(store, id) : (store.registryEvents || []).filter((event) => event.registry === registry && event.recordId === String(id))
      response.set('Cache-Control', 'no-store').json({ items: items.sort((left, right) => right.at.localeCompare(left.at)) })
    } catch (error) { next(error) }
  })
  return router
}
