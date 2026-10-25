import { todayBahia, shiftMonth, matchesSearch } from '../server/payableRules.js'

const DAY = 86400000
const day = (time) => new Date(time).toISOString().slice(0, 10)

// Cash book: every amount actually paid or received, posted in Tesouraria or settled in Contas a Pagar / Receber.
export function treasuryMovements(payables = [], receivables = []) {
  const movement = (row, type, settlement, name, document, origin) => ({ id: row.id, type, date: settlement.date, name, document: document || null, description: row.description || '', classification: row.classificationName || '', documentNumber: row.documentNumber || '', orderCode: row.orderCode || null, method: settlement.method, bankId: settlement.bankId || null, bankName: settlement.bankName || '', cents: settlement.finalCents, direct: Boolean(row.treasury), origin: row.treasury ? 'Tesouraria' : origin })
  return [
    ...payables.filter((row) => row.payment).map((row) => movement(row, 'out', row.payment, row.supplierName, row.supplierDocument, 'Contas a Pagar')),
    ...receivables.filter((row) => row.receipt).map((row) => movement(row, 'in', row.receipt, row.customerName, row.customerDocument, 'Contas a Receber')),
  ]
}

export function filterMovements(rows, filters = {}) {
  return rows.filter((row) => (!filters.start || row.date >= filters.start) && (!filters.end || row.date <= filters.end) && (!filters.direct || row.direct) && (!filters.bankId || row.bankId === filters.bankId)
    && matchesSearch({ id: row.id, supplierName: row.name, supplierDocument: row.document, description: `${row.description} ${row.classification} ${row.origin}`, documentNumber: row.documentNumber, orderCode: row.orderCode, valueCents: row.cents }, filters.search))
}

export function movementTotals(rows) {
  const entries = rows.filter((row) => row.type === 'in'), exits = rows.filter((row) => row.type === 'out')
  const sum = (list) => list.reduce((total, row) => total + row.cents, 0)
  return { inCents: sum(entries), inCount: entries.length, outCents: sum(exits), outCount: exits.length, balanceCents: sum(entries) - sum(exits) }
}

export function periodShortcuts(today = todayBahia()) {
  const first = `${today.slice(0, 7)}-01`, previous = shiftMonth(first, -1)
  const lastDay = (start) => day(Date.parse(shiftMonth(start, 1)) - DAY)
  return [['today', 'Hoje', today, today], ['week', 'Últimos 7 dias', day(Date.parse(today) - 6 * DAY), today], ['month', 'Este mês', first, lastDay(first)], ['previous', 'Mês passado', previous, lastDay(previous)], ['all', 'Todo o período', '', '']]
}
