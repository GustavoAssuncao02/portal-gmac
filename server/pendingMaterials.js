const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR')
const kg = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(Number(value).toFixed(3))) : 0

export function pendingOrderMaterials(order) {
  const groups = new Map()
  for (const material of order?.resources?.materials || []) {
    const pending = material.purchaseQuantity ?? (material.stockStatus === 'available' ? 0 : Number(material.quantity || 0) - Number(material.inventoryConsumedQuantity ?? material.stockAvailable ?? 0))
    const quantity = kg(pending)
    if (!quantity) continue
    const key = material.inventoryId != null ? `inventory-${material.inventoryId}` : `${normalize(material.name)}|${normalize(material.detail)}`
    if (!groups.has(key)) groups.set(key, { key, name: material.name || 'Material', detail: material.detail || '', quantity: 0 })
    const group = groups.get(key)
    group.quantity = kg(group.quantity + quantity)
  }
  return [...groups.values()]
}
