import { productionStages, stageCodeOf, stageLabel, stageGroupLabel } from './serviceStages.js'
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
    const stage = order.operation?.stages?.find((item) => item.name === name || stageCodeOf(item) === code)
    return { code, name, key: stage?.key ?? null, done: Number(order.operation?.stageCounts?.[stage?.key] || 0), plannedMinutes: Number(order.resources?.stageTimes?.[code]) || 0, resource: order.resources?.stageResources?.[code] || null, group: stageGroupLabel(code) }
  })
}

// When a stage was finished: the registration that took its pieces to the total of the OS or, without one (counts
// changed by hand), the completion of the OS. Null when neither is known.
function stageDoneAt(order, stage, quantity) {
  const times = (order?.operationEvents || []).filter((event) => event.type === 'stage_progress' && stage?.key && event.stageKey === stage.key && quantity && Number(event.stageTotal) >= quantity).map((event) => Date.parse(event.at)).filter(Number.isFinite)
  const time = times.length ? Math.min(...times) : Date.parse(order?.operation?.completedAt)
  return Number.isFinite(time) ? time : null
}

// Planned, running (someone works on the stage inside the block), done (the stage or the OS is finished) or late
// (the block started and nobody works on it, or it ended and the stage goes on). `delayMinutes` counts from the start
// when nothing began and from the end when the work runs over; `earlyMinutes` is how long before the planned end a
// done stage was finished.
export function blockState(block, order, now) {
  const start = blockStart(block), end = blockEnd(block)
  const stage = orderStages(order).find((item) => item.code === block.stageCode)
  const quantity = Number(order?.quantity) || 0
  const done = order?.operation?.status === 'completed' || Boolean(stage && quantity && stage.done >= quantity)
  const running = Boolean(stage?.key) && activeSessions(order?.operation).some((session) => session.stageKey === stage.key)
  const status = done ? 'done' : now < start ? 'planned' : running ? (now > end ? 'late' : 'running') : 'late'
  const doneAt = done ? stageDoneAt(order, stage, quantity) : null
  return { status, running, progress: quantity ? Math.min(100, Math.round(100 * (stage?.done || 0) / quantity)) : 0, delayMinutes: status === 'late' ? Math.floor((now - (running ? end : start)) / 60000) : 0,
    doneAt: doneAt == null ? null : new Date(doneAt).toISOString(), earlyMinutes: doneAt != null && doneAt < end ? Math.floor((end - doneAt) / 60000) : 0, stageName: stage?.name || block.stageCode,
    // Late for more than 7 days after its end, with nobody on it: it no longer holds the machine ("precisa replanejar").
    stale: status === 'late' && !running && now - end > STALE_MS }
}

// A late block (not done) holds its machine for up to 7 days after its planned end; an older one, nobody working on it,
// no longer does and its stage needs a new plan (2026-11-28).
export const STALE_MS = 7 * DAY_MS
// What is left of a late block: its minutes less the share of the pieces already registered in the stage (at least 15).
const lateRest = (block, state) => Math.max(SLOT_MS, Math.round(Number(block.minutes) * 60000 * (1 - (Number(state.progress) || 0) / 100)))

// The time a block really holds its machine (2026-11-28), `state` being blockState (the blocks of /planning carry it):
// a planned or running block, its own interval; a done one, until the stage was finished (an early finish frees the
// rest); a late one, from its start until now plus what is left of it; a stale one, nothing. Null when it holds nothing.
export function blockOccupancy(block, state, now) {
  const start = blockStart(block), end = blockEnd(block)
  if (state.status === 'done') {
    const doneAt = Date.parse(state.doneAt)
    const until = Math.min(end, Number.isFinite(doneAt) ? doneAt : now)
    return until > start ? { start, end: until } : null
  }
  if (state.status !== 'late') return { start, end }
  return state.stale ? null : { start, end: Math.max(end, now + lateRest(block, state)) }
}

// When the work of a block should happen from now on: a late one runs from now for what is left of it.
function workInterval(block, state, now) {
  if (state.status === 'done' || state.stale) return null
  return state.status === 'late' ? { start: now, end: now + lateRest(block, state) } : { start: blockStart(block), end: blockEnd(block) }
}

