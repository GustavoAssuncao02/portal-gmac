import { randomUUID } from 'node:crypto'

export function addNotification(store, notice) {
  store.operationalNotifications ||= []
  if (notice.id && store.operationalNotifications.some((item) => item.id === notice.id)) return
  store.operationalNotifications.push({ id: randomUUID(), at: new Date().toISOString(), ...notice })
}

function requests(store) {
  const offers = store.offers || [], orders = store.orders || []
  const sources = [...offers, ...orders.filter((order) => !offers.some((offer) => offer.id === order.offerId)).map((order) => ({ ...order, id: order.offerId, orderCode: order.code }))]
  return sources.filter((offer) => offer.status !== 'rejected').flatMap((offer) => (offer.resources?.materials || []).flatMap((material) => {
    const quantity = Number(material.purchaseQuantity ?? (material.stockStatus === 'available' ? 0 : Number(material.quantity) - Number(material.stockAvailable || 0)))
    return quantity > 0 && !material.requestRejection ? [{ id: `${offer.id}-${material.id}`, materialName: material.name, quantity, detail: material.detail, offerId: offer.id, offerCode: offer.code, orderCode: offer.orderCode }] : []
  })).concat((store.manualMaterialRequests || []).filter((material) => material.purchaseQuantity > 0 && !material.requestRejection).map((material) => ({ id: material.id, materialName: material.name, quantity: material.purchaseQuantity, detail: material.detail, manualRequestCode: material.code })))
}

export function workflowSnapshot(store) {
  return { requests: new Set(requests(store).map((item) => item.id)), orders: new Set((store.orders || []).map((order) => order.code)), completions: new Set((store.orders || []).flatMap((order) => (order.operationEvents || []).filter((event) => event.type === 'completed').map((event) => event.id))), consumptions: new Set((store.orders || []).filter((order) => order.inventoryConsumption).map((order) => `${order.code}:${order.inventoryConsumption.processedAt}`)) }
}

export function completedServiceNotice(order, event) {
  return { id: `service-completed:${event.id}`, type: 'service-completed', at: event.at, orderCode: order.code, title: 'Serviço concluído', description: `${order.code} · ${order.service}`, employeeName: event.employeeName || null }
}

export function inventorySignal(store, row, previousLow) {
  store.notificationInventory ||= {}
  const low = Number(row.quantity) <= Number(row.minimum)
  const previous = store.notificationInventory[String(row.id)]
  if (low && (previous ? !previous.low : previousLow === false || store.notificationInventoryInitialized)) addNotification(store, { type: 'low-stock', materialId: row.id, title: 'Estoque baixo', description: row.name, quantity: Number(row.quantity), minimum: Number(row.minimum) })
  store.notificationInventory[String(row.id)] = { low, quantity: Number(row.quantity), minimum: Number(row.minimum), name: row.name }
}

export function recordWorkflowNotifications(before, store) {
  for (const request of requests(store)) if (!before.requests.has(request.id)) addNotification(store, { ...request, id: randomUUID(), requestId: request.id, type: 'material-request', title: 'Novo pedido de material', description: `${request.materialName} · ${request.quantity.toLocaleString('pt-BR')} kg` })
  for (const order of store.orders || []) {
    if (!before.orders.has(order.code)) addNotification(store, { id: `service-added:${order.code}`, type: 'service-added', at: order.createdAt || new Date().toISOString(), orderCode: order.code, title: 'Novo serviço em andamento', description: `${order.code} · ${order.service}` })
    for (const event of order.operationEvents || []) if (event.type === 'completed' && !before.completions.has(event.id)) addNotification(store, completedServiceNotice(order, event))
    if (order.inventoryConsumption && !before.consumptions.has(`${order.code}:${order.inventoryConsumption.processedAt}`)) {
      for (const row of order.inventoryConsumption.materials || []) if (row.inventoryId != null && row.minimum != null) inventorySignal(store, { id: row.inventoryId, name: row.name, quantity: row.balance, minimum: row.minimum }, Number(row.stockAvailable) <= Number(row.minimum))
    }
  }
}
