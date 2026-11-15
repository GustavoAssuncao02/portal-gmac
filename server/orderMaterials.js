import { formatQuantity, materialUnit } from './materialUnits.js'
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR')
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error }
const kg = (value) => Number(Number(value).toFixed(3))
const reais = (value) => Number(Number(value).toFixed(4))

// Real cost of what an OS material took from the stock (inventoryConsumedCost, in reais): what left the stock at its
// price at that moment, and what came in for the OS (material request received) at the price paid. A material saved
// before this cost was kept counts at its estimated price, so its real cost is the estimate.
export const consumedQuantity = (material) => Number(material.inventoryConsumedQuantity ?? (Number(material.quantity) - (Number(material.purchaseQuantity) || 0))) || 0
export const consumedCost = (material) => material.inventoryConsumedCost != null ? Number(material.inventoryConsumedCost) : reais(consumedQuantity(material) * (Number(material.unitPrice) || 0))
// Difference between the real and the estimated material cost of an OS, in cents: only what already left the stock
// counts at its real price; what is still pending keeps the estimate.
export function materialCostDeltaCents(order) {
  return Math.round((order.resources?.materials || []).filter((material) => material.inventoryConsumedCost != null)
    .reduce((total, material) => total + Number(material.inventoryConsumedCost) - consumedQuantity(material) * (Number(material.unitPrice) || 0), 0) * 100)
}

export async function allocateReceivedMaterial(connection, result, { order, remainingQuantity, requestId }) {
  if (!order) return { allocatedQuantity: 0 }
  const materialId = result.materialId ?? result.id
  const quantity = kg(Math.min(Number(result.receivedQuantity), remainingQuantity))
  if (!(quantity > 0)) return { allocatedQuantity: 0 }
  const [[material]] = await connection.execute('SELECT id, quantity_kg, unit_price FROM inventory_materials WHERE id = ? FOR UPDATE', [materialId])
  if (!material || Number(material.quantity_kg) < quantity) fail(409, 'Saldo insuficiente para destinar o material recebido à OS.')
  const balance = kg(Number(material.quantity_kg) - quantity)
  await connection.execute('UPDATE inventory_materials SET quantity_kg = ? WHERE id = ?', [balance, materialId])
  await connection.execute(
    `INSERT INTO inventory_movements
      (material_id, movement_type, quantity_kg, unit_price_kg, balance_after_kg, destination, order_code, notes)
     VALUES (?, 'exit', ?, ?, ?, ?, ?, ?)`,
    [materialId, quantity, Number(material.unit_price), balance, 'Utilizado na ordem de serviço', order.code, `Recebimento do pedido de material ${requestId}.`],
  )
  // The OS pays what was paid for this purchase, not the average price of the stock.
  const paid = Number(result.purchaseUnitPrice)
  return { allocatedQuantity: quantity, allocatedUnitPrice: Number.isFinite(paid) && paid >= 0 ? paid : Number(material.unit_price), balance, orderCode: order.code }
}

// An OS that needs more of a material takes the increase from the stock when it is saved, as in the acceptance; what the
// stock does not have stays pending as a material request. Only the increase counts: a request already open is not touched,
// and a smaller quantity gives nothing back by itself. Runs in the transaction that saves the OS.
export async function consumeOrderIncrease(connection, order, previousMaterials = []) {
  const materials = order.resources?.materials || []
  for (const material of materials) {
    const before = previousMaterials.find((item) => item.id === material.id)
    if (!before || before.stockAvailable == null || material.inventoryId == null) continue
    const increase = kg(Number(material.quantity) - Number(before.quantity))
    const pending = Number(material.purchaseQuantity) || 0
    if (!(increase > 0) || !(pending > 0)) continue
    const [[item]] = await connection.execute('SELECT id, unit, quantity_kg, unit_price FROM inventory_materials WHERE id = ? FOR UPDATE', [material.inventoryId])
    if (!item) continue
    const quantity = kg(Math.min(increase, pending, Number(item.quantity_kg)))
    if (!(quantity > 0)) continue
    const balance = kg(Number(item.quantity_kg) - quantity)
    await connection.execute('UPDATE inventory_materials SET quantity_kg = ? WHERE id = ?', [balance, item.id])
    await connection.execute(
      `INSERT INTO inventory_movements
        (material_id, movement_type, quantity_kg, unit_price_kg, balance_after_kg, destination, order_code, notes)
       VALUES (?, 'exit', ?, ?, ?, ?, ?, ?)`,
      [item.id, quantity, Number(item.unit_price), balance, 'Utilizado na ordem de serviço', order.code, `Aumento da quantidade na OS: ${formatQuantity(before.quantity, item.unit)} → ${formatQuantity(material.quantity, item.unit)}.`],
    )
    const consumed = kg(Number(before.inventoryConsumedQuantity ?? Number(before.quantity) - (Number(before.purchaseQuantity) || 0)) + quantity)
    const remaining = kg(Math.max(0, Number(material.quantity) - consumed))
    Object.assign(material, { inventoryConsumedQuantity: consumed, inventoryConsumedCost: reais(consumedCost(before) + quantity * Number(item.unit_price)), stockAvailable: consumed, purchaseQuantity: remaining, stockStatus: remaining > 0 ? 'partial' : 'available' })
    const group = materials.filter((entry) => entry.inventoryId === material.inventoryId)
    const groupPending = kg(group.reduce((total, entry) => total + (Number(entry.purchaseQuantity) || 0), 0))
    for (const entry of group) Object.assign(entry, { groupPurchaseQuantity: groupPending, groupStockStatus: groupPending > 0 ? 'partial' : 'available' })
    const summary = order.inventoryConsumption?.materials?.find((row) => row.inventoryId === material.inventoryId)
    if (summary) Object.assign(summary, { quantity: kg(group.reduce((total, entry) => total + Number(entry.quantity), 0)), consumedQuantity: kg(group.reduce((total, entry) => total + (Number(entry.inventoryConsumedQuantity) || 0), 0)), purchaseQuantity: groupPending, balance })
  }
}

