const timestamp = (value) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0

export function servicePanelOrders(orders, completed = false) {
  const selected = orders.filter((order) => {
    const archived = order.operation?.status === 'completed' && Boolean(order.operation.completionAcknowledgedAt)
    return completed ? archived : !archived
  })
  if (!completed) return selected
  const completedTime = (order) => timestamp(order.operation.completedAt) || timestamp(order.operation.completionAcknowledgedAt) || timestamp(order.createdAt)
  return selected.sort((left, right) => completedTime(right) - completedTime(left) || String(right.code).localeCompare(String(left.code), 'pt-BR', { numeric: true }))
}
