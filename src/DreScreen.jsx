import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, FileDown, Sheet, TriangleAlert } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { PayableModal } from './PayableModal.jsx'
import { money, dateLabel, payableRequest, downloadBlob } from './payablesApi.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'
import { dreColumns, dreCell, visibleDreRows, variation, changeTone, monthBefore, monthLabel, periodLabel, viewLabels, viewHints, entrySourceLabels, entryKindLabels, percentText } from '../server/dreRules.js'
import { useBanks, bankOptionLabel } from './BankSelect.jsx'
import './payables.css'
import './dre.css'

const addMonths = (month, count) => shiftMonth(`${month}-01`, count).slice(0, 7)
const amount = (cents) => cents ? (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–'
// The screen opened from the DRE shows the account (or the adjustment) right away.
const openTargets = { payable: ['gmac-payable-open', 'Contas a Pagar'], receivable: ['gmac-receivable-open', 'Contas a Receber'], adjustment: ['gmac-dre-adjustment-open', 'Ajustes da DRE'] }

function Change({ row, current, previous }) {
  const change = variation(row, current, previous)
  if (!change) return null
  return <small className={`dre-change dre-change--${changeTone(change)}`} title="Em relação ao mês anterior">{change.value > 0 ? '▲' : change.value < 0 ? '▼' : '='} {percentText(Math.abs(change.value))}</small>
}

// The entries behind a line of the DRE: the whole period, or one month when a month cell is opened.
function EntriesModal({ report, target, onClose, onOpen }) {
  const entries = report.entries.filter((entry) => (target.classificationId ? entry.classificationId === target.classificationId : !entry.classificationId) && (target.month ? entry.month === target.month : report.months.includes(entry.month)))
  const total = entries.reduce((sum, entry) => sum + entry.valueCents, 0)
  return <PayableModal title={`${target.label} · ${target.month ? monthLabel(target.month) : periodLabel(report)}`} wide onClose={onClose}>
    <p className="payable-muted">{entries.length} {entries.length === 1 ? 'lançamento' : 'lançamentos'} · total {money(total)} · visão {viewLabels[report.view].toLocaleLowerCase('pt-BR')}</p>
    {!entries.length ? <p>Nenhum lançamento.</p> : <div className="payable-table-scroll"><table className="payable-table dre-entries-table"><thead><tr><th>Data</th><th>Origem</th><th>ID</th><th>Nome</th><th>Descrição</th><th className="dre-value">Valor</th></tr></thead><tbody>
      {entries.map((entry, index) => <tr key={`${entry.refId}:${entry.kind}:${index}`}><td data-label="Data">{dateLabel(entry.date)}</td><td data-label="Origem">{entrySourceLabels[entry.source]}{entry.kind !== 'principal' && entry.kind !== 'adjustment' ? <small>{entryKindLabels[entry.kind]}</small> : null}</td><td data-label="ID"><button type="button" className="payable-link" onClick={() => onOpen(entry)}>{entry.refId}</button></td><td data-label="Nome">{entry.name || '—'}</td><td data-label="Descrição">{entry.description || '—'}</td><td data-label="Valor" className={`dre-value${entry.valueCents < 0 ? ' dre-negative' : ''}`}>{money(entry.valueCents)}</td></tr>)}
    </tbody></table></div>}
  </PayableModal>
}

// DRE: the result of the month (by default the current one) or of a chosen period, by cash or by competência.
export default function DreScreen(props) {
  const current = todayBahia().slice(0, 7), banks = useBanks()
  const [view, setView] = useState('cash'), [range, setRange] = useState('month'), [month, setMonth] = useState(current), [period, setPeriod] = useState({ start: `${current.slice(0, 4)}-01`, end: current })
  const [report, setReport] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [showZero, setShowZero] = useState(false), [target, setTarget] = useState(null), [exporting, setExporting] = useState(false), [bankId, setBankId] = useState('')
  const start = range === 'month' ? month : period.start, end = range === 'month' ? month : period.end
  const valid = /^\d{4}-\d{2}$/.test(start) && /^\d{4}-\d{2}$/.test(end) && start <= end
  useEffect(() => {
    if (!valid) return
    let active = true
    setLoading(true)
    payableRequest(`/dre?view=${view}&start=${start}&end=${end}${bankId ? `&bankId=${encodeURIComponent(bankId)}` : ''}`).then((result) => { if (active) { setReport(result); setError('') } }).catch((caught) => { if (active) setError(caught.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [view, start, end, bankId, valid])
  async function download(format) {
    setExporting(true); setError('')
    try {
      const response = await fetch('/api/dre/export', { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ format, view, start, end, bankId }) })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Falha ao exportar.')
      downloadBlob(await response.blob(), `gmac-dre-${start}${end === start ? '' : `-a-${end}`}.${format}`)
    } catch (caught) { setError(caught.message) } finally { setExporting(false) }
  }
  function openEntry(entry) {
    const [key, page] = openTargets[entry.source]
    sessionStorage.setItem(key, entry.refId)
    props.navigationProps.onNavigate(page)
    window.dispatchEvent(new CustomEvent(key, { detail: entry.refId }))
  }
  const columns = report ? dreColumns(report) : [], rows = report ? visibleDreRows(report, showZero) : []
  const single = report?.months.length === 1
  return <AdminWorkspace {...props} title="DRE">
    <div className="payable-heading-actions"><button className="admin-tool-button" type="button" disabled={exporting || !report} onClick={() => download('pdf')}><FileDown size={16} />PDF</button><button className="admin-tool-button" type="button" disabled={exporting || !report} onClick={() => download('xlsx')}><Sheet size={16} />Excel</button></div>
    <div className="dre-controls">
      <div className="dre-control"><span className="dre-control-label">Visão</span><div className="payable-status-filters" role="group" aria-label="Visão da DRE">{Object.entries(viewLabels).map(([key, label]) => <button key={key} type="button" className="admin-tool-button" aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</div><small className="payable-hint">{viewHints[view]}</small></div>
      <div className="dre-control"><span className="dre-control-label">Período</span><div className="payable-status-filters" role="group" aria-label="Tipo de período">{[['month', 'Mês'], ['period', 'Período personalizado']].map(([key, label]) => <button key={key} type="button" className="admin-tool-button" aria-pressed={range === key} onClick={() => setRange(key)}>{label}</button>)}</div>
        {range === 'month' ? <div className="dre-month-picker"><button type="button" className="payable-icon" title="Mês anterior" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={18} /></button><input type="month" aria-label="Mês da DRE" required value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} /><button type="button" className="payable-icon" title="Próximo mês" aria-label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={18} /></button>{month !== current && <button type="button" className="payable-link" onClick={() => setMonth(current)}>Mês atual</button>}</div>
          : <div className="dre-month-picker"><label>De<input type="month" aria-label="Mês inicial" required max={period.end} value={period.start} onChange={(event) => setPeriod({ ...period, start: event.target.value })} /></label><label>Até<input type="month" aria-label="Mês final" required min={period.start} value={period.end} onChange={(event) => setPeriod({ ...period, end: event.target.value })} /></label><button type="button" className="payable-link" onClick={() => setPeriod({ start: `${current.slice(0, 4)}-01`, end: current })}>Este ano</button><button type="button" className="payable-link" onClick={() => setPeriod({ start: addMonths(current, -11), end: current })}>Últimos 12 meses</button></div>}
      </div>
      <div className="dre-control"><label className="dre-control-label" htmlFor="dre-bank">Banco</label><select id="dre-bank" className="dre-bank" aria-label="Banco" value={bankId} onChange={(event) => setBankId(event.target.value)}><option value="">Todos os bancos</option>{(banks || []).map((bank) => <option key={bank.id} value={bank.id}>{bankOptionLabel(bank)}</option>)}</select>{bankId && <small className="payable-hint">Só as contas baixadas neste banco. Os ajustes da DRE não passam pelo banco e ficam de fora.</small>}</div>
      <label className="payable-mobile-select dre-zero-toggle"><input type="checkbox" checked={showZero} onChange={(event) => setShowZero(event.target.checked)} />Mostrar linhas zeradas</label>
    </div>
    {!valid && <p className="admin-tool-error" role="alert">Informe um período válido: o mês inicial não pode vir depois do mês final.</p>}
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    {report?.unclassified.count > 0 && <p className="bank-warning bank-warning--warning dre-warning"><TriangleAlert size={17} aria-hidden="true" />{report.unclassified.count} {report.unclassified.count === 1 ? 'lançamento sem classificação ficou' : 'lançamentos sem classificação ficaram'} fora da DRE ({money(report.unclassified.inCents)} de entradas e {money(report.unclassified.outCents)} de saídas).<button type="button" className="payable-link" onClick={() => setTarget({ classificationId: null, label: 'Sem classificação' })}>Ver lançamentos</button></p>}
    {!report ? loading && valid && <p>Carregando...</p> : <section className="dre-report" aria-busy={loading}>
      <header className="dre-report-heading"><h2>Demonstração do Resultado · {periodLabel(report)}</h2><span>Visão {viewLabels[report.view].toLocaleLowerCase('pt-BR')}{report.bankName ? ` · ${report.bankName}` : ''} · valores em R${single ? ` · comparado com ${monthLabel(report.previousMonth)}` : ''}</span></header>
      <div className="payable-table-scroll dre-table-scroll"><table className="dre-table"><thead><tr><th scope="col" className="dre-label">Linha da DRE</th>{columns.map((column) => <th scope="col" key={column.key} className="dre-value">{column.label}</th>)}</tr></thead><tbody>
        {rows.map((row) => {
          const openable = row.type === 'line'
          const open = (month) => openable && setTarget({ classificationId: row.classificationId, label: `${row.code} · ${row.label}`, month })
          return <tr key={row.key} className={`dre-row dre-row--${row.type}${row.key === 'net_income' ? ' dre-row--final' : ''}${openable ? ' dre-row--openable' : ''}`} tabIndex={openable ? 0 : undefined} onClick={() => open(null)} onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) open(null) }}>
            <th scope="row" className="dre-label" style={{ '--dre-depth': row.depth || 0 }}>{row.code && <span className="dre-code">{row.code}</span>}{row.label}</th>
            {columns.map((column) => {
              const value = dreCell(report, row, column)
              if (column.type === 'variation') { const change = variation(row, row.values[report.start], row.values[report.previousMonth]); return <td key={column.key} className={`dre-value dre-change--${changeTone(change)}`}>{percentText(value)}</td> }
              if (column.type === 'percent') return <td key={column.key} className="dre-value dre-percent">{percentText(value)}</td>
              return <td key={column.key} className={`dre-value${value < 0 && row.type === 'result' ? ' dre-negative' : ''}${column.month && openable ? ' dre-cell--openable' : ''}`} onClick={column.month && openable ? (event) => { event.stopPropagation(); open(column.month) } : undefined}>{amount(value)}{!single && column.month && value ? <Change row={row} current={value} previous={row.values[monthBefore(report, column.month)]} /> : null}</td>
            })}
          </tr>
        })}
      </tbody></table></div>
      <p className="payable-muted dre-footnote">Clique em uma classificação para ver os lançamentos{single ? '' : ', ou no valor de um mês para ver só os daquele mês'}. As movimentações fora do resultado (transferências, empréstimos, compra de máquinas) aparecem no fim e não entram no lucro.</p>
    </section>}
    {target && report && <EntriesModal report={report} target={target} onClose={() => setTarget(null)} onOpen={(entry) => { setTarget(null); openEntry(entry) }} />}
  </AdminWorkspace>
}
