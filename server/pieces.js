import { randomUUID } from 'node:crypto'
import { productionStages } from './serviceStages.js'
import { materialUnit } from './materialUnits.js'
import { workIntervals } from './reportData.js'

// A piece is identified only by its name (not by client): case, accents and extra spaces are ignored.
export const pieceKey = (name) => String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim()

const stageCodeOf = (stage) => productionStages.find(([, label]) => label === stage?.name)?.[0] ?? null
const materialKey = (material) => material.inventoryId != null ? `inventory:${material.inventoryId}` : `name:${pieceKey(material.name)}|${pieceKey(material.detail)}`
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits

// Planned time of each stage, in minutes, for the whole OS: { [stage code]: minutes }.
// Machine or labor service planned for each checked stage, chosen from the registrations: { stage: { type, id, name } }.
// The name is kept so the plan still reads well if the registration is renamed or removed later.
export function cleanStageResources(value, stages, { machines = [], laborServices = [] } = {}) {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Máquinas e serviços das etapas inválidos.'), { status: 400 })
  const result = {}
  for (const [code, choice] of Object.entries(value)) {
    if (!choice || !stages.includes(code)) continue
    const catalog = choice.type === 'machine' ? machines : choice.type === 'labor-service' ? laborServices : null
    const found = catalog?.find((item) => String(item.id) === String(choice.id))
    if (!found) throw Object.assign(new Error('Selecione uma máquina ou um serviço cadastrado para a etapa.'), { status: 400 })
    result[code] = { type: choice.type, id: found.id, name: found.name }
  }
  return result
}

export function cleanStageTimes(value, stages) {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Tempos das etapas inválidos.'), { status: 400 })
  const result = {}
  for (const [code, minutes] of Object.entries(value)) {
    if (minutes == null || minutes === '' || !stages.includes(code)) continue
    const number = Number(minutes)
    if (!Number.isInteger(number) || number < 1 || number > 1000000) throw Object.assign(new Error('Informe o tempo de cada etapa em minutos inteiros.'), { status: 400 })
    result[code] = number
  }
  return result
}

export function materialTotals(materials = []) {
  const totals = {}
  for (const material of materials) totals[materialKey(material)] = (totals[materialKey(material)] || 0) + Math.max(0, Number(material.quantity) || 0)
  return totals
}

// Real minutes worked in each stage of an OS, from the time the operators spent on it (people's time is added up).
export function stageMinutes(operation) {
  const result = {}
  for (const stage of operation?.stages || []) {
    const code = stageCodeOf(stage), ms = Number(operation.stageTimeMs?.[stage.key] || 0)
    if (code && ms > 0) result[code] = (result[code] || 0) + ms / 60000
  }
  return result
}

// What enters the average of a piece: the first estimate (set when the piece was first made) and every completed OS.
// Only OS made after this function existed count; an OS marked atypical is left out entirely.
export function pieceSamples(orders, key) {
  const samples = []
  for (const order of orders) {
    if (!order.pieceTracking || order.atypical || pieceKey(order.service) !== key) continue
    const quantity = Number(order.quantity) || 0
    if (!quantity) continue
    if (order.pieceEstimate) samples.push({ code: order.code, estimate: true, quantity: Number(order.pieceEstimate.quantity) || quantity, materials: order.pieceEstimate.materials || {}, stages: order.pieceEstimate.stages || {} })
    if (order.operation?.status === 'completed') samples.push({ code: order.code, estimate: false, quantity, materials: materialTotals(order.resources?.materials), stages: stageMinutes(order.operation) })
  }
  return samples
}

// Average per piece where every piece weighs the same: everything spent ÷ every piece made.
export function pieceAverages(samples) {
  const average = (field) => {
    const sums = {}
    for (const sample of samples) for (const [key, value] of Object.entries(sample[field])) {
      if (!(value > 0)) continue
      sums[key] ||= { value: 0, pieces: 0 }
      sums[key].value += value
      sums[key].pieces += sample.quantity
    }
    return Object.fromEntries(Object.entries(sums).map(([key, sum]) => [key, sum.value / sum.pieces]))
  }
  return { materials: average('materials'), stages: average('stages'), samples: samples.length }
}

const sameKey = (key) => (row) => pieceKey(row.service) === key
const newest = (rows) => [...rows].sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null

// The last time the piece was made: the newest OS, or else the newest offer that already has resources.
export function lastPieceSource(offers, orders, key, excludeOfferId) {
  return newest(orders.filter((row) => sameKey(key)(row) && row.offerId !== excludeOfferId)) || newest(offers.filter((row) => sameKey(key)(row) && row.id !== excludeOfferId && (row.resources?.materials?.length || row.resources?.stages?.length)))
}

// Names already used, for the suggestions while typing; the newest spelling of each piece is shown.
export function pieceCatalog(offers, orders) {
  const pieces = new Map()
  for (const row of [...offers, ...orders]) {
    const key = pieceKey(row.service)
    if (!key) continue
    const current = pieces.get(key) || { key, name: row.service, orders: 0, lastAt: '' }
    if (String(row.createdAt || '') >= current.lastAt) Object.assign(current, { name: row.service, lastAt: String(row.createdAt || '') })
    if (orders.includes(row)) current.orders++
    pieces.set(key, current)
  }
  return [...pieces.values()].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
}

