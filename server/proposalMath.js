// Totals of the proposal documents, shared by the server (PDF) and the form in the browser.
export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100
const sum = (values) => round2(values.reduce((total, value) => total + value, 0))

export const situationLabels = { normal: 'Normal', night: 'Noturna', holiday: 'Feriado' }
export const situationNames = { normal: 'Normal', night: 'Noturna semanal e sábados', holiday: 'Domingos e feriados' }

// The "Variante" column: the rate of the situation chosen for the line.
export const rateFor = (row) => Number(row[row.situation] ?? row.normal) || 0

export function tableTotals(document) {
  const labor = (document.labor || []).map((row) => round2((Number(row.quantity) || 0) * rateFor(row)))
  const materials = (document.materials || []).map((row) => round2((Number(row.quantity) || 0) * (Number(row.price) || 0)))
  const place = document.freight?.places?.find((item) => item.name === document.freight.place)
  const freight = document.freight?.charge && place ? round2(place.value) : 0
  const laborTotal = sum(labor), materialsTotal = sum(materials)
  return { labor, materials, laborTotal, materialsTotal, freight, total: round2(laborTotal + materialsTotal + freight) }
}

export const itemTotal = (item) => round2((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))
export const letterTotal = (document) => sum((document.items || []).map(itemTotal))
