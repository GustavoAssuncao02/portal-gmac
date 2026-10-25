// Where the service is done: inside the company (interno, the default) or at the customer / a third party (externo).
// The offer chooses it; the OS can switch it later, and each switch is kept so the time spent in each one is known.
export const serviceLocations = [['internal', 'Interno'], ['external', 'Externo']]
export const serviceLocationLabel = (key) => serviceLocations.find(([code]) => code === key)?.[1] || 'Interno'
export const validServiceLocation = (value) => serviceLocations.some(([code]) => code === value)

export function currentServiceLocation(order) {
  return order?.locationChanges?.at(-1)?.to || (order?.resources?.serviceLocation === 'external' ? 'external' : 'internal')
}

// Time in each location from the creation of the OS until its completion (or now). Only meaningful after a switch:
// without one the whole life of the OS is in a single location, so null is returned.
export function serviceLocationTimes(order, now = Date.now()) {
  const changes = order?.locationChanges || []
  if (!changes.length) return null
  const end = order.operation?.status === 'completed' && order.operation.completedAt ? Date.parse(order.operation.completedAt) : now
  const totals = { internal: 0, external: 0 }
  let since = Date.parse(order.createdAt), location = changes[0].from
  for (const change of changes) {
    const at = Math.min(Date.parse(change.at), end)
    totals[location] += Math.max(0, at - since)
    since = at
    location = change.to
  }
  totals[location] += Math.max(0, end - since)
  return totals
}
