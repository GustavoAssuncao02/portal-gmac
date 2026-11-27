// Início personalizado: the widgets each account can place on its home screen, shared by the API (validation of the
// saved layout) and the screen (catalog, sizes, defaults). A layout is a list of { id, w, h, period? }: the widget, its width in
// quarters of the row (1 to 4) and its height in rows (1 or 2). Each widget appears at most once.
//
// `finance` widgets show Gestão Financeira data: administrative employees (role "staff") have no access to it, so the
// catalog hides them and a saved layout never keeps them for such an account.

export const homeModules = [
  ['dashboard', 'Início'],
  ['operation', 'Operação'],
  ['operational', 'Gestão Operacional'],
  ['finance', 'Gestão Financeira'],
  ['admin-stock', 'Estoque Administrativo'],
  ['calculator', 'Calculadora'],
  ['registrations', 'Cadastros'],
  ['reports', 'Relatórios'],
  ['settings', 'Configurações'],
  ['notes', 'Anotações e Tarefas'],
]

// widths: the sizes the widget accepts (quarters of the row); w/h: its size when added. tall: it may take two rows.
// periods: the widget has a period of its own (Contas a pagar / a receber), saved in its entry of the layout.
const widget = (id, module, title, description, { widths = [1, 2], w = widths[0], h = 1, tall = false, finance = false, periods = false } = {}) => ({ id, module, title, description, widths, w, h, tall, finance, periods })

// Period of "Total em aberto" / "Total a receber": what is overdue plus what falls due up to so many months ahead, or
// everything ('all'). The default (12 months) is not written in the layout.
export const homePeriods = [1, 3, 6, 12, 24, 'all']
export const DEFAULT_HOME_PERIOD = 12

