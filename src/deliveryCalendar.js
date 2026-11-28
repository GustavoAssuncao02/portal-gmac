import { deliveryTimestamp, serviceDeadline } from './serviceDeadline.js'
import { currentPieceProgress } from './serviceProgress.js'
import { quantityUnitOf, quantityWord } from '../server/quantityUnits.js'
import { localDay } from '../server/planningRules.js'

// Planejamento › Entregas (2026-11-24): every OS still open (production not concluded) on the day it has to be delivered —
// the date agreed in the accepted proposal, else the one the client asked for (the same date and the same state of
// Serviços em andamento and of the Início).
export function openDeliveries(orders, now = Date.now()) {
  return orders.filter((order) => order.operation?.status !== 'completed').map((order) => {
    const deadline = order.proposal?.deadline || order.deadline
    const at = deliveryTimestamp(deadline)
    const quantity = Math.max(0, Math.floor(Number(order.quantity) || 0))
    return {
      code: order.code, service: order.service || '', company: order.company || '',
      kind: (order.resources?.kind || order.proposal?.kind) === 'product' ? 'product' : 'service',
      quantity, unit: quantityUnitOf(order.quantityUnit),
      done: currentPieceProgress(order.operation, quantity).completedPieces,
      day: Number.isFinite(at) ? localDay(at) : null,
      // The moment of the deadline (end of the delivery day): a forecast after it "vai atrasar".
      deliveryAt: Number.isFinite(at) ? at : null,
      due: serviceDeadline({ ...order, deadline }, now),
      status: order.operation?.status || 'waiting',
      urgent: order.resources?.urgency === 'emergency',
    }
  }).sort((left, right) => (left.day || '9999').localeCompare(right.day || '9999') || Number(right.urgent) - Number(left.urgent) || String(left.code).localeCompare(String(right.code), 'pt-BR', { numeric: true }))
}

// How many OS, of which kind, and how much to deliver, by measure (unidades, pares, conjuntos are never added together).
export function deliveryTotals(rows) {
  const amounts = {}
  for (const row of rows) amounts[row.unit] = (amounts[row.unit] || 0) + row.quantity
  return { count: rows.length, services: rows.filter((row) => row.kind === 'service').length, products: rows.filter((row) => row.kind === 'product').length, amounts }
}
// "1.250 unidades · 4 pares" (or "1.250 un · 4 pares" with `short`).
export const amountsText = (amounts, { short = false } = {}) => ['un', 'par', 'cj'].filter((unit) => amounts[unit]).map((unit) => `${amounts[unit].toLocaleString('pt-BR')} ${quantityWord(amounts[unit], unit, { short })}`).join(' · ')
// "3 serviços · 1 produto".
export const kindsText = ({ services, products }) => [[services, 'serviço', 'serviços'], [products, 'produto', 'produtos']].filter(([count]) => count).map(([count, one, many]) => `${count} ${count === 1 ? one : many}`).join(' · ')
// The OS of each day.
export function byDeliveryDay(rows) {
  const days = new Map()
  for (const row of rows) if (row.day) days.set(row.day, [...(days.get(row.day) || []), row])
  return days
}
