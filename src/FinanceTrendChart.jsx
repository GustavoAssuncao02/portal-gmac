import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { money, payableRequest } from './payablesApi.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'

const AHEAD = 3
const monthLabel = (month) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', '').replace(' de ', '/')
const compact = (cents) => { const value = cents / 100; return value >= 1e6 ? `R$ ${(value / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : value >= 1e3 ? `R$ ${(value / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}` }
function niceTicks(max) {
  if (max <= 0) return [0, 100000]
  const raw = max / 4, magnitude = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((n) => n * magnitude).find((n) => n >= raw)
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, index) => index * step)
}

// Monthly totals by due month for active accounts; both series share one currency axis.
export function monthlyTotals(payables, receivables, months) {
  const sum = (rows, month) => rows.filter((row) => !row.inactive && row.dueDate?.startsWith(month)).reduce((total, row) => total + row.valueCents, 0)
  return months.map((month) => ({ month, receivable: sum(receivables, month), payable: sum(payables, month) }))
}

export default function FinanceTrendChart({ payables }) {
  const [receivables, setReceivables] = useState(null), [error, setError] = useState(''), [span, setSpan] = useState(12), [active, setActive] = useState(null), [table, setTable] = useState(false), [width, setWidth] = useState(720)
  const box = useRef(null)
  useEffect(() => { payableRequest('/receivables').then((result) => setReceivables(result.items)).catch((caught) => setError(caught.message)) }, [])
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [table, receivables])
  const current = `${todayBahia().slice(0, 7)}-01`
  const months = Array.from({ length: span + AHEAD }, (_, index) => shiftMonth(current, index - span + 1).slice(0, 7))
  const rows = monthlyTotals(payables, receivables || [], months)
  const height = 260, pad = { top: 18, right: 104, bottom: 32, left: 76 }
  const ticks = niceTicks(Math.max(...rows.flatMap((row) => [row.receivable, row.payable])))
  const top = ticks.at(-1), plotWidth = width - pad.left - pad.right, plotHeight = height - pad.top - pad.bottom
  const x = (index) => pad.left + (rows.length === 1 ? plotWidth / 2 : index * plotWidth / (rows.length - 1))
  const y = (cents) => pad.top + plotHeight - cents / top * plotHeight
  const path = (key) => rows.map((row, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(row[key]).toFixed(1)}`).join(' ')
  const labelEvery = Math.ceil(rows.length / Math.max(2, Math.floor(plotWidth / 56)))
  const last = rows.at(-1), endLabels = Math.abs(y(last.receivable) - y(last.payable)) >= 16
  const pick = (event) => { const bounds = event.currentTarget.getBoundingClientRect(); const index = Math.round((event.clientX - bounds.left - pad.left) / plotWidth * (rows.length - 1)); setActive(Math.min(rows.length - 1, Math.max(0, index))) }
  const keys = (event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); setActive((value) => event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, (value ?? rows.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1)))) }
  const point = active == null ? null : rows[active]
  return <section className="payable-chart finance-trend">
    <div className="finance-trend-heading"><div><h2>Evolução mensal: a receber × a pagar</h2><p className="payable-muted">Valores por mês de vencimento, contas ativas. Inclui os próximos {AHEAD} meses.</p></div>
      <div className="finance-trend-controls"><label>Período<select aria-label="Período do gráfico" value={span} onChange={(event) => setSpan(Number(event.target.value))}>{[6, 12, 24].map((n) => <option key={n} value={n}>Últimos {n} meses</option>)}</select></label><button type="button" className="admin-tool-button" aria-pressed={table} onClick={() => setTable(!table)}>{table ? 'Ver gráfico' : 'Ver tabela'}</button></div></div>
    <ul className="finance-trend-legend"><li><svg width="26" height="10" aria-hidden="true"><line className="finance-trend-line finance-trend-line--receivable" x1="1" y1="5" x2="25" y2="5" /><circle className="finance-trend-dot finance-trend-dot--receivable" cx="13" cy="5" r="4" /></svg>Contas a receber</li><li><svg width="26" height="10" aria-hidden="true"><line className="finance-trend-line finance-trend-line--payable" x1="1" y1="5" x2="25" y2="5" /><rect className="finance-trend-dot finance-trend-dot--payable" x="9" y="1" width="8" height="8" rx="1" /></svg>Contas a pagar</li></ul>
    {error && <p className="admin-tool-error" role="alert">Não foi possível carregar as contas a receber: {error}</p>}
    {!receivables && !error ? <p className="payable-muted">Carregando...</p> : table ? <div className="payable-table-scroll"><table className="payable-table finance-trend-table"><thead><tr><th>Mês</th><th>A receber</th><th>A pagar</th><th>Diferença</th></tr></thead><tbody>{rows.map((row) => <tr key={row.month}><td data-label="Mês">{monthLabel(row.month)}{row.month > current.slice(0, 7) ? ' (previsto)' : ''}</td><td data-label="A receber">{money(row.receivable)}</td><td data-label="A pagar">{money(row.payable)}</td><td data-label="Diferença">{money(row.receivable - row.payable)}</td></tr>)}</tbody></table></div> : <div className="finance-trend-plot" ref={box}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Evolução mensal de ${monthLabel(rows[0].month)} a ${monthLabel(last.month)}. Use as setas para percorrer os meses.`} tabIndex={0} onPointerMove={pick} onPointerLeave={() => setActive(null)} onFocus={() => setActive((value) => value ?? rows.length - 1)} onBlur={() => setActive(null)} onKeyDown={keys}>
        {ticks.map((tick) => <g key={tick}><line className="finance-trend-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} /><text className="finance-trend-axis" x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{compact(tick)}</text></g>)}
        {rows.map((row, index) => index % labelEvery === 0 || index === rows.length - 1 ? <text key={row.month} className="finance-trend-axis" x={x(index)} y={height - 10} textAnchor="middle">{monthLabel(row.month)}</text> : null)}
        <line className="finance-trend-today" x1={x(span - 1)} x2={x(span - 1)} y1={pad.top} y2={pad.top + plotHeight} />
        {point && <line className="finance-trend-crosshair" x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + plotHeight} />}
        <path className="finance-trend-line finance-trend-line--payable" d={path('payable')} />
        <path className="finance-trend-line finance-trend-line--receivable" d={path('receivable')} />
        {rows.map((row, index) => <g key={row.month}><rect className="finance-trend-dot finance-trend-dot--payable" x={x(index) - 4} y={y(row.payable) - 4} width="8" height="8" rx="1" /><circle className="finance-trend-dot finance-trend-dot--receivable" cx={x(index)} cy={y(row.receivable)} r="4" /></g>)}
        {endLabels && [['receivable', 'A receber'], ['payable', 'A pagar']].map(([key, label]) => <text key={key} className="finance-trend-end" x={x(rows.length - 1) + 10} y={y(last[key])} dy="0.32em">{label} {compact(last[key])}</text>)}
      </svg>
      {point && <div className="finance-trend-tooltip" role="status" style={{ left: Math.min(width - 190, Math.max(0, x(active) + 12)), top: pad.top }}><strong>{monthLabel(point.month)}{point.month > current.slice(0, 7) ? ' · previsto' : ''}</strong><span><i className="finance-trend-key finance-trend-key--receivable" aria-hidden="true" /><b>{money(point.receivable)}</b> a receber</span><span><i className="finance-trend-key finance-trend-key--payable" aria-hidden="true" /><b>{money(point.payable)}</b> a pagar</span><span>Diferença <b>{money(point.receivable - point.payable)}</b></span></div>}
    </div>}
  </section>
}
