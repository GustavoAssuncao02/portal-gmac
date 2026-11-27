import { useState } from 'react'
import { Archive, ArrowUpRight, Banknote, Boxes, Building2, Cake, Calculator, CalendarClock, CalendarDays, ChartColumn, CircleCheck, CirclePlay, ClipboardList, Clock, Contact, CreditCard, Factory, FileText, Funnel, Gauge, HandCoins, Hourglass, Landmark, LayoutGrid, LifeBuoy, Moon, Package, PackageMinus, Palette, Receipt, RefreshCw, Ruler, ShoppingCart, Sparkles, Sun, Timer, TrendingDown, TrendingUp, TriangleAlert, UserCog, UserRoundX, Users, Wallet, Wrench } from 'lucide-react'
import { payableOverview, receivableOverview } from './adminOverview.js'
import { money } from './payablesApi.js'
import { formatQuantity } from '../server/materialUnits.js'
import { SortableRows, SortHeader } from './RegistryList.jsx'
import { purchaseMaterialRequests } from './offerResources.js'
import { treasuryMovements } from './treasuryMovements.js'
import { cashFlowBuckets, cashFlowPeriod, classificationShares, totalsOf, changeOf, addDays } from './cashFlow.js'
import { receivableForecast } from './receivableForecast.js'
import { daysUntil, dueLabel, shiftMonth } from '../server/payableRules.js'
import { calculatorFormats, calculatorMaterials, calculatorWeight, conversionOptions } from './calculatorData.js'
import { currentVersion, releaseNotes } from './releaseNotes.js'
import { DEFAULT_HOME_PERIOD, homePeriods } from '../server/homeWidgets.js'
import { saveListState } from './savedListState.js'
import { useAccountAppearance } from './accountTheme.js'

// The widgets of the Início (catalog in server/homeWidgets.js). Each one receives `ctx` (the portal data, the sources
// read for the home screen and the navigation) and `size` ({ w, h }: quarters of the row and rows), and shows more or
// less according to the space it was given.

