// How a DRE report is shown, the same on the screen, in the PDF and in the spreadsheet. A single month is compared with
// the month before it; a period shows one column per month, the total and its share of the gross revenue.
const monthNames = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const fullMonthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const monthLabel = (month) => { const [year, number] = month.split('-'); return `${monthNames[Number(number) - 1]}/${year}` }
export const fullMonthLabel = (month) => { const [year, number] = month.split('-'); return `${fullMonthNames[Number(number) - 1]} de ${year}` }
export const periodLabel = (report) => report.start === report.end ? fullMonthLabel(report.start) : `${fullMonthLabel(report.start)} a ${fullMonthLabel(report.end)}`
export const viewLabels = { cash: 'Caixa', accrual: 'Competência' }
export const viewHints = { cash: 'Pela data do pagamento e do recebimento: entra só o que já foi pago ou recebido.', accrual: 'Pela data de emissão das contas, pagas ou não. Juros e descontos entram na data da baixa.' }
export const entrySourceLabels = { payable: 'Conta a pagar', receivable: 'Conta a receber', adjustment: 'Ajuste da DRE' }
export const entryKindLabels = { principal: 'Valor da conta', interest: 'Juros', discount: 'Desconto', iss: 'ISS retido', adjustment: 'Ajuste' }

export function dreColumns(report) {
  if (report.months.length === 1) return [{ key: 'previous', label: monthLabel(report.previousMonth), month: report.previousMonth }, { key: 'current', label: monthLabel(report.start), month: report.start }, { key: 'variation', label: 'Variação', type: 'variation' }, { key: 'percent', label: '% da receita', type: 'percent' }]
  return [...report.months.map((month) => ({ key: month, label: monthLabel(month), month })), { key: 'total', label: 'Total', type: 'total' }, { key: 'percent', label: '% da receita', type: 'percent' }]
}
// Change from the month before. Costs are compared by size, so an expense that grew shows a positive change; `good`
// says whether the change helps the result (null when nothing changed).
export function variation(row, current, previous) {
  if (!previous) return null
  const value = row.nature === 'expense' ? (Math.abs(current) - Math.abs(previous)) / Math.abs(previous) * 100 : (current - previous) / Math.abs(previous) * 100
  return { value, good: !value ? null : row.nature === 'expense' ? value < 0 : value > 0 }
}
export const monthBefore = (report, month) => { const index = report.months.indexOf(month); return index > 0 ? report.months[index - 1] : report.previousMonth }
export function dreCell(report, row, column) {
  if (column.month) return row.values[column.month]
  if (column.type === 'total') return row.total
  if (column.type === 'percent') return row.percent
  return variation(row, row.values[report.start], row.values[report.previousMonth])?.value ?? null
}
// Lines and group subtotals without any value in the columns are hidden unless asked; sections and results always show.
export function visibleDreRows(report, showZero = false) {
  const months = report.months.length === 1 ? [report.previousMonth, report.start] : report.months
  const filled = (row) => months.some((month) => row.values[month])
  return report.rows.filter((row) => showZero || ['section', 'result'].includes(row.type) || filled(row))
}
// The value of each month of a repeated adjustment: the first value changed by the monthly variation, month after month.
export const repeatedValues = (valueCents, count, variation) => Array.from({ length: count }, (_, index) => Math.round(valueCents * (1 + variation / 100) ** index))
export const changeTone = (change) => !change || change.good === null ? 'neutral' : change.good ? 'good' : 'bad'
export const percentText = (value) => value == null || !Number.isFinite(value) ? '—' : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
