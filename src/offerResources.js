export const normalizeSearch = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR')

export function findInventoryMaterial(material, inventory) {
  return inventory.find((item) => material.inventoryId != null && String(item.id) === String(material.inventoryId))
    || inventory.find((item) => normalizeSearch(item.name) === normalizeSearch(material.name))
}

export function materialStock(material, inventory) {
  const item = findInventoryMaterial(material, inventory)
  const stockAvailable = Math.max(0, Number(item?.quantity) || 0)
  const quantity = Number(material.quantity) || 0
  return {
    inventoryId: item?.id ?? null,
    stockAvailable,
    stockStatus: !item ? 'unknown' : stockAvailable <= 0 ? 'missing' : stockAvailable < quantity ? 'partial' : 'available',
    purchaseQuantity: Math.max(0, Number((quantity - stockAvailable).toFixed(3))),
  }
}

export function materialRequests(offers, orders) {
  const sources = [...offers, ...orders.filter((order) => !offers.some((offer) => offer.id === order.offerId)).map((order) => ({ ...order, id: order.offerId, orderCode: order.code }))]
  return sources.flatMap((offer) => (offer.resources?.materials || []).flatMap((material) => {
    const quantity = material.purchaseQuantity ?? (material.stockStatus === 'available' ? 0 : Math.max(0, Number(material.quantity) - Number(material.stockAvailable || 0)))
    if (!(quantity > 0)) return []
    return [{ id: `${offer.id}-${material.id}`, offerId: offer.id, offerCode: offer.code, orderCode: offer.orderCode, inventoryId: material.inventoryId, stockStatus: material.stockStatus, name: material.name, detail: material.detail, quantity, requiredQuantity: Number(material.quantity), requestedAt: material.requestedAt || offer.requestedAt }]
  }))
}

export function purchaseMaterialRequests(offers, orders, savedRequests = []) {
  const approvedIds = new Set(savedRequests.filter((request) => request.status === 'purchase-requested').map((request) => request.id))
  return materialRequests(offers, orders).filter((request) => {
    const registered = request.inventoryId != null || ['partial', 'missing'].includes(request.stockStatus)
    return registered || approvedIds.has(request.id)
  })
}

export function pendingInventoryRequests(offers, orders, inventory, savedRequests = []) {
  const statuses = new Map(savedRequests.map((request) => [request.id, request.status]))
  return materialRequests(offers, orders)
    .filter((request) => !findInventoryMaterial(request, inventory))
    .map((request) => ({ ...request, quantity: request.requiredQuantity, os: request.orderCode || request.offerCode, status: statuses.get(request.id) || 'pending' }))
}