export const number = (value) => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const operationLabels = { waiting: 'Aguardando', running: 'Em execução', paused: 'Pausado', stage_done: 'Etapa concluída', finalizing: 'Finalizando' }
const displayDate = (value) => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : 'America/Bahia' }) : 'Não informado'
const shortDate = (date) => date ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : ''
const monthNames = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const monthLabel = (month) => `${monthNames[Number(month.slice(5, 7)) - 1]}/${month.slice(2, 4)}`
const fullMonth = (now) => new Date(now).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia', month: 'long' })
const timeLabel = (value) => new Date(value).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' })
const plural = (count, one, many) => `${number(count)} ${count === 1 ? one : many}`
const hours = (ms) => { const minutes = Math.round((ms || 0) / 60000), h = Math.floor(minutes / 60), m = minutes % 60; return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min` }
const percent = (value) => `${Math.round(value * 100)}%`
const localDay = (value) => new Date(value).toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
const completedAt = (order) => [order.operation?.completedAt, order.operation?.completionAcknowledgedAt].map((value) => Date.parse(value)).find(Number.isFinite)
const isActive = (item) => item.active !== false && Number(item.active) !== 0
const changeText = (change) => change === null || !Number.isFinite(change) ? 'sem comparação' : `${change >= 0 ? '+' : ''}${Math.round(change)}% vs. mês passado`

function openPayable(ctx, id) { sessionStorage.setItem('gmac-payable-open', id); ctx.onNavigate('Contas a Pagar'); window.dispatchEvent(new CustomEvent('gmac-payable-open', { detail: id })) }
function openReceivable(ctx, id) { sessionStorage.setItem('gmac-receivable-open', id); ctx.onNavigate('Contas a Receber'); window.dispatchEvent(new CustomEvent('gmac-receivable-open', { detail: id })) }
// Contas a Receber opens on the accounts of the card: the screen keeps its filters in the list state, so they are written
// there before it opens (the other filters go back to empty, as in Contas a Pagar).
function openReceivables(ctx, filters) {
  saveListState('receivables', 'filters', { search: '', clientId: '', classificationId: '', bankId: '', kind: '', status: '', start: '', end: '', ...filters })
  saveListState('receivables', 'advanced', Boolean(filters.start || filters.end))
  saveListState('receivables', 'page', 1)
  ctx.onNavigate('Contas a Receber')
}
function openTicket(ctx, id) { sessionStorage.setItem('gmac-ticket-open', id); ctx.onNavigate('Ticket'); window.dispatchEvent(new CustomEvent('gmac-ticket-open', { detail: id })) }

const Expand = () => <ArrowUpRight className="icon" aria-hidden="true" strokeWidth={1.7} />

// The frame of the new widgets: icon, title, a line under it and the link to the screen it summarizes.
function Card({ icon: Icon, tone = 'blue', title, subtitle, action, className = '', children }) {
  return <section className={`home-card home-card--${tone} ${className}`}>
    <header className="home-card-heading">
      {Icon && <span className="home-card-icon"><Icon className="icon" aria-hidden="true" strokeWidth={1.7} /></span>}
      <div><h2>{title}</h2>{subtitle && <span>{subtitle}</span>}</div>
      {action && <button className="home-text-button" type="button" onClick={action.onClick}>{action.label}<Expand /></button>}
    </header>
    <div className="home-card-body">{children}</div>
  </section>
}
const Empty = ({ children }) => <p className="home-card-empty">{children}</p>
// Loading first, then the error (keeping the last data when there is some), then the content.
function SourceState({ source, children, empty }) {
  if (source.loading && source.data === null) return <Empty>Carregando...</Empty>
  if (source.data === null) return <Empty>{source.error || 'Dados indisponíveis no momento.'}</Empty>
  return <>{source.error && <p className="home-card-stale">{source.error}</p>}{empty ? <Empty>{empty}</Empty> : children}</>
}
// Horizontal bars, each relative to the largest value.
function Bars({ rows, onSelect }) {
  const max = Math.max(1, ...rows.map((row) => row.value))
  return <ul className="home-bars">{rows.map((row) => {
    const content = <><span className="home-bars-label"><span>{row.label}</span><strong>{row.display ?? number(row.value)}</strong></span><span className="home-bars-track"><span className={`home-bars-fill home-bars-fill--${row.tone || 'blue'}`} style={{ width: `${row.value > 0 ? Math.max(3, row.value / max * 100) : 0}%` }} /></span></>
    return <li key={row.key}>{onSelect ? <button type="button" onClick={() => onSelect(row)}>{content}</button> : <div>{content}</div>}</li>
  })}</ul>
}
function Stats({ items, columns }) {
  return <div className="home-stats" style={columns ? { '--home-stat-columns': columns } : undefined}>{items.map((item) => <div className={`home-stat home-stat--${item.tone || 'plain'}`} key={item.label}><span>{item.label}</span><strong>{item.value}</strong>{item.hint && <small>{item.hint}</small>}</div>)}</div>
}
// A list of rows that open something: title, a line under it and a value on the right.
function Rows({ rows, onSelect }) {
  return <ul className="home-rows">{rows.map((row) => {
    const content = <><span className="home-rows-main"><strong>{row.title}</strong>{row.detail && <small>{row.detail}</small>}</span>{row.value !== undefined && <span className={`home-rows-value home-rows-value--${row.tone || 'plain'}`}>{row.value}{row.valueDetail && <small>{row.valueDetail}</small>}</span>}</>
    return <li key={row.key}>{onSelect ? <button type="button" onClick={() => onSelect(row)}>{content}</button> : <div>{content}</div>}</li>
  })}</ul>
}
const rowLimit = (size, short, tall) => size.h === 2 ? tall : short

// ——— Início ———
const quickPages = [['Ofertas e serviços', 'Ofertas e serviços', FileText], ['Serviços em andamento', 'Serviços em andamento', ClipboardList], ['Planejamento', 'Planejamento', CalendarDays], ['Máquinas', 'Máquinas', Factory], ['Estoque', 'Estoque', Package], ['Pedidos', 'Pedidos de material', ShoppingCart], ['Contas a Pagar', 'Contas a Pagar', CreditCard, true], ['Contas a Receber', 'Contas a Receber', HandCoins, true], ['Relatórios', 'Relatórios', ChartColumn]]
function QuickAccess({ ctx }) {
  return <Card icon={LayoutGrid} title="Acesso rápido" subtitle="Telas mais usadas">
    <div className="home-shortcuts">{quickPages.filter(([, , , finance]) => !finance || !ctx.staff).map(([page, label, Icon]) => <button type="button" key={page} onClick={() => ctx.onNavigate(page)}><Icon className="icon" aria-hidden="true" strokeWidth={1.7} /><span>{label}</span></button>)}</div>
  </Card>
}

// ——— Operação ———
function OperationSummary({ ctx }) {
  const { summary, workflowLoading } = ctx
  return <section className="home-metrics" aria-label="Resumo da operação">{[
    ['OS em aberto', summary.openOrders.length, ClipboardList, 'blue', 'Serviços em andamento'], ['Em execução', summary.running, CirclePlay, 'green', 'Serviços em andamento'], ['OS atrasadas', summary.late, TriangleAlert, 'red', 'Serviços em andamento'], ['Ofertas em análise', summary.reviewing, FileText, 'amber', 'Ofertas e serviços'],
  ].map(([label, value, Icon, tone, page]) => <button className={`home-metric home-metric--${tone}`} type="button" key={label} onClick={() => ctx.onNavigate(page)}><span className="home-metric-icon"><Icon className="icon" aria-hidden="true" strokeWidth={1.7} /></span><div><span>{label}</span><strong>{workflowLoading ? '—' : number(value)}</strong></div></button>)}</section>
}

function OpenOrders({ ctx, size }) {
  const { summary, workflowLoading, workflowError } = ctx
  const limit = rowLimit(size, 4, 6)
  return <section className="home-orders" aria-labelledby="home-orders-title"><div className="home-section-heading"><div><h2 id="home-orders-title">OS em aberto</h2><span>{workflowLoading ? 'Carregando...' : plural(summary.openOrders.length, 'ordem de serviço', 'ordens de serviço')}</span></div><button className="home-text-button" type="button" onClick={() => ctx.onNavigate('Serviços em andamento')}>Ver todas<Expand /></button></div>
    <div className="home-orders-scroll"><SortableRows rows={summary.openOrders.slice(0, limit)} columns={[{ key: 'OS / Projeto', label: 'OS / Projeto', value: (order) => order.service }, { key: 'Prazo de entrega', label: 'Prazo de entrega', value: (order) => order.deliveryTimestamp, numeric: true }, { key: 'Tempo restante', label: 'Tempo restante', value: (order) => order.deliveryTimestamp, numeric: true }, { key: 'Status', label: 'Status', value: (order) => order.due.label }]}>{(sorted) => <table><thead><tr><SortHeader column={sorted.columns[0]} list={sorted} /><SortHeader column={sorted.columns[1]} list={sorted} /><SortHeader column={sorted.columns[2]} list={sorted} /><SortHeader column={sorted.columns[3]} list={sorted} /></tr></thead><tbody>{!workflowLoading && sorted.rows.map((order) => <tr key={order.code}><td data-label="OS / Projeto"><button className="home-order-link" type="button" onClick={() => ctx.onSelectOrder(order.code)}><strong>{order.service}</strong><span>{order.code} <span aria-hidden="true">·</span> {order.company}</span></button></td><td data-label="Prazo de entrega">{Number.isFinite(order.deliveryTimestamp) ? displayDate(order.deliveryDeadline) : 'Não informado'}</td><td data-label="Tempo restante" className={order.due.key === 'late' ? 'home-overdue' : ''}>{order.due.remaining}</td><td data-label="Status"><span className={`home-due home-due--${order.due.key}`}>{order.due.label}</span><small className="home-operation-state">{operationLabels[order.operation?.status] || 'Aguardando'}</small></td></tr>)}</tbody></table>}</SortableRows></div>
    {workflowLoading ? <p className="home-empty" role="status">Carregando ordens de serviço...</p> : !summary.openOrders.length && <p className="home-empty">{workflowError ? 'Ordens de serviço indisponíveis no momento.' : 'Nenhuma OS em aberto.'}</p>}
    {summary.openOrders.length > limit && <button className="home-more-orders" type="button" onClick={() => ctx.onNavigate('Serviços em andamento')}>Ver mais {number(summary.openOrders.length - limit)} ordens de serviço<Expand /></button>}
  </section>
}

function LateOrders({ ctx, size }) {
  const late = ctx.summary.openOrders.filter((order) => order.due.key === 'late')
  const limit = rowLimit(size, 4, 8)
  return <Card icon={TriangleAlert} tone="red" title="OS atrasadas" subtitle={ctx.workflowLoading ? 'Carregando...' : plural(late.length, 'ordem de serviço', 'ordens de serviço')} action={{ label: 'Ver todas', onClick: () => ctx.onNavigate('Serviços em andamento') }}>
    {ctx.workflowLoading ? <Empty>Carregando...</Empty> : !late.length ? <Empty>Nenhuma OS atrasada.</Empty> : <>
      <Rows rows={late.slice(0, limit).map((order) => ({ key: order.code, title: order.service, detail: `${order.code} · ${order.company || 'Cliente não informado'}`, value: order.due.remaining, valueDetail: `Prazo ${displayDate(order.deliveryDeadline)}`, tone: 'red' }))} onSelect={(row) => ctx.onSelectOrder(row.key)} />
      {late.length > limit && <p className="home-card-more">e mais {plural(late.length - limit, 'OS atrasada', 'OS atrasadas')}</p>}
    </>}
  </Card>
}

const deadlineRows = [['on-time', 'Dentro do prazo', 'green'], ['soon', 'Próximo do prazo', 'amber'], ['at-deadline', 'Em cima do prazo', 'orange'], ['late', 'Atrasadas', 'red'], ['unknown', 'Sem previsão', 'gray']]
function DeadlineHealth({ ctx }) {
  const open = ctx.summary.openOrders
  const late = open.filter((order) => order.due.key === 'late').length
  return <Card icon={Hourglass} tone="amber" title="Prazos das OS" subtitle={ctx.workflowLoading ? 'Carregando...' : open.length ? `${percent((open.length - late) / open.length)} dentro do prazo ou a caminho` : 'Nenhuma OS em aberto'} action={{ label: 'Ver OS', onClick: () => ctx.onNavigate('Serviços em andamento') }}>
    {ctx.workflowLoading ? <Empty>Carregando...</Empty> : <Bars rows={deadlineRows.map(([key, label, tone]) => ({ key, label, tone, value: open.filter((order) => order.due.key === key).length }))} />}
  </Card>
}

const statusRows = [['waiting', 'Aguardando', 'gray'], ['running', 'Em execução', 'green'], ['paused', 'Pausadas', 'amber'], ['stage_done', 'Etapa concluída', 'blue'], ['finalizing', 'Finalizando', 'teal']]
function OrderStatus({ ctx }) {
  const open = ctx.summary.openOrders
  return <Card icon={ClipboardList} title="OS por situação" subtitle={ctx.workflowLoading ? 'Carregando...' : plural(open.length, 'OS em aberto', 'OS em aberto')} action={{ label: 'Ver OS', onClick: () => ctx.onNavigate('Serviços em andamento') }}>
    {ctx.workflowLoading ? <Empty>Carregando...</Empty> : <Bars rows={statusRows.map(([key, label, tone]) => ({ key, label, tone, value: open.filter((order) => (order.operation?.status || 'waiting') === key).length }))} />}
  </Card>
}

function OfferPipeline({ ctx, size }) {
  const offers = ctx.offers
  const count = (match) => offers.filter(match).length
  const accepted = count((offer) => offer.status === 'accepted'), rejected = count((offer) => offer.status === 'rejected')
  const rows = [['creating', 'Em criação', 'gray', (offer) => offer.status === 'creating'], ['review', 'Em análise', 'amber', (offer) => offer.status === 'review' && !offer.orderCode], ['proposed', 'Propostas enviadas', 'blue', (offer) => offer.status === 'proposed'], ['accepted', 'Aceitas', 'green', (offer) => offer.status === 'accepted'], ['rejected', 'Recusadas', 'red', (offer) => offer.status === 'rejected']]
  return <Card icon={Funnel} tone="amber" title="Funil de ofertas" subtitle={accepted + rejected ? `${percent(accepted / (accepted + rejected))} das propostas respondidas foram aceitas` : 'Nenhuma proposta respondida ainda'} action={{ label: 'Ver ofertas', onClick: () => ctx.onNavigate('Ofertas e serviços') }}>
    {ctx.workflowLoading ? <Empty>Carregando...</Empty> : size.w >= 4 ? <Stats columns={5} items={rows.map(([key, label, tone, match]) => ({ label, value: number(count(match)), tone }))} /> : <Bars rows={rows.map(([key, label, tone, match]) => ({ key, label, tone, value: count(match) }))} />}
  </Card>
}

function ManagementAttention({ ctx }) {
  const { summary, workflowLoading } = ctx
  const pending = [
    { icon: ShoppingCart, label: 'Pedidos de material', count: summary.purchaseRequests, page: 'Pedidos', tone: 'blue' },
    { icon: ClipboardList, label: 'OS concluídas aguardando confirmação', count: summary.unacknowledged, page: 'Serviços em andamento', tone: 'green' },
  ]
  return <section className="home-attention" aria-labelledby="home-attention-title"><div className="home-section-heading"><h2 id="home-attention-title">Atenção da gestão</h2></div><div className="home-attention-items">{pending.map((item) => <button className={`home-attention-item home-attention-item--${item.tone}`} type="button" onClick={() => ctx.onNavigate(item.page)} key={item.label}><item.icon className="icon" aria-hidden="true" strokeWidth={1.7} /><span>{item.label}</span><strong>{workflowLoading ? '—' : number(item.count)}</strong><Expand /></button>)}</div></section>
}

function RecentCompleted({ ctx, size }) {
  const done = ctx.orders.filter((order) => order.operation?.status === 'completed').map((order) => ({ order, at: completedAt(order) })).sort((left, right) => (right.at || 0) - (left.at || 0))
  const limit = rowLimit(size, 4, 8)
  return <Card icon={CircleCheck} tone="green" title="Concluídas recentemente" subtitle={plural(done.length, 'OS concluída', 'OS concluídas')} action={{ label: 'Ver concluídas', onClick: () => ctx.onNavigate('Serviços concluídos') }}>
    {ctx.workflowLoading ? <Empty>Carregando...</Empty> : !done.length ? <Empty>Nenhuma OS concluída ainda.</Empty> : <Rows rows={done.slice(0, limit).map(({ order, at }) => ({ key: order.code, title: order.service, detail: `${order.code} · ${order.company || 'Cliente não informado'}`, value: at ? new Date(at).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' }) : '—', valueDetail: order.operation?.completionAcknowledgedAt ? 'Confirmada' : 'Aguardando confirmação', tone: 'green' }))} onSelect={(row) => ctx.onSelectOrder(row.key)} />}
  </Card>
}

// ——— Gestão Operacional ———
function LowStockList({ items, loading, size, empty }) {
  return <span className="home-stock-list">{!loading && (items.length ? items.slice(0, rowLimit(size, 3, 7)).map((item) => <span className="home-stock-item" key={item.id}><span><strong>{item.name}</strong><small>Mínimo: {formatQuantity(item.minimum, item.unit)}</small></span><b className={Number(item.quantity) <= 0 ? 'home-stock-zero' : ''}>{formatQuantity(item.quantity, item.unit)}</b></span>) : <span className="home-stock-empty">{empty}</span>)}</span>
}
function LowStock({ ctx, size }) {
  const source = ctx.sources.inventory
  const loading = source.loading && source.data === null
  return <><button className="home-stock-widget" type="button" onClick={() => ctx.onNavigate('Estoque')} aria-label="Abrir estoque baixo"><span className="home-stock-title"><span className="home-stock-icon"><Package className="icon" aria-hidden="true" strokeWidth={1.7} /></span><span><strong>Estoque baixo</strong><small>{loading ? 'Carregando...' : plural(ctx.summary.lowStock.length, 'material', 'materiais')}</small></span><Expand /></span><LowStockList items={ctx.summary.lowStock} loading={loading} size={size} empty="Nenhum material abaixo do mínimo." /><span className="home-stock-footer"><span>Ver estoque</span><small>{source.error ? 'Dados não atualizados' : 'Disponibilidade atual'}</small></span></button>
    {source.error && <p className="home-inventory-error" role="alert">Não foi possível atualizar o estoque. Exibindo os últimos dados disponíveis.</p>}</>
}

const machineTones = { working: 'green', idle: 'gray', maintenance: 'amber' }
function MachinesNow({ ctx, size }) {
  const source = ctx.sources.machines, machines = source.data || []
  const count = (status) => machines.filter((machine) => machine.status === status).length
  const working = machines.filter((machine) => machine.status !== 'idle').sort((left, right) => (left.status === 'working' ? 0 : 1) - (right.status === 'working' ? 0 : 1) || left.name.localeCompare(right.name, 'pt-BR'))
  return <Card icon={Factory} tone="green" title="Máquinas agora" subtitle={source.data ? `${count('working')} de ${machines.length} em funcionamento` : 'Carregando...'} action={{ label: 'Ver máquinas', onClick: () => ctx.onNavigate('Máquinas') }}>
    <SourceState source={source} empty={source.data && !machines.length ? 'Nenhuma máquina cadastrada.' : ''}>
      <Stats columns={3} items={[{ label: 'Em funcionamento', value: number(count('working')), tone: 'green' }, { label: 'Ociosas', value: number(count('idle')) }, { label: 'Em manutenção', value: number(count('maintenance')), tone: 'amber' }]} />
      {working.length > 0 && <Rows rows={working.slice(0, rowLimit(size, 3, 7)).map((machine) => ({ key: machine.id, title: machine.name, detail: machine.status === 'working' ? `${machine.operator} · desde ${machine.started}` : 'Em manutenção', value: machine.status === 'working' ? machine.usage : 'Manutenção', valueDetail: machine.status === 'working' ? 'de uso hoje' : '', tone: machineTones[machine.status] }))} onSelect={() => ctx.onNavigate('Máquinas')} />}
    </SourceState>
  </Card>
}

function IdleOperators({ ctx, size }) {
  const source = ctx.sources.idleEmployees, items = source.data?.items || []
  return <Card icon={UserRoundX} tone="amber" title="Operadores sem serviço" subtitle={source.data ? `${plural(items.length, 'parado', 'parados')} · ${plural(source.data.working || 0, 'trabalhando', 'trabalhando')}` : 'Carregando...'} action={{ label: 'Ver máquinas', onClick: () => ctx.onNavigate('Máquinas') }}>
    <SourceState source={source} empty={source.data && !items.length ? 'Todos os operadores estão com serviço.' : ''}>
      <Rows rows={items.slice(0, rowLimit(size, 4, 9)).map((item) => ({ key: item.id, title: item.name, detail: item.idleSince ? [item.reason, item.orderCode].filter(Boolean).join(' · ') || 'Sem motivo informado' : 'Sem serviço hoje', value: item.idleSince ? timeLabel(item.idleSince) : '—', valueDetail: item.idleSince ? 'parado desde' : '', tone: item.idleSince ? 'amber' : 'gray' }))} />
    </SourceState>
  </Card>
}

function MachineUsageToday({ ctx, size }) {
  const source = ctx.sources.machines, machines = [...(source.data || [])].sort((left, right) => (right.usageMs || 0) - (left.usageMs || 0) || left.name.localeCompare(right.name, 'pt-BR'))
  const total = machines.reduce((sum, machine) => sum + (machine.usageMs || 0), 0)
  return <Card icon={Timer} title="Uso das máquinas hoje" subtitle={source.data ? `${hours(total)} de uso somado` : 'Carregando...'} action={{ label: 'Ver máquinas', onClick: () => ctx.onNavigate('Máquinas') }}>
    <SourceState source={source} empty={source.data && !machines.length ? 'Nenhuma máquina cadastrada.' : ''}>
      <Bars rows={machines.slice(0, rowLimit(size, 5, 10)).map((machine) => ({ key: machine.id, label: machine.name, value: machine.usageMs || 0, display: hours(machine.usageMs), tone: machine.status === 'working' ? 'green' : machine.status === 'maintenance' ? 'amber' : 'blue' }))} />
    </SourceState>
  </Card>
}

function MaterialRequests({ ctx, size }) {
  const requests = purchaseMaterialRequests(ctx.offers, ctx.orders).filter((request) => request.quantity > 0 && !request.rejection && !request.receipt)
  return <Card icon={ShoppingCart} title="Pedidos de material" subtitle={ctx.workflowLoading ? 'Carregando...' : plural(requests.length, 'material aguardando compra', 'materiais aguardando compra')} action={{ label: 'Ver pedidos', onClick: () => ctx.onNavigate('Pedidos') }}>
    {ctx.workflowLoading ? <Empty>Carregando...</Empty> : !requests.length ? <Empty>Nenhum material aguardando compra.</Empty> : <Rows rows={requests.slice(0, rowLimit(size, 4, 8)).map((request) => ({ key: request.id, title: request.name, detail: [request.orderCode || request.offerCode, request.detail].filter(Boolean).join(' · '), value: formatQuantity(request.quantity, request.unit), orderCode: request.orderCode }))} onSelect={(row) => ctx.onNavigate('Pedidos', row.orderCode ? { orderCode: row.orderCode } : undefined)} />}
  </Card>
}

function stockStats(items) {
  return { value: items.reduce((sum, item) => sum + Math.max(0, item.quantity) * (item.unitPrice || 0), 0), zero: items.filter((item) => item.quantity <= 0).length, low: items.filter((item) => item.quantity <= item.minimum).length }
}
function StockValue({ ctx, size }) {
  const source = ctx.sources.inventory, items = source.data || [], stats = stockStats(items)
  return <Card icon={Boxes} tone="teal" title="Valor do estoque" subtitle={source.data ? plural(items.length, 'material cadastrado', 'materiais cadastrados') : 'Carregando...'} action={{ label: 'Ver estoque', onClick: () => ctx.onNavigate('Estoque') }}>
    <SourceState source={source}><Stats columns={size.w >= 2 ? 3 : 1} items={[{ label: 'Valor em estoque', value: money(Math.round(stats.value * 100)), tone: 'teal' }, { label: 'Abaixo do mínimo', value: number(stats.low), tone: 'amber' }, { label: 'Zerados', value: number(stats.zero), tone: 'red' }]} /></SourceState>
  </Card>
}

// ——— Gestão Financeira ———
// Period of "Total em aberto" / "Total a receber", saved with the layout of the account.
const periodLabel = (period) => period === 'all' ? 'Tudo' : period === 1 ? '1 mês' : `${period} meses`
function PeriodSelect({ period, label, onChange }) {
  return <select className="home-period-select" aria-label={label} title={label} value={String(period)} disabled={!onChange} onChange={(event) => onChange({ period: event.target.value === 'all' ? 'all' : Number(event.target.value) })}>{homePeriods.map((value) => <option key={value} value={String(value)}>{periodLabel(value)}</option>)}</select>
}
function PayablesSummary({ ctx, size, onSettings }) {
  const source = ctx.sources.payables
  const loading = source.loading && source.data === null
  const period = size?.period ?? DEFAULT_HOME_PERIOD
  const cards = payableOverview(source.data || [], ctx.now, period)
  const icons = { open: CreditCard, overdue: TriangleAlert, today: CalendarDays, upcoming: CalendarClock }
  return <section className="home-payables" aria-labelledby="home-payables-title">
    <div className="home-section-heading"><h2 id="home-payables-title">Contas a pagar</h2><div className="home-section-tools"><PeriodSelect period={period} label="Período do total em aberto" onChange={onSettings} /><button className="home-text-button" type="button" onClick={() => ctx.onOpenPayables({})}>Ver contas<Expand /></button></div></div>
    <div className="home-payables-metrics">{cards.map((item) => { const Icon = icons[item.key]; return <button className={`home-payable home-payable--${item.key}`} key={item.key} type="button" disabled={loading} onClick={() => ctx.onOpenPayables(item.filters)}>
      <span className="home-payable-heading"><Icon className="icon" aria-hidden="true" strokeWidth={1.7} /><span>{item.label}</span><Expand /></span>
      <strong>{source.data === null ? '—' : money(item.valueCents)}</strong><small>{loading ? 'Carregando...' : source.data === null ? 'Indisponível' : `${plural(item.count, 'conta', 'contas')}${source.error ? ' · Dados não atualizados' : ''}`}</small>
    </button> })}</div>
    {source.error && <p className="home-error home-payables-error" role="alert">Não foi possível atualizar os resumos de contas a pagar.<button className="home-text-button" type="button" onClick={ctx.retry}>Tentar novamente<RefreshCw className="icon" aria-hidden="true" strokeWidth={1.7} /></button></p>}
  </section>
}

function ReceivablesSummary({ ctx, size, onSettings }) {
  const source = ctx.sources.receivables
  const loading = source.loading && source.data === null
  const period = size?.period ?? DEFAULT_HOME_PERIOD
  const cards = receivableOverview(source.data?.items || [], ctx.now, period)
  const icons = { open: HandCoins, overdue: TriangleAlert, today: CalendarDays, upcoming: CalendarClock }
  return <section className="home-payables home-receivables" aria-labelledby="home-receivables-title">
    <div className="home-section-heading"><h2 id="home-receivables-title">Contas a receber</h2><div className="home-section-tools"><PeriodSelect period={period} label="Período do total a receber" onChange={onSettings} /><button className="home-text-button" type="button" onClick={() => openReceivables(ctx, {})}>Ver contas<Expand /></button></div></div>
    <div className="home-payables-metrics">{cards.map((item) => { const Icon = icons[item.key]; return <button className={`home-payable home-payable--${item.key === 'upcoming' ? 'upcoming' : item.key}`} key={item.key} type="button" disabled={loading} onClick={() => openReceivables(ctx, item.filters)}>
      <span className="home-payable-heading"><Icon className="icon" aria-hidden="true" strokeWidth={1.7} /><span>{item.label}</span><Expand /></span>
      <strong>{source.data === null ? '—' : money(item.valueCents)}</strong><small>{loading ? 'Carregando...' : source.data === null ? 'Indisponível' : `${plural(item.count, 'conta', 'contas')}${source.error ? ' · Dados não atualizados' : ''}`}</small>
    </button> })}</div>
  </section>
}

function movementsOf(ctx) {
  const payables = ctx.sources.payables, receivables = ctx.sources.receivables
  const ready = payables.data !== null && receivables.data !== null
  return { ready, loading: payables.loading || receivables.loading, error: payables.error || receivables.error, movements: ready ? treasuryMovements(payables.data, receivables.data.items) : [] }
}
function MonthCash({ ctx, size }) {
  const { ready, loading, error, movements } = movementsOf(ctx)
  const monthStart = `${ctx.today.slice(0, 7)}-01`, previousStart = shiftMonth(monthStart, -1)
  const current = totalsOf(movements, monthStart, ctx.today), previous = totalsOf(movements, previousStart, addDays(monthStart, -1))
  return <Card icon={Wallet} tone="teal" title="Caixa do mês" subtitle={`Entradas e saídas de ${fullMonth(ctx.now)}`} action={{ label: 'Ver tesouraria', onClick: () => ctx.onNavigate('Tesouraria') }}>
    <SourceState source={{ data: ready ? movements : null, loading, error }}>
      <Stats columns={size.w >= 2 ? 3 : 1} items={[
        { label: 'Entradas', value: money(current.inCents), tone: 'green', hint: changeText(changeOf(current.inCents, previous.inCents)) },
        { label: 'Saídas', value: money(current.outCents), tone: 'red', hint: changeText(changeOf(current.outCents, previous.outCents)) },
        { label: 'Saldo', value: money(current.balanceCents), tone: current.balanceCents < 0 ? 'red' : 'blue', hint: `Mês passado: ${money(previous.balanceCents)}` },
      ]} />
    </SourceState>
  </Card>
}

function WeekCashFlow({ ctx }) {
  const { ready, loading, error, movements } = movementsOf(ctx)
  const period = cashFlowPeriod('week', ctx.today)
  const buckets = cashFlowBuckets(movements, period, ctx.today)
  const max = Math.max(1, ...buckets.flatMap((bucket) => [bucket.inCents, bucket.outCents]))
  const week = totalsOf(movements, period.start, period.end)
  return <Card icon={ChartColumn} tone="teal" title="Fluxo de caixa da semana" subtitle={`Saldo da semana: ${money(week.balanceCents)}`} action={{ label: 'Ver fluxo', onClick: () => ctx.onNavigate('Fluxo de caixa') }}>
    <SourceState source={{ data: ready ? movements : null, loading, error }}>
      <div className="home-week-chart" role="img" aria-label={`Entradas e saídas de ${shortDate(period.start)} a ${shortDate(period.end)}`}>{buckets.map((bucket) => <div className={`home-week-day${bucket.key === ctx.today ? ' home-week-day--today' : ''}`} key={bucket.key} title={`${bucket.title}: entradas ${money(bucket.inCents)}, saídas ${money(bucket.outCents)}`}>
        <div className="home-week-bars"><span className="home-week-in" style={{ height: `${bucket.inCents / max * 100}%` }} /><span className="home-week-out" style={{ height: `${bucket.outCents / max * 100}%` }} /></div>
        <span>{bucket.label}</span><small>{bucket.detail}</small>
      </div>)}</div>
      <p className="home-chart-legend"><span className="home-legend-in">Entradas {money(week.inCents)}</span><span className="home-legend-out">Saídas {money(week.outCents)}</span></p>
    </SourceState>
  </Card>
}

function UpcomingPayments({ ctx, size }) {
  const source = ctx.sources.payables
  const open = (source.data || []).filter((row) => !row.payment && !row.inactive).sort((left, right) => left.dueDate.localeCompare(right.dueDate) || right.valueCents - left.valueCents)
  return <Card icon={Receipt} tone="red" title="Próximos pagamentos" subtitle={source.data ? `${plural(open.length, 'conta em aberto', 'contas em aberto')}` : 'Carregando...'} action={{ label: 'Ver contas', onClick: () => ctx.onOpenPayables({}) }}>
    <SourceState source={source} empty={source.data && !open.length ? 'Nenhuma conta a pagar em aberto.' : ''}>
      <Rows rows={open.slice(0, rowLimit(size, 4, 9)).map((row) => { const days = daysUntil(row.dueDate, ctx.today); return { key: row.id, title: row.supplierName || 'Fornecedor não informado', detail: [dueLabel(days), row.description].filter(Boolean).join(' · '), value: money(row.valueCents), valueDetail: shortDate(row.dueDate), tone: days < 0 ? 'red' : days === 0 ? 'amber' : 'plain' } })} onSelect={(row) => openPayable(ctx, row.key)} />
    </SourceState>
  </Card>
}

function UpcomingReceipts({ ctx, size }) {
  const source = ctx.sources.receivables
  const open = (source.data?.items || []).filter((row) => !row.receipt && !row.inactive).sort((left, right) => left.dueDate.localeCompare(right.dueDate) || right.valueCents - left.valueCents)
  return <Card icon={HandCoins} tone="green" title="Próximos recebimentos" subtitle={source.data ? plural(open.length, 'conta em aberto', 'contas em aberto') : 'Carregando...'} action={{ label: 'Ver contas', onClick: () => ctx.onNavigate('Contas a Receber') }}>
    <SourceState source={source} empty={source.data && !open.length ? 'Nenhuma conta a receber em aberto.' : ''}>
      <Rows rows={open.slice(0, rowLimit(size, 4, 9)).map((row) => { const days = daysUntil(row.dueDate, ctx.today); return { key: row.id, title: row.customerName || 'Cliente não informado', detail: [dueLabel(days), row.orderCode || row.description].filter(Boolean).join(' · '), value: money(row.valueCents), valueDetail: shortDate(row.dueDate), tone: days < 0 ? 'red' : days === 0 ? 'amber' : 'green' } })} onSelect={(row) => openReceivable(ctx, row.key)} />
    </SourceState>
  </Card>
}

function OverdueCustomers({ ctx, size }) {
  const source = ctx.sources.receivables
  const groups = new Map()
  for (const row of source.data?.items || []) {
    if (row.receipt || row.inactive || row.dueDate >= ctx.today) continue
    const name = row.customerName || 'Cliente não informado'
    const group = groups.get(name) || { name, cents: 0, count: 0, oldest: row.dueDate }
    group.cents += row.valueCents; group.count += 1; if (row.dueDate < group.oldest) group.oldest = row.dueDate
    groups.set(name, group)
  }
  const list = [...groups.values()].sort((left, right) => right.cents - left.cents || left.name.localeCompare(right.name, 'pt-BR'))
  const total = list.reduce((sum, group) => sum + group.cents, 0)
  return <Card icon={Banknote} tone="red" title="Clientes em atraso" subtitle={source.data ? `${money(total)} vencidos` : 'Carregando...'} action={{ label: 'Ver contas', onClick: () => ctx.onNavigate('Contas a Receber') }}>
    <SourceState source={source} empty={source.data && !list.length ? 'Nenhum recebimento vencido.' : ''}>
      <Rows rows={list.slice(0, rowLimit(size, 4, 9)).map((group) => ({ key: group.name, title: group.name, detail: `${plural(group.count, 'conta', 'contas')} · mais antiga ${dueLabel(daysUntil(group.oldest, ctx.today)).toLowerCase()}`, value: money(group.cents), tone: 'red' }))} onSelect={() => ctx.onNavigate('Contas a Receber')} />
    </SourceState>
  </Card>
}

function ReceivableForecast({ ctx }) {
  const source = ctx.sources.receivables
  const forecast = receivableForecast(source.data?.items || [], ctx.today)
  const max = Math.max(1, ...forecast.months.map((month) => month.gross))
  return <Card icon={TrendingUp} tone="green" title="Previsão de recebimentos" subtitle={source.data ? `${money(forecast.net)} líquidos a receber (ISS ${money(forecast.iss)})` : 'Carregando...'} action={{ label: 'Ver contas', onClick: () => ctx.onNavigate('Contas a Receber') }}>
    <SourceState source={source}>
      <div className="home-month-chart">{forecast.months.map((month) => <div key={month.month} title={`${monthLabel(month.month)}: ${money(month.gross)} bruto, ${money(month.net)} líquido`}>
        <div className="home-month-bar"><span style={{ height: `${month.gross / max * 100}%` }}><span style={{ height: `${month.gross ? month.net / month.gross * 100 : 0}%` }} /></span></div>
        <strong>{month.gross ? money(month.net).replace(/,\d{2}$/, '') : '—'}</strong><span>{monthLabel(month.month)}</span>
      </div>)}</div>
      {forecast.overdue > 0 && <p className="home-card-stale home-card-stale--red">{money(forecast.overdue)} já vencidos não entram nos meses.</p>}
    </SourceState>
  </Card>
}

function MonthExpenses({ ctx, size }) {
  const payables = ctx.sources.payables, receivables = ctx.sources.receivables
  const ready = payables.data !== null && receivables.data !== null
  const monthStart = `${ctx.today.slice(0, 7)}-01`
  const shares = ready ? classificationShares(payables.data, receivables.data.items, receivables.data.classifications, { start: monthStart, end: ctx.today }).out : []
  const total = shares.reduce((sum, row) => sum + row.cents, 0)
  return <Card icon={TrendingDown} tone="red" title="Despesas do mês" subtitle={ready ? `${money(total)} pagos em ${fullMonth(ctx.now)}` : 'Carregando...'} action={{ label: 'Ver fluxo', onClick: () => ctx.onNavigate('Fluxo de caixa') }}>
    <SourceState source={{ data: ready ? shares : null, loading: payables.loading || receivables.loading, error: payables.error || receivables.error }} empty={ready && !shares.length ? 'Nenhum pagamento neste mês.' : ''}>
      <Bars rows={shares.slice(0, rowLimit(size, 4, 8)).map((row) => ({ key: row.id, label: [row.code, row.name].filter(Boolean).join(' · '), value: row.cents, display: `${money(row.cents)} · ${percent(total ? row.cents / total : 0)}`, tone: 'red' }))} />
    </SourceState>
  </Card>
}

// ——— Estoque Administrativo ———
function AdminLowStock({ ctx, size }) {
  const source = ctx.sources.adminInventory
  const loading = source.loading && source.data === null
  const low = (source.data || []).filter((item) => item.quantity <= item.minimum).sort((left, right) => left.quantity / Math.max(1, left.minimum) - right.quantity / Math.max(1, right.minimum) || left.name.localeCompare(right.name, 'pt-BR'))
  return <button className="home-stock-widget home-stock-widget--admin" type="button" onClick={() => ctx.onNavigate('Estoque Administrativo')} aria-label="Abrir estoque administrativo baixo"><span className="home-stock-title"><span className="home-stock-icon"><Archive className="icon" aria-hidden="true" strokeWidth={1.7} /></span><span><strong>Estoque administrativo baixo</strong><small>{loading ? 'Carregando...' : source.data === null ? 'Indisponível' : plural(low.length, 'material', 'materiais')}</small></span><Expand /></span><LowStockList items={low} loading={loading} size={size} empty={source.data === null ? 'Estoque administrativo indisponível no momento.' : 'Nenhum material abaixo do mínimo.'} /><span className="home-stock-footer"><span>Ver estoque administrativo</span><small>{source.error ? 'Dados não atualizados' : 'Escritório, limpeza e copa'}</small></span></button>
}

function AdminStockSummary({ ctx, size }) {
  const source = ctx.sources.adminInventory, items = source.data || [], stats = stockStats(items)
  return <Card icon={Archive} tone="amber" title="Estoque administrativo" subtitle={source.data ? plural(items.length, 'item cadastrado', 'itens cadastrados') : 'Carregando...'} action={{ label: 'Abrir', onClick: () => ctx.onNavigate('Estoque Administrativo') }}>
    <SourceState source={source}><Stats columns={size.w >= 2 ? 3 : 1} items={[{ label: 'Valor em estoque', value: money(Math.round(stats.value * 100)), tone: 'teal' }, { label: 'Abaixo do mínimo', value: number(stats.low), tone: 'amber' }, { label: 'Zerados', value: number(stats.zero), tone: 'red' }]} /></SourceState>
  </Card>
}

function AdminStockExits({ ctx, size }) {
  const source = ctx.sources.adminInventory
  const exits = (source.data || []).flatMap((item) => (item.history || []).filter((entry) => entry.type === 'exit').map((entry) => ({ ...entry, item }))).sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
  return <Card icon={PackageMinus} tone="amber" title="Últimas baixas administrativas" subtitle={source.data ? `${plural(exits.filter((entry) => localDay(entry.date).slice(0, 7) === ctx.today.slice(0, 7)).length, 'baixa', 'baixas')} neste mês` : 'Carregando...'} action={{ label: 'Abrir', onClick: () => ctx.onNavigate('Estoque Administrativo') }}>
    <SourceState source={source} empty={source.data && !exits.length ? 'Nenhuma baixa registrada.' : ''}>
      <Rows rows={exits.slice(0, rowLimit(size, 4, 9)).map((entry) => ({ key: `${entry.item.id}-${entry.id}`, title: entry.item.name, detail: [entry.destination, entry.userName].filter(Boolean).join(' · ') || 'Sem destino informado', value: formatQuantity(entry.quantity, entry.item.unit), valueDetail: new Date(entry.date).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' }) }))} />
    </SourceState>
  </Card>
}

// ——— Calculadora ———
function CalculatorShortcut({ ctx }) {
  return <button className="home-calculator" type="button" onClick={() => ctx.onNavigate('Calculadora de pesos e medidas')}><Calculator className="icon" aria-hidden="true" strokeWidth={1.7} /><span>Calculadora de<br />pesos e medidas</span><Expand /></button>
}

const prefixes = { thickness: 'E', width: 'L', side: 'L', diameter: 'D', outerDiameter: 'DE', innerDiameter: 'DI', length: 'C', base: 'B', flangeLarge: 'A1', flangeSmall: 'A2', sideOne: 'L1', sideTwo: 'L2' }
const weightText = (value) => value >= 1000 ? `${Number((value / 1000).toFixed(3)).toString().replace('.', ',')} t` : `${Number(value.toFixed(3)).toString().replace('.', ',')} kg`
function QuickCalculator({ ctx }) {
  const [material, setMaterial] = useState('carbon'), [format, setFormat] = useState('flat'), [values, setValues] = useState({}), [length, setLength] = useState('1000')
  const selectedMaterial = calculatorMaterials.find((item) => item.key === material)
  const formats = calculatorFormats.filter((item) => item.materials.includes(material))
  const selectedFormat = formats.find((item) => item.key === format) || formats[0]
  const weight = calculatorWeight(selectedFormat.key, selectedMaterial, values)
  const perMeter = selectedFormat.resultLabel === 'metro'
  const millimeters = Number(length) > 0 ? Number(length) : 1000
  const result = weight > 0 ? (perMeter ? weight * millimeters / 1000 : weight) : null
  return <Card icon={Ruler} tone="teal" title="Calculadora rápida" subtitle={`${selectedMaterial.name} · ${selectedMaterial.density.toFixed(2).replace('.', ',')} g/cm³`} action={{ label: 'Completa', onClick: () => ctx.onNavigate('Calculadora de pesos e medidas') }}>
    <div className="home-calc">
      <label>Material<select value={material} onChange={(event) => { const next = event.target.value; setMaterial(next); setFormat(calculatorFormats.find((item) => item.materials.includes(next)).key); setValues({}) }}>{calculatorMaterials.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
      <label>Formato<select value={selectedFormat.key} onChange={(event) => { setFormat(event.target.value); setValues({}) }}>{formats.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
      {selectedFormat.fields.map(([key, label]) => <label key={key}><span><b>{prefixes[key] || 'M'}</b> {label} (mm)</span><input type="number" min="0" step="0.01" inputMode="decimal" value={values[key] || ''} placeholder="-" onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
      {perMeter && <label><span><b>C</b> Comprimento (mm)</span><input type="number" min="0" step="1" inputMode="decimal" value={length} onChange={(event) => setLength(event.target.value)} onBlur={() => { if (!(Number(length) > 0)) setLength('1000') }} /></label>}
    </div>
    <div className="home-calc-result" aria-live="polite"><span>{perMeter ? (millimeters === 1000 ? 'Peso por metro' : `Peso em ${millimeters.toLocaleString('pt-BR')} mm`) : `Peso por ${selectedFormat.resultLabel}`}</span><strong>{result ? weightText(result) : '-'}</strong></div>
  </Card>
}

function InchConverter() {
  const [selected, setSelected] = useState('15'), [millimeters, setMillimeters] = useState('')
  const option = conversionOptions[Number(selected)]
  const typed = Number(String(millimeters).replace(',', '.'))
  const nearest = typed > 0 ? conversionOptions.reduce((best, item) => Math.abs(item.millimeter - typed) < Math.abs(best.millimeter - typed) ? item : best) : null
  return <Card icon={Ruler} title="Conversor de polegadas" subtitle="Tabela da calculadora">
    <div className="home-convert">
      <label>Polegadas<select value={selected} onChange={(event) => setSelected(event.target.value)}>{conversionOptions.map((item) => <option key={item.key} value={item.key}>{item.inchLabel}&quot;</option>)}</select></label>
      <p className="home-convert-result"><strong>{option.inchLabel}&quot;</strong><span>=</span><strong>{option.millimeterLabel} mm</strong></p>
      <label>Milímetros<input type="number" min="0" step="0.01" inputMode="decimal" value={millimeters} placeholder="Ex.: 25,4" onChange={(event) => setMillimeters(event.target.value)} /></label>
      <p className="home-convert-result">{nearest ? <><strong>{(typed / 25.4).toFixed(3).replace('.', ',')}&quot;</strong><span>≈</span><strong>{nearest.inchLabel}&quot;</strong></> : <span>Digite uma medida em mm</span>}</p>
    </div>
  </Card>
}

// ——— Cadastros ———
const registryPages = [['Clientes', Building2], ['Fornecedores', Landmark], ['Funcionários', Users], ['Solicitantes', Contact], ['Compradores', ShoppingCart], ['Administradores', UserCog], ['Setores', LayoutGrid], ['Bancos', Landmark], ['Razões de pausas', Clock], ['Modelos de e-mail', FileText]]
function RegistryShortcuts({ ctx, size }) {
  return <Card icon={Contact} title="Atalhos de cadastro" subtitle="Abra um cadastro em um clique">
    <div className="home-shortcuts">{registryPages.slice(0, size.w >= 4 ? 10 : size.w >= 2 ? 8 : 6).map(([page, Icon]) => <button type="button" key={page} onClick={() => ctx.onNavigate(page)}><Icon className="icon" aria-hidden="true" strokeWidth={1.7} /><span>{page}</span></button>)}</div>
  </Card>
}

function TopClients({ ctx, size }) {
  const year = ctx.today.slice(0, 4)
  const counts = new Map()
  for (const order of ctx.orders) {
    if (String(order.createdAt || order.requestedAt || '').slice(0, 4) !== year) continue
    const name = order.company || 'Cliente não informado'
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  const list = [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'pt-BR'))
  return <Card icon={Building2} title="Principais clientes" subtitle={`Ordens de serviço em ${year}`} action={{ label: 'Ver clientes', onClick: () => ctx.onNavigate('Clientes') }}>
    {ctx.workflowLoading ? <Empty>Carregando...</Empty> : !list.length ? <Empty>Nenhuma OS aberta neste ano.</Empty> : <Bars rows={list.slice(0, rowLimit(size, 5, 10)).map(([name, count]) => ({ key: name, label: name, value: count, display: plural(count, 'OS', 'OS') }))} />}
  </Card>
}

function TeamOverview({ ctx, size }) {
  const employees = ctx.sources.employees, admins = ctx.sources.admins
  const active = (employees.data || []).filter(isActive)
  const ready = employees.data !== null
  return <Card icon={Users} title="Equipe" subtitle={ready ? plural(active.length, 'funcionário ativo', 'funcionários ativos') : 'Carregando...'} action={{ label: 'Ver', onClick: () => ctx.onNavigate('Funcionários') }}>
    <SourceState source={employees}><Stats columns={size.w >= 2 ? 3 : 1} items={[
      { label: 'Operadores', value: number(active.filter((item) => ['operator', 'both'].includes(item.type)).length), tone: 'green' },
      { label: 'Administrativos', value: number(active.filter((item) => ['administrative', 'both'].includes(item.type)).length), tone: 'blue' },
      { label: 'Administradores', value: admins.data ? number(admins.data.length) : '—', tone: 'amber' },
    ]} /></SourceState>
  </Card>
}

function Birthdays({ ctx, size }) {
  const employees = ctx.sources.employees, admins = ctx.sources.admins
  const month = ctx.today.slice(5, 7), day = ctx.today.slice(8, 10)
  const people = [...(employees.data || []).filter(isActive).map((item) => ({ ...item, kind: 'Funcionário' })), ...(admins.data || []).map((item) => ({ ...item, kind: 'Administrador' }))]
    .filter((item) => item.birthDate?.slice(5, 7) === month)
    .sort((left, right) => left.birthDate.slice(8, 10).localeCompare(right.birthDate.slice(8, 10)) || left.name.localeCompare(right.name, 'pt-BR'))
  const seen = new Set(), unique = people.filter((item) => { const key = `${item.name}-${item.birthDate}`; if (seen.has(key)) return false; seen.add(key); return true })
  return <Card icon={Cake} tone="pink" title="Aniversariantes do mês" subtitle={employees.data ? plural(unique.length, 'aniversariante', 'aniversariantes') + ` em ${fullMonth(ctx.now)}` : 'Carregando...'}>
    <SourceState source={employees} empty={employees.data && !unique.length ? 'Ninguém faz aniversário neste mês.' : ''}>
      <Rows rows={unique.slice(0, rowLimit(size, 4, 9)).map((item) => ({ key: `${item.kind}-${item.id}`, title: item.name, detail: item.kind, value: item.birthDate.slice(8, 10) === day ? 'Hoje' : shortDate(item.birthDate), tone: item.birthDate.slice(8, 10) === day ? 'pink' : item.birthDate.slice(8, 10) < day ? 'gray' : 'plain' }))} />
    </SourceState>
  </Card>
}

// ——— Relatórios ———
function ReportsShortcut({ ctx }) {
  return <button className="home-shortcut-card" type="button" onClick={() => ctx.onNavigate('Relatórios')}><ChartColumn className="icon" aria-hidden="true" strokeWidth={1.7} /><span><strong>Relatórios</strong><small>Produção, máquinas e funcionários em PDF ou planilha</small></span><Expand /></button>
}

function MonthProduction({ ctx, size }) {
  const monthStart = `${ctx.today.slice(0, 7)}-01`, previousMonth = shiftMonth(monthStart, -1).slice(0, 7)
  const doneIn = (month) => ctx.orders.filter((order) => { const at = completedAt(order); return order.operation?.status === 'completed' && at && localDay(at).slice(0, 7) === month }).length
  const openedIn = (month) => ctx.orders.filter((order) => order.createdAt && localDay(order.createdAt).slice(0, 7) === month).length
  const current = doneIn(ctx.today.slice(0, 7)), previous = doneIn(previousMonth)
  return <Card icon={Gauge} tone="green" title="Produção do mês" subtitle={`Ordens de serviço de ${fullMonth(ctx.now)}`} action={{ label: 'Relatórios', onClick: () => ctx.onNavigate('Relatórios') }}>
    {ctx.workflowLoading ? <Empty>Carregando...</Empty> : <Stats columns={size.w >= 2 ? 3 : 1} items={[
      { label: 'OS concluídas', value: number(current), tone: 'green', hint: changeText(changeOf(current, previous)) },
      { label: 'OS abertas no mês', value: number(openedIn(ctx.today.slice(0, 7))), tone: 'blue', hint: `Mês passado: ${number(openedIn(previousMonth))}` },
      { label: 'Concluídas no mês passado', value: number(previous) },
    ]} />}
  </Card>
}

function MachineUsageMonth({ ctx }) {
  const source = ctx.sources.machineUsageMonth, summary = source.data?.summary
  return <Card icon={Gauge} title="Uso das máquinas no mês" subtitle={summary ? `${summary.machinesUsed} de ${summary.machines} máquinas usadas em ${fullMonth(ctx.now)}` : 'Carregando...'} action={{ label: 'Ver máquinas', onClick: () => ctx.onNavigate('Máquinas') }}>
    <SourceState source={source}>{summary && <>
      <div className="home-gauge"><span className="home-gauge-track"><span style={{ width: `${Math.min(100, summary.utilization * 100)}%` }} /></span><strong>{percent(summary.utilization)}</strong><small>de aproveitamento</small></div>
      <Stats columns={2} items={[{ label: 'Mais usada', value: summary.mostUsed?.name || '—', hint: summary.mostUsed ? hours(summary.mostUsed.ms) : '', tone: 'green' }, { label: 'Mais ociosa', value: summary.mostIdle?.name || '—', hint: summary.mostIdle ? `${percent(summary.mostIdle.share)} do tempo parada` : '', tone: 'amber' }]} />
    </>}</SourceState>
  </Card>
}

// ——— Configurações ———
const urgencyLabels = { low: 'Baixo', medium: 'Médio', high: 'Alto' }
function SupportTickets({ ctx, size }) {
  const source = ctx.sources.tickets
  const open = (source.data || []).filter((ticket) => ticket.status !== 'closed')
  return <Card icon={LifeBuoy} title="Tickets de suporte" subtitle={source.data ? plural(open.length, 'ticket aberto', 'tickets abertos') : 'Carregando...'} action={{ label: 'Ver tickets', onClick: () => ctx.onNavigate('Ticket') }}>
    <SourceState source={source} empty={source.data && !open.length ? 'Nenhum ticket aberto.' : ''}>
      <Rows rows={open.slice(0, rowLimit(size, 3, 7)).map((ticket) => ({ key: ticket.id, title: ticket.title, detail: `${ticket.id} · ${ticket.createdByName || ''}`, value: urgencyLabels[ticket.urgency] || '', tone: ticket.urgency === 'high' ? 'red' : ticket.urgency === 'medium' ? 'amber' : 'plain' }))} onSelect={(row) => openTicket(ctx, row.key)} />
    </SourceState>
  </Card>
}

function ReleaseNotesWidget({ ctx, size }) {
  const latest = releaseNotes[0]
  const notes = latest.notes.slice(0, rowLimit(size, 3, 8))
  return <Card icon={Sparkles} tone="blue" title="Novidades do portal" subtitle={`Versão ${currentVersion} · ${latest.date.split('-').reverse().join('/')}`} action={{ label: 'Todas', onClick: () => { sessionStorage.setItem('gmac-release-notes-open', '1'); ctx.onNavigate('Configurações'); window.dispatchEvent(new CustomEvent('gmac-release-notes-open')) } }}>
    <ul className="home-notes">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
    {latest.notes.length > notes.length && <p className="home-card-more">e mais {plural(latest.notes.length - notes.length, 'novidade', 'novidades')}</p>}
  </Card>
}

function AppearanceWidget() {
  const appearance = useAccountAppearance()
  const options = [['light', 'Claro', Sun], ['dark', 'Escuro', Moon], ['black', 'Escuro intenso', Moon]]
  return <Card icon={Palette} title="Aparência" subtitle="Tema da sua conta">
    <div className="home-theme-options" role="group" aria-label="Tema">{options.map(([key, label, Icon]) => <button type="button" key={key} aria-pressed={appearance?.theme === key} disabled={!appearance || appearance.busy || appearance.loading} onClick={() => appearance.changeTheme(key)}><Icon className="icon" aria-hidden="true" strokeWidth={1.7} /><span>{label}</span></button>)}</div>
    {appearance?.error && <p className="home-card-stale home-card-stale--red">{appearance.error}</p>}
  </Card>
}

// Each widget: what it draws, the icon of the catalog and the sources it reads (homeSources.js).
export const widgetViews = {
  'quick-access': { Component: QuickAccess, icon: LayoutGrid },
  'operation-summary': { Component: OperationSummary, icon: ClipboardList },
  'open-orders': { Component: OpenOrders, icon: ClipboardList },
  'late-orders': { Component: LateOrders, icon: TriangleAlert },
  'deadline-health': { Component: DeadlineHealth, icon: Hourglass },
  'order-status': { Component: OrderStatus, icon: ClipboardList },
  'offer-pipeline': { Component: OfferPipeline, icon: Funnel },
  'management-attention': { Component: ManagementAttention, icon: TriangleAlert },
  'recent-completed': { Component: RecentCompleted, icon: CircleCheck },
  'low-stock': { Component: LowStock, icon: Package, sources: ['inventory'] },
  'machines-now': { Component: MachinesNow, icon: Factory, sources: ['machines'] },
  'idle-operators': { Component: IdleOperators, icon: UserRoundX, sources: ['idleEmployees'] },
  'machine-usage-today': { Component: MachineUsageToday, icon: Timer, sources: ['machines'] },
  'material-requests': { Component: MaterialRequests, icon: ShoppingCart },
  'stock-value': { Component: StockValue, icon: Boxes, sources: ['inventory'] },
  'payables-summary': { Component: PayablesSummary, icon: CreditCard, sources: ['payables'] },
  'receivables-summary': { Component: ReceivablesSummary, icon: HandCoins, sources: ['receivables'] },
  'month-cash': { Component: MonthCash, icon: Wallet, sources: ['payables', 'receivables'] },
  'week-cash-flow': { Component: WeekCashFlow, icon: ChartColumn, sources: ['payables', 'receivables'] },
  'upcoming-payments': { Component: UpcomingPayments, icon: Receipt, sources: ['payables'] },
  'upcoming-receipts': { Component: UpcomingReceipts, icon: HandCoins, sources: ['receivables'] },
  'overdue-customers': { Component: OverdueCustomers, icon: Banknote, sources: ['receivables'] },
  'receivable-forecast': { Component: ReceivableForecast, icon: TrendingUp, sources: ['receivables'] },
  'month-expenses': { Component: MonthExpenses, icon: TrendingDown, sources: ['payables', 'receivables'] },
  'admin-low-stock': { Component: AdminLowStock, icon: Archive, sources: ['adminInventory'] },
  'admin-stock-summary': { Component: AdminStockSummary, icon: Archive, sources: ['adminInventory'] },
  'admin-stock-exits': { Component: AdminStockExits, icon: PackageMinus, sources: ['adminInventory'] },
  'calculator-shortcut': { Component: CalculatorShortcut, icon: Calculator },
  'quick-calculator': { Component: QuickCalculator, icon: Ruler },
  'inch-converter': { Component: InchConverter, icon: Ruler },
  'registry-shortcuts': { Component: RegistryShortcuts, icon: Contact },
  'top-clients': { Component: TopClients, icon: Building2 },
  'team-overview': { Component: TeamOverview, icon: Users, sources: ['employees', 'admins'] },
  'birthdays': { Component: Birthdays, icon: Cake, sources: ['employees', 'admins'] },
  'reports-shortcut': { Component: ReportsShortcut, icon: ChartColumn },
  'month-production': { Component: MonthProduction, icon: Gauge },
  'machine-usage-month': { Component: MachineUsageMonth, icon: Wrench, sources: ['machineUsageMonth'] },
  'support-tickets': { Component: SupportTickets, icon: LifeBuoy, sources: ['tickets'] },
  'release-notes': { Component: ReleaseNotesWidget, icon: Sparkles },
  'appearance': { Component: AppearanceWidget, icon: Palette },
}
