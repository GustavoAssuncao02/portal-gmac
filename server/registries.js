import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'
import { requireAdminOrOperator } from './access.js'
import { employeeRecords } from './employeeAccess.js'
import { bankInUse } from './banks.js'

// Simple registrations kept by the users themselves: the sectors of the employees and the reasons an operator can choose
// when pausing a work session. Each item is only a name.
const defaultPauseReasons = ['Descanso', 'Horário de almoço', 'Jossenilson mandou parar', 'Troca de atividade']
// Recorded by the system itself when an operator moves to another OS; it is not chosen by anyone.
export const SWITCH_PAUSE_REASON = 'Troca de serviço'

const clean = (value, limit = 120) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, limit)
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const sameName = (left, right) => left.localeCompare(right, 'pt-BR', { sensitivity: 'base' }) === 0
const byName = (left, right) => left.name.localeCompare(right.name, 'pt-BR')

export async function ensurePauseReasons() {
  if (Array.isArray((await readStore()).pauseReasons)) return
  await mutateStore((store) => {
    if (!Array.isArray(store.pauseReasons)) store.pauseReasons = defaultPauseReasons.map((name) => ({ id: randomUUID(), name, createdAt: new Date().toISOString() }))
  })
}

export async function pauseReasonNames() {
  await ensurePauseReasons()
  return ((await readStore()).pauseReasons || []).map((item) => item.name)
}

export async function sectorRows() { return ((await readStore()).sectors || []).slice().sort(byName) }

// Cadastros > Setores is the only source of sectors: machines and labor services keep the names chosen from it, and the
// employees keep the ids. A name used by a machine or a service is always registered (inside the same change).
export const defaultSectors = ['Usinagem', 'Caldeiraria', 'Pintura']
export function registerSectorNames(store, names = []) {
  store.sectors ||= []
  return [...new Set(names.map((name) => clean(name)).filter(Boolean))].map((name) => {
    const found = store.sectors.find((row) => sameName(row.name, name))
    if (found) return found.name
    store.sectors.push({ id: randomUUID(), name, createdAt: new Date().toISOString() })
    return name
  })
}
const namesOf = (row) => Array.isArray(row.sectors) ? row.sectors : String(row.sector || '').split(/[,;]/)
const sectorText = (names) => names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : names[0] || ''

// The first start creates Usinagem, Caldeiraria and Pintura (once: a sector removed later does not come back) and
// registers the sectors the machines and services already had typed.
export async function ensureSectors() {
  const store = await readStore()
  const used = [...(store.machines || []), ...(store.laborServices || [])].flatMap(namesOf).map((name) => clean(name)).filter(Boolean)
  const missing = [...(store.sectorDefaultsCreated ? [] : defaultSectors), ...used].filter((name) => !(store.sectors || []).some((row) => sameName(row.name, name)))
  if (store.sectorDefaultsCreated && !missing.length) return
  await mutateStore((current) => {
    registerSectorNames(current, [...(current.sectorDefaultsCreated ? [] : defaultSectors), ...[...(current.machines || []), ...(current.laborServices || [])].flatMap(namesOf)])
    for (const row of [...(current.machines || []), ...(current.laborServices || [])]) {
      const names = registerSectorNames(current, namesOf(row))
      if (JSON.stringify(row.sectors) !== JSON.stringify(names)) Object.assign(row, { sectors: names, sector: sectorText(names) })
    }
    current.sectorDefaultsCreated = true
  })
}

// How many pauses each reason received; reasons removed from the registry still count under their name.
export async function pauseReasonStats(pool) {
  let events
  if (pool) {
    const [rows] = await pool.query("SELECT data FROM order_operation_events WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.type')) = 'paused'")
    events = rows.map((row) => typeof row.data === 'string' ? JSON.parse(row.data) : row.data)
  } else events = ((await readStore()).orders || []).flatMap((order) => (order.operationEvents || []).filter((event) => event.type === 'paused'))
  const counts = new Map()
  for (const event of events) if (event.reason) counts.set(event.reason, (counts.get(event.reason) || 0) + 1)
  return [...counts].map(([name, count]) => ({ name, count })).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'pt-BR'))
}

