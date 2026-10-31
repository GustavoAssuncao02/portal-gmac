import { useEffect, useState } from 'react'
import { Search, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { money, dateLabel, payableRequest } from './payablesApi.js'
import { settlementMethods, todayBahia, shiftMonth } from '../server/payableRules.js'
import { treasuryMovements, filterMovements } from './treasuryMovements.js'
import { cashFlowPeriod, cashFlowBuckets, classificationShares, totalsOf, changeOf, addDays } from './cashFlow.js'
import { CashFlowBars, ClassificationPie, Change } from './CashFlowCharts.jsx'
import { pollWhileVisible } from './polling.js'
import { useBanks, bankOptionLabel } from './BankSelect.jsx'
import './payables.css'
import './cashFlow.css'

const sortFields = [['date', 'Data'], ['id', 'ID'], ['type', 'Tipo'], ['name', 'Favorecido / Pagador'], ['description', 'Descrição'], ['classification', 'Classificação'], ['method', 'Forma'], ['origin', 'Origem'], ['cents', 'Valor']]
const typeLabel = { in: 'Entrada', out: 'Saída' }
const signed = (row) => `${row.type === 'in' ? '+' : '−'} ${money(row.cents)}`
const modes = [['day', 'Diário'], ['week', 'Semanal'], ['month', 'Mensal']]
const before = { day: 'ao dia anterior', week: 'à semana anterior', month: 'ao mês anterior' }
const titles = { day: 'Movimentação financeira do dia', week: 'Movimentação financeira da semana', month: 'Movimentação financeira do mês' }
const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const loadAll = async () => { const [payables, receivables] = await Promise.all([payableRequest('/payables'), payableRequest('/receivables')]); return { payables, receivables } }
const step = (mode, anchor, direction) => mode === 'month' ? shiftMonth(`${anchor.slice(0, 7)}-01`, direction) : addDays(anchor, direction * (mode === 'week' ? 7 : 1))
const periodText = (period) => period.mode === 'month' ? `${monthNames[Number(period.start.slice(5, 7)) - 1]} de ${period.start.slice(0, 4)}` : period.mode === 'week' ? `${dateLabel(period.start)} a ${dateLabel(period.end)}` : dateLabel(period.start)

// Fluxo de caixa: what entered and left the cash, by day, week or month. Read only: the money is posted in Tesouraria
// and in the settlements of Contas a Pagar and Contas a Receber.
export default function CashFlowScreen(props) {
  const banks = useBanks(), today = todayBahia()
  const [data, setData] = useState(null), [error, setError] = useState('')
  const [mode, setMode] = useState('day'), [anchor, setAnchor] = useState(today), [bankId, setBankId] = useState('')
  const [filters, setFilters] = useState({ search: '', type: '' }), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [sort, setSort] = useState({ key: 'date', direction: -1 })
  useEffect(() => {
    let active = true
    const load = () => loadAll().then((result) => { if (active) { setData(result); setError('') } }).catch((caught) => { if (active) setError(caught.message) })
    load()
    const stopPolling = pollWhileVisible(load, 30000, ['finance'])
    return () => { active = false; stopPolling() }
  }, [])
  useEffect(() => { setPage(1) }, [filters, pageSize, mode, anchor, bankId])

  const period = cashFlowPeriod(mode, anchor)
  const movements = filterMovements(treasuryMovements(data?.payables.items, data?.receivables.items), { bankId })
  const totals = totalsOf(movements, period.start, period.end), previous = totalsOf(movements, period.previous.start, period.previous.end)
  const buckets = cashFlowBuckets(movements, period, today)
  const shares = classificationShares(data?.payables.items, data?.receivables.items, data?.payables.classifications, { start: period.start, end: period.end, bankId })
  const inPeriod = filterMovements(movements, { start: period.start, end: period.end, search: filters.search })
  const filtered = inPeriod.filter((row) => !filters.type || row.type === filters.type).sort((a, b) => { const av = a[sort.key] ?? '', bv = b[sort.key] ?? ''; return sort.direction * (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'pt-BR')) || b.id.localeCompare(a.id) })
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), currentPage = Math.min(page, pages), visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const sortBy = (key) => setSort({ key, direction: sort.key === key ? -sort.direction : key === 'date' || key === 'cents' ? -1 : 1 })
  const metric = (label, cents, count, tone, change) => <article className={`payable-metric ${tone}`}><span>{label}</span><strong>{cents < 0 ? '− ' : ''}{money(Math.abs(cents))}</strong><small>{count != null ? `${count} ${count === 1 ? 'movimentação' : 'movimentações'}` : <><Change value={change} /> em relação {before[mode]}</>}</small></article>
  return <AdminWorkspace {...props} title="Fluxo de caixa">
    <p className="treasury-intro">Dinheiro que entrou e saiu do caixa no período: pagamentos e recebimentos já baixados, os mesmos da Tesouraria.</p>
    {error && <p className="admin-tool-error" role="alert">{error}<button className="admin-tool-button" type="button" onClick={() => loadAll().then(setData).catch((caught) => setError(caught.message))}>Tentar novamente</button></p>}
    <div className="cash-flow-controls">
      <div className="payable-status-filters" role="group" aria-label="Visão do fluxo de caixa">{modes.map(([key, label]) => <button key={key} type="button" className="admin-tool-button" aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>)}</div>
      <div className="cash-flow-period"><button type="button" className="payable-icon" title="Período anterior" aria-label="Período anterior" onClick={() => setAnchor(step(mode, anchor, -1))}><ChevronLeft size={18} /></button>
        {mode === 'month' ? <input type="month" aria-label="Mês" value={anchor.slice(0, 7)} onChange={(event) => event.target.value && setAnchor(`${event.target.value}-01`)} /> : <input type="date" aria-label={mode === 'week' ? 'Dia da semana' : 'Dia'} value={anchor} onChange={(event) => event.target.value && setAnchor(event.target.value)} />}
        <button type="button" className="payable-icon" title="Próximo período" aria-label="Próximo período" onClick={() => setAnchor(step(mode, anchor, 1))}><ChevronRight size={18} /></button>
        <strong>{periodText(period)}</strong>{(anchor < period.start || anchor > period.end || today < period.start || today > period.end) && <button type="button" className="payable-link" onClick={() => setAnchor(today)}>Voltar para hoje</button>}</div>
      <label className="cash-flow-bank">Banco<select aria-label="Banco" value={bankId} onChange={(event) => setBankId(event.target.value)}><option value="">Todos os bancos</option>{(banks || []).map((bank) => <option key={bank.id} value={bank.id}>{bankOptionLabel(bank)}</option>)}</select></label>
    </div>
    {!data ? !error && <p>Carregando...</p> : <div className="cash-flow">
      <div className="treasury-summary">{metric('Entradas', totals.inCents, movements.filter((row) => row.type === 'in' && row.date >= period.start && row.date <= period.end).length, 'payable-metric--paid')}{metric('Saídas', totals.outCents, movements.filter((row) => row.type === 'out' && row.date >= period.start && row.date <= period.end).length, 'payable-metric--overdue')}{metric('Saldo do período', totals.balanceCents, null, `treasury-balance treasury-balance--${totals.balanceCents < 0 ? 'negative' : 'positive'}`, changeOf(totals.balanceCents, previous.balanceCents))}</div>
      <CashFlowBars key={`${mode}:${period.start}`} buckets={buckets} mode={mode} title={titles[mode]} />
      <div className="cash-flow-pies">
        <ClassificationPie title="Custos por classificação" subtitle="Saídas do período, pela classificação de cada conta paga." rows={shares.out} empty="Nenhuma saída no período." />
        <ClassificationPie title="Receitas por classificação" subtitle="Entradas do período, pela classificação de cada conta recebida." rows={shares.in} empty="Nenhuma entrada no período." />
      </div>
      <section className="cash-flow-list"><h2>Movimentações do período</h2>
        <div className="payable-toolbar cash-flow-toolbar"><label className="payable-search"><Search size={18} /><input aria-label="Busca rápida" placeholder="ID, nome, CNPJ, valor, descrição, classificação ou OS" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label>
          <div className="payable-status-filters" role="group" aria-label="Tipo">{[['', 'Todas', inPeriod.length], ['in', 'Entradas', inPeriod.filter((row) => row.type === 'in').length], ['out', 'Saídas', inPeriod.filter((row) => row.type === 'out').length]].map(([key, label, count]) => <button type="button" className="admin-tool-button" aria-pressed={filters.type === key} key={key} onClick={() => setFilters({ ...filters, type: key })}>{label}<span>{count}</span></button>)}</div></div>
        <div className="payable-table-scroll"><table className="payable-table treasury-table cash-flow-table"><thead><tr>{sortFields.map(([key, label]) => <th key={key} className={key === 'cents' ? 'treasury-value' : undefined} aria-sort={sort.key === key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => sortBy(key)}>{label}<ArrowUpDown size={12} /></button></th>)}</tr></thead><tbody>
          {visible.map((row) => <tr key={`${row.type}:${row.id}`}><td className="treasury-date-cell">{dateLabel(row.date)}</td><td className="payable-id" data-label="ID">{row.id}</td><td data-label="Tipo"><span className={`treasury-type treasury-type--${row.type}`}>{typeLabel[row.type]}</span></td><td data-label="Favorecido / Pagador">{row.name || '—'}</td><td data-label="Descrição">{row.description || '—'}</td><td data-label="Classificação">{row.classification || '—'}</td><td data-label="Forma">{settlementMethods[row.method] || row.method || '—'}{row.bankName ? <small>{row.bankName}</small> : null}</td><td data-label="Origem">{row.origin}{row.orderCode ? <small>{row.orderCode}</small> : null}</td><td data-label="Valor" className={`payable-value treasury-value treasury-value--${row.type}`}>{signed(row)}</td></tr>)}
          {!visible.length && <tr><td colSpan={sortFields.length} className="payable-empty">Nenhuma movimentação no período.</td></tr>}
        </tbody></table></div>
        <div className="payable-pagination"><span>{filtered.length} {filtered.length === 1 ? 'movimentação' : 'movimentações'}</span><label>Por página<select aria-label="Por página" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{[20, 50, 100].map((n) => <option key={n}>{n}</option>)}</select></label><button type="button" className="payable-icon" title="Página anterior" aria-label="Página anterior" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button><span>{currentPage} / {pages}</span><button type="button" className="payable-icon" title="Próxima página" aria-label="Próxima página" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div>
      </section>
    </div>}
  </AdminWorkspace>
}
