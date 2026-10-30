import express from 'express'
import { randomUUID } from 'node:crypto'
import { mutateStore, readStore } from './offers.js'
import { registerSectorNames } from './registries.js'
import { requireAdminOrOperator } from './access.js'
import { seedStageCatalog, setStageCatalog } from './serviceStages.js'

// "Etapas" (below Máquinas and Serviços): the stages of the services. Each stage belongs to a sector of Cadastros ›
// Setores (its group), may be renamed (the old names stay as aliases, so the OS that kept a name still find it), and
// lists the machines and services it is made on (the first is the default of a new offer; with none, any of them).
// A stage already used by an offer or an OS is deactivated instead of deleted. Kept in the store as `stageCatalog`:
// { stages: [{ code, name, sectorId, active, resources: [{ type, id }], aliases }], groupOrder: [sectorId] }.
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const clean = (value, limit = 80) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, limit)
const sameText = (left, right) => String(left ?? '').trim().localeCompare(String(right ?? '').trim(), 'pt-BR', { sensitivity: 'base' }) === 0
const MAX_RESOURCES = 30

// The first catalog: the stages the system always had, in their sectors (registered when missing).
function seededCatalog(store) {
  const seed = seedStageCatalog()
  registerSectorNames(store, seed.groups)
  const sectorId = (name) => store.sectors.find((row) => sameText(row.name, name))?.id
  const now = new Date().toISOString()
  return { stages: seed.stages.map((row) => ({ code: row.code, name: row.name, sectorId: sectorId(row.group), active: row.active, resources: [], aliases: [], createdAt: now, updatedAt: now })), groupOrder: seed.groups.map(sectorId) }
}

// What the screens and the rules read: the sector names as groups, only the machines and services still registered.
export function catalogView(store) {
  const draft = store.stageCatalog ? store : structuredClone({ sectors: store.sectors || [] })
  const catalog = store.stageCatalog || seededCatalog(draft)
  const sectors = draft.sectors || []
  const sectorName = (id) => sectors.find((row) => row.id === id)?.name || 'Sem setor'
  const registered = (choice) => (choice.type === 'machine' ? store.machines : choice.type === 'labor-service' ? store.laborServices : null)?.some((item) => String(item.id) === String(choice.id))
  const stages = catalog.stages.map((row) => ({ ...row, group: sectorName(row.sectorId), resources: (row.resources || []).filter(registered) }))
  const ordered = (catalog.groupOrder || []).map(sectorName)
  const others = [...new Set(stages.map((row) => row.group))].filter((name) => !ordered.includes(name)).sort((left, right) => left.localeCompare(right, 'pt-BR'))
  return { stages, groups: [...new Set([...ordered, ...others])] }
}

export async function refreshStageCatalog() {
  const view = catalogView(await readStore())
  setStageCatalog(view)
  return view
}

// At startup: the first catalog is saved once; afterwards the saved one is loaded.
export async function ensureStageCatalog() {
  if (!(await readStore()).stageCatalog) await mutateStore((store) => { store.stageCatalog ||= seededCatalog(store) })
  return refreshStageCatalog()
}

// A stage is used once an offer or an OS has it (by code) or an OS production kept its name.
function stageInUse(store, row) {
  const names = [row.name, ...(row.aliases || [])]
  const withStage = (item) => [item.resources?.stages, item.proposal?.stages].some((list) => list?.includes(row.code))
  const produced = (order) => (order.operation?.stages || []).some((stage) => names.some((name) => sameText(name, stage.name)))
  return (store.offers || []).some(withStage) || [...(store.orders || []), ...(store.cancelledOrders || [])].some((order) => withStage(order) || produced(order))
}

function stageFields(body, store, current) {
  const name = clean(body?.name)
  if (!name) fail(400, 'Informe o nome da etapa.')
  const others = store.stageCatalog.stages.filter((row) => row.code !== current?.code)
  if (others.some((row) => [row.name, ...(row.aliases || [])].some((used) => sameText(used, name)))) fail(409, 'Já existe uma etapa com esse nome (ou que já teve esse nome).')
  const sectorId = String(body?.sectorId ?? '')
  if (!(store.sectors || []).some((row) => row.id === sectorId)) fail(400, 'Escolha o setor da etapa (Cadastros › Setores).')
  if (body?.resources !== undefined && !Array.isArray(body.resources)) fail(400, 'Máquinas e serviços da etapa inválidos.')
  const seen = new Set(), resources = []
  for (const choice of (body?.resources ?? current?.resources ?? []).slice(0, MAX_RESOURCES)) {
    const type = choice?.type, id = String(choice?.id ?? '')
    const catalog = type === 'machine' ? store.machines : type === 'labor-service' ? store.laborServices : null
    const found = catalog?.find((item) => String(item.id) === id)
    if (!found) fail(400, 'Escolha máquinas e serviços cadastrados para a etapa.')
    if (!seen.has(`${type}:${id}`)) { seen.add(`${type}:${id}`); resources.push({ type, id: found.id }) }
  }
  return { name, sectorId, resources }
}

