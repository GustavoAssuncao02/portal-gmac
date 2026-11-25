import { todayBahia } from './payableRules.js'

// Lançamento retroativo: a manual offer entered with a "Data da solicitação" before the day it was typed in the system.
// Its OS opens on that same day, so the acceptance asks nothing again. An offer requested and entered on the same day
// (and every site offer) gives ''. Shared by the server and the screens (no Node imports here).
export function retroactiveOrderDay(offer) {
  if (offer?.origin !== 'Inserida Manualmente') return ''
  const requested = Date.parse(offer.requestedAt), entered = Date.parse(offer.createdAt)
  if (!Number.isFinite(requested) || !Number.isFinite(entered)) return ''
  const day = todayBahia(new Date(requested))
  return day < todayBahia(new Date(entered)) ? day : ''
}
