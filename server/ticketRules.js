// Tickets de suporte: the options of the form, shared by the API (validation) and the screen (form, filters, charts).
// The modules are the main areas of the portal, as the menu groups them; "Outro" covers anything else.
export const ticketModules = [
  ['login', 'Login'],
  ['dashboard', 'Dashboard'],
  ['stock', 'Estoque'],
  ['material-requests', 'Pedidos de material'],
  ['calculator', 'Calculadora'],
  ['registrations', 'Cadastros'],
  ['operation', 'Operação'],
  ['finance', 'Gestão Financeira'],
  ['reports', 'Relatórios'],
  ['settings', 'Configurações'],
  ['operator', 'Painel do operador'],
  ['other', 'Outro'],
]
export const ticketUrgencies = [['low', 'Baixo'], ['medium', 'Médio'], ['high', 'Alto']]
export const ticketStatuses = [['open', 'Aberto'], ['closed', 'Fechado']]

const labelOf = (list, key) => list.find(([value]) => value === key)?.[1] || key
export const moduleLabel = (key) => labelOf(ticketModules, key)
export const urgencyLabel = (key) => labelOf(ticketUrgencies, key)
export const statusLabel = (key) => labelOf(ticketStatuses, key)

export const TITLE_MAX = 120
export const DESCRIPTION_MAX = 4000
export const RESOLUTION_MAX = 2000

// Month (YYYY-MM) of a moment in Bahia time, the time the portal shows.
export const bahiaMonth = (at) => new Date(Date.parse(at) - 3 * 3600000).toISOString().slice(0, 7)
export const bahiaDate = (at) => new Date(Date.parse(at) - 3 * 3600000).toISOString().slice(0, 10)

// Every month from `first` to `last` (YYYY-MM), both included.
export function monthRange(first, last) {
  const months = []
  let [year, month] = first.split('-').map(Number)
  const [endYear, endMonth] = last.split('-').map(Number)
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return months
}
