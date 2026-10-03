import { deliveryTimestamp, serviceDeadline } from './serviceDeadline.js'
import { pendingInventoryRequests, purchaseMaterialRequests } from './offerResources.js'

export function adminOverview(orders, offers, inventory, savedRequests = [], now = Date.now()) {
  const openOrders = orders.filter((order) => order.operation?.status !== 'completed').map((order) => {
    const deadline = order.proposal?.deadline || order.deadline
    const timestamp = deliveryTimestamp(deadline)
    return { ...order, deliveryDeadline: deadline, deliveryTimestamp: Number.isFinite(timestamp) ? timestamp : Infinity, due: serviceDeadline({ ...order, deadline }, now) }
  }).sort((left, right) => left.deliveryTimestamp - right.deliveryTimestamp || left.code.localeCompare(right.code))
  const lowStock = inventory.filter((item) => Number(item.quantity) <= Number(item.minimum)).sort((left, right) => {
    const ratio = (item) => Number(item.quantity) / Math.max(1, Number(item.minimum))
    return ratio(left) - ratio(right) || Number(left.quantity) - Number(right.quantity) || left.name.localeCompare(right.name, 'pt-BR')
  })
  return {
    openOrders,
    lowStock,
    running: openOrders.filter((order) => ['running', 'finalizing'].includes(order.operation?.status)).length,
    late: openOrders.filter((order) => order.due.key === 'late').length,
    reviewing: offers.filter((offer) => offer.status === 'review' && !offer.orderCode).length,
    pendingMaterials: pendingInventoryRequests(offers, orders, inventory, savedRequests).filter((request) => request.status === 'pending').length,
    purchaseRequests: purchaseMaterialRequests(offers, orders, savedRequests).length,
    unacknowledged: orders.filter((order) => order.operation?.status === 'completed' && !order.operation.completionAcknowledgedAt).length,
  }
}

export function adminFirstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'Administrador'
}
