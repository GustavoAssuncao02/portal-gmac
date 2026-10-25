import { useEffect, useState } from 'react'
import { Search, RotateCcw, ArrowUpDown, ChevronLeft, ChevronRight, CirclePlus, CircleMinus } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import PayableForm from './PayableForm.jsx'
import PayablePayment from './PayablePayment.jsx'
import PayableDetails from './PayableDetails.jsx'
import { ConfirmAction } from './PayablesScreen.jsx'
import { ReceivableForm, ReceiptForm, ReceivableDetails } from './ReceivablesScreen.jsx'
import { money, dateLabel, payableRequest, downloadPayables } from './payablesApi.js'
import { settlementMethods } from '../server/payableRules.js'
import { treasuryMovements, filterMovements, movementTotals, periodShortcuts } from './treasuryMovements.js'
import { pollWhileVisible } from './polling.js'
import './payables.css'
import { useBanks, bankOptionLabel } from './BankSelect.jsx'

const sortFields = [['date', 'Data'], ['id', 'ID'], ['type', 'Tipo'], ['name', 'Favorecido / Pagador'], ['description', 'Descrição'], ['method', 'Forma'], ['origin', 'Origem'], ['cents', 'Valor']]
const typeLabel = { in: 'Entrada', out: 'Saída' }
const signed = (row) => `${row.type === 'in' ? '+' : '−'} ${money(row.cents)}`
const initialFilters = () => { const [, , start, end] = periodShortcuts().find(([key]) => key === 'month'); return { search: '', type: '', direct: false, bankId: '', start, end } }
const loadAll = async () => { const [payables, receivables] = await Promise.all([payableRequest('/payables'), payableRequest('/receivables')]); return { payables, receivables } }