// `fields`: text fields besides the name ([key, limit]); `sameKey` tells which fields make two registrations the same.
function registryRoutes(router, { path, key, label, requireAdmin, readAccess = requireAdmin, inUse, decorate = async (items) => items, fields = [], sameKey = (row) => row.name, onSave = () => {} }) {
  const handle = (task) => async (request, response, next) => {
    try { await task(request, response) } catch (error) { error.status ? response.status(error.status).json({ message: error.message }) : next(error) }
  }
  router.get(path, readAccess, handle(async (_request, response) => {
    if (key === 'pauseReasons') await ensurePauseReasons()
    const items = ((await readStore())[key] || []).slice().sort(byName)
    response.set('Cache-Control', 'no-store').json({ items: await decorate(items) })
  }))
  for (const method of ['post', 'put']) router[method](method === 'post' ? path : `${path}/:id`, requireAdmin, handle(async (request, response) => {
    const name = clean(request.body?.name)
    if (!name) fail(400, 'Informe o nome.')
    if (key === 'pauseReasons' && sameName(name, SWITCH_PAUSE_REASON)) fail(409, `"${SWITCH_PAUSE_REASON}" é registrado pelo sistema quando o operador muda de OS.`)
    const extra = Object.fromEntries(fields.map(([field, limit]) => [field, clean(request.body?.[field], limit)]))
    const item = await mutateStore((store) => {
      store[key] ||= []
      if (store[key].some((row) => row.id !== request.params.id && sameName(String(sameKey(row)), String(sameKey({ name, ...extra }))))) fail(409, `${label} já cadastrado.`)
      let row = store[key].find((entry) => entry.id === request.params.id)
      if (method === 'put' && !row) fail(404, `${label} não encontrado.`)
      if (!row) { row = { id: randomUUID(), createdAt: new Date().toISOString() }; store[key].push(row) }
      const previous = row.name
      Object.assign(row, { name, ...extra })
      onSave(store, row, previous)
      return row
    })
    response.status(method === 'post' ? 201 : 200).json({ item })
  }))
  router.delete(`${path}/:id`, requireAdmin, handle(async (request, response) => {
    const current = ((await readStore())[key] || []).find((row) => row.id === request.params.id)
    if (!current) fail(404, `${label} não encontrado.`)
    const used = await inUse(current)
    if (used) fail(409, used)
    await mutateStore((store) => { store[key] = (store[key] || []).filter((row) => row.id !== current.id) })
    response.status(204).end()
  }))
}

export default function createRegistriesRouter(requireAdmin, pool) {
  const router = express.Router()
  // Who uses a sector: employees by id, machines and labor services by name.
  const usage = async (sector) => {
    const store = await readStore()
    const named = (rows) => (rows || []).filter((row) => namesOf(row).some((name) => sameName(clean(name), sector.name))).length
    return { employees: (await employeeRecords(pool)).filter((employee) => employee.sectorIds.includes(sector.id)).length, machines: named(store.machines), laborServices: named(store.laborServices) }
  }
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`
  registryRoutes(router, {
    path: '/sectors', key: 'sectors', label: 'Setor', requireAdmin,
    decorate: async (items) => Promise.all(items.map(async (item) => ({ ...item, ...await usage(item) }))),
    inUse: async (sector) => {
      const { employees, machines, laborServices } = await usage(sector)
      const parts = [employees && plural(employees, 'funcionário', 'funcionários'), machines && plural(machines, 'máquina', 'máquinas'), laborServices && plural(laborServices, 'serviço', 'serviços')].filter(Boolean)
      return parts.length ? `Este setor está vinculado a ${sectorText(parts)}. Troque o setor deles antes de excluir.` : null
    },
    // Renaming a sector renames it in the machines and services that use it (the employees keep its id).
    onSave: (store, row, previous) => {
      if (!previous || previous === row.name) return
      for (const item of [...(store.machines || []), ...(store.laborServices || [])]) {
        const names = namesOf(item).map((name) => clean(name)).filter(Boolean)
        if (!names.some((name) => sameName(name, previous))) continue
        const renamed = [...new Set(names.map((name) => sameName(name, previous) ? row.name : name))]
        Object.assign(item, { sectors: renamed, sector: sectorText(renamed) })
      }
    },
  })
  // The operator account reads the reasons to pause; removing one keeps the pauses already recorded with it.
  registryRoutes(router, {
    path: '/pause-reasons', key: 'pauseReasons', label: 'Razão de pausa', requireAdmin, readAccess: requireAdminOrOperator,
    inUse: async () => ((await readStore()).pauseReasons || []).length <= 1 ? 'Mantenha pelo menos uma razão de pausa para os operadores.' : null,
  })
  // Banks: the name with branch and account; the same bank may have several accounts.
  registryRoutes(router, {
    path: '/banks', key: 'banks', label: 'Banco', requireAdmin, fields: [['agency', 20], ['account', 30]],
    sameKey: (row) => [row.name, row.agency || '', row.account || ''].join('|'),
    decorate: async (items) => { const store = await readStore(); return items.map((item) => ({ ...item, settlements: bankInUse(store, item.id) })) },
    inUse: async (bank) => { const count = bankInUse(await readStore(), bank.id); return count ? `Este banco está em ${count} ${count === 1 ? 'baixa' : 'baixas'} de contas. Ele continua no histórico e não pode ser excluído.` : null },
  })
  router.get('/pause-reasons/stats', requireAdmin, async (_request, response, next) => {
    try { response.set('Cache-Control', 'no-store').json({ items: await pauseReasonStats(pool) }) } catch (error) { next(error) }
  })
  return router
}
