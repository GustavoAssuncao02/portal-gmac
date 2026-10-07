const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR')
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error }
const kg = (value) => Number(Number(value).toFixed(3))

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
  return { allocatedQuantity: quantity, balance, orderCode: order.code }
}

export function orderMaterialPlan(materials, inventory) {
  const groups = new Map()
  for (const [index, material] of materials.entries()) {
    const quantity = Number(material.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) fail(400, `Quantidade inválida para ${material.name || 'o material'}.`)
    const item = inventory.find((row) => material.inventoryId != null && String(row.id) === String(material.inventoryId))
      || inventory.find((row) => normalize(row.name) === normalize(material.name))
    const key = item ? `inventory-${item.id}` : `new-${normalize(material.name)}`
    if (!groups.has(key)) groups.set(key, { inventoryId: item?.id ?? null, name: item?.name || material.name, quantity: 0, stockAvailable: Math.max(0, Number(item?.quantity) || 0), minimum: item?.minimum, unitPrice: Number(item?.unitPrice) || 0, materialIndexes: [] })
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
  const [inventory] = await connection.execute('SELECT id, name, quantity_kg AS quantity, minimum_kg AS minimum, unit_price AS unitPrice FROM inventory_materials ORDER BY id FOR UPDATE')
  const plan = orderMaterialPlan(materials, inventory)
  const shortages = plan.filter((row) => row.purchaseQuantity > 0)
  if (!allowPartial && shortages.length) fail(409, `Estoque insuficiente: ${shortages.map((row) => `${row.name}: faltam ${row.purchaseQuantity.toLocaleString('pt-BR')} kg`).join('; ')}.`)
  const remaining = new Map(plan.map((row) => [row, row.stockAvailable]))
  order.resources = { ...order.resources, materials: materials.map((material, index) => {
    const group = plan.find((row) => row.materialIndexes.includes(index))
    const available = remaining.get(group)
    const consumed = kg(Math.min(available, Number(material.quantity)))
    remaining.set(group, kg(available - consumed))
    return {
      ...material, inventoryId: group.inventoryId, stockAvailable: available,
      stockStatus: group.inventoryId == null ? 'unknown' : available <= 0 ? 'missing' : available < Number(material.quantity) ? 'partial' : 'available',
      purchaseQuantity: kg(Number(material.quantity) - consumed), inventoryConsumedQuantity: consumed,
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
      [row.inventoryId, row.consumedQuantity, row.unitPrice, row.balance, 'Utilizado na ordem de serviço', order.code, `${row.quantity.toLocaleString('pt-BR')} kg necessários${row.purchaseQuantity ? `; ${row.purchaseQuantity.toLocaleString('pt-BR')} kg pendentes de compra` : ''}.`],
    )
  }
  return plan
}