export const homeWidgets = [
  widget('quick-access', 'dashboard', 'Acesso rápido', 'Botões para as telas mais usadas do portal.', { widths: [1, 2, 4], w: 2 }),

  widget('operation-summary', 'operation', 'Resumo da operação', 'OS em aberto, em execução, atrasadas e ofertas em análise.', { widths: [2, 4], w: 4 }),
  widget('open-orders', 'operation', 'OS em aberto', 'Lista das ordens de serviço abertas, pelo prazo de entrega.', { widths: [2, 3, 4], w: 3, h: 2, tall: true }),
  widget('late-orders', 'operation', 'OS atrasadas', 'As ordens de serviço que passaram do prazo de entrega.', { widths: [1, 2, 3], w: 2, tall: true }),
  widget('upcoming-deliveries', 'operation', 'Próximas entregas', 'As 5 OS abertas de entrega mais próxima, a partir de hoje, e quantas estão atrasadas.', { widths: [1, 2, 3], w: 2, tall: true }),
  widget('deadline-health', 'operation', 'Prazos das OS', 'Quantas OS estão dentro do prazo, perto dele ou atrasadas.', { widths: [1, 2], w: 2 }),
  widget('order-status', 'operation', 'OS por situação', 'Aguardando, em execução, pausadas, etapa concluída e finalizando.', { widths: [1, 2], w: 2 }),
  widget('offer-pipeline', 'operation', 'Funil de ofertas', 'Ofertas em criação, em análise, com proposta, aceitas e recusadas.', { widths: [1, 2, 4], w: 2 }),
  widget('management-attention', 'operation', 'Atenção da gestão', 'Pedidos de material e OS concluídas aguardando confirmação.', { widths: [2, 4], w: 4 }),
  widget('recent-completed', 'operation', 'Concluídas recentemente', 'As últimas ordens de serviço finalizadas.', { widths: [1, 2, 3], w: 2, tall: true }),

  widget('low-stock', 'operational', 'Estoque baixo', 'Materiais da fábrica abaixo do mínimo.', { widths: [1, 2], w: 1, tall: true }),
  widget('machines-now', 'operational', 'Máquinas agora', 'Máquinas em funcionamento, ociosas e em manutenção, com o operador.', { widths: [1, 2, 3], w: 2, tall: true }),
  widget('idle-operators', 'operational', 'Operadores sem serviço', 'Quem está sem OS aberta agora e desde quando.', { widths: [1, 2], w: 1, tall: true }),
  widget('machine-usage-today', 'operational', 'Uso das máquinas hoje', 'Horas de uso de cada máquina desde a meia-noite.', { widths: [1, 2, 3], w: 2, tall: true }),
  widget('material-requests', 'operational', 'Pedidos de material', 'Materiais a comprar para as ofertas e OS.', { widths: [1, 2, 3], w: 2, tall: true }),
  widget('stock-value', 'operational', 'Valor do estoque', 'Valor total, materiais cadastrados, zerados e abaixo do mínimo.', { widths: [1, 2], w: 1 }),

  widget('payables-summary', 'finance', 'Contas a pagar', 'Total em aberto, vencidas, vencem hoje e próximos 7 dias.', { widths: [2, 4], w: 4, finance: true, periods: true }),
  widget('receivables-summary', 'finance', 'Contas a receber', 'Total a receber, vencidas, vencem hoje e próximos 7 dias.', { widths: [2, 4], w: 4, finance: true, periods: true }),
  widget('month-cash', 'finance', 'Caixa do mês', 'Entradas, saídas e saldo do mês, comparados ao mês passado.', { widths: [1, 2, 4], w: 2, finance: true }),
  widget('week-cash-flow', 'finance', 'Fluxo de caixa da semana', 'Entradas e saídas de cada dia da semana atual.', { widths: [2, 3, 4], w: 2, finance: true }),
  widget('upcoming-payments', 'finance', 'Próximos pagamentos', 'Contas a pagar vencidas e as próximas a vencer.', { widths: [1, 2, 3], w: 2, tall: true, finance: true }),
  widget('upcoming-receipts', 'finance', 'Próximos recebimentos', 'Contas a receber vencidas e as próximas a vencer.', { widths: [1, 2, 3], w: 2, tall: true, finance: true }),
  widget('overdue-customers', 'finance', 'Clientes em atraso', 'Quem deve recebimentos vencidos e quanto.', { widths: [1, 2], w: 2, tall: true, finance: true }),
  widget('receivable-forecast', 'finance', 'Previsão de recebimentos', 'O que entra nos próximos 6 meses, antes e depois do ISS.', { widths: [2, 3, 4], w: 2, finance: true }),
  widget('month-expenses', 'finance', 'Despesas do mês', 'O que foi pago no mês, pelas classificações que mais pesaram.', { widths: [1, 2, 3], w: 2, tall: true, finance: true }),

  widget('admin-low-stock', 'admin-stock', 'Estoque administrativo baixo', 'Materiais do escritório, limpeza e copa abaixo do mínimo.', { widths: [1, 2], w: 1, tall: true }),
  widget('admin-stock-summary', 'admin-stock', 'Resumo do estoque administrativo', 'Itens, abaixo do mínimo, zerados e valor em estoque.', { widths: [1, 2], w: 1 }),
  widget('admin-stock-exits', 'admin-stock', 'Últimas baixas administrativas', 'O que saiu do estoque administrativo, por quem e para onde.', { widths: [1, 2, 3], w: 2, tall: true }),

  widget('calculator-shortcut', 'calculator', 'Atalho da calculadora', 'Abre a Calculadora de pesos e medidas.', { widths: [1, 2], w: 1 }),
  widget('quick-calculator', 'calculator', 'Calculadora rápida', 'Peso por metro ou por peça sem sair do Início.', { widths: [1, 2], w: 1, tall: true }),
  widget('inch-converter', 'calculator', 'Conversor de polegadas', 'Polegadas para milímetros pela tabela da calculadora.', { widths: [1, 2], w: 1 }),

  widget('registry-shortcuts', 'registrations', 'Atalhos de cadastro', 'Clientes, fornecedores, funcionários, solicitantes e mais.', { widths: [1, 2, 4], w: 2 }),
  widget('top-clients', 'registrations', 'Principais clientes', 'Os clientes com mais ordens de serviço no ano.', { widths: [1, 2], w: 2, tall: true }),
  widget('team-overview', 'registrations', 'Equipe', 'Funcionários ativos, operadores, administrativos e administradores.', { widths: [1, 2], w: 1 }),
  widget('birthdays', 'registrations', 'Aniversariantes do mês', 'Funcionários e administradores que fazem aniversário no mês.', { widths: [1, 2], w: 1, tall: true }),

  widget('reports-shortcut', 'reports', 'Relatórios', 'Abre os relatórios de produção, máquinas e funcionários.', { widths: [1, 2], w: 1 }),
  widget('month-production', 'reports', 'Produção do mês', 'OS concluídas e abertas no mês, comparadas ao mês passado.', { widths: [1, 2, 4], w: 2 }),
  widget('machine-usage-month', 'reports', 'Uso das máquinas no mês', 'Aproveitamento das máquinas, a mais usada e a mais ociosa.', { widths: [1, 2], w: 2 }),

  widget('support-tickets', 'settings', 'Tickets de suporte', 'Chamados abertos e os mais recentes.', { widths: [1, 2], w: 1, tall: true }),
  widget('release-notes', 'settings', 'Novidades do portal', 'O que mudou na última versão.', { widths: [1, 2, 3], w: 2, tall: true }),
  widget('appearance', 'settings', 'Aparência', 'Troque entre claro, escuro e escuro intenso.', { widths: [1, 2], w: 1 }),

  widget('my-tasks', 'notes', 'Minhas tarefas', 'Tarefas atrasadas, de hoje e dos próximos dias, para concluir sem sair do Início.', { widths: [1, 2, 3], w: 2, tall: true }),
  widget('recent-notes', 'notes', 'Anotações recentes', 'As últimas anotações, as fixadas primeiro.', { widths: [1, 2, 3], w: 2, tall: true }),
  widget('quick-note', 'notes', 'Anotação rápida', 'Crie uma anotação ou tarefa sem sair do Início.', { widths: [1, 2], w: 1 }),
  widget('note-invites', 'notes', 'Convites pendentes', 'Convites para anotações e tarefas compartilhadas: aceite ou recuse.', { widths: [1, 2], w: 1, tall: true }),
]

