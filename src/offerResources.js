import { materialRequestSources } from '../server/materialRequestSources.js'
import { materialUnit } from '../server/materialUnits.js'
export { normalizeSearch, findInventoryMaterial, materialStock, materialsStock } from '../server/materialStock.js'
import { normalizeSearch, findInventoryMaterial } from '../server/materialStock.js'

export function materialRequests(offers, orders) {
  return materialRequestSources(offers, orders).flatMap((offer) => (offer.resources?.materials || []).flatMap((material) => {
    const receipt = material.requestReceipt || orders.find((order) => order.offerId === offer.id)?.resources?.materials?.find((entry) => entry.id === material.id)?.requestReceipt
    const rejection = material.requestRejection || orders.find((order) => order.offerId === offer.id)?.resources?.materials?.find((entry) => entry.id === material.id)?.requestRejection
    const quantity = material.purchaseQuantity ?? (material.stockStatus === 'available' ? 0 : Math.max(0, Number(material.quantity) - Number(material.stockAvailable || 0)))
    if (!(quantity > 0) && !receipt && !rejection) return []
    return [{ id: `${offer.id}-${material.id}`, offerId: offer.id, offerCode: offer.code, orderCode: offer.orderCode, inventoryId: material.inventoryId, stockStatus: material.stockStatus, name: material.name, detail: material.detail, unit: materialUnit(material.unit), unitPrice: material.unitPrice, quantity, requiredQuantity: Number(material.quantity), requestedAt: material.requestedAt || offer.requestedAt, receipt, rejection }]
  }))
}

export function purchaseMaterialRequests(offers, orders) {
  return materialRequests(offers, orders)
}

export function pendingInventoryRequests(offers, orders, inventory, savedRequests = []) {
  const statuses = new Map(savedRequests.map((request) => [request.id, request.status]))
  return materialRequests(offers, orders)
    .filter((request) => !findInventoryMaterial(request, inventory))
    .map((request) => ({ ...request, quantity: request.requiredQuantity, os: request.orderCode || request.offerCode, status: statuses.get(request.id) || 'pending' }))
}
