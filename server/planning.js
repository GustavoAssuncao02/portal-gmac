import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'
import { ordersWithOperations, workIntervals } from './reportData.js'
import { requireAdminOrOperator } from './access.js'
import { employeeRecords } from './employeeAccess.js'
import { sectorRows } from './registries.js'
import { machineSectors } from './machines.js'
import { DAY_MS, SLOT_MS, addDays, blockEnd, blockStart, blockState, clockTime, dayStart, localDay, operatorQueue, orderStages, planningBacklog } from './planningRules.js'

const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayStart(value)) && localDay(dayStart(value)) === value

// Machines and labor services as the plan sees them: what can receive a block, with its sectors.
function planningResources(store) {
  return [
    ...(store.machines || []).map((item) => ({ type: 'machine', id: String(item.id), name: item.name, sectors: machineSectors(item), maintenance: item.maintenance || null })),
    ...(store.laborServices || []).map((item) => ({ type: 'labor-service', id: String(item.id), name: item.name, sectors: machineSectors(item), maintenance: null })),
  ]
}

// Each block with what the screens show: the OS, the stage, the resource and how it is going now.
function decorate(blocks, orders, resources, now) {
  const orderOf = new Map(orders.map((order) => [order.code, order]))
  return blocks.flatMap((block) => {
    const order = orderOf.get(block.orderCode)
    if (!order) return []
    const resource = resources.find((item) => item.type === block.resourceType && item.id === String(block.resourceId))
    return [{ ...block, end: new Date(blockEnd(block)).toISOString(), ...blockState(block, order, now), service: order.service, company: order.company, deadline: order.deadline, urgency: order.resources?.urgency === 'emergency' ? 'emergency' : 'normal', quantityTotal: Number(order.quantity) || 0, resourceName: resource?.name || 'Fora do cadastro' }]
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
  async function blockFrom(body, id) {
    const { store, orders, resources } = await load()
    const order = orders.find((item) => item.code === body?.orderCode)
    if (!order) fail(404, 'OS não encontrada.')
    if (order.operation?.status === 'completed') fail(409, 'Esta OS já foi concluída.')
    if (!orderStages(order).some((stage) => stage.code === body?.stageCode)) fail(400, 'Selecione uma etapa desta OS.')
    const resource = resources.find((item) => item.type === body?.resourceType && item.id === String(body?.resourceId ?? ''))
    if (!resource) fail(400, 'Selecione uma máquina ou um serviço cadastrado.')
    const start = Date.parse(body?.start)
    if (!Number.isFinite(start) || start % SLOT_MS) fail(400, 'O início deve estar na grade de 15 em 15 minutos.')
    const minutes = Number(body?.minutes)
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 20160) fail(400, 'Informe a duração em minutos (até 14 dias).')
    const quantity = body?.quantity == null || body.quantity === '' ? null : Number(body.quantity)
    if (quantity != null && (!Number.isInteger(quantity) || quantity < 1 || quantity > Number(order.quantity))) fail(400, `As peças do bloco vão de 1 a ${order.quantity}.`)
    return { store, block: { orderCode: order.code, stageCode: body.stageCode, resourceType: resource.type, resourceId: resource.id, start: new Date(start).toISOString(), minutes, quantity }, resource }
  }
  const assertFree = (blocks, block, resource, id) => {
    if (block.resourceType !== 'machine') return
    const clash = blocks.find((item) => item.id !== id && item.resourceType === 'machine' && String(item.resourceId) === String(block.resourceId) && blockStart(item) < blockEnd(block) && blockStart(block) < blockEnd(item))
    if (clash) fail(409, `${resource.name} já tem a ${clash.orderCode} das ${clockTime(blockStart(clash))} às ${clockTime(blockEnd(clash))}${localDay(blockStart(clash)) !== localDay(blockStart(block)) ? ` de ${localDay(blockStart(clash)).split('-').reverse().join('/')}` : ''}.`)
  }

  router.post('/planning/blocks', requireAdmin, handle(async (request, response) => {
    const { block, resource } = await blockFrom(request.body)
    const at = new Date().toISOString(), by = request.adminName || 'Administrador'
    const item = await mutateStore((store) => {
      store.planningBlocks ||= []
      assertFree(store.planningBlocks, block, resource)
      const created = { id: randomUUID(), ...block, createdAt: at, createdBy: by, updatedAt: at, updatedBy: by }
      store.planningBlocks.push(created)
      return created
    })
    response.status(201).json({ item })
  }))
  router.put('/planning/blocks/:id', requireAdmin, handle(async (request, response) => {
    const { block, resource } = await blockFrom(request.body, request.params.id)
    const item = await mutateStore((store) => {
      const current = (store.planningBlocks || []).find((entry) => entry.id === request.params.id)
      if (!current) fail(404, 'Bloco do planejamento não encontrado.')
      assertFree(store.planningBlocks, block, resource, current.id)
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
