import { offerRequesterNames } from '../server/offerRequesters.js'

// The magnifier of Ofertas e serviços, Serviços em andamento and Serviços concluídos: one rule for the three screens.
// It finds service, client, offer and OS codes, requesters and buyer, label, quote number, the client's purchase order
// number, the nota de entrada and the name of any attachment — of the offer, of its proposal e-mails, of the OS and of its "Anexos
// administrativos" (order.purchaseOrders) and of its NF-e (order.invoices, also by the number of the note). An offer and its OS are one job: what belongs to either finds both. Accents
// and capitals do not matter.
export const workSearchPlaceholder = 'Buscar por serviço, cliente, OS, cotação ou anexo...'

export const foldSearch = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').trim()

const names = (files) => (Array.isArray(files) ? files : []).map((file) => file?.name)
// The numbers printed on the proposal or quote: Nº da cotação (models A/B), FS-3055 number (Nestlé), label (Etiqueta).
const quoteNumbers = (proposal) => { const document = proposal?.document; return document ? [document.quoteNumber, document.number, document.labelNumber] : [] }

function offerTerms(offer) {
  if (!offer) return []
  return [offer.service, offer.company, offer.code, offer.labelNumber, offer.orderCode, ...offerRequesterNames(offer), offer.buyer, ...quoteNumbers(offer.proposal), ...names(offer.attachments), ...(offer.proposalEmails || []).flatMap((email) => names(email.attachments))]
}

function orderTerms(order) {
  if (!order) return []
  return [order.service, order.company, order.code, order.labelNumber, order.purchaseOrderNumber, order.entryInvoiceNumber,...quoteNumbers(order.proposal), ...(order.labelQuote?.versions || []).map((version) => version.number), ...names(order.attachments), ...names(order.purchaseOrders), ...names(order.invoices), ...(order.invoices || []).map((file) => file.number)]
}

// `offers` and `orders` are the full lists, so each side also searches what belongs to the other.
export function createWorkSearch(offers = [], orders = []) {
  const orderOf = (offer) => orders.find((order) => order.code === offer.orderCode || order.offerId === offer.id)
  const offerOf = (order) => offers.find((offer) => offer.id === order.offerId || offer.orderCode === order.code)
  const matches = (terms, query) => { const wanted = foldSearch(query); return !wanted || terms.some((term) => foldSearch(term).includes(wanted)) }
  return {
    offer: (offer, query) => matches([...offerTerms(offer), ...orderTerms(orderOf(offer))], query),
    order: (order, query) => matches([...orderTerms(order), ...offerTerms(offerOf(order))], query),
  }
}
