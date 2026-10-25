import { useLayoutEffect, useRef, useState } from 'react'
import { money } from './payablesApi.js'
import { MONTHS, receivableForecast } from './receivableForecast.js'

const monthLabel = (month) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', '').replace(' de ', '/')
const compact = (cents) => { const value = cents / 100; return value >= 1e6 ? `R$ ${(value / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : value >= 1e3 ? `R$ ${(value / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}` }
function niceTicks(max) {
  if (max <= 0) return [0, 100000]
  const raw = max / 4, magnitude = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((n) => n * magnitude).find((n) => n >= raw)
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, index) => index * step)
}
export default function ReceivableForecast({ rows }) {
  const forecast = receivableForecast(rows)
  const [active, setActive] = useState(null), [table, setTable] = useState(false), [width, setWidth] = useState(720)
  const box = useRef(null)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [table])
  const points = forecast.months
  const height = 260, pad = { top: 18, right: width < 520 ? 16 : 112, bottom: 32, left: 76 }
  const ticks = niceTicks(Math.max(...points.map((row) => row.gross)))
  const top = ticks.at(-1), plotWidth = width - pad.left - pad.right, plotHeight = height - pad.top - pad.bottom
  const x = (index) => pad.left + index * plotWidth / (points.length - 1)
  const y = (cents) => pad.top + plotHeight - cents / top * plotHeight
  const path = (key) => points.map((row, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(row[key]).toFixed(1)}`).join(' ')
  const last = points.at(-1), endLabels = pad.right > 100 && Math.abs(y(last.gross) - y(last.net)) >= 16
  const pick = (event) => { const bounds = event.currentTarget.getBoundingClientRect(); const index = Math.round((event.clientX - bounds.left - pad.left) / plotWidth * (points.length - 1)); setActive(Math.min(points.length - 1, Math.max(0, index))) }
  const keys = (event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); setActive((value) => event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.min(points.length - 1, Math.max(0, (value ?? 0) + (event.key === 'ArrowLeft' ? -1 : 1)))) }
  const point = active == null ? null : points[active]
  return <section className="receivable-forecast" aria-labelledby="receivable-forecast-title">
    <h2 id="receivable-forecast-title">Previsão de recebimento</h2>
    <div className="receivable-forecast-cards">
      <article className="receivable-forecast-card"><span>Valor bruto a receber</span><strong>{money(forecast.gross)}</strong><small>Contas pendentes e vencidas{forecast.overdue ? ` · ${money(forecast.overdue)} vencido` : ''}</small></article>
      <article className="receivable-forecast-card"><span>ISS retido previsto</span><strong>{money(forecast.iss)}</strong><small>Informado nas contas a receber</small></article>
      <article className="receivable-forecast-card receivable-forecast-card--net"><span>Valor líquido a receber</span><strong>{money(forecast.net)}</strong><small>Bruto menos o ISS</small></article>
    </div>
    <div className="finance-trend receivable-forecast-chart">
      <div className="finance-trend-heading"><div><h3>Receita dos próximos {MONTHS} meses</h3><p className="payable-muted">Contas ainda não recebidas, pelo mês previsto de recebimento. As vencidas ficam fora do gráfico.</p></div>
        <div className="finance-trend-controls"><button type="button" className="admin-tool-button" aria-pressed={table} onClick={() => setTable(!table)}>{table ? 'Ver gráfico' : 'Ver tabela'}</button></div></div>
      <ul className="finance-trend-legend"><li><svg width="26" height="10" aria-hidden="true"><line className="finance-trend-line forecast-line--gross" x1="1" y1="5" x2="25" y2="5" /><circle className="finance-trend-dot forecast-dot--gross" cx="13" cy="5" r="4" /></svg>A receber bruto</li><li><svg width="26" height="10" aria-hidden="true"><line className="finance-trend-line forecast-line--net" x1="1" y1="5" x2="25" y2="5" /><rect className="finance-trend-dot forecast-dot--net" x="9" y="1" width="8" height="8" rx="1" /></svg>A receber líquido</li></ul>
      {table ? <div className="payable-table-scroll"><table className="payable-table finance-trend-table"><thead><tr><th>Mês</th><th>Bruto</th><th>ISS</th><th>Líquido</th></tr></thead><tbody>{points.map((row) => <tr key={row.month}><td data-label="Mês">{monthLabel(row.month)}</td><td data-label="Bruto">{money(row.gross)}</td><td data-label="ISS">{money(row.gross - row.net)}</td><td data-label="Líquido">{money(row.net)}</td></tr>)}</tbody></table></div> : <div className="finance-trend-plot" ref={box}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Previsão de ${monthLabel(points[0].month)} a ${monthLabel(last.month)}: valores bruto e líquido. Use as setas para percorrer os meses.`} tabIndex={0} onPointerMove={pick} onPointerLeave={() => setActive(null)} onFocus={() => setActive((value) => value ?? 0)} onBlur={() => setActive(null)} onKeyDown={keys}>
          {ticks.map((tick) => <g key={tick}><line className="finance-trend-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} /><text className="finance-trend-axis" x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{compact(tick)}</text></g>)}
          {points.map((row, index) => <text key={row.month} className="finance-trend-axis" x={x(index)} y={height - 10} textAnchor="middle">{monthLabel(row.month)}</text>)}
          {point && <line className="finance-trend-crosshair" x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + plotHeight} />}
          <path className="finance-trend-line forecast-line--net" d={path('net')} />
          <path className="finance-trend-line forecast-line--gross" d={path('gross')} />
          {points.map((row, index) => <g key={row.month}><rect className="finance-trend-dot forecast-dot--net" x={x(index) - 4} y={y(row.net) - 4} width="8" height="8" rx="1" /><circle className="finance-trend-dot forecast-dot--gross" cx={x(index)} cy={y(row.gross)} r="4" /></g>)}
          {endLabels && [['gross', 'Bruto'], ['net', 'Líquido']].map(([key, label]) => <text key={key} className="finance-trend-end" x={x(points.length - 1) + 10} y={y(last[key])} dy="0.32em">{label} {compact(last[key])}</text>)}
        </svg>
        {point && <div className="finance-trend-tooltip" role="status" style={{ left: Math.min(width - 190, Math.max(0, x(active) + 12)), top: pad.top }}><strong>{monthLabel(point.month)}</strong><span><i className="finance-trend-key forecast-key--gross" aria-hidden="true" /><b>{money(point.gross)}</b> bruto</span><span><i className="finance-trend-key forecast-key--net" aria-hidden="true" /><b>{money(point.net)}</b> líquido</span><span>ISS <b>{money(point.gross - point.net)}</b></span></div>}
      </div>}
    </div>
  </section>
}
