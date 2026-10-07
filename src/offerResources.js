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

export function materialsStock(materials, inventory) {
  const groups = new Map()
  const entries = materials.map((material) => {
    const item = findInventoryMaterial(material, inventory)
    const key = item || normalizeSearch(material.name)
    if (!groups.has(key)) groups.set(key, { item, quantity: 0, remaining: Math.max(0, Number(item?.quantity) || 0) })
    const group = groups.get(key)
    group.quantity += Math.max(0, Number(material.quantity) || 0)
    return { material, group }
  })
  return entries.map(({ material, group }) => {
    // Allocate stock within this offer only; no inventory balance is changed.
    const stock = materialStock(material, group.item ? [{ ...group.item, quantity: group.remaining }] : [])
    group.remaining = Math.max(0, Number((group.remaining - Number(material.quantity || 0)).toFixed(3)))
    const total = materialStock({ ...material, quantity: Number(group.quantity.toFixed(3)) }, group.item ? [group.item] : [])
    return { ...material, ...stock, groupStockStatus: total.stockStatus, groupPurchaseQuantity: total.purchaseQuantity }
  })
}

export function materialRequests(offers, orders) {
  const sources = [...offers, ...orders.filter((order) => !offers.some((offer) => offer.id === order.offerId)).map((order) => ({ ...order, id: order.offerId, orderCode: order.code }))]
  return sources.filter((offer) => offer.status !== 'rejected').flatMap((offer) => (offer.resources?.materials || []).flatMap((material) => {
    const receipt = material.requestReceipt || orders.find((order) => order.offerId === offer.id)?.resources?.materials?.find((entry) => entry.id === material.id)?.requestReceipt
    const rejection = material.requestRejection || orders.find((order) => order.offerId === offer.id)?.resources?.materials?.find((entry) => entry.id === material.id)?.requestRejection
    const quantity = material.purchaseQuantity ?? (material.stockStatus === 'available' ? 0 : Math.max(0, Number(material.quantity) - Number(material.stockAvailable || 0)))
    if (!(quantity > 0) && !receipt && !rejection) return []
    return [{ id: `${offer.id}-${material.id}`, offerId: offer.id, offerCode: offer.code, orderCode: offer.orderCode, inventoryId: material.inventoryId, stockStatus: material.stockStatus, name: material.name, detail: material.detail, unitPrice: material.unitPrice, quantity, requiredQuantity: Number(material.quantity), requestedAt: material.requestedAt || offer.requestedAt, receipt, rejection }]
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
