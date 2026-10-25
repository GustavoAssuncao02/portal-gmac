// Stock, offers and material requests count each material in kilos (kg, the original unit) or in units (un).
// The SQL columns keep the old names (quantity_kg, minimum_kg…) and hold the quantity in the unit of the material.
export const materialUnits = [['kg', 'Quilo (kg)'], ['un', 'Unidade (un)']]
export const materialUnit = (value) => value === 'un' ? 'un' : 'kg'
export const validMaterialUnit = (value) => value === 'kg' || value === 'un'
export const formatQuantity = (quantity, unit) => `${Number(quantity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${materialUnit(unit)}`
export const unitPriceLabel = (unit) => materialUnit(unit) === 'un' ? 'Valor por unidade' : 'Valor por kg'
// Units are counted whole; kilos accept up to three decimals.
export const validQuantityFor = (quantity, unit) => Number.isFinite(Number(quantity)) && (materialUnit(unit) === 'kg' || Number.isInteger(Number(quantity)))
