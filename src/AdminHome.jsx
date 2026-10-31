import { useEffect, useState } from 'react'
import { ArrowUpRight, Calculator, CalendarClock, CalendarDays, CirclePlay, ClipboardList, CreditCard, FileText, Package, RefreshCw, ShoppingCart, TriangleAlert } from 'lucide-react'
import { adminFirstName, adminOverview, payableOverview } from './adminOverview.js'
import { money } from './payablesApi.js'
import { pollWhileVisible } from './polling.js'
import './adminHome.css'
import { formatQuantity } from '../server/materialUnits.js'

const number = (value) => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const operationLabels = { waiting: 'Aguardando', running: 'Em execução', paused: 'Pausado', stage_done: 'Etapa concluída', finalizing: 'Finalizando' }
const displayDate = (value) => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : 'America/Bahia' }) : 'Não informado'

const homeIcons = { expand: ArrowUpRight, calculator: Calculator, machines: CirclePlay, services: ClipboardList, offers: FileText, stock: Package, reports: RefreshCw, orders: ShoppingCart, info: TriangleAlert, open: CreditCard, overdue: TriangleAlert, today: CalendarDays, upcoming: CalendarClock }
function Icon({ name }) {
  const Component = homeIcons[name]
  return <Component className="icon" aria-hidden="true" strokeWidth={1.7} />
}

