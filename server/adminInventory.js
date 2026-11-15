import express from 'express'
import { inventoryAppearance } from './inventoryAppearance.js'
import { adminMaterialIcons, defaultAdminMaterialIcon } from './materialIcons.js'
import { invalidUnitMessage, materialUnit, validMaterialUnit, validQuantityFor } from './materialUnits.js'

// Estoque Administrativo: office, cleaning and pantry supplies (papel higiênico, lápis, caneta...). It works like the
// factory stock (materials, entries, average price, history, low-stock notice) but in its own tables, so these items
// never show up in offers or OS. Nothing consumes it automatically: what is used leaves by a "baixa" typed on the screen,
// with who registered it.
export const adminInventoryTables = [
  `CREATE TABLE IF NOT EXISTS admin_inventory_materials (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  unit VARCHAR(4) NOT NULL DEFAULT 'un',
  quantity DECIMAL(12,3) NOT NULL DEFAULT 0,
  minimum DECIMAL(12,3) NOT NULL DEFAULT 0,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  icon VARCHAR(24) NOT NULL DEFAULT '${defaultAdminMaterialIcon}',
  photo TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_admin_inventory_materials_name (name)
)`,
  `CREATE TABLE IF NOT EXISTS admin_inventory_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id INT UNSIGNED NOT NULL,
  movement_type ENUM('creation', 'entry', 'exit') NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance_after DECIMAL(12,3) NOT NULL,
  destination VARCHAR(255) NULL,
  notes VARCHAR(500) NULL,
  user_name VARCHAR(160) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_admin_inventory_movements_material_date (material_id, created_at),
  CONSTRAINT fk_admin_inventory_movements_material
    FOREIGN KEY (material_id) REFERENCES admin_inventory_materials (id)
    ON DELETE CASCADE
)`,
]

export async function ensureAdminInventory(pool) {
  for (const statement of adminInventoryTables) await pool.query(statement)
}

// The low-stock notices share the factory stock's bell; the "admin-" id keeps the two stocks' ids apart.
export const adminNoticeRow = (row) => ({ id: `admin-${row.id}`, admin: true, name: row.name, unit: row.unit, quantity: Number(row.quantity), minimum: Number(row.minimum) })

export async function loadAdminInventoryRows(pool) {
  const [rows] = await pool.execute('SELECT id, name, unit, quantity, minimum FROM admin_inventory_materials')
  return rows.map(adminNoticeRow)
}

const text = (value, limit) => String(value ?? '').trim().slice(0, limit)
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const movementColumns = `id, movement_type AS type, created_at AS date, quantity, unit_price AS unitPrice, balance_after AS balance,
                destination, notes, user_name AS userName`