export function orderMaterialPlan(materials, inventory) {
  const groups = new Map()
  for (const [index, material] of materials.entries()) {
    const quantity = Number(material.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) fail(400, `Quantidade inválida para ${material.name || 'o material'}.`)
    // Without the link, a material is matched by name among the ones counted in the same unit (kg, m, un or cj).
    const item = inventory.find((row) => material.inventoryId != null && String(row.id) === String(material.inventoryId))
      || inventory.find((row) => normalize(row.name) === normalize(material.name) && materialUnit(row.unit) === materialUnit(material.unit))
    const unit = materialUnit(item ? item.unit : material.unit)
    const key = item ? `inventory-${item.id}` : `new-${unit}-${normalize(material.name)}`
    if (!groups.has(key)) groups.set(key, { inventoryId: item?.id ?? null, name: item?.name || material.name, unit, quantity: 0, stockAvailable: Math.max(0, Number(item?.quantity) || 0), minimum: item?.minimum, unitPrice: Number(item?.unitPrice) || 0, materialIndexes: [] })
    const group = groups.get(key)
    group.quantity = kg(group.quantity + quantity)
    group.materialIndexes.push(index)
  }
  return [...groups.values()].map((group) => {
    const consumedQuantity = kg(Math.min(group.quantity, group.stockAvailable))
    return { ...group, consumedQuantity, purchaseQuantity: kg(group.quantity - consumedQuantity), balance: kg(group.stockAvailable - consumedQuantity) }
  })
}

export async function consumeOrderMaterials(connection, order, { allowPartial = false } = {}) {
  const materials = order.resources?.materials || []
  if (!materials.length) return []
  const [inventory] = await connection.execute('SELECT id, name, unit, quantity_kg AS quantity, minimum_kg AS minimum, unit_price AS unitPrice FROM inventory_materials ORDER BY id FOR UPDATE')
  const plan = orderMaterialPlan(materials, inventory)
  const shortages = plan.filter((row) => row.purchaseQuantity > 0)
  if (!allowPartial && shortages.length) fail(409, `Estoque insuficiente: ${shortages.map((row) => `${row.name}: faltam ${formatQuantity(row.purchaseQuantity, row.unit)}`).join('; ')}.`)
  const remaining = new Map(plan.map((row) => [row, row.stockAvailable]))
  order.resources = { ...order.resources, materials: materials.map((material, index) => {
    const group = plan.find((row) => row.materialIndexes.includes(index))
    const available = remaining.get(group)
    const consumed = kg(Math.min(available, Number(material.quantity)))
    remaining.set(group, kg(available - consumed))
    return {
      ...material, inventoryId: group.inventoryId, unit: group.unit, stockAvailable: available,
      stockStatus: group.inventoryId == null ? 'unknown' : available <= 0 ? 'missing' : available < Number(material.quantity) ? 'partial' : 'available',
      purchaseQuantity: kg(Number(material.quantity) - consumed), inventoryConsumedQuantity: consumed, inventoryConsumedCost: reais(consumed * (Number(group.unitPrice) || 0)),
      groupStockStatus: group.inventoryId == null ? 'unknown' : group.stockAvailable <= 0 ? 'missing' : group.purchaseQuantity > 0 ? 'partial' : 'available',
      groupPurchaseQuantity: group.purchaseQuantity,
    }
  }) }
  for (const row of plan) {
    if (!row.consumedQuantity) continue
    await connection.execute('UPDATE inventory_materials SET quantity_kg = ? WHERE id = ?', [row.balance, row.inventoryId])
    await connection.execute(
      `INSERT INTO inventory_movements
        (material_id, movement_type, quantity_kg, unit_price_kg, balance_after_kg, destination, order_code, notes)
       VALUES (?, 'exit', ?, ?, ?, ?, ?, ?)`,
      [row.inventoryId, row.consumedQuantity, row.unitPrice, row.balance, 'Utilizado na ordem de serviço', order.code, `${formatQuantity(row.quantity, row.unit)} necessários${row.purchaseQuantity ? `; ${formatQuantity(row.purchaseQuantity, row.unit)} pendentes de compra` : ''}.`],
    )
  }
  return plan
}
