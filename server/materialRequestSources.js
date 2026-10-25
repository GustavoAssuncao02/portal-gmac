// The material planned in an offer becomes a purchase request only when the offer is accepted (it has an OS): before
// that the proposal may still change or be declined. OS without their offer (older records) count as well.
export function materialRequestSources(offers = [], orders = []) {
  return [
    ...offers.filter((offer) => offer.status !== 'rejected' && offer.orderCode),
    ...orders.filter((order) => !offers.some((offer) => offer.id === order.offerId)).map((order) => ({ ...order, id: order.offerId, orderCode: order.code })),
  ]
}
