import { notificationSettings } from './accounts.js'
import { addNotification } from './notificationEvents.js'
import { bahiaDay, momentOf } from './noteRules.js'
import { mutateStore, readStore } from './offers.js'
import { responseAnswered, responseNoticePlan, responseNoticeText, responseNoticeTime } from './offerResponseRules.js'

// TCK-0012: the notices of the "Prazo para resposta do cliente" in the bell, at 07:30 (the company starts at 07:30), for
// everybody of the administrative portal (administrators and administrative employees, who all see Ofertas), each by
// their own settings (Configurações › Notificações › Comercial). Checked every minute by the server; each notice is
// given once per offer, person, kind and deadline (a new deadline notifies again). A deadline set after 07:30 of a
// notice day does not send that day's notice: whoever set it already knows. Answered offers (accepted or refused) stop.
export const responseNoticeTypes = { first: 'offer-response-first', second: 'offer-response-second', due: 'offer-response-due' }

// `people()`: the accounts of the administrative portal.
export default function createOfferResponseNotices({ people, now = Date.now }) {
  function dueNotices(store, persons, at) {
    const today = bahiaDay(at), noticeAt = momentOf(today, responseNoticeTime)
    if (at < noticeAt) return []
    const sent = new Set((store.operationalNotifications || []).map((item) => item.id))
    const found = []
    for (const offer of store.offers || []) {
      if (!offer.responseDeadline || responseAnswered(offer)) continue
      if ((Date.parse(offer.responseSetAt || offer.createdAt) || 0) > noticeAt) continue
      for (const person of persons) {
        for (const notice of responseNoticePlan(offer.responseDeadline, notificationSettings(store, person.id))) {
          const id = `offer-response:${offer.id}:${person.id}:${notice.kind}:${offer.responseDeadline}`
          if (notice.day === today && !sent.has(id)) found.push({ id, offer, person, notice })
        }
      }
    }
    return found
  }
  let sweeping = null
  // `at`: the moment checked (now; the tests move it).
  async function sweep(at = now()) {
    if (sweeping) return sweeping
    sweeping = (async () => {
      const persons = await people()
      if (!dueNotices(await readStore(), persons, at).length) return []
      return mutateStore((store) => {
        const list = dueNotices(store, persons, at)
        for (const { id, offer, person, notice } of list) {
          addNotification(store, { id, at: new Date(at).toISOString(), type: responseNoticeTypes[notice.kind], offerId: offer.id, recipientIds: [person.id], title: notice.kind === 'due' ? 'Prazo de resposta vence hoje' : 'Prazo de resposta do cliente', description: responseNoticeText(offer, notice.days) })
        }
        return list.map(({ id }) => id)
      })
    })().finally(() => { sweeping = null })
    return sweeping
  }
  return { sweep }
}
