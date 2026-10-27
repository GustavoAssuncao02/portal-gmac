import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'
import { missingMaterialRequestCodes, nextMaterialRequestCode } from './materialRequestCodes.js'
import { invalidUnitMessage, materialUnit, validMaterialUnit, validQuantityFor } from './materialUnits.js'

const requestIds = (store) => new Set([
  ...(store.offers || []),
  ...(store.orders || []).map((order) => ({ ...order, id: order.offerId })),
].filter((offer) => offer.status !== 'rejected').flatMap((offer) => (offer.resources?.materials || []).map((material) => `${offer.id}-${material.id}`)).concat((store.manualMaterialRequests || []).map((item) => item.id)))

const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const requestedMaterials = (store, id) => [
  ...(store.offers || []), ...(store.orders || []).map((order) => ({ ...order, id: order.offerId })),
].filter((source) => source.status !== 'rejected').flatMap((source) => (source.resources?.materials || []).filter((material) => `${source.id}-${material.id}` === id)).concat((store.manualMaterialRequests || []).filter((material) => material.id === id))

// Receipt metadata and stock use the same commit, including retries from another browser.
export async function saveRequestedMaterial(id, adminId, save, { commit, rollback, allocate, receiptId, adminName } = {}) {
  if (id == null) {
    try { const result = await save(); await commit?.(); return result }
    catch (error) { await rollback?.(); throw error }
  }
  if (typeof id !== 'string' || !id || id.length > 160) fail(400, 'Pedido de material inválido.')
  if (receiptId != null && (typeof receiptId !== 'string' || !receiptId || receiptId.length > 100)) fail(400, 'Identificação de recebimento inválida.')
  return mutateStore(async (store) => {
    const materials = requestedMaterials(store, id)
    if (!materials.length) fail(404, 'Pedido de material não encontrado.')
    const previous = materials.find((material) => material.requestReceipt)?.requestReceipt
    const repeated = receiptId ? materials.flatMap((material) => material.requestReceipts || (material.requestReceipt ? [material.requestReceipt] : [])).find((receipt) => receipt.id === receiptId) : previous
    if (repeated) return { ...repeated.result, alreadyReceived: true }
    if (materials.some((material) => material.requestRejection)) fail(409, 'Este pedido de material foi recusado.')
    if (!materials.some((material) => Number(material.purchaseQuantity ?? (material.stockStatus === 'available' ? 0 : Number(material.quantity) - Number(material.stockAvailable || 0))) > 0)) fail(409, 'Este material não possui pedido pendente.')
    const order = (store.orders || []).find((item) => (item.resources?.materials || []).some((material) => `${item.offerId}-${material.id}` === id))
    const material = order?.resources.materials.find((item) => `${order.offerId}-${item.id}` === id) || materials[0]
    const remainingQuantity = Math.max(0, Number(material.purchaseQuantity ?? (material.stockStatus === 'available' ? 0 : Number(material.quantity) - Number(material.inventoryConsumedQuantity ?? material.stockAvailable ?? 0))))
    const context = { order, material, remainingQuantity, requestId: id }
    const result = await save(context)
    const allocation = await allocate?.(result, context) || { allocatedQuantity: 0 }
    if (order && !allocate) fail(503, 'A entrada precisa registrar também a saída para a OS.')
    Object.assign(result, allocation)
    const supplied = order ? Number(allocation.allocatedQuantity) : Math.min(Number(result.receivedQuantity), remainingQuantity)
    const pending = Number(Math.max(0, remainingQuantity - supplied).toFixed(3))
    const receipt = { id: receiptId, receivedAt: new Date().toISOString(), receivedBy: adminId, receivedByName: adminName || null, inventoryId: result.materialId ?? result.id, quantity: result.receivedQuantity, allocatedQuantity: Number(allocation.allocatedQuantity), orderCode: order?.code ?? null, result }
    const consumed = Number(material.inventoryConsumedQuantity ?? (Number(material.quantity) - remainingQuantity))
    for (const entry of materials) {
      entry.inventoryId = receipt.inventoryId
      entry.purchaseQuantity = pending
      entry.stockStatus = pending > 0 ? 'partial' : 'available'
      if (order) { entry.inventoryConsumedQuantity = Number((consumed + supplied).toFixed(3)); entry.stockAvailable = entry.inventoryConsumedQuantity }
      else entry.stockAvailable = Number(entry.stockAvailable || 0) + supplied
      entry.requestReceipts = [...(entry.requestReceipts || (entry.requestReceipt ? [entry.requestReceipt] : [])), receipt]
      entry.requestReceipt = receipt
    }
    if (order) {
      for (const entry of order.resources.materials) {
        const group = order.resources.materials.filter((item) => item.inventoryId === entry.inventoryId)
        entry.groupPurchaseQuantity = Number(group.reduce((total, item) => total + Number(item.purchaseQuantity || 0), 0).toFixed(3))
        entry.groupStockStatus = entry.groupPurchaseQuantity > 0 ? 'partial' : 'available'
      }
      for (const entry of materials) { entry.groupPurchaseQuantity = material.groupPurchaseQuantity; entry.groupStockStatus = material.groupStockStatus }
      const summary = order.inventoryConsumption?.materials?.find((entry) => entry.inventoryId === receipt.inventoryId || entry.inventoryId == null && entry.name === material.name)
      if (summary) {
        const group = order.resources.materials.filter((entry) => entry.inventoryId === receipt.inventoryId)
        Object.assign(summary, { inventoryId: receipt.inventoryId, consumedQuantity: Number(group.reduce((total, entry) => total + Number(entry.inventoryConsumedQuantity || 0), 0).toFixed(3)), purchaseQuantity: material.groupPurchaseQuantity, balance: result.balance })
      }
    }
    store.materialRequestStatuses ||= []
    let status = store.materialRequestStatuses.find((item) => item.id === id)
    if (!status) { status = { id }; store.materialRequestStatuses.push(status) }
    Object.assign(status, receipt, { status: pending > 0 ? 'partially-received' : 'received' })
    return result
  }, { commit, rollback })
}

