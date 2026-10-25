import express from 'express'
import { inventoryAppearance } from './inventoryAppearance.js'
import { saveRequestedMaterial } from './materialRequests.js'
import { allocateReceivedMaterial } from './orderMaterials.js'
import { materialUnit, validMaterialUnit, validQuantityFor } from './materialUnits.js'

// Materials and movements of the shared stock (tables inventory_materials and inventory_movements).
// `recordInventoryNotification(row, previousLow)` registers a low-stock notice after a movement;
// `refreshInventoryNotifications()` checks every material again after an edit.
export default function createInventoryRouter(pool, requireAdmin, { recordInventoryNotification = async () => {}, refreshInventoryNotifications = async () => {} } = {}) {
  const router = express.Router()
  // Stock (quantities and prices) is for the administrative portal only.
  router.get('/inventory', requireAdmin, async (_request, response) => {
    try {
      const [materials] = await pool.execute(
        `SELECT id, name, detail, unit, quantity_kg AS quantity, minimum_kg AS minimum,
                unit_price AS unitPrice, icon, photo, created_at
           FROM inventory_materials
          ORDER BY name ASC`,
      )
      if (!materials.length) return response.json({ items: [] })
      const ids = materials.map((material) => material.id)
      const placeholders = ids.map(() => '?').join(', ')
      const [movements] = await pool.execute(
        `SELECT id, material_id, movement_type AS type, created_at AS date,
                quantity_kg AS quantity, unit_price_kg AS unitPrice, balance_after_kg AS balance,
                destination, order_code AS \`order\`, notes
           FROM inventory_movements
          WHERE material_id IN (${placeholders})
          ORDER BY created_at ASC, id ASC`,
        ids,
      )
      const historyByMaterial = new Map()
      for (const movement of movements) {
        if (!historyByMaterial.has(movement.material_id)) historyByMaterial.set(movement.material_id, [])
        historyByMaterial.get(movement.material_id).push(movement)
      }
      const items = materials.map((material) => ({
        ...material,
        history: historyByMaterial.get(material.id) || [],
      }))
      return response.json({ items })
    } catch (error) {
      console.error('Falha ao consultar estoque:', error)
      return response.status(500).json({ message: 'Não foi possível consultar o estoque.' })
    }
  })

  router.post('/inventory', requireAdmin, async (request, response) => {
    const { name, detail, quantity, minimum, unitPrice } = request.body ?? {}
    const initialQuantity = Number(quantity)
    if (request.body?.unit != null && !validMaterialUnit(request.body.unit)) return response.status(400).json({ message: 'Escolha a unidade do material: quilo ou unidade.' })
    const unit = materialUnit(request.body?.unit)
    if (!String(name || '').trim() || !Number.isFinite(initialQuantity) || initialQuantity < 0) {
      return response.status(400).json({ message: 'Informe o nome e uma quantidade inicial válida.' })
    }
    if (!validQuantityFor(initialQuantity, unit) || !validQuantityFor(Number(minimum) || 0, unit)) return response.status(400).json({ message: 'Material contado por unidade aceita só quantidades inteiras.' })

    let connection
    try {
      const appearance = await inventoryAppearance(request.body)
      const receipt = await saveRequestedMaterial(request.body.materialRequestId, request.adminId, async ({ order } = {}) => {
        if (request.body.materialRequestId && initialQuantity <= 0) throw Object.assign(new Error('Informe uma quantidade de entrada maior que zero.'), { status: 400 })
        connection = await pool.getConnection()
        await connection.beginTransaction()
        const [result] = await connection.execute(
          `INSERT INTO inventory_materials (name, detail, unit, quantity_kg, minimum_kg, unit_price, icon, photo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [String(name).trim(), detail || null, unit, initialQuantity, Number(minimum) || 0, Number(unitPrice) || 0, appearance.icon || 'sheet', appearance.photo || null],
        )
        await connection.execute(
          `INSERT INTO inventory_movements
            (material_id, movement_type, quantity_kg, unit_price_kg, balance_after_kg, destination, order_code)
           VALUES (?, 'creation', ?, ?, ?, ?, ?)`,
          [result.insertId, initialQuantity, Number(unitPrice) || 0, initialQuantity, order ? 'Entrada de material para a OS' : 'Cadastro inicial', order?.code || null],
        )
        return { id: result.insertId, receivedQuantity: initialQuantity }
      }, { commit: () => connection?.commit(), rollback: () => connection?.rollback(), receiptId: request.body.materialReceiptId, adminName: request.adminName, allocate: (result, context) => allocateReceivedMaterial(connection, result, context) })
      if (!receipt.alreadyReceived) await recordInventoryNotification({ id: receipt.id, name: String(name).trim(), quantity: receipt.balance ?? initialQuantity, minimum: Number(minimum) || 0 }, false)
      return response.status(201).json(receipt)
    } catch (error) {
      if (connection) await connection.rollback()
      if (error.status) return response.status(error.status).json({ message: error.message })
      console.error('Falha ao cadastrar material:', error)
      return response.status(500).json({ message: 'Não foi possível cadastrar o material.' })
    } finally {
      connection?.release()
    }
  })

  router.patch('/inventory/:materialId', requireAdmin, async (request, response) => {
    const { name, detail, minimum, unitPrice } = request.body ?? {}
    if (request.body?.unit != null && !validMaterialUnit(request.body.unit)) return response.status(400).json({ message: 'Escolha a unidade do material: quilo ou unidade.' })
    try {
      const [[current]] = await pool.execute('SELECT unit, quantity_kg AS quantity FROM inventory_materials WHERE id = ?', [request.params.materialId])
      if (!current) return response.status(404).json({ message: 'Material não encontrado.' })
      // The unit changes only while the balance is zero: otherwise the quantities already registered would change meaning.
      const unit = request.body?.unit ?? materialUnit(current.unit)
      if (unit !== materialUnit(current.unit) && Number(current.quantity) !== 0) return response.status(409).json({ message: 'A unidade só pode mudar com o saldo do material zerado.' })
      if (!validQuantityFor(Number(minimum) || 0, unit)) return response.status(400).json({ message: 'Material contado por unidade aceita só quantidades inteiras.' })
      const appearance = await inventoryAppearance(request.body)
      const appearanceFields = Object.keys(appearance)
      const [result] = await pool.execute(
        `UPDATE inventory_materials
            SET name = ?, detail = ?, unit = ?, minimum_kg = ?, unit_price = ?${appearanceFields.map((field) => `, ${field} = ?`).join('')}
          WHERE id = ?`,
        [String(name || '').trim(), detail || null, unit, Number(minimum) || 0, Number(unitPrice) || 0, ...appearanceFields.map((field) => appearance[field]), request.params.materialId],
      )
      if (!result.affectedRows) return response.status(404).json({ message: 'Material não encontrado.' })
      await refreshInventoryNotifications()
      return response.json({ ok: true })
    } catch (error) {
      if (error.status === 400) return response.status(400).json({ message: error.message })
      console.error('Falha ao editar material:', error)
      return response.status(500).json({ message: 'Não foi possível editar o material.' })
    }
  })

  router.delete('/inventory/:materialId', requireAdmin, async (request, response) => {
    try {
      const [result] = await pool.execute('DELETE FROM inventory_materials WHERE id = ?', [request.params.materialId])
      if (!result.affectedRows) return response.status(404).json({ message: 'Material não encontrado.' })
      return response.status(204).end()
    } catch (error) {
      console.error('Falha ao remover material:', error)
      return response.status(500).json({ message: 'Não foi possível remover o material.' })
    }
  })

  router.get('/inventory/:materialId/history', requireAdmin, async (request, response) => {
    try {
      const [rows] = await pool.execute(
        `SELECT id, movement_type AS type, created_at AS date, quantity_kg AS quantity,
                unit_price_kg AS unitPrice, balance_after_kg AS balance,
                destination, order_code AS \`order\`, notes
           FROM inventory_movements
          WHERE material_id = ?
          ORDER BY created_at DESC, id DESC`,
        [request.params.materialId],
      )
      return response.json({ history: rows })
    } catch (error) {
      console.error('Falha ao consultar histórico do estoque:', error)
      return response.status(500).json({ message: 'Não foi possível consultar o histórico do material.' })
    }
  })

  router.post('/inventory/:materialId/movements', requireAdmin, async (request, response) => {
    const { type, quantityKg, unitPrice, destination, orderCode, notes } = request.body ?? {}
    const quantity = Number(quantityKg)
    if (!['entry', 'exit'].includes(type) || !Number.isFinite(quantity) || quantity <= 0) {
      return response.status(400).json({ message: 'Informe um tipo de movimentação e uma quantidade válida.' })
    }

    let connection
    try {
      let notification
      const receipt = await saveRequestedMaterial(request.body.materialRequestId, request.adminId, async ({ order } = {}) => {
        if (request.body.materialRequestId && type !== 'entry') throw Object.assign(new Error('O pedido exige uma entrada de material.'), { status: 400 })
        connection = await pool.getConnection()
        await connection.beginTransaction()
        const [materials] = await connection.execute(
          'SELECT id, name, unit, quantity_kg, minimum_kg, unit_price FROM inventory_materials WHERE id = ? FOR UPDATE',
          [request.params.materialId],
        )
        const material = materials[0]
        if (!material) {
          throw Object.assign(new Error('Material não encontrado.'), { status: 404 })
        }
        if (!validQuantityFor(quantity, material.unit)) throw Object.assign(new Error('Material contado por unidade aceita só quantidades inteiras.'), { status: 400 })

        const currentBalance = Number(material.quantity_kg)
        const currentUnitPrice = Number(material.unit_price)
        const incomingUnitPrice = Number(unitPrice)
        const nextBalance = type === 'entry' ? currentBalance + quantity : currentBalance - quantity
        if (nextBalance < 0) {
          throw Object.assign(new Error('A saída não pode ser maior que o saldo disponível.'), { status: 409 })
        }

        const nextUnitPrice = type === 'entry' && Number.isFinite(incomingUnitPrice) && incomingUnitPrice >= 0 && nextBalance > 0
          ? ((currentBalance * currentUnitPrice) + (quantity * incomingUnitPrice)) / nextBalance
          : currentUnitPrice
        await connection.execute(
          'UPDATE inventory_materials SET quantity_kg = ?, unit_price = ? WHERE id = ?',
          [nextBalance, nextUnitPrice, request.params.materialId],
        )
        await connection.execute(
          `INSERT INTO inventory_movements
            (material_id, movement_type, quantity_kg, unit_price_kg, balance_after_kg, destination, order_code, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [request.params.materialId, type, quantity, type === 'entry' ? incomingUnitPrice : currentUnitPrice, nextBalance, order ? 'Entrada de material para a OS' : destination || null, order?.code || orderCode || null, notes || null],
        )
        notification = { row: { id: material.id, name: material.name, quantity: nextBalance, minimum: Number(material.minimum_kg) }, previousLow: currentBalance <= Number(material.minimum_kg) }
        return { materialId: Number(request.params.materialId), balance: nextBalance, unitPrice: nextUnitPrice, receivedQuantity: quantity }
      }, { commit: () => connection?.commit(), rollback: () => connection?.rollback(), receiptId: request.body.materialReceiptId, adminName: request.adminName, allocate: (result, context) => allocateReceivedMaterial(connection, result, context) })
      if (notification) await recordInventoryNotification({ ...notification.row, quantity: receipt.balance }, notification.previousLow)
      return response.status(201).json(receipt)
    } catch (error) {
      if (connection) await connection.rollback()
      if (error.status) return response.status(error.status).json({ message: error.message })
      console.error('Falha ao registrar movimentação do estoque:', error)
      return response.status(500).json({ message: 'Não foi possível registrar a movimentação.' })
    } finally {
      connection?.release()
    }
  })
  return router
}
