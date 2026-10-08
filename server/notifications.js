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
  const operational = (store, userId) => {
    const settings = notificationSettings(store, userId)
    return (store.operationalNotifications || []).filter((item) => settings[notificationPreference[item.type]])
  }
  const items = (store, userId) => [
    ...notificationItems(store, userId).map((item) => ({ ...item, type: 'payable' })),
    ...receivableNotificationItems(store, userId).map((item) => ({ ...item, type: 'receivable' })),
    ...operational(store, userId).map(({ readBy, ...item }) => ({ ...item, readAt: readBy?.find((entry) => String(entry.userId) === String(userId))?.at || null })),
  ].sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
  for (const [method, route, reading] of [['get', '/notifications', false], ['post', '/notifications/read-all', true]]) router[method](route, async (request, response, next) => {
    try {
      await sweepInventory()
      await receivables?.sweep(request.adminId)
      let store = await payables.sweep(request.adminId)
      if (reading && items(store, request.adminId).some((item) => !item.readAt)) store = await mutateStore((current) => {
        const at = new Date().toISOString()
        for (const notice of [...activeNotifications(current, request.adminId), ...activeReceivableNotices(current, request.adminId), ...operational(current, request.adminId)]) {
          notice.readBy ||= []
          if (!notice.readBy.some((entry) => String(entry.userId) === String(request.adminId))) notice.readBy.push({ userId: request.adminId, at })
        }
        return current
      })
      response.set('Cache-Control', 'no-store').json({ items: items(store, request.adminId) })
    } catch (error) { next(error) }
  })
  router.sweepInventory = sweepInventory
  return router
}
