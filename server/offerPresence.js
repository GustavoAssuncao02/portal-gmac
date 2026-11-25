// "Criando oferta" in real time (2026-11-25). The details of an offer being created tell the server, every 30 s, that
// the person creating it is still there (POST /api/presence/offers/:id), and once more when they leave (closing the
// tab, going to another screen) or stop touching the page for a while. The list shows "Criando oferta" only while that
// goes on; otherwise "Em aberto" with "editado há ...".
//
// What is kept on the offer (editingBy): `active` (true while the person is there) and `lastActiveAt` (the last time
// they were seen). Only the changes of `active` are saved, so the open screens are told of them by the live updates
// (liveUpdates.js); the beats in between stay in this memory, and lastActiveAt is saved again at most every 5 minutes,
// so a restart of the server loses at most that much. The route is outside the live topics ("presence").
export const PRESENCE_BEAT_MS = 30000
export const PRESENCE_STALE_MS = 90000
const SAVE_EVERY_MS = 5 * 60000

const same = (a, b) => a != null && b != null && String(a) === String(b)
const editing = (offer, userId) => offer?.status === 'creating' && offer.editingBy && same(offer.editingBy.id, userId)

// Whether somebody is creating the offer now: an editingBy without `active` comes from before this rule and counts as
// stopped since editingBy.at.
export const presenceActive = (offer) => Boolean(offer?.editingBy?.active)
export const lastActiveAt = (offer) => offer?.editingBy?.lastActiveAt || offer?.editingBy?.at || offer?.createdAt || null

export function createOfferPresence({ readStore, mutateStore, now = () => Date.now(), staleMs = PRESENCE_STALE_MS, log = () => {} }) {
  const seen = new Map()
  const startedAt = now()

  async function setActive(offerId, userId, active, at) {
    return mutateStore((store) => {
      const item = store.offers.find((entry) => entry.id === offerId)
      if (!editing(item, userId)) return false
      item.editingBy = { ...item.editingBy, active, lastActiveAt: new Date(at).toISOString() }
      return true
    })
  }

  // The person creating the offer is on its details. Somebody else (the offer was taken over) changes nothing.
  async function beat(offerId, userId) {
    const at = now()
    const offer = (await readStore()).offers.find((entry) => entry.id === offerId)
    if (!editing(offer, userId)) return false
    seen.set(offerId, { userId: String(userId), at })
    const saved = Date.parse(offer.editingBy.lastActiveAt)
    if (!offer.editingBy.active || !(at - saved < SAVE_EVERY_MS)) await setActive(offerId, userId, true, at)
    return true
  }

  // Left the details (or stopped touching them): "Em aberto" at once, edited now.
  async function leave(offerId, userId) {
    const entry = seen.get(offerId)
    if (entry && entry.userId === String(userId)) seen.delete(offerId)
    const offer = (await readStore()).offers.find((item) => item.id === offerId)
    if (!editing(offer, userId) || !offer.editingBy.active) return false
    return setActive(offerId, userId, false, now())
  }

  // Run every few seconds: an offer whose person stopped sending beats (tab closed, computer off, connection lost) is
  // "Em aberto" since the last beat. After a restart (or an offer just taken over) nobody was seen yet here: it waits one
  // stale period from the later of the start and its last saved activity.
  async function sweep() {
    const at = now()
    const stale = (await readStore()).offers.filter((offer) => offer.status === 'creating' && presenceActive(offer)).filter((offer) => {
      const entry = seen.get(offer.id)
      if (entry && entry.userId === String(offer.editingBy.id)) return at - entry.at >= staleMs
      return at - Math.max(startedAt, Date.parse(offer.editingBy.lastActiveAt) || 0) >= staleMs
    })
    for (const offer of stale) {
      const entry = seen.get(offer.id), last = Math.max(entry?.at || 0, Date.parse(offer.editingBy.lastActiveAt) || 0) || at
      seen.delete(offer.id)
      await setActive(offer.id, offer.editingBy.id, false, last).catch((error) => log(error))
    }
    return stale.length
  }

  return { beat, leave, sweep }
}
