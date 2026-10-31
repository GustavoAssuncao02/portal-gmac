import { useEffect, useState } from 'react'
import { Search, Plus, X, Check, Trash2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { ConfirmAction } from './PayablesScreen.jsx'
import { money, dateLabel, payableRequest } from './payablesApi.js'
import { filterPayables, todayBahia, dueLabel } from '../server/payableRules.js'
import { pollWhileVisible } from './polling.js'
import './payables.css'
import { batchByClassification, openBalanceByMonth, palette } from './batchSettlement.js'
import './batchSettlement.css'
import BankSelect from './BankSelect.jsx'

const pickerColumns = [['id', 'ID'], ['supplierName', 'Fornecedor'], ['description', 'Descrição'], ['classificationName', 'Classificação'], ['dueDate', 'Vencimento'], ['valueCents', 'Valor']]

const monthLabel = (month) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', '').replace(' de ', '/')
const compact = (cents) => { const value = cents / 100; return value >= 1e6 ? `${(value / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : value >= 1e3 ? `${(value / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : value.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) }

function PieChart({ slices, total }) {
  const radius = 80, center = 100
  let angle = -Math.PI / 2
  const point = (value) => [center + radius * Math.cos(value), center + radius * Math.sin(value)]
  return <section className="batch-card"><h2>Distribuição por classificação</h2>
    {!slices.length ? <p className="payable-muted">Adicione lançamentos para ver a distribuição.</p> : <div className="batch-pie">
      <svg viewBox="0 0 200 200" role="img" aria-label={`Distribuição do valor da baixa: ${slices.map((s) => `${s.name} ${Math.round(s.value / total * 100)}%`).join(', ')}`}>
        {slices.length === 1 ? <circle cx={center} cy={center} r={radius} fill={palette[0]} /> : slices.map((slice, index) => {
          const sweep = slice.value / total * Math.PI * 2, [x1, y1] = point(angle), [x2, y2] = point(angle + sweep)
          const path = `M${center},${center} L${x1.toFixed(2)},${y1.toFixed(2)} A${radius},${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`
          angle += sweep
          return <path key={slice.name} d={path} fill={palette[index]} className="batch-pie-slice"><title>{slice.name}: {money(slice.value)}</title></path>
        })}
      </svg>
      <ul>{slices.map((slice, index) => <li key={slice.name}><i style={{ background: palette[index] }} aria-hidden="true" /><span>{slice.name}</span><strong>{money(slice.value)}</strong><small>{(slice.value / total * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</small></li>)}</ul>
    </div>}
  </section>
}

function EvolutionChart({ rows }) {
  const width = 720, height = 260, pad = { top: 16, right: 12, bottom: 34, left: 56 }
  const max = Math.max(1, ...rows.map((row) => row.now)), plotWidth = width - pad.left - pad.right, plotHeight = height - pad.top - pad.bottom
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((part) => max * part), slot = plotWidth / Math.max(1, rows.length)
  const y = (cents) => pad.top + plotHeight - cents / max * plotHeight
  return <section className="batch-card batch-evolution"><h2>Evolução do contas a pagar</h2>
    <p className="payable-muted">Saldo em aberto por mês de vencimento: como está agora e como ficará após a baixa da lista.</p>
    <ul className="batch-legend"><li><i className="batch-key batch-key--now" aria-hidden="true" />Agora</li><li><i className="batch-key batch-key--after" aria-hidden="true" />Após a baixa</li></ul>
    {!rows.length ? <p className="payable-muted">Nenhuma conta em aberto.</p> : <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Saldo em aberto por mês de vencimento, agora e após a baixa">
      {ticks.map((tick) => <g key={tick}><line className="batch-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} /><text className="batch-axis" x={pad.left - 6} y={y(tick)} dy="0.32em" textAnchor="end">{compact(tick)}</text></g>)}
      {['now', 'after'].map((key) => <path key={key} className={`batch-line batch-line--${key}`} d={rows.map((row, index) => `${index ? 'L' : 'M'}${(pad.left + slot * (index + 0.5)).toFixed(1)},${y(row[key]).toFixed(1)}`).join(' ')} />)}
      {rows.map((row, index) => { const cx = pad.left + slot * (index + 0.5); return <g key={row.month}>
        <circle className="batch-dot batch-dot--now" cx={cx} cy={y(row.now)} r="5"><title>{monthLabel(row.month)} · agora: {money(row.now)}</title></circle>
        <circle className="batch-dot batch-dot--after" cx={cx} cy={y(row.after)} r="4"><title>{monthLabel(row.month)} · após a baixa: {money(row.after)}</title></circle>
        <text className="batch-axis" x={cx} y={height - 12} textAnchor="middle">{monthLabel(row.month)}</text></g> })}
    </svg>}
    {rows.length > 0 && <div className="payable-table-scroll"><table className="payable-table batch-evolution-table"><thead><tr><th>Mês</th><th>Agora</th><th>Após a baixa</th><th>Redução</th></tr></thead><tbody>{rows.map((row) => <tr key={row.month}><td data-label="Mês">{monthLabel(row.month)}</td><td data-label="Agora">{money(row.now)}</td><td data-label="Após a baixa">{money(row.after)}</td><td data-label="Redução">{money(row.now - row.after)}</td></tr>)}</tbody></table></div>}
  </section>
}

function SettleForm({ count, total, onClose, onConfirm }) {
  const [draft, setDraft] = useState({ date: todayBahia(), method: 'pix', bankId: '' })
  return <ConfirmAction title="Efetivar baixa em lote" onClose={onClose} onConfirm={() => onConfirm(draft)}>
    <p>{count} {count === 1 ? 'conta será baixada' : 'contas serão baixadas'}, totalizando <strong>{money(total)}</strong>. Cada uma será paga pelo valor integral.</p>
    <label>Data do pagamento<input type="date" required value={draft.date} max={todayBahia()} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
    <label>Forma de pagamento<select aria-label="Forma de pagamento" value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value })}><option value="pix">Pix</option><option value="boleto">Boleto</option><option value="card">Cartão</option></select></label>
    <BankSelect value={draft.bankId} onChange={(bankId) => setDraft({ ...draft, bankId })} />
  </ConfirmAction>
}

// A single list shared by every administrator: what one person adds, the others see on their next refresh.
export default function BatchSettlementScreen(props) {
  const [items, setItems] = useState([]), [batch, setBatch] = useState({ ids: [] }), [loading, setLoading] = useState(true), [error, setError] = useState(''), [search, setSearch] = useState(''), [dueOnly, setDueOnly] = useState(false), [settling, setSettling] = useState(false), [notice, setNotice] = useState(''), [sort, setSort] = useState({ key: 'dueDate', direction: 1 })
  const load = async () => { const [payables, current] = await Promise.all([payableRequest('/payables'), payableRequest('/payables/batch')]); setItems(payables.items); setBatch(current); setError('') }
  useEffect(() => {
    let active = true
    const run = () => load().catch((caught) => { if (active) setError(caught.message) }).finally(() => { if (active) setLoading(false) })
    run(); const stop = pollWhileVisible(run, 8000, ['finance'])
    return () => { active = false; stop() }
  }, [])
  const change = async (route, method, body) => { try { setBatch(await payableRequest(route, method, body)); setError('') } catch (caught) { setError(caught.message); load().catch(() => {}) } }
  const today = todayBahia(), open = items.filter((row) => !row.payment && !row.inactive)
  const inBatch = batch.ids.map((id) => open.find((row) => row.id === id)).filter(Boolean)
  const total = inBatch.reduce((sum, row) => sum + row.valueCents, 0)
  const available = filterPayables(open, { search }, today).filter((row) => !batch.ids.includes(row.id) && (!dueOnly || row.dueDate <= today)).sort((a, b) => { const av = a[sort.key] ?? '', bv = b[sort.key] ?? ''; return sort.direction * (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'pt-BR')) || a.id.localeCompare(b.id) })
  const shown = available.slice(0, 50)
  // Numbers and dates start from the largest/latest; text starts from A.
  const sortBy = (key) => setSort({ key, direction: sort.key === key ? -sort.direction : key === 'valueCents' ? -1 : 1 })
  async function settle(body) {
    await payableRequest('/payables/batch/settle', 'POST', body)
    setSettling(false); setNotice(`${inBatch.length} ${inBatch.length === 1 ? 'conta baixada' : 'contas baixadas'} com sucesso.`); await load()
  }
  return <AdminWorkspace {...props} title="Baixa em Lote">
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    {notice && <p className="batch-notice" role="status">{notice}<button type="button" className="payable-icon" aria-label="Fechar aviso" onClick={() => setNotice('')}><X size={15} /></button></p>}
    {loading ? <p>Carregando...</p> : <>
      <div className="batch-layout">
        <section className="batch-card">
          <h2>Lista de baixa do dia</h2>
          <p className="payable-muted">Lista única do sistema: todos os administradores veem e alteram os mesmos lançamentos.{batch.updatedAt ? ` Última alteração por ${batch.updatedByName || 'Sistema'} em ${new Date(batch.updatedAt).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}.` : ''}</p>
          <div className="batch-list">{inBatch.map((row) => <div className="batch-item" key={row.id}><div><strong>{row.id} · {row.supplierName}</strong><span>{row.description || '—'} · {row.classificationName}</span><small>{dateLabel(row.dueDate)}{row.daysUntil < 0 ? ` · ${dueLabel(row.daysUntil)}` : ''}</small></div><strong>{money(row.valueCents)}</strong><button type="button" className="payable-icon" title="Remover da lista" aria-label={`Remover ${row.id}`} onClick={() => change(`/payables/batch/items/${row.id}`, 'DELETE')}><X size={16} /></button></div>)}{!inBatch.length && <p className="payable-empty">Nenhum lançamento na lista. Adicione contas abaixo.</p>}</div>
          <div className="batch-total"><span>{inBatch.length} {inBatch.length === 1 ? 'lançamento' : 'lançamentos'}</span><div><small>Total da baixa</small><strong>{money(total)}</strong></div></div>
          <div className="batch-actions"><button type="button" className="admin-tool-button" disabled={!inBatch.length} onClick={() => change('/payables/batch/items', 'DELETE')}><Trash2 size={15} />Limpar lista</button><button type="button" className="admin-tool-button admin-tool-button--primary" disabled={!inBatch.length} onClick={() => setSettling(true)}><Check size={15} />Efetivar baixa</button></div>
        </section>
        <PieChart slices={batchByClassification(inBatch)} total={total} />
      </div>
      <EvolutionChart rows={openBalanceByMonth(open, inBatch.map((row) => row.id))} />
      <section className="batch-card batch-picker">
        <h2>Adicionar lançamentos</h2>
        <div className="payable-toolbar"><label className="payable-search"><Search size={18} /><input aria-label="Buscar contas em aberto" placeholder="ID, fornecedor, descrição ou documento" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="batch-check"><input type="checkbox" checked={dueOnly} onChange={(event) => setDueOnly(event.target.checked)} />Somente vencidas e que vencem hoje</label>{shown.length > 0 && <button type="button" className="admin-tool-button" onClick={() => change('/payables/batch/items', 'POST', { ids: shown.map((row) => row.id) })}><Plus size={15} />Adicionar listadas ({shown.length})</button>}</div>
        <div className="payable-table-scroll batch-picker-scroll"><table className="payable-table batch-picker-table"><thead><tr>{pickerColumns.map(([key, label]) => <th key={key} aria-sort={sort.key === key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => sortBy(key)}>{label}{sort.key !== key ? <ArrowUpDown size={12} /> : sort.direction === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</button></th>)}<th><span className="sr-only">Adicionar</span></th></tr></thead><tbody>{shown.map((row) => <tr key={row.id}><td className="payable-id">{row.id}</td><td data-label="Fornecedor">{row.supplierName}</td><td data-label="Descrição">{row.description || '—'}</td><td data-label="Classificação">{row.classificationName}</td><td data-label="Vencimento">{dateLabel(row.dueDate)}<small className="batch-due">{dueLabel(row.daysUntil)}</small></td><td data-label="Valor" className="payable-value">{money(row.valueCents)}</td><td><button type="button" className="payable-icon" title="Adicionar à lista" aria-label={`Adicionar ${row.id}`} onClick={() => change('/payables/batch/items', 'POST', { ids: [row.id] })}><Plus size={16} /></button></td></tr>)}{!shown.length && <tr><td colSpan={7} className="payable-empty">Nenhuma conta em aberto encontrada.</td></tr>}</tbody></table></div>
        {available.length > shown.length && <p className="payable-muted">Mostrando {shown.length} de {available.length}. Refine a busca para ver as demais.</p>}
      </section>
    </>}
    {settling && <SettleForm count={inBatch.length} total={total} onClose={() => setSettling(false)} onConfirm={settle} />}
  </AdminWorkspace>
}
