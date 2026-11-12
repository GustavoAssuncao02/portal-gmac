import { deliveryTimestamp } from './serviceDeadline.js'

const timestamp = (value) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0

// Nearest delivery first: the agreed delivery date of the proposal, else the requested one; an OS without a date goes last.
const deliveryDue = (order) => [order.deliveryDeadline, order.deadline].map(deliveryTimestamp).find(Number.isFinite) ?? Infinity
export const byDeliveryDeadline = (rows) => [...rows].sort((left, right) => (deliveryDue(left) - deliveryDue(right)) || left.code.localeCompare(right.code))

export function servicePanelOrders(orders, completed = false) {
  const selected = orders.filter((order) => {
    const archived = order.operation?.status === 'completed' && Boolean(order.operation.completionAcknowledgedAt)
    return completed ? archived : !archived
  })
  if (!completed) return selected
  const completedTime = (order) => timestamp(order.operation.completedAt) || timestamp(order.operation.completionAcknowledgedAt) || timestamp(order.createdAt)
  return selected.sort((left, right) => completedTime(right) - completedTime(left) || String(right.code).localeCompare(String(left.code), 'pt-BR', { numeric: true }))
}
