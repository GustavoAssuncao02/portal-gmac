import { deliveryTimestamp, serviceDeadline } from './serviceDeadline.js'
import { purchaseMaterialRequests } from './offerResources.js'
import { DAY, filterPayables, todayBahia } from '../server/payableRules.js'

export function payableOverview(rows, now = Date.now()) {
  const today = todayBahia(new Date(now))
  const shiftDay = (days) => new Date(Date.parse(`${today}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10)
  return [
    { key: 'open', label: 'Total em aberto', filters: {} },
    { key: 'overdue', label: 'Contas vencidas', filters: { status: 'overdue' } },
    { key: 'today', label: 'Vencem hoje', filters: { status: 'pending', start: today, end: today } },
    { key: 'upcoming', label: 'Próximos 7 dias', filters: { status: 'pending', start: shiftDay(1), end: shiftDay(7) } },
  ].map((item) => {
    const selected = filterPayables(rows, item.filters, today)
    return { ...item, count: selected.length, valueCents: selected.reduce((sum, row) => sum + row.valueCents, 0) }
  })
}

export function adminOverview(orders, offers, inventory, now = Date.now()) {
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
    purchaseRequests: purchaseMaterialRequests(offers, orders).filter((request) => request.quantity > 0 && !request.rejection).length,
    unacknowledged: orders.filter((order) => order.operation?.status === 'completed' && !order.operation.completionAcknowledgedAt).length,
  }
}

export function adminFirstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'Administrador'
}
