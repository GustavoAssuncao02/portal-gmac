import { notificationSettings, proposalNoticeSeedNeeded, seedProposalNoticeDefaults } from './accounts.js'
import { addNotification } from './notificationEvents.js'
import { bahiaDay, momentOf } from './noteRules.js'
import { mutateStore, readStore } from './offers.js'
import { proposalNoticePlan, proposalNoticeText, proposalNoticeTime, proposalNoticeTypes, proposalPending } from './proposalDeadlineRules.js'

// TCK-0012: the notices of the "Prazo para enviar a proposta" in the bell (only), at 07:30 (the company starts at 07:30),
// weekends included, for everybody of the administrative portal, each by their own settings (Configurações ›
// Notificações › Comercial; off by default, on for the CPFs of PROPOSAL_DEADLINE_NOTICE_CPFS). Checked every minute by
// the server; each notice is given once per offer, person, kind and deadline (a new deadline notifies again). A deadline
// set after 07:30 of a notice day does not send that day's notice: whoever set it already knows. An offer with its
// proposal generated, accepted or refused warns no more.

// `people()`: the accounts of the administrative portal.
export default function createProposalDeadlineNotices({ people, now = Date.now }) {
  function dueNotices(store, persons, at) {
    const today = bahiaDay(at), noticeAt = momentOf(today, proposalNoticeTime)
    if (at < noticeAt) return []
    const sent = new Set((store.operationalNotifications || []).map((item) => item.id))
    const found = []
    for (const offer of store.offers || []) {
      if (!offer.proposalDeadline || !proposalPending(offer)) continue
      if ((Date.parse(offer.proposalDeadlineSetAt || offer.createdAt) || 0) > noticeAt) continue
      for (const person of persons) {
        for (const notice of proposalNoticePlan(offer.proposalDeadline, notificationSettings(store, person.id, person))) {
          const id = `proposal-deadline:${offer.id}:${person.id}:${notice.kind}:${offer.proposalDeadline}`
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
      const store = await readStore()
      // The accounts that come with the notices on keep that choice in their settings, so the bell shows them too.
      if (!dueNotices(store, persons, at).length && !proposalNoticeSeedNeeded(store, persons)) return []
      return mutateStore((current) => {
        seedProposalNoticeDefaults(current, persons)
        const list = dueNotices(current, persons, at)
        for (const { id, offer, person, notice } of list) {
          addNotification(current, { id, at: new Date(at).toISOString(), type: proposalNoticeTypes[notice.kind], offerId: offer.id, recipientIds: [person.id], title: notice.kind === 'due' ? 'Prazo da proposta vence hoje' : 'Prazo para enviar a proposta', description: proposalNoticeText(offer, notice.days) })
        }
        return list.map(({ id }) => id)
      })
    })().finally(() => { sweeping = null })
    return sweeping
  }
  return { sweep }
}