// The planned time of a stage for the pieces still to make (null without a planned time).
const stageRemaining = (stage, quantity) => stage.plannedMinutes ? Math.ceil(stage.plannedMinutes * (quantity ? (quantity - stage.done) / quantity : 1)) : null
// The blocks of a stage and how much of its time they hold: the blocks that have not ended, whole, and the late ones
// for what is left of them. A stale block holds nothing and asks for a new plan.
function stagePlan(order, stage, blocks, now) {
  const own = blocks.filter((block) => block.stageCode === stage.code).map((block) => ({ block, state: blockState(block, order, now) }))
  const scheduled = own.reduce((sum, { block, state }) => sum + (blockEnd(block) > now ? Number(block.minutes) : state.status === 'late' && !state.stale ? lateRest(block, state) / 60000 : 0), 0)
  return { own, scheduled, replan: own.some(({ state }) => state.stale) }
}

// What is left to plan, stage by stage: the planned time of the stage for the pieces still to make, minus the blocks
// that hold it (stagePlan: a late block still counts for what is left of it, up to 7 days). Emergencies first, then the
// nearest deadline; the stages of an OS keep their order. `replan`: a block of the stage is stale.
export function planningBacklog(orders, blocks, now) {
  const rows = []
  for (const order of orders) {
    // A new OS has no production record until someone works on it: it is waiting, and fully to plan.
    if (order.operation?.status === 'completed') continue
    const quantity = Number(order.quantity) || 0
    const mine = blocks.filter((block) => block.orderCode === order.code)
    for (const [index, stage] of orderStages(order).entries()) {
      if (quantity && stage.done >= quantity) continue
      const remaining = stageRemaining(stage, quantity)
      const { scheduled, replan } = stagePlan(order, stage, mine, now)
      const toPlan = remaining == null ? null : Math.max(0, Math.round(remaining - scheduled))
      if (toPlan === 0) continue
      rows.push({ orderCode: order.code, service: order.service, company: order.company, deadline: order.deadline, urgency: order.resources?.urgency === 'emergency' ? 'emergency' : 'normal', position: index + 1, stageCode: stage.code, stageName: stage.name, group: stage.group, suggested: stage.resource, plannedMinutes: stage.plannedMinutes, remainingMinutes: remaining, scheduledMinutes: Math.round(scheduled), toPlanMinutes: toPlan, done: stage.done, quantity, replan })
    }
  }
  const rank = (row) => row.urgency === 'emergency' ? 0 : 1
  return rows.sort((left, right) => rank(left) - rank(right) || String(left.deadline || '9999').localeCompare(String(right.deadline || '9999')) || left.orderCode.localeCompare(right.orderCode))
}

// When an OS should be ready if everything goes as planned (Planejamento > Entregas, 2026-11-28). Only when every stage
// is done or planned (its time covered by blocks; a stage without a planned time, by any block). The stages go in the
// order of the OS and one starts no earlier than the previous ends, so a late stage pushes the ones after it, while the
// blocks of the plan stay where they are. `end` is null while the plan is incomplete or when every stage is done.
export function orderForecast(order, blocks, now) {
  const quantity = Number(order.quantity) || 0
  const stages = orderStages(order), mine = blocks.filter((block) => block.orderCode === order.code)
  let planned = 0, done = 0, replan = false, cursor = null
  for (const stage of stages) {
    if (quantity && stage.done >= quantity) { planned += 1; done += 1; continue }
    const { own, scheduled, replan: stale } = stagePlan(order, stage, mine, now)
    replan ||= stale
    const work = own.map(({ block, state }) => workInterval(block, state, now)).filter(Boolean)
    const remaining = stageRemaining(stage, quantity)
    if (!work.length || (remaining != null && Math.round(remaining - scheduled) > 0)) continue
    planned += 1
    const first = Math.min(...work.map((item) => item.start)), last = Math.max(...work.map((item) => item.end))
    cursor = Math.max(cursor ?? last, last + Math.max(0, (cursor ?? first) - first))
  }
  const complete = stages.length > 0 && planned === stages.length
  return { planned, total: stages.length, replan, finished: stages.length > 0 && done === stages.length, end: complete && cursor != null ? new Date(cursor).toISOString() : null }
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