const byId = new Map(homeWidgets.map((item) => [item.id, item]))
export const homeWidget = (id) => byId.get(id) || null
export const MAX_HOME_WIDGETS = homeWidgets.length

// The home screen as it was before it became customizable: the default of every account (and "Restaurar padrão").
const fullDefault = [
  { id: 'operation-summary', w: 4, h: 1 },
  { id: 'payables-summary', w: 4, h: 1 },
  { id: 'open-orders', w: 3, h: 2 },
  { id: 'low-stock', w: 1, h: 1 },
  { id: 'calculator-shortcut', w: 1, h: 1 },
  { id: 'management-attention', w: 4, h: 1 },
]
export const widgetAllowed = (item, role) => Boolean(item) && !(item.finance && role === 'staff')
export const defaultHomeLayout = (role) => fullDefault.filter((entry) => widgetAllowed(homeWidget(entry.id), role)).map((entry) => ({ ...entry }))

// A saved layout as the screen can draw it: unknown or forbidden widgets and repeats leave, sizes outside what the
// widget accepts come back to its nearest one. `null` (nothing saved) is the default layout.
export function normalizeHomeLayout(layout, role) {
  if (!Array.isArray(layout)) return defaultHomeLayout(role)
  const seen = new Set(), result = []
  for (const entry of layout) {
    const item = homeWidget(entry?.id)
    if (!widgetAllowed(item, role) || seen.has(item.id)) continue
    seen.add(item.id)
    const width = Number(entry.w)
    const w = item.widths.includes(width) ? width : item.widths.reduce((best, option) => Math.abs(option - width) < Math.abs(best - width) ? option : best, item.w)
    const period = item.periods && homePeriods.includes(entry.period) && entry.period !== DEFAULT_HOME_PERIOD ? { period: entry.period } : {}
    result.push({ id: item.id, w, h: item.tall && Number(entry.h) === 2 ? 2 : 1, ...period })
  }
  return result
}

// What the API accepts to save: a list of known widgets, without repeats, with valid sizes. Anything else is refused
// (the screen only sends what it built from the catalog), so a broken request never erases the person's layout.
export function validHomeLayout(layout, role) {
  if (!Array.isArray(layout) || layout.length > MAX_HOME_WIDGETS) return false
  const seen = new Set()
  for (const entry of layout) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const item = homeWidget(entry.id)
    if (!widgetAllowed(item, role) || seen.has(item.id)) return false
    if (!item.widths.includes(entry.w) || ![1, 2].includes(entry.h) || entry.h === 2 && !item.tall) return false
    if (entry.period !== undefined && !(item.periods && homePeriods.includes(entry.period))) return false
    seen.add(item.id)
  }
  return true
}
