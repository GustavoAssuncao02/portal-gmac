import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'

export async function machineRows() { return (await readStore()).machines || [] }
const normalize = (item) => ({ id: item.id || randomUUID(), name: String(item.name || '').trim().slice(0, 160), type: String(item.type || '').slice(0, 100), sector: String(item.sector || '').slice(0, 100), hourlyRate: Math.max(0, Number(item.hourlyRate) || 0), status: 'idle', operator: '\u2014', started: '\u2014', usage: '0h 00min' })

export default function createMachinesRouter(requireAdmin) {
  const router = express.Router()
  router.get('/machines', async (_request, response, next) => {
    try { response.json({ items: await machineRows() }) } catch (error) { next(error) }
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
  router.delete('/machines/:id', requireAdmin, async (request, response, next) => {
    try {
      const result = await mutateStore((store) => {
        const rows = store.machines || []
        const index = rows.findIndex((item) => String(item.id) === request.params.id)
        if (index < 0) return false
        if (store.orders.some((order) => String(order.operation?.activeSession?.machineId) === request.params.id)) return 'active'
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