export default function AdminHome({ user, orders, offers, workflowError, workflowLoading, onRefresh, onNavigate, onSelectOrder, onOpenPayables, loadPayables, loadInventory, Sidebar, WorkspaceTabs, navigationProps }) {
  const [inventory, setInventory] = useState([])
  const [inventoryLoading, setInventoryLoading] = useState(true)
  const [inventoryError, setInventoryError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [retry, setRetry] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [payables, setPayables] = useState(null)
  const [payablesLoading, setPayablesLoading] = useState(true)
  const [payablesError, setPayablesError] = useState('')
  useEffect(() => {
    if (!loadPayables) return undefined
    const controller = new AbortController()
    let fetching = false
    async function load() {
      if (fetching) return
      fetching = true
      try {
        const result = await loadPayables(controller.signal)
        if (!controller.signal.aborted) { setPayables(result.items); setPayablesError(''); setNow(Date.now()) }
      } catch {
        if (!controller.signal.aborted) setPayablesError('Não foi possível atualizar os resumos de contas a pagar.')
      } finally {
        fetching = false
        if (!controller.signal.aborted) setPayablesLoading(false)
      }
    }
    load()
    const stopPolling = pollWhileVisible(load, 30000, ['data', 'finance'])
    return () => { controller.abort(); stopPolling() }
  }, [retry, loadPayables])
  useEffect(() => {
    const controller = new AbortController()
    let fetching = false
    async function load() {
      if (fetching) return
      fetching = true
      try {
        const result = await loadInventory(controller.signal)
        if (!controller.signal.aborted) { setInventory(result.items); setInventoryError('') }
      } catch (error) {
        if (!controller.signal.aborted) setInventoryError('Não foi possível atualizar o estoque. Exibindo os últimos dados disponíveis.')
      } finally {
        fetching = false
        if (!controller.signal.aborted) setInventoryLoading(false)
      }
    }
    load()
    const stopPolling = pollWhileVisible(() => { setNow(Date.now()); load() }, 60000, ['data', 'finance'])
    return () => { controller.abort(); stopPolling() }
  }, [retry, loadInventory])
  const summary = adminOverview(orders, offers, inventory, now)
  const payableSummary = payableOverview(payables || [], now)
  const today = new Date(now).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia', day: 'numeric', month: 'long', year: 'numeric' })

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    setNow(Date.now())
    setRetry((value) => value + 1)
    try { await onRefresh() } catch { /* Workflow errors are displayed by the parent. */ }
    finally { setRefreshing(false) }
  }
  const pending = [
    { icon: 'orders', label: 'Pedidos de material', count: summary.purchaseRequests, action: () => onNavigate('Pedidos'), tone: 'blue' },
    { icon: 'services', label: 'OS concluídas aguardando confirmação', count: summary.unacknowledged, action: () => onNavigate('Serviços em andamento'), tone: 'green' },
  ]
  return <div className="dashboard-shell admin-home-shell">
    <Sidebar {...navigationProps} onNavigate={onNavigate} />
    <main className="admin-home-main">
      <WorkspaceTabs {...navigationProps} onNavigate={onNavigate} />
      <header className="home-heading"><div><span className="home-eyebrow">GMAC Metalúrgica <span>/</span> Início</span><h1>Bem-vindo, {adminFirstName(user?.name)}</h1><p>{today}</p></div><div className="home-heading-actions"><button className="home-button" type="button" onClick={refresh} disabled={refreshing} title="Atualizar resumos"><Icon name="reports" />{refreshing ? 'Atualizando...' : 'Atualizar'}</button><button className="home-button home-button--primary" type="button" onClick={() => onNavigate('Ofertas e serviços')}><Icon name="offers" />Ofertas e serviços</button></div></header>
      {workflowError && <p className="home-error" role="alert">{workflowError}</p>}
      <section className="home-metrics" aria-label="Resumo da operação">{[
        ['OS em aberto', summary.openOrders.length, 'services', 'blue'], ['Em execução', summary.running, 'machines', 'green'], ['OS atrasadas', summary.late, 'info', 'red'], ['Ofertas em análise', summary.reviewing, 'offers', 'amber'],
      ].map(([label, value, icon, tone]) => <div className={`home-metric home-metric--${tone}`} key={label}><span className="home-metric-icon"><Icon name={icon} /></span><div><span>{label}</span><strong>{workflowLoading ? '—' : number(value)}</strong></div></div>)}</section>
      {loadPayables && <section className="home-payables" aria-labelledby="home-payables-title">
        <div className="home-section-heading"><h2 id="home-payables-title">Contas a pagar</h2><button className="home-text-button" type="button" onClick={() => onOpenPayables({})}>Ver contas<Icon name="expand" /></button></div>
        <div className="home-payables-metrics">{payableSummary.map((item) => <button className={`home-payable home-payable--${item.key}`} key={item.key} type="button" disabled={payablesLoading} onClick={() => onOpenPayables(item.filters)}>
          <span className="home-payable-heading"><Icon name={item.key} /><span>{item.label}</span><Icon name="expand" /></span>
          <strong>{payables === null ? '—' : money(item.valueCents)}</strong><small>{payablesLoading ? 'Carregando...' : payables === null ? 'Indisponível' : `${number(item.count)} ${item.count === 1 ? 'conta' : 'contas'}${payablesError ? ' · Dados não atualizados' : ''}`}</small>
        </button>)}</div>
        {payablesError && <p className="home-error home-payables-error" role="alert">{payablesError}<button className="home-text-button" type="button" onClick={() => setRetry((value) => value + 1)}>Tentar novamente<Icon name="reports" /></button></p>}
      </section>}
      <div className="home-workspace"><section className="home-orders" aria-labelledby="home-orders-title"><div className="home-section-heading"><div><h2 id="home-orders-title">OS em aberto</h2><span>{workflowLoading ? 'Carregando...' : `${summary.openOrders.length} ${summary.openOrders.length === 1 ? 'ordem de serviço' : 'ordens de serviço'}`}</span></div><button className="home-text-button" type="button" onClick={() => onNavigate('Serviços em andamento')}>Ver todas<Icon name="expand" /></button></div>
        <div className="home-orders-scroll"><table><thead><tr><th>OS / Projeto</th><th aria-sort="ascending">Prazo de entrega</th><th>Tempo restante</th><th>Status</th></tr></thead><tbody>{!workflowLoading && summary.openOrders.slice(0, 6).map((order) => <tr key={order.code}><td data-label="OS / Projeto"><button className="home-order-link" type="button" onClick={() => onSelectOrder(order.code)}><strong>{order.service}</strong><span>{order.code} <span aria-hidden="true">·</span> {order.company}</span></button></td><td data-label="Prazo de entrega">{Number.isFinite(order.deliveryTimestamp) ? displayDate(order.deliveryDeadline) : 'Não informado'}</td><td data-label="Tempo restante" className={order.due.key === 'late' ? 'home-overdue' : ''}>{order.due.remaining}</td><td data-label="Status"><span className={`home-due home-due--${order.due.key}`}>{order.due.label}</span><small className="home-operation-state">{operationLabels[order.operation?.status] || 'Aguardando'}</small></td></tr>)}</tbody></table></div>
        {workflowLoading ? <p className="home-empty" role="status">Carregando ordens de serviço...</p> : !summary.openOrders.length && <p className="home-empty">{workflowError ? 'Ordens de serviço indisponíveis no momento.' : 'Nenhuma OS em aberto.'}</p>}
        {summary.openOrders.length > 6 && <button className="home-more-orders" type="button" onClick={() => onNavigate('Serviços em andamento')}>Ver mais {number(summary.openOrders.length - 6)} ordens de serviço<Icon name="expand" /></button>}
      </section>
      <aside className="home-side"><button className="home-stock-widget" type="button" onClick={() => onNavigate('Estoque')} aria-label="Abrir estoque baixo"><span className="home-stock-title"><span className="home-stock-icon"><Icon name="stock" /></span><span><strong>Estoque baixo</strong><small>{inventoryLoading ? 'Carregando...' : `${summary.lowStock.length} ${summary.lowStock.length === 1 ? 'material' : 'materiais'}`}</small></span><Icon name="expand" /></span><span className="home-stock-list">{!inventoryLoading && (summary.lowStock.length ? summary.lowStock.slice(0, 3).map((item) => <span className="home-stock-item" key={item.id}><span><strong>{item.name}</strong><small>Mínimo: {formatQuantity(item.minimum, item.unit)}</small></span><b className={Number(item.quantity) <= 0 ? 'home-stock-zero' : ''}>{formatQuantity(item.quantity, item.unit)}</b></span>) : <span className="home-stock-empty">Nenhum material abaixo do mínimo.</span>)}</span><span className="home-stock-footer"><span>Ver estoque</span><small>{inventoryError ? 'Dados não atualizados' : 'Disponibilidade atual'}</small></span></button>
        {inventoryError && <p className="home-inventory-error" role="alert">{inventoryError}</p>}
        <button className="home-calculator" type="button" onClick={() => onNavigate('Calculadora de pesos e medidas')}><Icon name="calculator" /><span>Calculadora de<br />pesos e medidas</span><Icon name="expand" /></button>
      </aside></div>
      <section className="home-attention" aria-labelledby="home-attention-title"><div className="home-section-heading"><h2 id="home-attention-title">Atenção da gestão</h2></div><div className="home-attention-items">{pending.map((item) => <button className={`home-attention-item home-attention-item--${item.tone}`} type="button" onClick={item.action} key={item.label}><Icon name={item.icon} /><span>{item.label}</span><strong>{workflowLoading ? '—' : number(item.count)}</strong><Icon name="expand" /></button>)}</div></section>
      <footer className="home-footer"><span><span className="home-live-dot" />Visão da operação</span><span>{workflowLoading ? 'Carregando dados' : workflowError ? 'Atualização indisponível' : `Consultado às ${new Date(now).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' })}`}</span></footer>
    </main>
  </div>
}
