// An offer names up to 5 requesters (who asked for the service at the client). `requesters` keeps each one with its
// registration (Cadastros › Solicitantes, id null when the client is not registered); `requester` (the names joined by
// ", ") and `requesterId` (the first one) stay for whatever reads a single requester: the proposal PDF, the lists, the
// site offers and the offers made before. Shared by the server and the screens (no Node imports here).
export const maxOfferRequesters = 5
export const requesterSeparator = ', '

export function offerRequesters(offer) {
  const listed = Array.isArray(offer?.requesters) ? offer.requesters.filter((item) => String(item?.name ?? '').trim()) : []
  if (listed.length) return listed.map((item) => ({ name: String(item.name).trim(), id: item.id ?? null }))
  const name = String(offer?.requester ?? '').trim()
  return name ? [{ name, id: offer.requesterId ?? null }] : []
}

export const offerRequesterNames = (offer) => offerRequesters(offer).map((item) => item.name)
export const requestersLabel = (count) => (count > 1 ? 'Solicitantes' : 'Solicitante')
