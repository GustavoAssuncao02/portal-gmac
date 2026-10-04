import express from 'express'
import { inventoryAppearance } from './inventoryAppearance.js'

export function importedInventory(body) {
  if (!Array.isArray(body?.items) || body.items.length > 1000) throw new Error('Lista de materiais invalida.')
  const number = (value, max) => {
    const result = Number(value)
    if (!Number.isFinite(result) || result < 0 || result > max) throw new Error('Saldo ou valor de material invalido.')
    return result
  }
  return body.items.map((item) => {
    const name = String(item?.name || '').trim()
    const detail = String(item?.detail || '').trim()
    if (!name || name.length > 160 || detail.length > 255) throw new Error('Nome ou especificacao de material invalido.')
    const history = (Array.isArray(item.history) ? item.history : []).map((entry) => {
      if (!['creation', 'entry', 'exit'].includes(entry.type) || !Number.isFinite(Date.parse(entry.date))) throw new Error('Historico de estoque invalido.')
      return { type: entry.type, date: new Date(entry.date), quantity: number(entry.quantity, 999999999), unitPrice: number(entry.unitPrice ?? item.unitPrice ?? 0, 9999999999), balance: number(entry.balance, 999999999), destination: String(entry.destination || '').slice(0, 255), order: String(entry.order || '').slice(0, 80), notes: String(entry.notes || '').slice(0, 500) }
    })
    if (history.length > 10000) throw new Error('Historico de estoque muito extenso.')
    return { name, detail, quantity: number(item.quantity, 999999999), minimum: number(item.minimum || 0, 999999999), unitPrice: number(item.unitPrice || 0, 9999999999), history, ...(Object.hasOwn(item, 'icon') ? { icon: item.icon } : {}), ...(Object.hasOwn(item, 'photo') ? { photo: item.photo } : {}) }
  })
}

export default function createInventoryImportRouter(pool, requireAdmin) {
  const router = express.Router()
  router.post('/inventory/import', requireAdmin, async (request, response, next) => {
    if (!pool) return response.status(503).json({ message: 'O banco de dados ainda nao esta configurado.' })
    let items
    try {
      items = importedInventory(request.body)
      for (const item of items) Object.assign(item, await inventoryAppearance(item))
    } catch (error) { return response.status(400).json({ message: error.message }) }
    let connection, locked = false
    try {
      connection = await pool.getConnection()
      const [[lock]] = await connection.execute("SELECT GET_LOCK('portal_gmac.inventory_import', 10) AS acquired")
      locked = lock.acquired === 1
      if (!locked) return response.status(409).json({ message: 'O estoque esta sendo importado. Tente novamente.' })
      await connection.beginTransaction()
      const [existing] = await connection.execute('SELECT name, detail FROM inventory_materials')
      const key = (item) => JSON.stringify([item.name.toLocaleLowerCase('pt-BR'), String(item.detail || '').toLocaleLowerCase('pt-BR')])
      const known = new Set(existing.map(key))
      let imported = 0
      // Fresh browsers must never restore deleted defaults or replace the shared balances.
      if (!request.body.onlyIfEmpty || !existing.length) for (const item of items) {
        if (known.has(key(item))) continue
        const [result] = await connection.execute('INSERT INTO inventory_materials (name, detail, quantity_kg, minimum_kg, unit_price, icon, photo) VALUES (?, ?, ?, ?, ?, ?, ?)', [item.name, item.detail, item.quantity, item.minimum, item.unitPrice, item.icon || 'sheet', item.photo || null])
        const history = item.history.length ? item.history : [{ type: 'creation', quantity: item.quantity, unitPrice: item.unitPrice, balance: item.quantity, date: new Date(), destination: 'Cadastro inicial', order: '', notes: '' }]
        for (const entry of history) await connection.execute('INSERT INTO inventory_movements (material_id, movement_type, quantity_kg, unit_price_kg, balance_after_kg, destination, order_code, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [result.insertId, entry.type, entry.quantity, entry.unitPrice, entry.balance, entry.destination, entry.order, entry.notes, entry.date])
        known.add(key(item))
        imported++
      }
      await connection.commit()
      response.json({ imported })
    } catch (error) {
      if (connection) await connection.rollback()
      next(error)
    } finally {
      if (locked) await connection.execute("SELECT RELEASE_LOCK('portal_gmac.inventory_import')")
      connection?.release()
    }
  })
  return router
}
