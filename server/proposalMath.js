// Totals of the proposal documents, shared by the server (PDF) and the form in the browser.
export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100
const sum = (values) => round2(values.reduce((total, value) => total + value, 0))

export const situationLabels = { normal: 'Normal', night: 'Noturna', holiday: 'Feriado' }
export const situationNames = { normal: 'Normal', night: 'Noturna semanal e sábados', holiday: 'Domingos e feriados' }

// The "Variante" column: the rate of the situation chosen for the line.
export const rateFor = (row) => Number(row[row.situation] ?? row.normal) || 0

export function tableTotals(document) {
  const labor = (document.labor || []).map((row) => round2((Number(row.quantity) || 0) * rateFor(row)))
  const materials = (document.materials || []).map((row) => round2((Number(row.quantity) || 0) * (Number(row.price) || 0)))
  const place = document.freight?.places?.find((item) => item.name === document.freight.place)
  const freight = document.freight?.charge && place ? round2(place.value) : 0
  const laborTotal = sum(labor), materialsTotal = sum(materials)
  return { labor, materials, laborTotal, materialsTotal, freight, total: round2(laborTotal + materialsTotal + freight) }
}

export const itemTotal = (item) => round2((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))
export const letterTotal = (document) => sum((document.items || []).map(itemTotal))

// Costs and hours of an offer, from its planned materials and labor. Machine hours and labor (hora homem) hours are
// kept apart; the total is their sum.
export function proposalCosts(resources = {}) {
  const materials = sum((resources.materials || []).map((item) => round2((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))))
  const entries = resources.laborEntries || []
  const labor = sum(entries.map((item) => round2((Number(item.hours) || 0) * (Number(item.hourlyRate) || 0))))
  const hoursOf = (list) => sum(list.map((item) => Number(item.hours) || 0))
  const machineHours = hoursOf(entries.filter((item) => item.type === 'machine')), serviceHours = hoursOf(entries.filter((item) => item.type !== 'machine'))
  return { materials, labor, machineHours, serviceHours, totalHours: round2(machineHours + serviceHours) }
}
export const hoursText = (hours) => `${(Number(hours) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${Number(hours) === 1 ? 'hora' : 'horas'}`

// Pricing of a proposal option. The service value is the cost (materials + labor); the OS value is what the customer
// pays: the cost plus the gross profit (margin on the cost), less the discount. The gross profit is what is left.
export function proposalPricing({ materials, labor, margin, discount }) {
  const serviceValue = round2((Number(materials) || 0) + (Number(labor) || 0))
  const osValue = round2(serviceValue * (1 + (Number(margin) || 0) / 100) * (1 - (Number(discount) || 0) / 100))
  return { serviceValue, osValue, profit: round2(osValue - serviceValue) }
}

// Amount charged for a saved proposal. A generated document states the contract total; proposals saved before the OS value
// existed kept the price in the service value, less the discount.
export function osValueOf(proposal) {
  if (!proposal) return 0
  if (Number(proposal.document?.total) > 0) return round2(proposal.document.total)
  if (proposal.osValue != null) return round2(proposal.osValue)
  return round2((Number(proposal.serviceValue) || 0) * (1 - (Number(proposal.discount) || 0) / 100))
}

// Gross profit of the options A, B, C and D. Each one learns separately from the proposals the customer accepted (the
// OS of today on, except the atypical ones), starting from its original value as the first record. The options never
// cross: each stays at least PROPOSAL_MARGIN_GAP points above the previous one, so there are always different proposals.
export const PROPOSAL_OPTIONS = [['A', 15], ['B', 20], ['C', 25], ['D', 30]]
export const PROPOSAL_MARGIN_GAP = 3
const round1 = (value) => Math.round(value * 10) / 10
export const declineReasons = ['Preço', 'Prazo de entrega', 'Escolheu outro fornecedor', 'Outro']
// Price-list models (Nestlé, Etiqueta) take their value from the customer's table, not from the margin of the option:
// they stay out of the average margin, but still count in the acceptance rate.
export const PRICE_LIST_MODELS = ['nestle', 'etiqueta']
const fromPriceList = (proposal) => PRICE_LIST_MODELS.includes(proposal?.document?.model ?? proposal?.layout)
// The acceptance rate of an option: accepted ÷ (accepted + declined). Proposals still waiting for an answer do not count.
export function proposalMargins(orders = [], offers = []) {
  let previous = -Infinity
  return PROPOSAL_OPTIONS.map(([key, initial]) => {
    const tracked = orders.filter((order) => order.pieceTracking && order.proposal?.key === key)
    const accepted = tracked.filter((order) => !order.atypical && !fromPriceList(order.proposal) && Number.isFinite(Number(order.proposal.margin))).map((order) => Number(order.proposal.margin))
    const average = [initial, ...accepted].reduce((total, value) => total + value, 0) / (accepted.length + 1)
    // Only the option that would break the order moves up.
    const margin = round1(Math.max(average, previous + PROPOSAL_MARGIN_GAP))
    previous = margin
    const declined = offers.filter((offer) => offer.status === 'rejected' && offer.proposalDecline?.key === key).length
    const answered = tracked.length + declined
    return { key, margin, average: round1(average), accepted: accepted.length, won: tracked.length, declined, rate: answered ? Math.round(tracked.length / answered * 100) : null }
  })
}
// Allowed range of an option, given its neighbours: the gap to the previous and to the next one.
export function marginLimits(margins, index) {
  return { min: index > 0 ? round1(Number(margins[index - 1]) + PROPOSAL_MARGIN_GAP) : 0, max: index < margins.length - 1 ? round1(Number(margins[index + 1]) - PROPOSAL_MARGIN_GAP) : 1000 }
}
