import { useEffect, useRef, useState } from 'react'
import { FileDown, Sheet, RefreshCw, Search } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'

const types = [['employees', 'Funcion\u00e1rios'], ['clients', 'Clientes'], ['admins', 'Administradores'], ['employee-hours', 'Horas trabalhadas'], ['machine-hours', 'Horas de m\u00e1quinas'], ['orders', 'Ordens de servi\u00e7o']]
const today = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10)
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}` })

export default function ReportsScreen(props) {
  const [kind, setKind] = useState('employees')
  const [start, setStart] = useState(() => `${today().slice(0, 8)}01`)
  const [end, setEnd] = useState(today)
  const [catalog, setCatalog] = useState({ employees: [], machines: [] })
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [all, setAll] = useState(true)
  const [ids, setIds] = useState([])
  const [search, setSearch] = useState('')
  const [idleHours, setIdleHours] = useState(false)
  const [report, setReport] = useState(null)
  const [section, setSection] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const pending = useRef(null)
  const requiresDates = kind.endsWith('-hours') || kind === 'orders'
  const hasSelection = kind.endsWith('-hours')
  const items = kind === 'machine-hours' ? catalog.machines : catalog.employees
  const selectionLabel = kind === 'machine-hours' ? 'M\u00e1quinas' : 'Funcion\u00e1rios'
  useEffect(() => {
    const controller = new AbortController()
    setCatalogLoading(true)
    fetch('/api/reports/catalog', { headers: headers(), signal: controller.signal }).then(async (response) => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Falha ao carregar os cadastros.')
      if (!controller.signal.aborted) { setCatalog(data); setError('') }
    }).catch((caught) => { if (!controller.signal.aborted) setError(caught.message) }).finally(() => { if (!controller.signal.aborted) setCatalogLoading(false) })
    return () => controller.abort()
  }, [retry])
  useEffect(() => () => pending.current?.abort(), [])
  function change(action) { action(); setReport(null); setError('') }
  async function generate(format) {
    if (requiresDates && (!start || !end || start > end)) return setError('Informe um per\u00edodo v\u00e1lido.')
    if (hasSelection && !all && !ids.length) return setError('Selecione pelo menos um cadastro.')
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setBusy(format || 'preview'); setError('')
    try {
      const response = await fetch(`/api/reports/${format ? 'export' : 'generate'}`, { method: 'POST', headers: headers(), signal: controller.signal, body: JSON.stringify({ kind, start, end, ids: all ? [] : ids, idleHours: kind === 'machine-hours' && idleHours, ...(format ? { format } : {}) }) })
      if (!response.ok) { const data = await response.json(); throw new Error(data.message || 'Falha ao gerar o relat\u00f3rio.') }
      if (format) {
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url; link.download = `gmac-${kind}.${format}`; link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      } else { setReport(await response.json()); setSection(0) }
    } catch (caught) { if (!controller.signal.aborted) setError(caught.message) }
    finally { if (!controller.signal.aborted) setBusy('') }
  }
  const part = report?.sections[section]
  return <AdminWorkspace title="Relatórios" {...props}>
    <form className="reports-filters" onSubmit={(event) => { event.preventDefault(); generate() }}>
      <fieldset disabled={Boolean(busy)}><div className="reports-filter-fields">
        <label>Relatório<select aria-label="Tipo de relatório" value={kind} onChange={(event) => change(() => { setKind(event.target.value); setAll(true); setIds([]); setSearch('') })}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {requiresDates && <><label>Data de início<input type="date" value={start} onChange={(event) => change(() => setStart(event.target.value))} required max={end || undefined} /></label><label>Data de fim<input type="date" value={end} onChange={(event) => change(() => setEnd(event.target.value))} required min={start || undefined} /></label></>}
      </div>
      {hasSelection && <section className="reports-selection" aria-label={selectionLabel}><header><strong>{selectionLabel}</strong><label className="reports-check"><input type="checkbox" checked={all} onChange={(event) => change(() => { setAll(event.target.checked); setIds([]) })} />Todos</label><label className="reports-search"><Search size={15} aria-hidden="true" /><input aria-label={`Buscar ${selectionLabel.toLowerCase()}`} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome" /></label></header>
        {catalogLoading ? <p role="status">Carregando cadastros...</p> : <div className="reports-selection-list">{items.filter((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((item) => <label className="reports-check" key={item.id}><input type="checkbox" checked={all || ids.includes(String(item.id))} onChange={(event) => change(() => { const current = all ? items.map((row) => String(row.id)) : ids; setAll(false); setIds(event.target.checked ? [...new Set([...current, String(item.id)])] : current.filter((id) => id !== String(item.id))) })} />{item.name}</label>)}{!items.length && <p>Nenhum cadastro encontrado.</p>}</div>}
      </section>}
      {kind === 'machine-hours' && <label className="reports-check reports-idle-option"><input type="checkbox" checked={idleHours} onChange={(event) => change(() => setIdleHours(event.target.checked))} />Horas ociosas</label>}
      <div className="reports-actions"><button className="admin-tool-button admin-tool-button--primary" type="submit" disabled={hasSelection && catalogLoading}><Search size={16} />{busy === 'preview' ? 'Gerando...' : 'Consultar'}</button><button className="admin-tool-button" type="button" onClick={() => generate('pdf')}><FileDown size={16} />{busy === 'pdf' ? 'Gerando...' : 'Baixar PDF'}</button><button className="admin-tool-button" type="button" onClick={() => generate('xlsx')}><Sheet size={16} />{busy === 'xlsx' ? 'Gerando...' : 'Baixar Excel'}</button></div>
      </fieldset>
    </form>
    {error && <div className="admin-tool-error" role="alert">{error}<button type="button" className="admin-tool-button" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={15} />Atualizar cadastros</button></div>}
    {report && <section className="reports-result" aria-label="Resultado do relatório"><div className="reports-result-heading"><h2>{report.title}</h2><small>{new Date(report.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}</small></div><dl className="reports-summary">{report.summary.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {report.kind === 'orders' && <p className="reports-period-basis">Data de criação da OS: {report.start} a {report.end}</p>}
      <div className="reports-section-tabs" role="tablist" aria-label="Seções do relatório">{report.sections.map((item, index) => <button key={item.name} type="button" role="tab" aria-selected={section === index} onClick={() => setSection(index)}>{item.name}<span>{item.rows.length}</span></button>)}</div>
      <div className="reports-table-scroll" role="tabpanel" aria-label={part.name}><table><thead><tr>{part.columns.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{part.rows.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column}>{value ?? '\u2014'}</td>)}</tr>)}</tbody></table>{!part.rows.length && <p className="reports-empty">Nenhum registro encontrado.</p>}</div>
      {report.notes.map((note) => <p className="reports-note" key={note}>{note}</p>)}
    </section>}
  </AdminWorkspace>
}
