import { useLayoutEffect, useRef, useState } from 'react'
import { money } from './payablesApi.js'
import { niceTicks } from './FinanceTrendChart.jsx'
import { pieSlices } from './cashFlow.js'

const axisMoney = (cents) => `R$ ${(cents / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
const percent = (value) => `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
const signed = (cents) => `${cents < 0 ? '− ' : ''}${money(Math.abs(cents))}`
export function Change({ value, suffix = '' }) {
  if (value == null) return <span className="cash-change cash-change--none">—</span>
  const tone = value > 0 ? 'good' : value < 0 ? 'bad' : 'none'
  return <span className={`cash-change cash-change--${tone}`}>{value > 0 ? '▲' : value < 0 ? '▼' : '='} {percent(Math.abs(value))}{suffix}</span>
}
// Bars grow from the baseline with only their top corners rounded.
function barPath(x, y, width, height) {
  if (height <= 0) return ''
  const r = Math.min(4, height, width / 2)
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`
}
function useWidth(fallback) {
  const box = useRef(null), [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  })
  return [box, width]
}

// Entradas × Saídas. A day shows its two totals side by side; a week shows its days and a month its weeks, each with
// the change of its balance (entries − exits) against the column before: more in green, less in red.
export function CashFlowBars({ buckets, mode, title }) {
  const [box, width] = useWidth(720), [active, setActive] = useState(null), [table, setTable] = useState(false)
  const daily = mode === 'day'
  const groups = daily ? [{ key: 'in', label: 'Entradas', bars: [['in', buckets[0].inCents]], bucket: buckets[0] }, { key: 'out', label: 'Saídas', bars: [['out', buckets[0].outCents]], bucket: buckets[0] }]
    : buckets.map((bucket) => ({ key: bucket.key, label: bucket.label, detail: bucket.detail, bars: [['in', bucket.inCents], ['out', bucket.outCents]], bucket }))
  const height = 300, pad = { top: daily ? 14 : 34, right: 10, bottom: daily ? 30 : 46, left: 78 }
  const ticks = niceTicks(Math.max(...groups.flatMap((group) => group.bars.map(([, cents]) => cents)))), top = ticks.at(-1)
  const plotWidth = width - pad.left - pad.right, plotHeight = height - pad.top - pad.bottom, slot = plotWidth / groups.length
  const y = (cents) => pad.top + plotHeight - cents / top * plotHeight
  // Narrow columns (a month on a phone) take the short names: S1 and 01–04.
  const narrow = slot < 96
  const barWidth = daily ? Math.min(slot * 0.42, 150) : Math.max(4, Math.min((slot * 0.62 - 2) / 2, 46))
  const point = active == null ? null : groups[active]
  const tooltipLeft = point ? Math.min(width - 210, Math.max(0, pad.left + slot * (active + 0.5) + barWidth + 8)) : 0
  return <section className="cash-flow-card cash-flow-bars">
    <div className="cash-flow-chart-heading"><h2>{title}</h2><div>{!daily && <ul className="cash-flow-legend" aria-label="Legenda"><li><i className="cash-key cash-key--in" />Entradas</li><li><i className="cash-key cash-key--out" />Saídas</li></ul>}<button type="button" className="admin-tool-button" aria-pressed={table} onClick={() => setTable(!table)}>{table ? 'Ver gráfico' : 'Ver tabela'}</button></div></div>
    {table ? <div className="payable-table-scroll"><table className="payable-table cash-flow-bucket-table"><thead><tr><th>Período</th><th className="cash-value">Entradas</th><th className="cash-value">Saídas</th><th className="cash-value">Saldo</th><th className="cash-value">Variação</th></tr></thead><tbody>{buckets.map((bucket) => <tr key={bucket.key}><td data-label="Período">{bucket.title}</td><td data-label="Entradas" className="cash-value">{money(bucket.inCents)}</td><td data-label="Saídas" className="cash-value">{money(bucket.outCents)}</td><td data-label="Saldo" className="cash-value">{signed(bucket.balanceCents)}</td><td data-label="Variação" className="cash-value">{bucket.future ? '—' : <Change value={bucket.change} />}</td></tr>)}</tbody></table></div>
      : <div className="cash-flow-plot" ref={box}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${buckets.map((bucket) => `${bucket.title}, entradas ${money(bucket.inCents)}, saídas ${money(bucket.outCents)}`).join('; ')}`}>
          {ticks.map((tick) => <g key={tick}><line className={tick ? 'cash-grid' : 'cash-baseline'} x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} /><text className="cash-axis" x={pad.left - 10} y={y(tick)} dy="0.32em" textAnchor="end">{axisMoney(tick)}</text></g>)}
          {groups.map((group, index) => {
            const center = pad.left + slot * (index + 0.5), span = group.bars.length * barWidth + (group.bars.length - 1) * 2, highest = Math.min(...group.bars.map(([, cents]) => y(cents)))
            return <g key={group.key} className={group.bucket.future ? 'cash-group--future' : undefined}>
              {active === index && <rect className="cash-hover" x={pad.left + slot * index + 2} y={pad.top} width={slot - 4} height={plotHeight} rx="4" />}
              {group.bars.map(([kind, cents], bar) => { const x = center - span / 2 + bar * (barWidth + 2); return <path key={kind} className={`cash-bar cash-bar--${kind}`} d={barPath(x, y(cents), barWidth, y(0) - y(cents))} /> })}
              {!daily && !group.bucket.future && (group.bucket.count > 0 || group.bucket.previousBalanceCents !== 0) && <text className={`cash-chip cash-chip--${group.bucket.change == null ? 'none' : group.bucket.change > 0 ? 'good' : group.bucket.change < 0 ? 'bad' : 'none'}`} x={center} y={highest - 8} textAnchor="middle">{group.bucket.change == null ? '—' : `${group.bucket.change > 0 ? '▲' : group.bucket.change < 0 ? '▼' : '='} ${percent(Math.abs(group.bucket.change))}`}</text>}
              <text className="cash-label" x={center} y={height - pad.bottom + 18} textAnchor="middle">{narrow && group.bucket.shortLabel && !daily ? group.bucket.shortLabel : group.label}</text>
              {group.detail && <text className="cash-axis" x={center} y={height - pad.bottom + 34} textAnchor="middle">{narrow && group.bucket.shortDetail ? group.bucket.shortDetail : group.detail}</text>}
              <rect className="cash-hit" x={pad.left + slot * index} y={pad.top} width={slot} height={plotHeight + pad.bottom} tabIndex={0} aria-label={`${group.bucket.title}: entradas ${money(group.bucket.inCents)}, saídas ${money(group.bucket.outCents)}, saldo ${signed(group.bucket.balanceCents)}`} onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} />
            </g>
          })}
        </svg>
        {point && <div className="cash-tooltip" role="status" style={{ left: tooltipLeft, top: pad.top }}><strong>{point.bucket.title}</strong><span><i className="cash-key cash-key--in" />Entradas <b>{money(point.bucket.inCents)}</b></span><span><i className="cash-key cash-key--out" />Saídas <b>{money(point.bucket.outCents)}</b></span><span>Saldo <b>{signed(point.bucket.balanceCents)}</b></span>{!point.bucket.future && <span>Em relação ao período anterior <Change value={point.bucket.change} /></span>}</div>}
      </div>}
  </section>
}

