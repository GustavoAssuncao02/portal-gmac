import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'
import { hourReport, localDate, ordersWithOperations, reportRange, workIntervals } from './reportData.js'
import { activityDateRange } from './employeeActivity.js'
import { activeSessions } from './operationSessions.js'
import { requireAdminOrOperator } from './access.js'
import { registerSectorNames } from './registries.js'
import { machineDay, machineUsageReport } from './machineUsage.js'

export async function machineRows() { return (await readStore()).machines || [] }
// A machine may serve more than one sector (the same T\u00eampera for Usinagem and Caldeiraria): `sectors` lists them and
// `sector` keeps the readable label ("Usinagem e Caldeiraria") for the screens, searches and reports.
export const machineSectors = (item) => [...new Set((Array.isArray(item.sectors) ? item.sectors : String(item.sector || '').split(/[,;]/)).map((value) => String(value ?? '').trim().slice(0, 100)).filter(Boolean))].slice(0, 10)
export const sectorLabel = (sectors) => sectors.length > 1 ? `${sectors.slice(0, -1).join(', ')} e ${sectors.at(-1)}` : sectors[0] || ''
const normalize = (item) => { const sectors = machineSectors(item); return { id: item.id || randomUUID(), name: String(item.name || '').trim().slice(0, 160), type: String(item.type || '').slice(0, 100), sectors, sector: sectorLabel(sectors), hourlyRate: Math.max(0, Number(item.hourlyRate) || 0), status: 'idle', operator: '\u2014', started: '\u2014', usage: '0h 00min' } }

