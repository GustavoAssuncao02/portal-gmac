import { productionStages, stageLabel, stageGroupLabel } from './serviceStages.js'
import { activeSessions } from './operationSessions.js'

// Planning of the machines and labor services. The factory runs 24 hours a day in Bahia time (UTC-3, no daylight
// saving); a block is one stage of one OS on one machine or service, from a start (on the 15-minute grid) for some minutes.
// These rules are shared by the server and the screen, so both read the plan the same way.
export const DAY_MS = 86400000
export const SLOT_MS = 15 * 60000
export const dayStart = (date) => Date.parse(`${date}T00:00:00-03:00`)
export const localDay = (ms) => new Date(Number(ms) - 3 * 3600000).toISOString().slice(0, 10)
export const addDays = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
export const clockTime = (ms) => new Date(Number(ms) - 3 * 3600000).toISOString().slice(11, 16)
export const blockStart = (block) => Date.parse(block.start)
export const blockEnd = (block) => blockStart(block) + Number(block.minutes) * 60000
export const resourceKey = (type, id) => `${type}:${id}`
const sameName = (left, right) => String(left).localeCompare(String(right), 'pt-BR', { sensitivity: 'base' }) === 0

// The stages of an OS in the order of the offer: the code, the name the production shows, the key of the stage in the
// production (pieces done there), the planned time for the whole OS and the machine or service planned for it.
export function orderStages(order) {
  const codes = order?.resources?.stages ?? order?.proposal?.stages ?? []
  return codes.map((code) => {
    const name = productionStages.some(([key]) => key === code) ? stageLabel(code) : code
    const stage = order.operation?.stages?.find((item) => item.name === name)
    return { code, name, key: stage?.key ?? null, done: Number(order.operation?.stageCounts?.[stage?.key] || 0), plannedMinutes: Number(order.resources?.stageTimes?.[code]) || 0, resource: order.resources?.stageResources?.[code] || null, group: stageGroupLabel(code) }
  })
}

// Planned, running (someone works on the stage inside the block), done (the stage or the OS is finished) or late
// (the block started and nobody works on it, or it ended and the stage goes on). `delayMinutes` counts from the start
// when nothing began and from the end when the work runs over.
export function blockState(block, order, now) {
  const start = blockStart(block), end = blockEnd(block)
  const stage = orderStages(order).find((item) => item.code === block.stageCode)
  const quantity = Number(order?.quantity) || 0
  const done = order?.operation?.status === 'completed' || Boolean(stage && quantity && stage.done >= quantity)
  const running = Boolean(stage?.key) && activeSessions(order?.operation).some((session) => session.stageKey === stage.key)
  const status = done ? 'done' : now < start ? 'planned' : running ? (now > end ? 'late' : 'running') : 'late'
  return { status, running, progress: quantity ? Math.min(100, Math.round(100 * (stage?.done || 0) / quantity)) : 0, delayMinutes: status === 'late' ? Math.floor((now - (running ? end : start)) / 60000) : 0, stageName: stage?.name || block.stageCode }
}

// What is left to plan, stage by stage: the planned time of the stage for the pieces still to make, minus the blocks
// that have not ended (whole: what was already made shows in the pieces). Emergencies first, then the nearest deadline;
// the stages of an OS keep their order.
export function planningBacklog(orders, blocks, now) {
  const rows = []
  for (const order of orders) {
    // A new OS has no production record until someone works on it: it is waiting, and fully to plan.
    if (order.operation?.status === 'completed') continue
    const quantity = Number(order.quantity) || 0
    for (const stage of orderStages(order)) {
      if (quantity && stage.done >= quantity) continue
      const remaining = stage.plannedMinutes ? Math.ceil(stage.plannedMinutes * (quantity ? (quantity - stage.done) / quantity : 1)) : null
      const scheduled = blocks.filter((block) => block.orderCode === order.code && block.stageCode === stage.code && blockEnd(block) > now).reduce((sum, block) => sum + Number(block.minutes), 0)
      const toPlan = remaining == null ? null : Math.max(0, Math.round(remaining - scheduled))
      if (toPlan === 0) continue
      rows.push({ orderCode: order.code, service: order.service, company: order.company, deadline: order.deadline, urgency: order.resources?.urgency === 'emergency' ? 'emergency' : 'normal', stageCode: stage.code, stageName: stage.name, group: stage.group, suggested: stage.resource, plannedMinutes: stage.plannedMinutes, remainingMinutes: remaining, scheduledMinutes: Math.round(scheduled), toPlanMinutes: toPlan, done: stage.done, quantity })
    }
  }
  const rank = (row) => row.urgency === 'emergency' ? 0 : 1
  return rows.sort((left, right) => rank(left) - rank(right) || String(left.deadline || '9999').localeCompare(String(right.deadline || '9999')) || left.orderCode.localeCompare(right.orderCode))
}

// The plan at one moment, resource by resource: busy (a block covers it), idle (with the free interval around it) or
// unavailable (maintenance). Up to now it also tells what really happened (who worked there at that moment).
export function planningSnapshot(resources, blocks, actual, at, now) {
  return resources.map((resource) => {
    const own = blocks.filter((block) => block.resourceType === resource.type && String(block.resourceId) === String(resource.id)).sort((left, right) => blockStart(left) - blockStart(right))
    const block = own.find((item) => blockStart(item) <= at && at < blockEnd(item)) || null
    const previous = own.filter((item) => blockEnd(item) <= at).at(-1), next = own.find((item) => blockStart(item) > at)
    const real = at <= now ? actual.filter((item) => item.resourceType === resource.type && String(item.resourceId) === String(resource.id) && item.start <= at && at < item.end) : []
    return { resource, state: resource.maintenance ? 'unavailable' : block ? 'busy' : 'idle', block, freeFrom: block ? null : previous ? blockEnd(previous) : null, freeUntil: block ? null : next ? blockStart(next) : null, real }
  })
}

// The queue an operator sees on the tablet: blocks of the machines and services of their sectors that are not done,
// in the order of the plan (late ones included, up to a day back).
export function operatorQueue(blocks, resources, sectorNames, now, limit = 6) {
  const mine = new Set(resources.filter((resource) => (resource.sectors || []).some((sector) => sectorNames.some((name) => sameName(name, sector)))).map((resource) => resourceKey(resource.type, resource.id)))
  return blocks.filter((block) => mine.has(resourceKey(block.resourceType, block.resourceId)) && block.status !== 'done' && blockEnd(block) > now - DAY_MS && (blockEnd(block) > now || block.status === 'late'))
    .sort((left, right) => blockStart(left) - blockStart(right)).slice(0, limit)
    .map((block) => ({ ...block, now: blockStart(block) <= now && now < blockEnd(block) }))
}