// Share of each classification in what entered or left. Each classification keeps the color of its place in the list;
// "Outras" and "Sem classificação" are neutral.
export function ClassificationPie({ title, subtitle, rows, empty }) {
  const { total, slices } = pieSlices(rows), [active, setActive] = useState(null)
  const size = 196, outer = 92, inner = 58, center = size / 2
  let slot = 0
  const colored = slices.map((row) => ({ ...row, color: row.id === 'other' ? 'var(--slice-other)' : row.id === 'none' ? 'var(--slice-none)' : `var(--slice-${++slot})` }))
  const point = (radius, angle) => `${(center + radius * Math.cos(angle)).toFixed(2)},${(center + radius * Math.sin(angle)).toFixed(2)}`
  let angle = -Math.PI / 2
  const arcs = colored.map((row) => {
    const sweep = row.cents / total * Math.PI * 2, start = angle, end = angle + sweep
    angle = end
    if (sweep >= Math.PI * 2 - 1e-6) return `M${point(outer, -Math.PI / 2)}A${outer},${outer} 0 1 1 ${point(outer, Math.PI / 2)}A${outer},${outer} 0 1 1 ${point(outer, -Math.PI / 2)}M${point(inner, -Math.PI / 2)}A${inner},${inner} 0 1 0 ${point(inner, Math.PI / 2)}A${inner},${inner} 0 1 0 ${point(inner, -Math.PI / 2)}Z`
    const large = sweep > Math.PI ? 1 : 0
    return `M${point(outer, start)}A${outer},${outer} 0 ${large} 1 ${point(outer, end)}L${point(inner, end)}A${inner},${inner} 0 ${large} 0 ${point(inner, start)}Z`
  })
  const shown = active == null ? null : colored[active]
  const name = (row) => [row.code, row.name].filter(Boolean).join(' · ')
  return <section className="cash-flow-card cash-flow-pie">
    <h2>{title}</h2>{subtitle && <p className="payable-muted">{subtitle}</p>}
    {!total ? <p className="payable-muted cash-flow-empty">{empty}</p> : <div className="cash-pie-body">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title}: ${colored.map((row) => `${name(row)} ${percent(row.percent)}`).join(', ')}`}>
        {arcs.map((path, index) => <path key={colored[index].id} d={path} fill={colored[index].color} fillRule="evenodd" className={`cash-slice${active != null && active !== index ? ' cash-slice--dim' : ''}`} onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} />)}
        <text className="cash-pie-center-label" x={center} y={center - 8} textAnchor="middle">{shown ? percent(shown.percent) : 'Total'}</text>
        <text className="cash-pie-center-value" x={center} y={center + 12} textAnchor="middle">{money(shown ? shown.cents : total)}</text>
      </svg>
      <ul className="cash-pie-legend">{colored.map((row, index) => <li key={row.id} className={active != null && active !== index ? 'cash-pie-legend--dim' : undefined} tabIndex={0} title={row.others ? row.others.map(name).join(', ') : undefined} onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}><i className="cash-key" style={{ background: row.color }} /><span>{name(row)}</span><b>{money(row.cents)}</b><small>{percent(row.percent)}</small></li>)}</ul>
    </div>}
  </section>
}
