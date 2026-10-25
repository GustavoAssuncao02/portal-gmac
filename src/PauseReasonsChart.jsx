import { useEffect, useMemo, useState } from 'react'
import { payableRequest } from './payablesApi.js'

const SLOTS = 8
const RADIUS = 110, CENTER = 120
// Each reason keeps its color while the filter changes: the color comes from its place in the alphabetical list of every
// reason, never from its size. Past the eighth, reasons share the neutral "Outras" color.
const colorOf = (index) => index < SLOTS ? `var(--pause-slot-${index + 1})` : 'var(--pause-other)'
const percent = (value) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

function slicePath(start, end) {
  const point = (angle) => [CENTER + RADIUS * Math.sin(angle), CENTER - RADIUS * Math.cos(angle)]
  const [x1, y1] = point(start), [x2, y2] = point(end)
  return `M${CENTER},${CENTER} L${x1.toFixed(2)},${y1.toFixed(2)} A${RADIUS},${RADIUS} 0 ${end - start > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`
}

// How the pauses recorded by the operators are split among the reasons; the checkboxes beside the pie choose which
// reasons enter the total.
export default function PauseReasonsChart({ reasons, version }) {
  const [stats, setStats] = useState(null), [error, setError] = useState(''), [hidden, setHidden] = useState(() => new Set()), [active, setActive] = useState(null)
  useEffect(() => {
    let alive = true
    payableRequest('/pause-reasons/stats').then((result) => { if (alive) { setStats(result.items); setError('') } }).catch((caught) => { if (alive) setError(caught.message) })
    return () => { alive = false }
  }, [version])
  const rows = useMemo(() => {
    const counts = new Map((stats || []).map((row) => [row.name, row.count]))
    for (const reason of reasons) if (!counts.has(reason.name)) counts.set(reason.name, 0)
    return [...counts].map(([name, count]) => ({ name, count })).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')).map((row, index) => ({ ...row, color: colorOf(index), registered: reasons.some((reason) => reason.name === row.name) }))
  }, [stats, reasons])
  const shown = rows.filter((row) => !hidden.has(row.name) && row.count > 0)
  const total = shown.reduce((sum, row) => sum + row.count, 0)
  let angle = 0
  const slices = shown.map((row) => { const start = angle; angle += row.count / total * Math.PI * 2; return { ...row, start, end: angle, share: row.count / total * 100 } })
  const toggle = (name) => setHidden((current) => { const next = new Set(current); next.has(name) ? next.delete(name) : next.add(name); return next })
  const point = active && slices.find((slice) => slice.name === active)
  return <section className="payable-chart pause-reasons-chart">
    <h2>Distribuição das pausas por razão</h2>
    <p className="payable-muted">Quantidade de pausas registradas pelos operadores em todas as OS. Desmarque uma razão para tirá-la do gráfico.</p>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    {!stats && !error ? <p className="payable-muted">Carregando...</p> : <div className="pause-reasons-layout">
      <div className="pause-reasons-plot">
        {total ? <svg viewBox="0 0 240 240" width="240" height="240" role="img" aria-label={`Pausas por razão: ${slices.map((slice) => `${slice.name}, ${slice.count} (${percent(slice.share)})`).join('; ')}`} onPointerLeave={() => setActive(null)}>
          {slices.length === 1 ? <circle className="pause-reasons-slice" cx={CENTER} cy={CENTER} r={RADIUS} style={{ fill: slices[0].color }} onPointerEnter={() => setActive(slices[0].name)} />
            : slices.map((slice) => <path key={slice.name} className={`pause-reasons-slice${active && active !== slice.name ? ' pause-reasons-slice--dim' : ''}`} d={slicePath(slice.start, slice.end)} style={{ fill: slice.color }} onPointerEnter={() => setActive(slice.name)} />)}
        </svg> : <p className="payable-muted pause-reasons-empty">{rows.some((row) => row.count) ? 'Nenhuma razão selecionada.' : 'Nenhuma pausa registrada ainda.'}</p>}
        {point && <div className="pause-reasons-tooltip" role="status"><strong>{point.name}</strong><span>{point.count} {point.count === 1 ? 'pausa' : 'pausas'} · {percent(point.share)}</span></div>}
      </div>
      <fieldset className="pause-reasons-filter"><legend>Razões no gráfico</legend>
        <div className="pause-reasons-filter-actions"><button type="button" className="admin-tool-button" disabled={!hidden.size} onClick={() => setHidden(new Set())}>Marcar todas</button><button type="button" className="admin-tool-button" disabled={hidden.size === rows.length} onClick={() => setHidden(new Set(rows.map((row) => row.name)))}>Desmarcar todas</button></div>
        <ul>{rows.map((row) => { const slice = slices.find((item) => item.name === row.name); return <li key={row.name} onPointerEnter={() => slice && setActive(row.name)} onPointerLeave={() => setActive(null)}>
          <label><input type="checkbox" checked={!hidden.has(row.name)} onChange={() => toggle(row.name)} /><i className="pause-reasons-swatch" style={{ background: row.color }} aria-hidden="true" /><span>{row.name}{!row.registered && <small> (fora do cadastro)</small>}</span></label>
          <b>{row.count}</b><small className="pause-reasons-share">{slice ? percent(slice.share) : '—'}</small>
        </li> })}</ul>
      </fieldset>
    </div>}
  </section>
}