// A renamed stage: the OS that kept the old name in their production and records show the new one.
async function renameInOrders(pool, from, to) {
  const renameStages = (state) => {
    let changed = false
    for (const stage of state?.stages || []) if (sameText(stage.name, from)) { stage.name = to; changed = true }
    return changed
  }
  if (pool) {
    const [states] = await pool.execute('SELECT order_code, data FROM order_operations WHERE data LIKE ?', [`%${from}%`])
    for (const row of states) {
      const state = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
      if (renameStages(state)) await pool.execute('UPDATE order_operations SET data = ? WHERE order_code = ?', [JSON.stringify(state), row.order_code])
    }
    const [events] = await pool.execute('SELECT id, data FROM order_operation_events WHERE data LIKE ?', [`%${from}%`])
    for (const row of events) {
      const event = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
      if (sameText(event.stageName, from)) { event.stageName = to; await pool.execute('UPDATE order_operation_events SET data = ? WHERE id = ?', [JSON.stringify(event), row.id]) }
    }
  }
  await mutateStore((store) => {
    for (const order of [...(store.orders || []), ...(store.cancelledOrders || [])]) {
      renameStages(order.operation)
      for (const event of order.operationEvents || []) if (sameText(event.stageName, from)) event.stageName = to
    }
  })
}

export default function createStageCatalogRouter(requireAdmin, pool) {
  const router = express.Router()
  const handle = (task) => async (request, response, next) => {
    try { await task(request, response) } catch (error) { error.status ? response.status(error.status).json({ message: error.message }) : next(error) }
  }
  const answer = async (response, status = 200) => {
    const store = await readStore()
    const view = catalogView(store)
    setStageCatalog(view)
    const raw = new Map((store.stageCatalog?.stages || []).map((row) => [row.code, row]))
    response.status(status).set('Cache-Control', 'no-store').json({ ...view, stages: view.stages.map((row) => ({ ...row, inUse: stageInUse(store, raw.get(row.code) || row) })), sectors: (store.sectors || []).map(({ id, name }) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')) })
  }
  // The catalog is read by every screen (and by the operator's tablet, for the names and groups).
  router.get('/stages', requireAdminOrOperator, handle(async (_request, response) => {
    if (!(await readStore()).stageCatalog) await ensureStageCatalog()
    await answer(response)
  }))
  router.post('/stages', requireAdmin, handle(async (request, response) => {
    await mutateStore((store) => {
      store.stageCatalog ||= seededCatalog(store)
      const now = new Date().toISOString()
      store.stageCatalog.stages.push({ code: `stage-${randomUUID().slice(0, 8)}`, ...stageFields(request.body, store), active: true, aliases: [], createdAt: now, updatedAt: now })
    })
    await answer(response, 201)
  }))
  router.put('/stages/:code', requireAdmin, handle(async (request, response) => {
    const renamed = await mutateStore((store) => {
      store.stageCatalog ||= seededCatalog(store)
      const row = store.stageCatalog.stages.find((entry) => entry.code === request.params.code)
      if (!row) fail(404, 'Etapa não encontrada.')
      const fields = stageFields(request.body, store, row)
      const before = row.name
      if (!sameText(before, fields.name)) row.aliases = [...new Set([...(row.aliases || []).filter((alias) => !sameText(alias, fields.name)), before])]
      Object.assign(row, fields, { updatedAt: new Date().toISOString() })
      return before !== fields.name ? { from: before, to: fields.name } : null
    })
    if (renamed) await renameInOrders(pool, renamed.from, renamed.to)
    await answer(response)
  }))
  router.patch('/stages/:code/active', requireAdmin, handle(async (request, response) => {
    if (typeof request.body?.active !== 'boolean') fail(400, 'Informe se a etapa fica ativa.')
    await mutateStore((store) => {
      store.stageCatalog ||= seededCatalog(store)
      const row = store.stageCatalog.stages.find((entry) => entry.code === request.params.code)
      if (!row) fail(404, 'Etapa não encontrada.')
      Object.assign(row, { active: request.body.active, updatedAt: new Date().toISOString() })
    })
    await answer(response)
  }))
  router.delete('/stages/:code', requireAdmin, handle(async (request, response) => {
    await mutateStore((store) => {
      store.stageCatalog ||= seededCatalog(store)
      const row = store.stageCatalog.stages.find((entry) => entry.code === request.params.code)
      if (!row) fail(404, 'Etapa não encontrada.')
      if (stageInUse(store, row)) fail(409, `A etapa ${row.name} já foi usada em ofertas ou OS: desative-a em vez de excluir.`)
      store.stageCatalog.stages = store.stageCatalog.stages.filter((entry) => entry !== row)
    })
    await answer(response)
  }))
  // The order of the "Etapas" screen: the groups (sectors) and the stages; it is the order of every new offer.
  router.put('/stages-order', requireAdmin, handle(async (request, response) => {
    const { groups, stages } = request.body || {}
    if (!Array.isArray(groups) || !Array.isArray(stages)) fail(400, 'Ordem das etapas inválida.')
    await mutateStore((store) => {
      store.stageCatalog ||= seededCatalog(store)
      const rank = (list, value) => { const index = list.indexOf(value); return index === -1 ? Infinity : index }
      const rows = store.stageCatalog.stages.map((row, index) => ({ row, index }))
      store.stageCatalog.stages = rows.sort((left, right) => rank(stages, left.row.code) - rank(stages, right.row.code) || left.index - right.index).map(({ row }) => row)
      store.stageCatalog.groupOrder = [...new Set(groups.map(String).filter((id) => (store.sectors || []).some((row) => row.id === id)))]
    })
    await answer(response)
  }))
  return router
}
