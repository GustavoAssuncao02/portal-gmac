import express from 'express'
import { readStore, mutateStore } from './offers.js'

const requestIds = (store) => new Set([
  ...(store.offers || []),
  ...(store.orders || []).map((order) => ({ ...order, id: order.offerId })),
].flatMap((offer) => (offer.resources?.materials || []).map((material) => `${offer.id}-${material.id}`)))

export default function createMaterialRequestsRouter(requireAdmin) {
  const router = express.Router()
  router.use('/material-requests', requireAdmin)
  router.get('/material-requests', async (_request, response, next) => {
    try { response.json({ items: (await readStore()).materialRequestStatuses || [] }) } catch (error) { next(error) }
  })
  router.post('/material-requests/import', async (request, response, next) => {
    const items = request.body?.items
    if (!Array.isArray(items) || items.length > 10000 || items.some((item) => typeof item?.id !== 'string' || item.id.length > 160 || item.status !== 'purchase-requested')) return response.status(400).json({ message: 'Solicitacoes de compra invalidas.' })
    try {
      const result = await mutateStore((store) => {
        store.materialRequestStatuses ||= []
        const valid = requestIds(store)
        for (const item of items) if (valid.has(item.id) && !store.materialRequestStatuses.some((current) => current.id === item.id)) store.materialRequestStatuses.push({ id: item.id, status: 'purchase-requested', importedAt: new Date().toISOString() })
        return store.materialRequestStatuses
      })
      response.json({ items: result })
    } catch (error) { next(error) }
  })
  router.post('/material-requests/:id/approve', async (request, response, next) => {
    try {
      const result = await mutateStore((store) => {
        if (!requestIds(store).has(request.params.id)) throw Object.assign(new Error('Material solicitado nao encontrado.'), { status: 404 })
        store.materialRequestStatuses ||= []
        if (!store.materialRequestStatuses.some((item) => item.id === request.params.id)) store.materialRequestStatuses.push({ id: request.params.id, status: 'purchase-requested', approvedAt: new Date().toISOString(), approvedBy: request.adminId })
        return store.materialRequestStatuses
      })
      response.json({ items: result })
    } catch (error) { next(error) }
  })
  return router
}