export default function createMaterialRequestsRouter(requireAdmin, pool, accounts) {
  const router = express.Router()
  router.use('/material-requests', requireAdmin)
  router.get('/material-requests', async (_request, response, next) => {
    try {
      let store = await readStore()
      // Requests created before the code column existed receive their codes on the first listing.
      if (missingMaterialRequestCodes(store).length) store = await mutateStore((current) => current)
      response.json({ items: store.materialRequestStatuses || [], manualRequests: store.manualMaterialRequests || [], codes: store.materialRequestCodes || {} })
    } catch (error) { next(error) }
  })
  router.post('/material-requests', async (request, response, next) => {
    const body = request.body || {}, quantity = Number(body.quantity)
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 160 || body.detail != null && (typeof body.detail !== 'string' || body.detail.length > 500) || !Number.isFinite(quantity) || quantity < .001 || quantity > 1000000000) return response.status(400).json({ message: 'Informe o material, a especificação e uma quantidade válida.' })
    if (body.unit != null && !validMaterialUnit(body.unit)) return response.status(400).json({ message: invalidUnitMessage })
    if (body.inventoryId != null && (!Number.isInteger(Number(body.inventoryId)) || Number(body.inventoryId) <= 0)) return response.status(400).json({ message: 'Selecione um material válido do estoque.' })
    try {
      let inventory
      if (body.inventoryId != null && pool) {
        const [[row]] = await pool.execute('SELECT id, name, detail, unit, unit_price AS unitPrice FROM inventory_materials WHERE id = ?', [body.inventoryId])
        if (!row) fail(404, 'Material não encontrado no estoque.')
        inventory = row
      }
      // A material of the stock keeps its unit; a new one uses the unit chosen in the request.
      const unit = materialUnit(inventory ? inventory.unit : body.unit)
      if (!validQuantityFor(quantity, unit)) fail(400, 'Material contado por unidade aceita só quantidades inteiras.')
      const item = await mutateStore((store) => {
        store.manualMaterialRequests ||= []
        const item = { id: `manual-${randomUUID()}`, code: nextMaterialRequestCode(store), manual: true, name: inventory?.name || body.name.trim(), detail: body.detail?.trim() || inventory?.detail || '', inventoryId: inventory?.id ?? (body.inventoryId != null ? Number(body.inventoryId) : null), unit, quantity: Number(quantity.toFixed(3)), purchaseQuantity: Number(quantity.toFixed(3)), unitPrice: Number(inventory?.unitPrice || 0), requestedAt: new Date().toISOString(), requestedBy: request.adminId, requestedByName: request.adminName || null }
        store.manualMaterialRequests.unshift(item)
        return item
      })
      response.status(201).json({ item })
    } catch (error) { next(error) }
  })
  router.get('/material-requests/:id/history', async (request, response, next) => {
    try {
      const store = await readStore(), materials = requestedMaterials(store, request.params.id)
      if (!materials.length) fail(404, 'Pedido de material não encontrado.')
      const material = materials[0]
      const source = (store.offers || []).find((offer) => (offer.resources?.materials || []).some((entry) => `${offer.id}-${entry.id}` === request.params.id)) || (store.orders || []).find((order) => (order.resources?.materials || []).some((entry) => `${order.offerId}-${entry.id}` === request.params.id))
      const admins = accounts ? await accounts.admins() : []
      const name = (id, snapshot) => snapshot || admins.find((admin) => String(admin.id) === String(id))?.name || (id === 'repair' ? 'Correção administrativa' : 'Não identificado (registro antigo)')
      const events = [{ type: 'requested', at: material.requestedAt || source?.requestedAt || source?.createdAt || null, userName: name(material.requestedBy, material.requestedByName), quantity: material.manual ? Number(material.quantity) : Number(material.requestedQuantity) > 0 ? Number(material.requestedQuantity) : null }]
      const receipts = materials.find((entry) => entry.requestReceipts?.length)?.requestReceipts || (materials.find((entry) => entry.requestReceipt)?.requestReceipt ? [materials.find((entry) => entry.requestReceipt).requestReceipt] : [])
      for (const receipt of receipts) events.push({ type: 'received', at: receipt.receivedAt, userName: name(receipt.receivedBy, receipt.receivedByName), quantity: receipt.quantity, allocatedQuantity: receipt.allocatedQuantity, orderCode: receipt.orderCode })
      const rejection = materials.find((entry) => entry.requestRejection)?.requestRejection
      if (rejection) events.push({ type: 'rejected', at: rejection.rejectedAt, userName: name(rejection.rejectedBy, rejection.rejectedByName) })
      response.json({ items: events.sort((a, b) => Date.parse(a.at || '') - Date.parse(b.at || '')) })
    } catch (error) { next(error) }
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
  router.post('/material-requests/:id/reject', async (request, response, next) => {
    try {
      const result = await mutateStore((store) => {
        if (!requestIds(store).has(request.params.id)) throw Object.assign(new Error('Material solicitado nao encontrado.'), { status: 404 })
        const materials = requestedMaterials(store, request.params.id)
        const previous = materials.find((material) => material.requestRejection)?.requestRejection
        if (materials.some((material) => material.requestReceipt)) fail(409, 'O material solicitado já foi adicionado.')
        if (!previous && !materials.some((material) => Number(material.purchaseQuantity ?? (material.stockStatus === 'available' ? 0 : Number(material.quantity) - Number(material.stockAvailable || 0))) > 0)) throw Object.assign(new Error('Este material nao possui pedido pendente.'), { status: 409 })
        const rejection = previous || { rejectedAt: new Date().toISOString(), rejectedBy: request.adminId, rejectedByName: request.adminName || null }
        for (const material of materials) material.requestRejection = rejection
        store.materialRequestStatuses ||= []
        let status = store.materialRequestStatuses.find((item) => item.id === request.params.id)
        if (!status) { status = { id: request.params.id }; store.materialRequestStatuses.push(status) }
        Object.assign(status, rejection, { status: 'rejected' })
        return status
      })
      response.json({ item: result })
    } catch (error) { next(error) }
  })
  router.post('/material-requests/:id/receive-local', async (request, response, next) => {
    if (pool) return response.status(409).json({ message: 'Registre a entrada no estoque compartilhado.' })
    const { materialId, quantity, receiptId } = request.body || {}
    if (!Number.isFinite(Number(materialId)) || Number(materialId) <= 0 || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0) return response.status(400).json({ message: 'Informe o material e a quantidade recebida.' })
    try {
      const item = await saveRequestedMaterial(request.params.id, request.adminId, async () => ({ materialId: Number(materialId), receivedQuantity: Number(quantity) }), { receiptId, adminName: request.adminName, allocate: async (result, { order, remainingQuantity }) => ({ allocatedQuantity: order ? Math.min(result.receivedQuantity, remainingQuantity) : 0, orderCode: order?.code }) })
      response.json({ item })
    } catch (error) { next(error) }
  })
  return router
}
