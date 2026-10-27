// Stock, offers and material requests count each material in kilos (kg, the original unit), in metres (m) or in units (un).
// The SQL columns keep the old names (quantity_kg, minimum_kg…) and hold the quantity in the unit of the material.
export const materialUnits = [['kg', 'Quilo (kg)'], ['m', 'Metro (m)'], ['un', 'Unidade (un)']]
export const materialUnit = (value) => value === 'un' || value === 'm' ? value : 'kg'
export const validMaterialUnit = (value) => materialUnits.some(([key]) => key === value)
export const formatQuantity = (quantity, unit) => `${Number(quantity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${materialUnit(unit)}`
export const unitPriceLabel = (unit) => ({ kg: 'Valor por kg', m: 'Valor por metro', un: 'Valor por unidade' })[materialUnit(unit)]
export const invalidUnitMessage = 'Escolha a unidade do material: quilo, metro ou unidade.'
// Units are counted whole; kilos and metres accept up to three decimals.
export const wholeUnit = (unit) => materialUnit(unit) === 'un'
export const quantityStep = (unit) => wholeUnit(unit) ? '1' : '0.001'
export const validQuantityFor = (quantity, unit) => Number.isFinite(Number(quantity)) && (!wholeUnit(unit) || Number.isInteger(Number(quantity)))
