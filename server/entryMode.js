import { wholeUnit } from './materialUnits.js'

// How the materials and the times of an offer or OS are typed. "piece": for one piece, and the system multiplies by the
// quantity of the order. "total": for the whole order (everything launched before this choice existed).
// The totals stay in the same fields as always (material.quantity, stageTimes, labor hours), so stock, material requests,
// proposal, planning, tablet and reports read them as before; what was typed per piece is kept next to them.
export const entryModes = [
  ['piece', 'Por peça', 'Informe o material e o tempo de uma peça; o sistema multiplica pela quantidade.'],
  ['total', 'Total do pedido', 'Informe o material e o tempo do pedido inteiro.'],
]
export const validEntryMode = (value) => entryModes.some(([key]) => key === value)

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits
const pieceCount = (pieces) => Math.max(1, Number(pieces) || 1)

// A saved choice wins. Without one, what already has something launched is "total" and an empty one starts "piece".
export function currentEntryMode(resources) {
  if (validEntryMode(resources?.entryMode)) return resources.entryMode
  const launched = resources?.materials?.length || resources?.laborEntries?.length || Object.keys(resources?.stageTimes || {}).length
  return launched ? 'total' : 'piece'
}

// Units are whole: a fraction per piece (a bar that makes 4 pieces) is rounded up in the total.
export function materialTotal(perPiece, pieces, unit) {
  const total = round(Number(perPiece) * pieceCount(pieces), 3)
  return wholeUnit(unit) ? Math.ceil(total) : total
}
export const stageTotal = (perPiece, pieces) => Math.max(1, Math.round(Number(perPiece) * pieceCount(pieces)))

// Brings the totals in line with what was typed per piece. A material without a value per piece (added later by a material
// request, for example) stays as it is. In "total" the per-piece values are dropped.
export function withEntryMode(resources = {}, pieces) {
  const { stageTimesPerPiece, ...rest } = resources
  if (resources.entryMode !== 'piece') {
    return { ...rest, ...(resources.materials ? { materials: resources.materials.map(({ quantityPerPiece, ...material }) => material) } : {}) }
  }
  const stageTimes = Object.fromEntries(Object.entries(stageTimesPerPiece || {}).filter(([, minutes]) => Number(minutes) > 0).map(([code, minutes]) => [code, stageTotal(minutes, pieces)]))
  return {
    ...rest,
    stageTimesPerPiece: stageTimesPerPiece || {},
    stageTimes,
    ...(resources.materials ? { materials: resources.materials.map((material) => Number(material.quantityPerPiece) > 0 ? { ...material, quantity: materialTotal(material.quantityPerPiece, pieces, material.unit) } : material) } : {}),
    ...(resources.laborEntries ? { laborEntries: resources.laborEntries.map((entry) => entry.stageCode && stageTimes[entry.stageCode] ? { ...entry, hours: stageTimes[entry.stageCode] / 60 } : entry) } : {}),
  }
}

// Changing the choice keeps the totals: 10 kg in 10 pieces becomes 1 kg per piece, without multiplying again.
export function switchEntryMode(resources = {}, mode, pieces) {
  if (mode !== 'piece') return withEntryMode({ ...resources, entryMode: 'total' }, pieces)
  const count = pieceCount(pieces)
  const stageTimesPerPiece = Object.fromEntries(Object.entries(resources.stageTimes || {}).filter(([, minutes]) => Number(minutes) > 0).map(([code, minutes]) => [code, round(Number(minutes) / count, 2)]))
  return withEntryMode({
    ...resources,
    entryMode: 'piece',
    stageTimesPerPiece,
    materials: (resources.materials || []).map((material) => ({ ...material, quantityPerPiece: round(Number(material.quantity) / count, 4) })),
  }, count)
}

// What a new quantity of pieces changes in an OS launched per piece, to tell before saving. `consumed`: already taken from
// the stock for the OS; what was already requested or taken is not redone.
export function quantityChanges(previous = {}, next = {}) {
  const materials = (next.materials || []).flatMap((material) => {
    const before = (previous.materials || []).find((item) => item.id === material.id)
    if (!before || Number(before.quantity) === Number(material.quantity)) return []
    return [{ id: material.id, name: material.name, unit: material.unit, before: Number(before.quantity), after: Number(material.quantity), consumed: Number(before.inventoryConsumedQuantity) || 0 }]
  })
  const stages = Object.entries(next.stageTimes || {}).flatMap(([code, after]) => {
    const before = Number(previous.stageTimes?.[code])
    return before && before !== Number(after) ? [{ code, before, after: Number(after) }] : []
  })
  return { materials, stages }
}

export const minutesLabel = (minutes) => {
  const value = Math.round(Number(minutes) || 0), hours = Math.floor(value / 60), rest = value % 60
  return hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${rest} min`
}