// Cash book. Money in and out is posted here already settled, with the forms of Contas a Pagar and Contas a Receber.
export default function TreasuryScreen(props) {
  const banks = useBanks()
  const [data, setData] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [version, setVersion] = useState(0)
  const [filters, setFilters] = useState(initialFilters), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [sort, setSort] = useState({ key: 'date', direction: -1 })
  const [form, setForm] = useState(null), [detail, setDetail] = useState(null), [settling, setSettling] = useState(null), [confirm, setConfirm] = useState(null)
  async function refresh() { const result = await loadAll(); setData(result); setVersion((value) => value + 1); setError(''); return result }
  useEffect(() => {
    let active = true
    const load = () => loadAll().then((result) => { if (active) { setData(result); setError('') } }).catch((caught) => { if (active) setError(caught.message) })
    load()
    const stopPolling = pollWhileVisible(load, 30000)
    return () => { active = false; stopPolling() }
  }, [])
  useEffect(() => { setPage(1) }, [filters, pageSize])

  const inPeriod = filterMovements(treasuryMovements(data?.payables.items, data?.receivables.items), filters)
  const totals = movementTotals(inPeriod)
  const filtered = inPeriod.filter((row) => !filters.type || row.type === filters.type).sort((a, b) => { const av = a[sort.key] ?? '', bv = b[sort.key] ?? ''; return sort.direction * (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'pt-BR')) || b.id.localeCompare(a.id) })
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), currentPage = Math.min(page, pages), visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const sortBy = (key) => setSort({ key, direction: sort.key === key ? -sort.direction : key === 'date' || key === 'cents' ? -1 : 1 })
  const posted = (type, id, cents, edited) => setNotice(`${typeLabel[type]} ${id} de ${money(cents)} ${edited ? 'atualizada' : 'registrada'}.`)
  const openForm = (value) => { setNotice(''); setForm(value) }

  // Same actions as the account screens, for the payable opened from the cash book.
  async function payableAction(key, info) {
    const row = info.item
    if (key === 'open') return setDetail({ type: 'out', id: row.id })
    if (key === 'pdf') { try { await downloadPayables({ format: 'pdf', id: row.id }) } catch (caught) { setError(caught.message) } return }
    if (key === 'edit' || key === 'duplicate') { setDetail(null); openForm({ type: 'out', source: row, edit: key === 'edit', treasury: key === 'duplicate', siblings: info.siblings, structureLocked: info.structureLocked }); return }
    if (key === 'pay') { setDetail(null); setSettling({ type: 'out', rows: [row] }); return }
    const titles = { reverse: 'Estornar baixa', delete: 'Excluir lançamento', deactivate: 'Desativar conta', reactivate: 'Reativar conta' }
    setConfirm({ title: titles[key], reasonRequired: key === 'reverse', text: key === 'reverse' ? 'A saída deixa a Tesouraria e volta a ficar em aberto em Contas a Pagar.' : `${titles[key]} ${row.id}?`, onConfirm: async (reason) => { await payableRequest(`/payables/${row.id}${key === 'reverse' ? '/reverse' : key === 'delete' ? '' : '/activation'}`, key === 'delete' ? 'DELETE' : 'POST', key === 'reverse' ? { reason } : key === 'delete' ? undefined : { inactive: key === 'deactivate' }); await refresh(); setConfirm(null); if (key === 'delete' || key === 'reverse') setDetail(null) } })
  }

  return <AdminWorkspace {...props} title="Tesouraria">
    <div className="payable-heading-actions"><button type="button" className="admin-tool-button treasury-add treasury-add--in" onClick={() => openForm({ type: 'in', treasury: true })}><CirclePlus size={17} />Nova entrada</button><button type="button" className="admin-tool-button treasury-add treasury-add--out" onClick={() => openForm({ type: 'out', treasury: true })}><CircleMinus size={17} />Nova saída</button></div>
    <p className="treasury-intro">Dinheiro que já entrou ou saiu. As baixas de Contas a Pagar e de Contas a Receber aparecem aqui automaticamente.</p>
    {error && <p className="admin-tool-error" role="alert">{error}<button className="admin-tool-button" onClick={() => refresh().catch((caught) => setError(caught.message))}>Tentar novamente</button></p>}
    {notice && <p className="treasury-notice" role="status">{notice}</p>}
    {!data ? !error && <p>Carregando...</p> : <div className="treasury-layout">
      <div className="treasury-summary"><article className="payable-metric payable-metric--paid"><span>Entradas</span><strong>{money(totals.inCents)}</strong><small>{totals.inCount} {totals.inCount === 1 ? 'lançamento' : 'lançamentos'}</small></article><article className="payable-metric payable-metric--overdue"><span>Saídas</span><strong>{money(totals.outCents)}</strong><small>{totals.outCount} {totals.outCount === 1 ? 'lançamento' : 'lançamentos'}</small></article><article className={`payable-metric treasury-balance treasury-balance--${totals.balanceCents < 0 ? 'negative' : 'positive'}`}><span>Saldo do período</span><strong>{totals.balanceCents < 0 ? '− ' : ''}{money(Math.abs(totals.balanceCents))}</strong><small>Entradas menos saídas</small></article></div>
      <div className="treasury-list"><div className="payable-toolbar treasury-toolbar"><label className="payable-search"><Search size={18} /><input aria-label="Busca rápida" placeholder="ID, nome, CNPJ, valor, descrição, classificação ou OS" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label><label className="treasury-date">De<input type="date" aria-label="Data inicial" max={filters.end || undefined} value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} /></label><label className="treasury-date">Até<input type="date" aria-label="Data final" min={filters.start || undefined} value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} /></label><label className="treasury-date">Banco<select aria-label="Banco" value={filters.bankId} onChange={(event) => setFilters({ ...filters, bankId: event.target.value })}><option value="">Todos</option>{(banks || []).map((bank) => <option key={bank.id} value={bank.id}>{bankOptionLabel(bank)}</option>)}</select></label><button className="admin-tool-button" onClick={() => setFilters(initialFilters())}><RotateCcw size={16} />Limpar filtros</button></div>
      <div className="payable-quick-filters"><div className="payable-status-filters payable-due-filters" role="group" aria-label="Período"><span className="payable-quick-label" aria-hidden="true">Período:</span>{periodShortcuts().map(([key, label, start, end]) => <button className="admin-tool-button" aria-pressed={filters.start === start && filters.end === end} key={key} onClick={() => setFilters({ ...filters, start, end })}>{label}</button>)}</div>
        <div className="payable-status-filters" role="group" aria-label="Tipo">{[['', 'Todas', inPeriod.length], ['in', 'Entradas', totals.inCount], ['out', 'Saídas', totals.outCount]].map(([key, label, count]) => <button className="admin-tool-button" aria-pressed={filters.type === key} key={key} onClick={() => setFilters({ ...filters, type: key })}>{label}<span>{count}</span></button>)}<button className="admin-tool-button" aria-pressed={filters.direct} title="Mostra só o que foi lançado direto na Tesouraria, sem as baixas das contas" onClick={() => setFilters({ ...filters, direct: !filters.direct })}>Só lançadas aqui</button></div></div>
      <div className="payable-table-scroll"><table className="payable-table treasury-table"><thead><tr>{sortFields.map(([key, label]) => <th key={key} className={key === 'cents' ? 'treasury-value' : undefined} aria-sort={sort.key === key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button onClick={() => sortBy(key)}>{label}<ArrowUpDown size={12} /></button></th>)}</tr></thead><tbody>{visible.map((row) => <tr key={row.id} tabIndex={0} onClick={() => setDetail({ type: row.type, id: row.id })} onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) setDetail({ type: row.type, id: row.id }) }}><td className="treasury-date-cell">{dateLabel(row.date)}</td><td className="payable-id">{row.id}</td><td data-label="Tipo"><span className={`treasury-type treasury-type--${row.type}`}>{typeLabel[row.type]}</span></td><td data-label="Favorecido / Pagador">{row.name}</td><td data-label="Descrição">{row.description || '—'}{row.classification && <small>{row.classification}</small>}</td><td data-label="Forma">{settlementMethods[row.method] || row.method}{row.bankName && <small>{row.bankName}</small>}</td><td data-label="Origem">{row.origin}{row.orderCode && <small>{row.orderCode}</small>}</td><td data-label="Valor" className={`payable-value treasury-value treasury-value--${row.type}`}>{signed(row)}</td></tr>)}{!visible.length && <tr><td colSpan={8} className="payable-empty">Nenhuma movimentação neste período. Use <strong>Nova entrada</strong> ou <strong>Nova saída</strong> para lançar.</td></tr>}</tbody></table></div>
      <div className="payable-pagination"><span>{filtered.length} {filtered.length === 1 ? 'movimentação' : 'movimentações'}</span><label>Por página<select aria-label="Por página" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{[20, 50, 100].map((n) => <option key={n}>{n}</option>)}</select></label><button className="payable-icon" title="Página anterior" aria-label="Página anterior" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button><span>{currentPage} / {pages}</span><button className="payable-icon" title="Próxima página" aria-label="Próxima página" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div></div>
    </div>}
    {detail?.type === 'out' && <PayableDetails id={detail.id} key={detail.id} refreshVersion={version} onClose={() => setDetail(null)} onAction={payableAction} />}
    {detail?.type === 'in' && <ReceivableDetails id={detail.id} key={detail.id} refreshVersion={version} onClose={() => setDetail(null)} onEdit={(info) => { setDetail(null); openForm({ type: 'in', source: info.item, siblings: info.siblings, structureLocked: info.structureLocked }) }} onReceive={(row) => { setDetail(null); setSettling({ type: 'in', rows: [row] }) }} onChanged={refresh} onOpen={(id) => setDetail({ type: 'in', id })} />}
    {form?.type === 'out' && <PayableForm source={form.source} edit={form.edit} treasury={form.treasury} siblings={form.siblings} structureLocked={form.structureLocked} suppliers={data.payables.suppliers} classifications={data.payables.classifications} orders={data.payables.orders || []} items={data.payables.items} onClose={() => setForm(null)} onSupplierCreated={() => refresh().catch(() => {})} onSaved={async (items, close) => { await refresh(); if (items[0].payment) posted('out', items[0].id, items[0].payment.finalCents, form.edit); if (close) setForm(null) }} />}
    {form?.type === 'in' && <ReceivableForm source={form.source} treasury={form.treasury} siblings={form.siblings} structureLocked={form.structureLocked} clients={data.receivables.clients} onClose={() => setForm(null)} onClientCreated={() => refresh().catch(() => {})} onSaved={async (item) => { await refresh(); if (item.receipt) posted('in', item.id, item.receipt.finalCents, Boolean(form.source)); setForm(null) }} />}
    {settling?.type === 'out' && <PayablePayment rows={settling.rows} onClose={() => setSettling(null)} onSaved={async () => { await refresh(); setSettling(null) }} />}
    {settling?.type === 'in' && <ReceiptForm rows={settling.rows} onClose={() => setSettling(null)} onSaved={async () => { await refresh(); setSettling(null) }} />}
    {confirm && <ConfirmAction {...confirm} onClose={() => setConfirm(null)}>{confirm.text && <p>{confirm.text}</p>}</ConfirmAction>}
  </AdminWorkspace>
}
