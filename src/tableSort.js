// Text of a ready cell, sorted as what it is: 1.234,56 and R$ 1.234,56 as numbers, 31/12/2026 as a date.
export function cellValue(value) {
  if (typeof value !== 'string') return value
  const text = value.trim(), date = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (date) return `${date[3]}-${date[2]}-${date[1]}${text.slice(10)}`
  return /^-?(R\$\s*)?\d[\d.]*(,\d+)?$/.test(text) ? Number(text.replace(/R\$\s*/, '').replaceAll('.', '').replace(',', '.')) : text
}
