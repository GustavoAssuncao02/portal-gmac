import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'
import { ordersWithOperations, workIntervals } from './reportData.js'
import { requireAdminOrOperator } from './access.js'
import { employeeRecords } from './employeeAccess.js'
import { sectorRows } from './registries.js'
import { machineSectors } from './machines.js'
import { sortedByName } from './byName.js'
import { DAY_MS, SLOT_MS, addDays, blockEnd, blockOccupancy, blockStart, blockState, clockTime, dayStart, localDay, operatorQueue, orderForecast, orderStages, planningBacklog } from './planningRules.js'

const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayStart(value)) && localDay(dayStart(value)) === value

// Machines and labor services as the plan sees them: what can receive a block, with its sectors.
function planningResources(store) {
  return [
    ...sortedByName(store.machines).map((item) => ({ type: 'machine', id: String(item.id), name: item.name, sectors: machineSectors(item), maintenance: item.maintenance || null })),
    ...sortedByName(store.laborServices).map((item) => ({ type: 'labor-service', id: String(item.id), name: item.name, sectors: machineSectors(item), maintenance: null })),
  ]
}

// Each block with what the screens show: the OS, the stage, the resource and how it is going now.
function decorate(blocks, orders, resources, now) {
  const orderOf = new Map(orders.map((order) => [order.code, order]))
  return blocks.flatMap((block) => {
    const order = orderOf.get(block.orderCode)
    if (!order) return []
    const resource = resources.find((item) => item.type === block.resourceType && item.id === String(block.resourceId))
    // The machine or service defined in the OS for the stage: the block stays on it. `position`: the order of the stage
    // in the OS (Planejar OS starts a stage after the blocks of the stages before it).
    const stages = orderStages(order), index = stages.findIndex((item) => item.code === block.stageCode)
    const stageResource = stages[index]?.resource || null
    return [{ ...block, end: new Date(blockEnd(block)).toISOString(), ...blockState(block, order, now), stageResource, position: index + 1, service: order.service, company: order.company, deadline: order.deadline, urgency: order.resources?.urgency === 'emergency' ? 'emergency' : 'normal', quantityTotal: Number(order.quantity) || 0, resourceName: resource?.name || 'Fora do cadastro' }]
  })
}