const hoursLabel = (ms) => { const minutes = Math.floor(Math.max(0, ms) / 60000); return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}min` }

export function machineAvailability(machines, orders, now = Date.now()) {
  const today = localDate(now)
  const range = reportRange(today, today)
  const totals = hourReport(workIntervals(orders, now), machines, 'machineId', range).totals
  const usage = new Map(totals.map((row) => [row.id, row.ms]))
  // Idle today is the time elapsed since midnight in Bahia without the machine in use (overlapping sessions already merged).
  const elapsed = now - range.start
  const active = orders.flatMap((order) => activeSessions(order.operation).map((session) => ({ ...session, orderCode: order.code }))).filter((session) => session?.machineId != null)
  return machines.map((machine) => {
    const sessions = active.filter((session) => String(session.machineId) === String(machine.id))
    const starts = sessions.map((session) => Date.parse(session.machineStartedAt || session.startedAt)).filter(Number.isFinite)
    const used = usage.get(String(machine.id)) || 0
    return {
      ...machine,
      // A machine in maintenance cannot be chosen; the work already running on it (none, the change waits for it) wins.
      status: sessions.length ? 'working' : machine.maintenance ? 'maintenance' : 'idle',
      operator: [...new Set(sessions.map((session) => session.employeeName || 'Operador não identificado'))].join(', ') || '\u2014',
      // Who holds the machine now (one person at a time): the operator screen shows it as taken.
      inUseBy: sessions.map((session) => ({ employeeId: session.employeeId ?? null, employeeName: session.employeeName || 'Operador não identificado', orderCode: session.orderCode })),
      started: starts.length ? new Date(Math.min(...starts)).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' }) : '\u2014',
      usage: hoursLabel(used),
      usageMs: used,
      idle: hoursLabel(elapsed - used),
    }
  })
}

export function machineUsageHistory(machineId, orders, range = null, now = Date.now()) {
  const orderMap = new Map(orders.map((order) => [order.code, order]))
  return workIntervals(orders, now)
    .filter((interval) => String(interval.machineId) === String(machineId) && (!range || interval.start < range.end && interval.end > range.start))
    .map((interval) => ({
      id: `${interval.orderCode}|${interval.sessionId || 'legacy'}|${interval.start}`,
      employeeId: interval.employeeId ?? null,
      employeeName: interval.employeeName || 'Operador não identificado',
      orderCode: interval.orderCode,
      service: orderMap.get(interval.orderCode)?.service || '',
      startedAt: new Date(interval.start).toISOString(),
      endedAt: interval.active ? null : new Date(interval.end).toISOString(),
      durationMs: Math.min(interval.end, range?.end ?? Infinity) - Math.max(interval.start, range?.start ?? -Infinity),
      active: interval.active,
      endedBy: interval.endedBy,
      reason: interval.reason,
    }))
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
}

export default function createMachinesRouter(requireAdmin, pool) {
  const router = express.Router()
  // The operator account chooses the machine when it starts the work.
  router.get('/machines', requireAdminOrOperator, async (_request, response, next) => {
    try {
      const store = await readStore()
      const orders = await ordersWithOperations(store.orders, pool)
      response.set('Cache-Control', 'no-store').json({ items: machineAvailability(store.machines || [], orders) })
    } catch (error) { next(error) }
  })
  // Machine use over a period (the current month by default on the screen), up to one year at a time.
  router.get('/machines/usage', requireAdmin, async (request, response, next) => {
    let range
    try { range = reportRange(request.query.start, request.query.end) } catch (error) { return response.status(400).json({ message: error.message }) }
    if (range.end - range.start > 366 * 86400000) return response.status(400).json({ message: 'Escolha um período de até 366 dias.' })
    try {
      const store = await readStore()
      const orders = await ordersWithOperations(store.orders, pool)
      response.set('Cache-Control', 'no-store').json(machineUsageReport(store.machines || [], orders, range))
    } catch (error) { next(error) }
  })
  // Everything that happened to one machine on one day.
  router.get('/machines/:id/day', requireAdmin, async (request, response, next) => {
    try { reportRange(request.query.date, request.query.date) } catch (error) { return response.status(400).json({ message: error.message === 'Informe as datas de início e fim.' ? 'Informe a data.' : error.message }) }
    try {
      const store = await readStore()
      const machine = (store.machines || []).find((item) => String(item.id) === request.params.id)
      if (!machine) return response.status(404).json({ message: 'Máquina não encontrada.' })
      const orders = await ordersWithOperations(store.orders, pool)
      response.set('Cache-Control', 'no-store').json(machineDay(machine, orders, request.query.date))
    } catch (error) { next(error) }
  })
  router.get('/machines/:id/history', requireAdmin, async (request, response, next) => {
    try {
      const range = activityDateRange(request.query.period ?? 'all', request.query.date)
      const store = await readStore()
      const machine = (store.machines || []).find((item) => String(item.id) === request.params.id)
      if (!machine) return response.status(404).json({ message: 'Máquina não encontrada.' })
      const orders = await ordersWithOperations(store.orders, pool)
      response.set('Cache-Control', 'no-store').json({ items: machineUsageHistory(machine.id, orders, range) })
    } catch (error) {
      if (error instanceof RangeError) return response.status(400).json({ message: error.message })
      next(error)
    }
  })
  router.post('/machines/import', requireAdmin, async (request, response, next) => {
    try {
      if (!Array.isArray(request.body.items) || request.body.items.length > 500 || request.body.items.some((item) => !item.name || item.id == null)) return response.status(400).json({ message: 'Lista de máquinas inválida.' })
      const items = await mutateStore((store) => {
        // Import only once: an intentionally emptied registry must stay empty.
        if (!Array.isArray(store.machines)) store.machines = request.body.items.map(normalize)
        return store.machines
      })
      response.json({ items })
    } catch (error) { next(error) }
  })
  for (const method of ['post', 'put']) router[method](method === 'post' ? '/machines' : '/machines/:id', requireAdmin, async (request, response, next) => {
    try {
      const item = normalize({ ...request.body, id: method === 'post' ? undefined : request.params.id })
      if (!item.name || !Number.isFinite(Number(request.body.hourlyRate)) || Number(request.body.hourlyRate) < 0) return response.status(400).json({ message: 'Informe nome e valor por hora válidos.' })
      const found = await mutateStore((store) => {
        store.machines ||= []
        // The sectors come from Cadastros > Setores, with its spelling.
        item.sectors = registerSectorNames(store, item.sectors)
        item.sector = sectorLabel(item.sectors)
        if (method === 'post') { store.machines.push(item); return item }
        const current = store.machines.find((row) => String(row.id) === request.params.id)
        if (!current) return null
        Object.assign(current, item)
        return current
      })
      if (!found) return response.status(404).json({ message: 'Máquina não encontrada.' })
      response.status(method === 'post' ? 201 : 200).json({ item: found })
    } catch (error) { next(error) }
  })
  // Maintenance takes the machine out of use: the operators cannot choose it until it is released. Each period is kept,
  // with who started and who ended it, for the machine history and the planning.
  router.post('/machines/:id/maintenance', requireAdmin, async (request, response, next) => {
    try {
      const active = request.body?.active === true
      const reason = String(request.body?.reason ?? '').trim().slice(0, 500)
      if (active && reason.length < 3) return response.status(400).json({ message: 'Informe o motivo da manutenção.' })
      const store = await readStore()
      const machine = (store.machines || []).find((item) => String(item.id) === request.params.id)
      if (!machine) return response.status(404).json({ message: 'Máquina não encontrada.' })
      if (active) {
        const orders = await ordersWithOperations(store.orders, pool)
        const session = orders.flatMap((order) => activeSessions(order.operation).map((item) => ({ ...item, orderCode: order.code }))).find((item) => String(item.machineId) === request.params.id)
        if (session) return response.status(409).json({ message: `A máquina está sendo usada por ${session.employeeName || 'um operador'} na ${session.orderCode}. Pause o trabalho antes de colocar em manutenção.` })
      }
      const at = new Date().toISOString(), by = request.adminName || 'Administrador'
      const item = await mutateStore((current) => {
        const row = (current.machines || []).find((entry) => String(entry.id) === request.params.id)
        if (!row) return null
        if (active && !row.maintenance) row.maintenance = { since: at, reason, startedBy: by }
        else if (active) row.maintenance.reason = reason
        else if (row.maintenance) {
          row.maintenanceHistory = [{ ...row.maintenance, until: at, endedBy: by }, ...(row.maintenanceHistory || [])].slice(0, 200)
          row.maintenance = null
        }
        return row
      })
      if (!item) return response.status(404).json({ message: 'Máquina não encontrada.' })
      response.json({ item })
    } catch (error) { next(error) }
  })
  router.delete('/machines/:id', requireAdmin, async (request, response, next) => {
    try {
      const result = await mutateStore((store) => {
        const rows = store.machines || []
        const index = rows.findIndex((item) => String(item.id) === request.params.id)
        if (index < 0) return false
        if (store.orders.some((order) => activeSessions(order.operation).some((session) => String(session.machineId) === request.params.id))) return 'active'
        rows.splice(index, 1)
        return true
      })
      if (result === 'active') return response.status(409).json({ message: 'Pause a sessão desta máquina antes de excluir.' })
      if (!result) return response.status(404).json({ message: 'Máquina não encontrada.' })
      response.json({ ok: true })
    } catch (error) { next(error) }
  })
  return router
}
