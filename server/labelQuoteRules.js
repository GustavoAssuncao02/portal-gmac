import { hoursText, proposalCosts, proposalPricing } from './proposalMath.js'

// Etiqueta (2026-11-14): an offer with a label number is a measured service. Its OS opens with only the estimate of
// material and hours, without a proposal; at the end the quote ("orçamento da etiqueta") is generated from the hours really
// worked and the material really used, sent to the client, and only then the OS is concluded. Offers that already had a
// proposal when this came (or that got one) keep the normal flow. Shared by the server and the browser.
export const labelQuoteOffer = (offer) => Boolean(String(offer?.labelNumber ?? '').trim()) && !offer?.proposal && !offer?.orderCode
export const labelQuotePending = (item) => Boolean(item?.labelQuote?.pending)
export const labelQuotePendingText = 'Orçamento pendente'
export const labelQuoteRequired = 'Gere o orçamento da etiqueta antes de concluir a OS.'

// The OS of an etiqueta carries this proposal until the quote exists: the estimated cost (materials and labor of the
// offer) and the times, with nothing charged yet (the receivable waits for the quote, see labelQuoteRequired).
export function labelPlaceholderProposal(item) {
  const resources = item.resources || {}
  const costs = proposalCosts(resources)
  const { serviceValue } = proposalPricing({ ...costs, margin: 0, discount: 0 })
  return {
    key: 'A', title: 'Etiqueta', deadline: item.deadline, serviceValue, osValue: 0, discount: 0, margin: 0, profit: 0,
    machine: hoursText(costs.machineHours), serviceTime: hoursText(costs.serviceHours), totalTime: hoursText(costs.totalHours), materials: costs.materials, labor: costs.labor,
    stages: resources.stages || [], kind: resources.kind ?? 'service', strictProcess: resources.strictProcess !== false, labelQuotePending: true,
  }
}

// What the OS was opened with: the quantity of each material and the planned minutes of each stage, to compare with the
// real use when the quote is made.
export function labelEstimate(resources = {}) {
  return {
    materials: Object.fromEntries((resources.materials || []).map((material) => [material.id, Number(material.quantity) || 0])),
    stages: Object.fromEntries(Object.entries(resources.stageTimes || {}).map(([code, minutes]) => [code, Number(minutes) || 0])),
  }
}