export default function createAdminInventoryRouter(pool, requireAdmin, { recordInventoryNotification = async () => {} } = {}) {
  const router = express.Router()
  router.use('/admin-inventory', requireAdmin)
  const appearance = (body) => inventoryAppearance(body, adminMaterialIcons)
  const answer = (response, error, message) => {
    if (error.status) return response.status(error.status).json({ message: error.message })
    console.error(`${message}:`, error)
    return response.status(500).json({ message: `${message}.` })
  }
  async function transaction(work) {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const result = await work(connection)
      await connection.commit()
      return result
    } catch (error) { await connection.rollback(); throw error }
    finally { connection.release() }
  }

  router.get('/admin-inventory', async (_request, response) => {
    try {
      const [materials] = await pool.execute(`SELECT id, name, unit, quantity, minimum, unit_price AS unitPrice, icon, photo, created_at
                                                FROM admin_inventory_materials ORDER BY name ASC`)
      const [movements] = materials.length ? await pool.execute(`SELECT material_id, ${movementColumns} FROM admin_inventory_movements ORDER BY created_at ASC, id ASC`) : [[]]
      const history = new Map()
      for (const { material_id: id, ...movement } of movements) history.set(id, [...(history.get(id) || []), movement])
      return response.json({ items: materials.map((material) => ({ ...material, history: history.get(material.id) || [] })) })
    } catch (error) { return answer(response, error, 'Não foi possível consultar o estoque administrativo') }
  })

  router.post('/admin-inventory', async (request, response) => {
    try {
      const body = request.body ?? {}
      const name = text(body.name, 160), quantity = Number(body.quantity ?? 0), minimum = Number(body.minimum) || 0, unitPrice = Number(body.unitPrice) || 0
      if (body.unit != null && !validMaterialUnit(body.unit)) fail(invalidUnitMessage)
      const unit = materialUnit(body.unit ?? 'un')
      if (!name || !Number.isFinite(quantity) || quantity < 0 || minimum < 0 || unitPrice < 0) fail('Informe o nome e uma quantidade inicial válida.')
      if (!validQuantityFor(quantity, unit) || !validQuantityFor(minimum, unit)) fail('Material contado por unidade aceita só quantidades inteiras.')
      const look = await appearance(body)
      const id = await transaction(async (connection) => {
        const [result] = await connection.execute('INSERT INTO admin_inventory_materials (name, unit, quantity, minimum, unit_price, icon, photo) VALUES (?, ?, ?, ?, ?, ?, ?)', [name, unit, quantity, minimum, unitPrice, look.icon || defaultAdminMaterialIcon, look.photo || null])
        await connection.execute(`INSERT INTO admin_inventory_movements (material_id, movement_type, quantity, unit_price, balance_after, destination, user_name)
                                  VALUES (?, 'creation', ?, ?, ?, 'Cadastro inicial', ?)`, [result.insertId, quantity, unitPrice, quantity, request.adminName || null])
        return result.insertId
      })
      await recordInventoryNotification(adminNoticeRow({ id, name, unit, quantity, minimum }), false)
      return response.status(201).json({ id })
    } catch (error) { return answer(response, error, 'Não foi possível cadastrar o material') }
  })

  router.patch('/admin-inventory/:materialId', async (request, response) => {
    try {
      const body = request.body ?? {}
      const name = text(body.name, 160), minimum = Number(body.minimum) || 0, unitPrice = Number(body.unitPrice) || 0
      if (!name) fail('Informe o nome do material.')
      if (body.unit != null && !validMaterialUnit(body.unit)) fail(invalidUnitMessage)
      const [[current]] = await pool.execute('SELECT unit, quantity FROM admin_inventory_materials WHERE id = ?', [request.params.materialId])
      if (!current) fail('Material não encontrado.', 404)
      // As in the factory stock: the unit changes only with the balance at zero.
      const unit = body.unit ?? materialUnit(current.unit)
      if (unit !== materialUnit(current.unit) && Number(current.quantity) !== 0) fail('A unidade só pode mudar com o saldo do material zerado.', 409)
      if (!validQuantityFor(minimum, unit)) fail('Material contado por unidade aceita só quantidades inteiras.')
      const look = await appearance(body), fields = Object.keys(look)
      await pool.execute(`UPDATE admin_inventory_materials SET name = ?, unit = ?, minimum = ?, unit_price = ?${fields.map((field) => `, ${field} = ?`).join('')} WHERE id = ?`,
        [name, unit, minimum, unitPrice, ...fields.map((field) => look[field]), request.params.materialId])
      await recordInventoryNotification(adminNoticeRow({ id: request.params.materialId, name, unit, quantity: current.quantity, minimum }))
      return response.json({ ok: true })
    } catch (error) { return answer(response, error, 'Não foi possível editar o material') }
  })

  router.delete('/admin-inventory/:materialId', async (request, response) => {
    try {
      const [result] = await pool.execute('DELETE FROM admin_inventory_materials WHERE id = ?', [request.params.materialId])
      if (!result.affectedRows) fail('Material não encontrado.', 404)
      return response.status(204).end()
    } catch (error) { return answer(response, error, 'Não foi possível remover o material') }
  })

  router.get('/admin-inventory/:materialId/history', async (request, response) => {
    try {
      const [rows] = await pool.execute(`SELECT ${movementColumns} FROM admin_inventory_movements WHERE material_id = ? ORDER BY created_at DESC, id DESC`, [request.params.materialId])
      return response.json({ history: rows })
    } catch (error) { return answer(response, error, 'Não foi possível consultar o histórico do material') }
  })

  // Entry (a purchase: the unit price is averaged as in the factory stock) or exit (the "baixa" of what was used).
  router.post('/admin-inventory/:materialId/movements', async (request, response) => {
    try {
      const body = request.body ?? {}
      const quantity = Number(body.quantity)
      if (!['entry', 'exit'].includes(body.type) || !Number.isFinite(quantity) || quantity <= 0) fail('Informe um tipo de movimentação e uma quantidade válida.')
      const destination = text(body.destination, 255), notes = text(body.notes, 500)
      const result = await transaction(async (connection) => {
        const [[material]] = await connection.execute('SELECT id, name, unit, quantity, minimum, unit_price FROM admin_inventory_materials WHERE id = ? FOR UPDATE', [request.params.materialId])
        if (!material) fail('Material não encontrado.', 404)
        if (!validQuantityFor(quantity, material.unit)) fail('Material contado por unidade aceita só quantidades inteiras.')
        const balance = Number(material.quantity), price = Number(material.unit_price), incoming = Number(body.unitPrice)
        const next = body.type === 'entry' ? balance + quantity : balance - quantity
        if (next < -1e-9) fail('A baixa não pode ser maior que o saldo disponível.', 409)
        const nextPrice = body.type === 'entry' && Number.isFinite(incoming) && incoming >= 0 && next > 0 ? (balance * price + quantity * incoming) / next : price
        await connection.execute('UPDATE admin_inventory_materials SET quantity = ?, unit_price = ? WHERE id = ?', [Math.max(0, next), nextPrice, material.id])
        await connection.execute(`INSERT INTO admin_inventory_movements (material_id, movement_type, quantity, unit_price, balance_after, destination, notes, user_name)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [material.id, body.type, quantity, body.type === 'entry' && Number.isFinite(incoming) ? incoming : price, Math.max(0, next), destination || (body.type === 'entry' ? 'Entrada de estoque' : null), notes || null, request.adminName || null])
        return { material, balance: Math.max(0, next), unitPrice: nextPrice, previousLow: balance <= Number(material.minimum) }
      })
      await recordInventoryNotification(adminNoticeRow({ ...result.material, quantity: result.balance }), result.previousLow)
      return response.status(201).json({ materialId: result.material.id, balance: result.balance, unitPrice: result.unitPrice })
    } catch (error) { return answer(response, error, 'Não foi possível registrar a movimentação') }
  })
  return router
}
