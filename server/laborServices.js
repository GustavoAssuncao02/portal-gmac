import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'
import { activityDateRange } from './employeeActivity.js'
import { activeSessions } from './operationSessions.js'
import { requireAdminOrOperator } from './access.js'
import { duration, hourReport, ordersWithOperations, workIntervals } from './reportData.js'

const defaults = [
  ['Tornearia', 'Usinagem', 85], ['Fresagem', 'Usinagem', 90],
  ['Soldagem', 'Caldeiraria', 75], ['Corte e dobra', 'Caldeiraria', 65],
  ['Montagem mecânica', 'Montagem', 70], ['Pintura industrial', 'Pintura', 60],
  ['Polimento', 'Acabamento', 55],
]

export async function ensureLaborServices() {
  if (Array.isArray((await readStore()).laborServices)) return
  await mutateStore((store) => {
    if (!Array.isArray(store.laborServices)) store.laborServices = defaults.map(([name, sector, hourlyRate]) => ({ id: randomUUID(), name, type: 'Hora homem', sector, hourlyRate, createdAt: new Date().toISOString() }))
  })
}
export async function laborServiceRows() { return (await readStore()).laborServices || [] }

export function laborServiceHistory(id, orders, range = null, now = Date.now()) {
  return workIntervals(orders, now).filter((row) => String(row.laborServiceId) === String(id) && (!range || row.start < range.end && row.end > range.start)).map((row) => ({
    id: `${row.orderCode}|${row.sessionId}|${row.start}`, employeeId: row.employeeId, employeeName: row.employeeName || 'Operador não identificado', orderCode: row.orderCode,
    service: orders.find((order) => order.code === row.orderCode)?.service || '',
    startedAt: new Date(row.start).toISOString(), endedAt: row.active ? null : new Date(row.end).toISOString(),
    durationMs: Math.min(row.end, range?.end ?? Infinity) - Math.max(row.start, range?.start ?? -Infinity), active: row.active, endedBy: row.endedBy, reason: row.reason,
  })).sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
}

export default function createLaborServicesRouter(requireAdmin, pool) {
  const router = express.Router()
  // The operator account chooses the labor service when it starts the work.
  router.get('/labor-services', requireAdminOrOperator, async (_request, response, next) => {
    try {
      const store = await readStore()
      const intervals = workIntervals(await ordersWithOperations(store.orders, pool))
      const totals = hourReport(intervals, store.laborServices || [], 'laborServiceId', { start: 0, end: Date.now() }, [], { parallelField: 'employeeId' }).totals
      response.set('Cache-Control', 'no-store').json({ items: (store.laborServices || []).map((row) => ({ ...row, usage: duration(totals.find((item) => item.id === String(row.id))?.ms || 0) })) })
    } catch (error) { next(error) }
  })
  router.get('/labor-services/:id/history', requireAdmin, async (request, response, next) => {
    try {
      const range = activityDateRange(request.query.period ?? 'all', request.query.date)
      const store = await readStore()
      if (!(store.laborServices || []).some((row) => String(row.id) === request.params.id)) return response.status(404).json({ message: 'Serviço não encontrado.' })
      response.set('Cache-Control', 'no-store').json({ items: laborServiceHistory(request.params.id, await ordersWithOperations(store.orders, pool), range) })
    } catch (error) { if (error instanceof RangeError) return response.status(400).json({ message: error.message }); next(error) }
  })
  for (const method of ['post', 'put']) router[method](method === 'post' ? '/labor-services' : '/labor-services/:id', requireAdmin, async (request, response, next) => {
    try {
      const { name, type = 'Hora homem', sector = '', hourlyRate } = request.body || {}
      if (typeof name !== 'string' || !name.trim() || name.length > 160 || typeof type !== 'string' || type.length > 100 || typeof sector !== 'string' || sector.length > 100 || hourlyRate == null || hourlyRate === '' || !['number', 'string'].includes(typeof hourlyRate) || !Number.isFinite(Number(hourlyRate)) || Number(hourlyRate) < 0) return response.status(400).json({ message: 'Informe nome e valor por hora válidos.' })
      const item = await mutateStore((store) => {
        store.laborServices ||= []
        const row = method === 'post' ? { id: randomUUID(), createdAt: new Date().toISOString() } : store.laborServices.find((entry) => String(entry.id) === request.params.id)
        if (!row) return null
        Object.assign(row, { name: name.trim(), type: type.trim(), sector: sector.trim(), hourlyRate: Number(hourlyRate) })
        if (method === 'post') store.laborServices.push(row)
        return row
      })
      if (!item) return response.status(404).json({ message: 'Serviço não encontrado.' })
      response.status(method === 'post' ? 201 : 200).json({ item })
    } catch (error) { next(error) }
  })
  router.delete('/labor-services/:id', requireAdmin, async (request, response, next) => {
    try {
      const result = await mutateStore(async (store) => {
        const index = (store.laborServices || []).findIndex((row) => String(row.id) === request.params.id)
        if (index < 0) return 'missing'
        const orders = await ordersWithOperations(store.orders, pool)
        if (orders.some((order) => activeSessions(order.operation).some((session) => String(session.laborServiceId) === request.params.id))) return 'active'
        store.laborServices.splice(index, 1)
        return 'removed'
      })
      if (result === 'missing') return response.status(404).json({ message: 'Serviço não encontrado.' })
      if (result === 'active') return response.status(409).json({ message: 'Pause ou troque o serviço nas sessões ativas antes de excluir.' })
      response.json({ ok: true })
    } catch (error) { next(error) }
  })
  return router
}
