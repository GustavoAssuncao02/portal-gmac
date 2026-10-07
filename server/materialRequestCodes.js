// Every material request gets a permanent code (PM-YYYY-NNNN). Manual requests keep the code saved
// with them; requests that come from an offer or OS are registered in `store.materialRequestCodes`.

const requestYear = (value) => new Intl.DateTimeFormat('en', { timeZone: 'America/Bahia', year: 'numeric' }).format(Number.isFinite(Date.parse(value)) ? new Date(value) : new Date())

export function nextMaterialRequestCode(store, at = new Date().toISOString()) {
  const prefix = `PM-${requestYear(at)}-`
  const used = [...(store.manualMaterialRequests || []).map((entry) => entry.code), ...Object.values(store.materialRequestCodes || {})]
  const sequence = Math.max(0, ...used.filter((code) => typeof code === 'string' && code.startsWith(prefix)).map((code) => Number(code.slice(prefix.length)) || 0)) + 1
  return `${prefix}${String(sequence).padStart(4, '0')}`
}

// Same rule used by the Pedidos de material screen to list offer and OS requests.
function linkedRequests(store) {
  const offers = store.offers || [], orders = store.orders || []
  const sources = [...offers, ...orders.filter((order) => !offers.some((offer) => offer.id === order.offerId)).map((order) => ({ ...order, id: order.offerId }))]
  return sources.filter((source) => source.status !== 'rejected').flatMap((source) => (source.resources?.materials || []).flatMap((material) => {
    const orderMaterial = orders.find((order) => order.offerId === source.id)?.resources?.materials?.find((entry) => entry.id === material.id)
    const quantity = material.purchaseQuantity ?? (material.stockStatus === 'available' ? 0 : Math.max(0, Number(material.quantity) - Number(material.stockAvailable || 0)))
    const handled = material.requestReceipt || material.requestRejection || orderMaterial?.requestReceipt || orderMaterial?.requestRejection
    return quantity > 0 || handled ? [{ id: `${source.id}-${material.id}`, requestedAt: material.requestedAt || source.requestedAt || source.createdAt }] : []
  }))
}

export function missingMaterialRequestCodes(store) {
  const codes = store.materialRequestCodes || {}
  return linkedRequests(store).filter((request) => !codes[request.id])
}

export function assignMaterialRequestCodes(store) {
  const missing = missingMaterialRequestCodes(store)
  if (!missing.length) return
  store.materialRequestCodes ||= {}
  // Older requests are numbered first, so existing records receive codes in chronological order.
  for (const request of missing.sort((left, right) => (Date.parse(left.requestedAt) || 0) - (Date.parse(right.requestedAt) || 0))) {
    store.materialRequestCodes[request.id] = nextMaterialRequestCode(store, request.requestedAt)
  }
}
