import { todayBahia, shiftMonth } from '../server/payableRules.js'

export const MONTHS = 6
const open = (row) => !row.receipt && !row.inactive
const net = (row) => row.valueCents - (row.issCents || 0)

// What is still to be received, before and after the ISS the customers will withhold, by month of expected receipt.
export function receivableForecast(rows, today = todayBahia()) {
  const current = `${today.slice(0, 7)}-01`
  const months = Array.from({ length: MONTHS }, (_, index) => shiftMonth(current, index).slice(0, 7))
  const pending = rows.filter(open)
  return {
    gross: pending.reduce((sum, row) => sum + row.valueCents, 0),
    iss: pending.reduce((sum, row) => sum + (row.issCents || 0), 0),
    net: pending.reduce((sum, row) => sum + net(row), 0),
    overdue: pending.filter((row) => row.dueDate < today).reduce((sum, row) => sum + row.valueCents, 0),
    months: months.map((month) => {
      const inMonth = pending.filter((row) => row.dueDate?.startsWith(month) && row.dueDate >= today)
      return { month, gross: inMonth.reduce((sum, row) => sum + row.valueCents, 0), net: inMonth.reduce((sum, row) => sum + net(row), 0) }
    }),
  }
}