// The machine or labor service of each stage: the one planned the last time or, for a piece made before the plan became
// mandatory, the one the operators used the longest on that stage in the OS of the piece. Only what is still registered
// (`catalog`: { machine: [...], 'labor-service': [...] }), with its current name.
function stagePlans(stages, planned = {}, history, catalog) {
  const registered = (plan) => {
    const item = plan && catalog[plan.type]?.find((entry) => String(entry.id) === String(plan.id))
    return item ? { type: plan.type, id: item.id, name: item.name } : null
  }
  const used = new Map()
  for (const interval of workIntervals(history)) {
    const code = productionStages.find(([, label]) => label === interval.stageName)?.[0]
    const plan = interval.machineId != null ? { type: 'machine', id: interval.machineId } : interval.laborServiceId != null ? { type: 'labor-service', id: interval.laborServiceId } : null
    if (!code || !stages.includes(code) || !registered(plan)) continue
    const key = `${code}|${plan.type}|${plan.id}`
    used.set(key, { code, plan, ms: (used.get(key)?.ms || 0) + interval.end - interval.start })
  }
  const plans = {}
  for (const code of stages) {
    const longest = [...used.values()].filter((row) => row.code === code).sort((left, right) => right.ms - left.ms)[0]
    const plan = registered(planned[code]) || registered(longest?.plan)
    if (plan) plans[code] = plan
  }
  return plans
}

// Resources for a new offer of a piece made before. Choices (which materials, stages and their order, process options,
// labor, the machine or service of each stage) come from the last time; material quantities and stage times come from
// the average per piece × the new quantity. `history`: the OS of the piece with their operation events.
export function pieceSuggestion({ offers, orders, name, quantity, prices = new Map(), excludeOfferId, catalog = {}, history = [] }) {
  const key = pieceKey(name), pieces = Math.max(1, Number(quantity) || 1)
  const source = key && lastPieceSource(offers, orders, key, excludeOfferId)
  if (!source?.resources) return null
  const averages = pieceAverages(pieceSamples(orders, key))
  const sourcePieces = Math.max(1, Number(source.quantity) || 1), resources = source.resources, now = new Date().toISOString()
  const materials = (resources.materials || []).map((material) => {
    const perPiece = averages.materials[materialKey(material)] ?? (Number(material.quantity) || 0) / sourcePieces
    // Units are whole: a scaled quantity of units is rounded up.
    const unit = materialUnit(material.unit), quantity = unit === 'un' ? Math.ceil(round(perPiece * pieces, 3)) : round(perPiece * pieces, 3)
    return { id: randomUUID(), name: material.name, detail: material.detail || '', inventoryId: material.inventoryId ?? null, unit, quantity, unitPrice: prices.get(String(material.inventoryId)) ?? Number(material.unitPrice || 0), icon: material.icon || '▰', requestedAt: now }
  }).filter((material) => material.quantity > 0)
  const stages = [...(resources.stages || [])]
  const stageTimes = {}
  for (const code of stages) {
    const perPiece = averages.stages[code] ?? (Number(resources.stageTimes?.[code]) || 0) / sourcePieces
    if (perPiece > 0) stageTimes[code] = Math.max(1, Math.round(perPiece * pieces))
  }
  const laborEntries = (resources.laborEntries || []).map(({ stockStatus, ...entry }) => ({ ...entry, id: randomUUID() }))
  const stageResources = stagePlans(stages, resources.stageResources, history.filter(sameKey(key)), catalog)
  return {
    key, name: source.service, source: source.code, samples: averages.samples,
    resources: { materials, laborEntries, stages, stageLayout: resources.stageLayout, kind: resources.kind || 'service', manufacturedFrom: resources.manufacturedFrom ?? null, tempering: resources.tempering ?? null, paintColor: resources.paintColor || '', serviceDescription: resources.serviceDescription || '', strictProcess: resources.strictProcess !== false, stageTimes, stageResources },
  }
}

// Captured when the OS is generated: the first OS of a piece also brings the estimate into the average.
export function pieceTracking(store, order) {
  const key = pieceKey(order.service)
  const first = !store.orders.some((row) => row !== order && row.pieceTracking && !row.atypical && pieceKey(row.service) === key)
  const minutes = order.resources?.stageTimes || {}
  return { pieceTracking: true, ...(first ? { pieceEstimate: { quantity: Number(order.quantity) || 1, materials: materialTotals(order.resources?.materials), stages: { ...minutes } } } : {}) }
}

// How long the piece took to be ready, from the OS (acceptance) to its completion, in days. Same rules as the other
// averages: every completed OS of today on counts the same and the atypical ones are left out.
export function pieceLeadTime(orders, name, excludeOfferId) {
  const key = pieceKey(name)
  const done = orders.filter((order) => order.pieceTracking && !order.atypical && order.offerId !== excludeOfferId && pieceKey(order.service) === key && order.operation?.status === 'completed')
    .map((order) => ({ code: order.code, completedAt: order.operation.completedAt, days: (Date.parse(order.operation.completedAt) - Date.parse(order.createdAt)) / 86400000 }))
    .filter((row) => Number.isFinite(row.days) && row.days >= 0)
    .sort((left, right) => String(right.completedAt).localeCompare(String(left.completedAt)))
  if (!done.length) return null
  return { count: done.length, averageDays: done.reduce((total, row) => total + row.days, 0) / done.length, lastDays: done[0].days, lastCode: done[0].code }
}
