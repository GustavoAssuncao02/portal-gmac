import express from 'express'
import { readStore, mutateStore } from './offers.js'
import { notificationSettings } from './accounts.js'
import { notificationPreference } from './notificationRules.js'
import { inventorySignal } from './notificationEvents.js'
import { activeNotifications, notificationItems } from './payables.js'
import { activeReceivableNotices, receivableNotificationItems } from './receivables.js'

export default function createNotificationsRouter({ requireAdmin, payables, receivables, loadInventory }) {
  const router = express.Router()
  router.use('/notifications', requireAdmin)
  let inventorySweep = null
  async function sweepInventory() {
    if (!loadInventory) return
    if (inventorySweep) return inventorySweep
    inventorySweep = (async () => {
      const rows = await loadInventory()
      if (!Array.isArray(rows)) return
      const snapshot = await readStore()
      if (snapshot.notificationInventoryInitialized && rows.every((row) => {
        const previous = snapshot.notificationInventory?.[String(row.id)]
        return previous && previous.quantity === Number(row.quantity) && previous.minimum === Number(row.minimum) && previous.name === row.name
      }) && Object.keys(snapshot.notificationInventory || {}).length === rows.length) return
      await mutateStore((store) => {
        for (const row of rows) inventorySignal(store, row)
        const ids = new Set(rows.map((row) => String(row.id)))
        for (const id of Object.keys(store.notificationInventory || {})) if (!ids.has(id)) delete store.notificationInventory[id]
        store.notificationInventoryInitialized = true
      })
    })().finally(() => { inventorySweep = null })
    return inventorySweep
  }
  // A notice with an author (a saved proposal, an accepted offer) is not shown to the person who caused it. The notice of
  // a new version of the portal goes to everybody, whatever the preferences.
  const operational = (store, userId) => {
    const settings = notificationSettings(store, userId)
    return (store.operationalNotifications || []).filter((item) => (item.type === 'release' || settings[notificationPreference[item.type]]) && (item.authorId == null || String(item.authorId) !== String(userId)))
  }
  // Administrative employees have no access to the finance screens, so they get no payable or receivable notices.
  const items = (store, userId, finance) => [
    ...(finance ? notificationItems(store, userId).map((item) => ({ ...item, type: 'payable' })) : []),
    ...(finance ? receivableNotificationItems(store, userId).map((item) => ({ ...item, type: 'receivable' })) : []),
    ...operational(store, userId).map(({ readBy, ...item }) => ({ ...item, readAt: readBy?.find((entry) => String(entry.userId) === String(userId))?.at || null })),
  ].sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
  for (const [method, route, reading] of [['get', '/notifications', false], ['post', '/notifications/read-all', true]]) router[method](route, async (request, response, next) => {
    try {
      const finance = request.adminRole !== 'staff'
      await sweepInventory()
      if (finance) await receivables?.sweep(request.adminId)
      let store = finance ? await payables.sweep(request.adminId) : await readStore()
      if (reading && items(store, request.adminId, finance).some((item) => !item.readAt)) store = await mutateStore((current) => {
        const at = new Date().toISOString()
        for (const notice of [...(finance ? [...activeNotifications(current, request.adminId), ...activeReceivableNotices(current, request.adminId)] : []), ...operational(current, request.adminId)]) {
          notice.readBy ||= []
          if (!notice.readBy.some((entry) => String(entry.userId) === String(request.adminId))) notice.readBy.push({ userId: request.adminId, at })
        }
        return current
      })
      // The sound goes with every poll, so the bell plays the account's current choice without another request.
      response.set('Cache-Control', 'no-store').json({ items: items(store, request.adminId, finance), sound: notificationSettings(store, request.adminId).sound })
    } catch (error) { next(error) }
  })
  router.sweepInventory = sweepInventory
  return router
}