export default function createPlanningRouter(requireAdmin, pool) {
  const router = express.Router()
  const handle = (task) => async (request, response, next) => {
    try { await task(request, response) } catch (error) { error.status ? response.status(error.status).json({ message: error.message }) : next(error) }
  }
  const load = async () => {
    const store = await readStore()
    return { store, orders: await ordersWithOperations(store.orders || [], pool), resources: planningResources(store) }
  }

  // The plan of a period (a day, a week or a month, up to 62 days), the real work in it and what is left to plan.
  router.get('/planning', requireAdmin, handle(async (request, response) => {
    const from = request.query.from ?? localDay(Date.now()), to = request.query.to ?? from
    if (!isDate(from) || !isDate(to) || to < from || dayStart(to) - dayStart(from) > 62 * DAY_MS) fail(400, 'Informe um período válido de até 62 dias.')
    const start = dayStart(from), end = dayStart(addDays(to, 1)), now = Date.now()
    const { store, orders, resources } = await load()
    const blocks = store.planningBlocks || []
    const actual = workIntervals(orders, now).filter((item) => item.start < end && item.end > start && (item.machineId != null || item.laborServiceId != null))
      .map((item) => ({ resourceType: item.machineId != null ? 'machine' : 'labor-service', resourceId: String(item.machineId ?? item.laborServiceId), orderCode: item.orderCode, employeeName: item.employeeName || 'Operador não identificado', start: item.start, end: item.end, active: item.active }))
    response.set('Cache-Control', 'no-store').json({
      now, from, to,
      resources,
      sectors: (await sectorRows()).map((sector) => sector.name),
      blocks: decorate(blocks.filter((block) => blockStart(block) < end && blockEnd(block) > start), orders, resources, now),
      actual,
      backlog: planningBacklog(orders, blocks, now),
    })
  }))

  // A block is valid for an open OS, one of its stages and a registered resource; a machine takes one block at a time.
  // A stage with its machine or service defined in the OS is planned on it: it is where the operator will work.
  function blockFrom(body, { orders, resources }) {
    const order = orders.find((item) => item.code === body?.orderCode)
    if (!order) fail(404, 'OS não encontrada.')
    if (order.operation?.status === 'completed') fail(409, 'Esta OS já foi concluída.')
    const stage = orderStages(order).find((item) => item.code === body?.stageCode)
    if (!stage) fail(400, 'Selecione uma etapa desta OS.')
    const resource = resources.find((item) => item.type === body?.resourceType && item.id === String(body?.resourceId ?? ''))
    if (!resource) fail(400, 'Selecione uma máquina ou um serviço cadastrado.')
    const planned = stage.resource && resources.find((item) => item.type === stage.resource.type && item.id === String(stage.resource.id))
    if (planned && planned !== resource) fail(400, `A etapa ${stage.name} da ${order.code} é feita em ${planned.name}. Para trocar, edite a OS.`)
    const start = Date.parse(body?.start)
    if (!Number.isFinite(start) || start % SLOT_MS) fail(400, 'O início deve estar na grade de 15 em 15 minutos.')
    const minutes = Number(body?.minutes)
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 20160) fail(400, 'Informe a duração em minutos (até 14 dias).')
    const quantity = body?.quantity == null || body.quantity === '' ? null : Number(body.quantity)
    if (quantity != null && (!Number.isInteger(quantity) || quantity < 1 || quantity > Number(order.quantity))) fail(400, `As peças do bloco vão de 1 a ${order.quantity}.`)
    return { block: { orderCode: order.code, stageCode: body.stageCode, resourceType: resource.type, resourceId: resource.id, start: new Date(start).toISOString(), minutes, quantity }, resource }
  }
  // A machine is held by its blocks as they really go (blockOccupancy, 2026-11-28): a late block until now plus what is
  // left of it, a block done early only until it was done, a block late for more than 7 days not at all; the blocks of an
  // OS no longer in the portal do not hold it (the screens do not show them).
  const assertFree = (blocks, block, resource, id, orders, now = Date.now()) => {
    if (block.resourceType !== 'machine') return
    const orderOf = new Map(orders.map((order) => [order.code, order]))
    for (const item of blocks) {
      if (item.id === id || item.resourceType !== 'machine' || String(item.resourceId) !== String(block.resourceId) || !orderOf.has(item.orderCode)) continue
      const busy = blockOccupancy(item, blockState(item, orderOf.get(item.orderCode), now), now)
      if (!busy || !(busy.start < blockEnd(block) && blockStart(block) < busy.end)) continue
      const day = localDay(busy.start) !== localDay(blockStart(block)) ? ` de ${localDay(busy.start).split('-').reverse().join('/')}` : ''
      fail(409, busy.end > blockEnd(item) ? `${resource.name} ainda está com a ${item.orderCode}, em atraso, até ${clockTime(busy.end)}${localDay(busy.end) !== localDay(blockStart(block)) ? ` de ${localDay(busy.end).split('-').reverse().join('/')}` : ''}.` : `${resource.name} já tem a ${item.orderCode} das ${clockTime(busy.start)} às ${clockTime(busy.end)}${day}.`)
    }
  }

  router.post('/planning/blocks', requireAdmin, handle(async (request, response) => {
    const loaded = await load()
    const { block, resource } = blockFrom(request.body, loaded)
    const at = new Date().toISOString(), by = request.adminName || 'Administrador'
    const item = await mutateStore((store) => {
      store.planningBlocks ||= []
      assertFree(store.planningBlocks, block, resource, null, loaded.orders)
      const created = { id: randomUUID(), ...block, createdAt: at, createdBy: by, updatedAt: at, updatedBy: by }
      store.planningBlocks.push(created)
      return created
    })
    response.status(201).json({ item })
  }))
  // Several stages of an OS at once (Planejar OS): all are saved or none, each one also checked against the others.
  router.post('/planning/blocks/batch', requireAdmin, handle(async (request, response) => {
    const items = request.body?.items
    if (!Array.isArray(items) || !items.length || items.length > 30) fail(400, 'Escolha as etapas para planejar.')
    const loaded = await load()
    const prepared = items.map((body) => blockFrom(body, loaded))
    const at = new Date().toISOString(), by = request.adminName || 'Administrador'
    const created = await mutateStore((store) => {
      store.planningBlocks ||= []
      return prepared.map(({ block, resource }) => {
        assertFree(store.planningBlocks, block, resource, null, loaded.orders)
        const item = { id: randomUUID(), ...block, createdAt: at, createdBy: by, updatedAt: at, updatedBy: by }
        store.planningBlocks.push(item)
        return item
      })
    })
    response.status(201).json({ items: created })
  }))
  router.put('/planning/blocks/:id', requireAdmin, handle(async (request, response) => {
    const loaded = await load()
    const { block, resource } = blockFrom(request.body, loaded)
    const item = await mutateStore((store) => {
      const current = (store.planningBlocks || []).find((entry) => entry.id === request.params.id)
      if (!current) fail(404, 'Bloco do planejamento não encontrado.')
      assertFree(store.planningBlocks, block, resource, current.id, loaded.orders)
      return Object.assign(current, block, { updatedAt: new Date().toISOString(), updatedBy: request.adminName || 'Administrador' })
    })
    response.json({ item })
  }))
  router.delete('/planning/blocks/:id', requireAdmin, handle(async (request, response) => {
    const removed = await mutateStore((store) => {
      const before = (store.planningBlocks || []).length
      store.planningBlocks = (store.planningBlocks || []).filter((entry) => entry.id !== request.params.id)
      return store.planningBlocks.length < before
    })
    if (!removed) fail(404, 'Bloco do planejamento não encontrado.')
    response.status(204).end()
  }))

  // Planejamento > Entregas (2026-11-28): when each open OS should be ready if everything goes as planned (orderForecast),
  // or how much of it is planned.
  router.get('/planning/forecasts', requireAdmin, handle(async (request, response) => {
    const { store, orders } = await load()
    const now = Date.now(), blocks = store.planningBlocks || []
    response.set('Cache-Control', 'no-store').json({ now, items: orders.filter((order) => order.operation?.status !== 'completed').map((order) => ({ orderCode: order.code, ...orderForecast(order, blocks, now) })) })
  }))

  // The tablet: what is planned for the sectors of the identified employee, in the order of the plan.
  router.get('/planning/operator-queue', requireAdminOrOperator, handle(async (request, response) => {
    const employee = (await employeeRecords(pool)).find((item) => String(item.id) === String(request.query.employeeId ?? ''))
    if (!employee || !employee.active) fail(404, 'Funcionário não encontrado.')
    const names = (await sectorRows()).filter((sector) => employee.sectorIds.includes(sector.id)).map((sector) => sector.name)
    const { store, orders, resources } = await load()
    const now = Date.now()
    const blocks = decorate((store.planningBlocks || []).filter((block) => blockEnd(block) > now - DAY_MS && blockStart(block) < now + 2 * DAY_MS), orders, resources, now)
    response.set('Cache-Control', 'no-store').json({ sectors: names, items: names.length ? operatorQueue(blocks, resources, names, now) : [] })
  }))
  return router
}
