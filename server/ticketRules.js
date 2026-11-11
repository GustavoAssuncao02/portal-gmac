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
// The modules that are groups in the menu ask for the screen involved (the sub-module), in the order of the menu.
export const ticketSubmodules = {
  registrations: [['suppliers', 'Fornecedores'], ['admins', 'Administradores'], ['employees', 'Funcionários'], ['sectors', 'Setores'], ['clients', 'Clientes'], ['requesters', 'Solicitantes'], ['buyers', 'Compradores'], ['banks', 'Bancos'], ['pause-reasons', 'Razões de pausas']],
  operation: [['services-in-progress', 'Serviços em andamento'], ['completed-services', 'Serviços concluídos'], ['offers', 'Ofertas e serviços'], ['planning', 'Planejamento']],
  finance: [['payables', 'Contas a Pagar'], ['receivables', 'Contas a Receber'], ['treasury', 'Tesouraria'], ['cash-flow', 'Fluxo de caixa'], ['batch', 'Baixa em Lote'], ['bank', 'Conciliação bancária'], ['bi', 'Business Intelligence'], ['dre', 'DRE'], ['dre-adjustments', 'Ajustes da DRE'], ['account-groups', 'Grupos de contas'], ['classifications', 'Classificações']],
}
export const ticketUrgencies = [['low', 'Baixo'], ['medium', 'Médio'], ['high', 'Alto']]
export const ticketStatuses = [['open', 'Aberto'], ['closed', 'Fechado']]

const labelOf = (list, key) => list.find(([value]) => value === key)?.[1] || key
export const moduleLabel = (key) => labelOf(ticketModules, key)
export const submodulesOf = (module) => ticketSubmodules[module] || []
export const submoduleLabel = (module, key) => labelOf(submodulesOf(module), key)
// "Gestão Financeira › Contas a Pagar", or only the module when it has no sub-module.
export const moduleTitle = (module, submodule) => submodule ? `${moduleLabel(module)} › ${submoduleLabel(module, submodule)}` : moduleLabel(module)
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
