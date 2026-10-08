import { todayBahia, shiftMonth } from '../server/payableRules.js'

// Shared by Contas a Pagar and Contas a Receber: settled rows count what was actually paid or received.
export const amountOf = (row) => row.payment ? row.payment.finalCents : row.receipt ? row.receipt.finalCents : row.valueCents
export const sumOf = (rows) => rows.reduce((total, row) => total + amountOf(row), 0)
export function dueShortcuts(today = todayBahia()) {
  const first = `${today.slice(0, 7)}-01`, last = new Date(Date.parse(shiftMonth(first, 1)) - 86400000).toISOString().slice(0, 10)
  const week = new Date(Date.parse(today) + 6 * 86400000).toISOString().slice(0, 10)
  return [['today', 'Vence hoje', today, today], ['week', 'Próximos 7 dias', today, week], ['month', 'Este mês', first, last]]
}
