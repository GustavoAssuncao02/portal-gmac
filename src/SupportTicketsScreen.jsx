import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CircleCheck, CircleDot, Download, FilterX, Info, Lock, Paperclip, RotateCcw, Search, Send } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { PayableModal, FilePicker } from './PayableModal.jsx'
import { payableRequest, uploadFiles, downloadFile } from './payablesApi.js'
import { SortableRows, SortHeader } from './RegistryList.jsx'
import { latestOnly, pollWhileVisible } from './polling.js'
import { DESCRIPTION_MAX, RESOLUTION_MAX, TITLE_MAX, bahiaDate, bahiaMonth, monthRange, moduleLabel, moduleTitle, statusLabel, submoduleLabel, submodulesOf, ticketModules, ticketUrgencies, urgencyLabel } from '../server/ticketRules.js'
import './payables.css'
import './supportTickets.css'

const dateOf = (at) => new Date(at).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
const timeOf = (at) => new Date(at).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' })
const dateTime = (at) => `${dateOf(at)} às ${timeOf(at)}`
const plain = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const percent = (value) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const ticketCount = (count) => `${count} ${count === 1 ? 'ticket' : 'tickets'}`
const urgencyRank = { low: 1, medium: 2, high: 3 }
const urgencyHints = {
  low: 'Baixo: incomoda, mas dá para contornar e o trabalho segue.',
  medium: 'Médio: atrapalha uma tarefa importante, mas não para a empresa.',
  high: 'Alto: impede o trabalho ou afeta dinheiro, produção ou clientes.',
}
const historyLabels = { opened: 'Ticket aberto', closed: 'Ticket fechado', reopened: 'Ticket reaberto' }
const monthShort = (month) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', '').replace(' de ', '/')
const monthLong = (month) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const shiftMonth = (month, count) => { const [year, number] = month.split('-').map(Number), total = year * 12 + number - 1 + count; return `${Math.floor(total / 12)}-${String(total % 12 + 1).padStart(2, '0')}` }
const noFilters = { search: '', status: 'all', urgency: '', module: '', submodule: '', author: '', from: '', to: '', mine: false }

// The dot has the color of the urgency in the charts; the word carries the meaning.
export function UrgencyBadge({ value }) {
  return <span className={`ticket-urgency ticket-urgency--${value}`}><i className="ticket-urgency-dot" aria-hidden="true" />{urgencyLabel(value)}</span>
}
export function StatusBadge({ value }) {
  const Icon = value === 'closed' ? CircleCheck : CircleDot
  return <span className={`ticket-status ticket-status--${value}`}><Icon size={14} aria-hidden="true" />{statusLabel(value)}</span>
}

// The form: urgency, the module of the problem (a strip of options), title, description and the evidence files.
function NewTicketForm({ onCreated }) {
  const id = useId()
  const empty = { urgency: '', module: '', submodule: '', title: '', description: '' }
  const [draft, setDraft] = useState(empty), [files, setFiles] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [created, setCreated] = useState('')
  const screens = submodulesOf(draft.module)
  async function submit(event) {
    event.preventDefault()
    if (!draft.urgency) return setError('Escolha o grau de urgência.')
    if (!draft.module) return setError('Escolha o módulo do sistema onde está o problema.')
    if (screens.length && !draft.submodule) return setError(`Escolha o sub-módulo de ${moduleLabel(draft.module)} onde está o problema.`)
    setBusy(true); setError(''); setCreated('')
    try {
      const fileIds = await uploadFiles('/support-tickets', files)
      const { item } = await payableRequest('/support-tickets', 'POST', { ...draft, fileIds })
      setDraft(empty); setFiles([]); setCreated(item.id)
      await onCreated(item)
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <section className="ticket-form" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Abrir novo ticket</h2>
    <p className="ticket-guidance" role="note"><Info size={18} aria-hidden="true" /><span><strong>Como relatar o problema:</strong> conte o que você estava fazendo, o que esperava que acontecesse e o que aconteceu de fato (a mensagem de erro, a tela e o número da OS, oferta ou conta envolvida). Anexe prints ou vídeos da tela como evidência: eles ajudam os desenvolvedores a reproduzir e resolver o problema mais rápido.</span></p>
    <form onSubmit={submit}><fieldset className="ticket-form-fields" disabled={busy}>
      <fieldset className="ticket-choice"><legend>Grau de urgência</legend>
        <div className="ticket-urgency-options">{ticketUrgencies.map(([key, label]) => <label key={key} className={`ticket-option ticket-urgency-option ticket-urgency--${key}`}><input type="radio" name={`${id}-urgency`} value={key} required checked={draft.urgency === key} onChange={() => setDraft({ ...draft, urgency: key })} /><i className="ticket-urgency-dot" aria-hidden="true" /><span>{label}</span></label>)}</div>
        <small className="payable-hint">{urgencyHints[draft.urgency] || 'Escolha o quanto o problema atrapalha o trabalho.'}</small>
      </fieldset>
      <fieldset className="ticket-choice"><legend>Módulo do sistema</legend>
        <div className="ticket-module-options">{ticketModules.map(([key, label]) => <label key={key} className="ticket-option ticket-module-option"><input type="radio" name={`${id}-module`} value={key} required checked={draft.module === key} onChange={() => setDraft({ ...draft, module: key, submodule: '' })} /><span>{label}</span></label>)}</div>
      </fieldset>
      {screens.length > 0 && <fieldset className="ticket-choice ticket-submodule"><legend>Sub-módulo de {moduleLabel(draft.module)}</legend><div className="ticket-submodule-body">
        <div className="ticket-module-options">{screens.map(([key, label]) => <label key={key} className="ticket-option ticket-module-option"><input type="radio" name={`${id}-submodule`} value={key} required checked={draft.submodule === key} onChange={() => setDraft({ ...draft, submodule: key })} /><span>{label}</span></label>)}</div>
        <small className="payable-hint">Escolha a tela de {moduleLabel(draft.module)} onde o problema aparece.</small>
      </div></fieldset>}
      <label className="ticket-field">Título<input aria-label="Título" required maxLength={TITLE_MAX} placeholder="Ex.: erro ao salvar a baixa de uma conta a pagar" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label className="ticket-field">Descrição do problema<textarea aria-label="Descrição do problema" required rows={5} maxLength={DESCRIPTION_MAX} placeholder="O que você fazia, o que esperava e o que aconteceu." value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /><small className="ticket-counter">{draft.description.length}/{DESCRIPTION_MAX}</small></label>
      <div className="ticket-files"><FilePicker title="Anexos (evidências do problema)" files={files} setFiles={setFiles} disabled={busy} /><small className="payable-hint"><Lock size={12} aria-hidden="true" /> Os anexos abrem só para você e para os administradores.</small></div>
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
      {created && <p className="ticket-created" role="status"><CircleCheck size={16} aria-hidden="true" />Ticket {created} aberto. Os desenvolvedores foram avisados.</p>}
      <div className="ticket-form-actions"><button className="admin-tool-button admin-tool-button--primary" type="submit"><Send size={16} aria-hidden="true" />{busy ? 'Enviando...' : 'Abrir ticket'}</button></div>
    </fieldset></form>
  </section>
}

const RADIUS = 84, CENTER = 90
function slicePath(start, end) {
  const point = (angle) => [CENTER + RADIUS * Math.sin(angle), CENTER - RADIUS * Math.cos(angle)]
  const [x1, y1] = point(start), [x2, y2] = point(end)
  return `M${CENTER},${CENTER} L${x1.toFixed(2)},${y1.toFixed(2)} A${RADIUS},${RADIUS} 0 ${end - start > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`
}

// A pie with its legend: every slice keeps its color whatever the filters, and the legend gives the counts and shares.
function TicketPie({ title, description, rows }) {
  const [active, setActive] = useState(null)
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  let angle = 0
  const slices = rows.filter((row) => row.count > 0).map((row) => { const start = angle; angle += row.count / total * Math.PI * 2; return { ...row, start, end: angle, share: row.count / total * 100 } })
  const point = slices.find((slice) => slice.key === active)
  return <section className="ticket-chart">
    <h3>{title}</h3><p className="payable-muted">{description}</p>
    {!total ? <p className="payable-muted ticket-chart-empty">Nenhum ticket com estes filtros.</p> : <div className="ticket-pie-layout">
      <div className="ticket-pie-plot">
        <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label={`${title}: ${slices.map((slice) => `${slice.label}, ${ticketCount(slice.count)} (${percent(slice.share)})`).join('; ')}`} onPointerLeave={() => setActive(null)}>
          {slices.length === 1 ? <circle className="ticket-pie-slice" cx={CENTER} cy={CENTER} r={RADIUS} style={{ fill: slices[0].color }} onPointerEnter={() => setActive(slices[0].key)} />
            : slices.map((slice) => <path key={slice.key} className={`ticket-pie-slice${active && active !== slice.key ? ' ticket-pie-slice--dim' : ''}`} d={slicePath(slice.start, slice.end)} style={{ fill: slice.color }} onPointerEnter={() => setActive(slice.key)} />)}
        </svg>
        {point && <div className="ticket-chart-tooltip" role="status"><strong>{point.label}</strong><span>{ticketCount(point.count)} · {percent(point.share)}</span>{point.detail && <small>{point.detail}</small>}</div>}
      </div>
      <ul className="ticket-chart-legend">{slices.map((slice) => <li key={slice.key} className={active === slice.key ? 'ticket-chart-legend--active' : ''} onPointerEnter={() => setActive(slice.key)} onPointerLeave={() => setActive(null)}>
        <i style={{ background: slice.color }} aria-hidden="true" /><span>{slice.label}{slice.detail && <small>{slice.detail}</small>}</span><b>{slice.count}</b><small>{percent(slice.share)}</small>
      </li>)}</ul>
    </div>}
  </section>
}

function integerTicks(max) {
  if (max <= 0) return [0, 1]
  const raw = max / 4, magnitude = 10 ** Math.floor(Math.log10(raw)), step = Math.max(1, [1, 2, 5, 10].map((n) => n * magnitude).find((n) => n >= raw))
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, index) => index * step)
}
function barPath(x, y, width, height) {
  const r = Math.min(4, width / 2, height)
  return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`
}

// Tickets opened per month, from the first ticket (or the start of the period filter) to this month (or its end).
function TicketMonthly({ tickets, from, to }) {
  const box = useRef(null)
  const [width, setWidth] = useState(520), [active, setActive] = useState(null)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const rows = useMemo(() => {
    const opened = tickets.map((ticket) => bahiaMonth(ticket.createdAt))
    const current = bahiaMonth(new Date().toISOString())
    let first = from ? from.slice(0, 7) : opened.length ? opened.reduce((left, right) => left < right ? left : right) : current
    let last = to ? to.slice(0, 7) : current
    if (last < first) last = first
    if (!from && monthRange(first, last).length < 6) first = shiftMonth(last, -5)
    return monthRange(first, last).slice(-24).map((month) => ({ month, count: opened.filter((item) => item === month).length }))
  }, [tickets, from, to])
  const max = Math.max(0, ...rows.map((row) => row.count)), ticks = integerTicks(max), top = ticks.at(-1)
  const height = 220, left = 34, right = 8, upper = 12, lower = 28, plotWidth = width - left - right, plotHeight = height - upper - lower
  const band = plotWidth / rows.length, barWidth = Math.max(6, Math.min(40, band * 0.6))
  const y = (value) => upper + plotHeight - value / top * plotHeight
  const every = rows.length > 12 ? 2 : 1
  const point = rows.find((row) => row.month === active), pointIndex = rows.indexOf(point)
  return <section className="ticket-chart ticket-chart--wide">
    <h3>Tickets abertos por mês</h3><p className="payable-muted">Quantidade de tickets abertos em cada mês, com os filtros aplicados.</p>
    <div className="ticket-month-plot" ref={box}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`Tickets abertos por mês: ${rows.map((row) => `${monthLong(row.month)}, ${row.count}`).join('; ')}`} onPointerLeave={() => setActive(null)}>
        {ticks.map((tick) => <g key={tick}><line className="ticket-month-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} /><text className="ticket-month-axis" x={left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{tick}</text></g>)}
        {rows.map((row, index) => { const x = left + band * index + (band - barWidth) / 2; return <g key={row.month}>
          {row.count > 0 && <path className={`ticket-month-bar${active && active !== row.month ? ' ticket-month-bar--dim' : ''}`} d={barPath(x, y(row.count), barWidth, y(0) - y(row.count))} />}
          {index % every === (rows.length - 1) % every && <text className="ticket-month-axis" x={left + band * index + band / 2} y={height - 8} textAnchor="middle">{monthShort(row.month)}</text>}
          <rect className="ticket-month-hit" x={left + band * index} y={upper} width={band} height={plotHeight} onPointerEnter={() => setActive(row.month)} />
        </g> })}
        <line className="ticket-month-baseline" x1={left} x2={width - right} y1={y(0)} y2={y(0)} />
      </svg>
      {point && <div className="ticket-chart-tooltip ticket-month-tooltip" role="status" style={{ left: `${Math.min(Math.max(left + band * pointIndex + band / 2, 80), width - 80)}px`, top: `${Math.max(y(point.count) - 8, 0)}px` }}><strong>{monthLong(point.month)}</strong><span>{ticketCount(point.count)}</span></div>}
    </div>
    <table className="sr-only"><caption>Tickets abertos por mês</caption><thead><tr><th>Mês</th><th>Tickets</th></tr></thead><tbody>{rows.map((row) => <tr key={row.month}><td>{monthLong(row.month)}</td><td>{row.count}</td></tr>)}</tbody></table>
  </section>
}

// Each module keeps its color while the filters change: the colors follow how many tickets each module has in all, and
// past eight modules the smaller ones are grouped in "Demais módulos".
function moduleSlots(items) {
  const counts = new Map(), order = ticketModules.map(([key]) => key)
  for (const ticket of items) counts.set(ticket.module, (counts.get(ticket.module) || 0) + 1)
  const ranked = [...counts.keys()].sort((left, right) => counts.get(right) - counts.get(left) || order.indexOf(left) - order.indexOf(right))
  return new Map((ranked.length <= 8 ? ranked : ranked.slice(0, 7)).map((key, index) => [key, index + 1]))
}
function moduleRows(tickets, slots) {
  const counts = new Map()
  for (const ticket of tickets) counts.set(ticket.module, (counts.get(ticket.module) || 0) + 1)
  const own = [...slots].filter(([key]) => counts.has(key)).sort((left, right) => left[1] - right[1]).map(([key, slot]) => ({ key, label: moduleLabel(key), count: counts.get(key), color: `var(--ticket-slot-${slot})` }))
  const rest = [...counts.keys()].filter((key) => !slots.has(key))
  return rest.length ? [...own, { key: 'rest', label: 'Demais módulos', detail: rest.map(moduleLabel).join(', '), count: rest.reduce((sum, key) => sum + counts.get(key), 0), color: 'var(--ticket-other)' }] : own
}

function TicketDetail({ ticket, viewer, onClose, onChanged }) {
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const closing = ticket.status === 'open'
  async function change() {
    setBusy(true); setError('')
    try { const { item } = await payableRequest(`/support-tickets/${ticket.id}/status`, 'POST', { status: closing ? 'closed' : 'open', note }); setNote(''); await onChanged(item) } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  const email = ticket.email
  return <PayableModal title={`${ticket.id} · ${ticket.title}`} wide busy={busy} onClose={onClose} className="ticket-detail-modal" footer={<button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Fechar janela</button>}>
    <dl className="ticket-detail-meta">
      <div><dt>Status</dt><dd><StatusBadge value={ticket.status} /></dd></div>
      <div><dt>Urgência</dt><dd><UrgencyBadge value={ticket.urgency} /></dd></div>
      <div><dt>Módulo</dt><dd>{moduleTitle(ticket.module, ticket.submodule)}</dd></div>
      <div><dt>Aberto por</dt><dd>{ticket.createdByName}</dd></div>
      <div><dt>Aberto em</dt><dd>{dateTime(ticket.createdAt)}</dd></div>
    </dl>
    <section className="ticket-detail-block"><h3>Descrição do problema</h3><p className="ticket-detail-text">{ticket.description}</p></section>
    <section className="ticket-detail-block"><h3>Anexos</h3>
      {ticket.attachments.length ? <ul className="ticket-detail-files">{ticket.attachments.map((file) => <li key={file.id}><Paperclip size={14} aria-hidden="true" /><span>{file.name}</span><button type="button" className="payable-icon" title="Baixar" aria-label={`Baixar ${file.name}`} onClick={() => downloadFile(`/api/support-tickets/${ticket.id}/files/${file.id}`, file.name).catch((caught) => setError(caught.message))}><Download size={15} /></button></li>)}</ul>
        : ticket.attachmentsLocked ? <p className="ticket-locked"><Lock size={15} aria-hidden="true" />{ticket.attachmentCount} {ticket.attachmentCount === 1 ? 'anexo' : 'anexos'}. Os anexos abrem só para quem abriu o ticket e para os administradores.</p>
        : <p className="payable-muted">Sem anexos.</p>}
    </section>
    {ticket.status === 'closed' && <section className="ticket-detail-block ticket-resolution"><h3>Resposta do desenvolvedor</h3><p className="ticket-detail-text">{ticket.resolution}</p><small>{ticket.closedByName} · fechado em {dateTime(ticket.closedAt)}</small></section>}
    <section className="ticket-detail-block"><h3>Histórico</h3><ol className="ticket-history">{(ticket.history || []).map((entry, index) => <li key={index}><strong>{historyLabels[entry.type] || entry.type}</strong><span>{entry.userName} · {dateTime(entry.at)}</span>{entry.note && <p>{entry.note}</p>}</li>)}</ol></section>
    {viewer.developer ? <section className="ticket-detail-block ticket-developer"><h3>Ações do desenvolvedor</h3>
      <p className="payable-muted ticket-email-status"><Send size={13} aria-hidden="true" />{email?.sentAt ? `E-mail do ticket enviado aos desenvolvedores em ${dateTime(email.sentAt)}.` : email?.failedAt ? `O e-mail do ticket não foi enviado: ${email.reason}` : email?.skippedAt ? `E-mail do ticket não enviado: ${email.reason}` : 'Enviando o e-mail do ticket aos desenvolvedores...'}</p>
      <label className="ticket-field">{closing ? 'Resposta: como o problema foi resolvido' : 'Motivo da reabertura (opcional)'}<textarea aria-label={closing ? 'Resposta do desenvolvedor' : 'Motivo da reabertura'} rows={3} maxLength={RESOLUTION_MAX} disabled={busy} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="ticket-form-actions"><button className="admin-tool-button admin-tool-button--primary" type="button" disabled={busy || (closing && !note.trim())} onClick={change}>{closing ? <CircleCheck size={16} aria-hidden="true" /> : <RotateCcw size={16} aria-hidden="true" />}{busy ? 'Salvando...' : closing ? 'Fechar ticket' : 'Reabrir ticket'}</button></div>
    </section> : <p className="payable-muted">Somente os desenvolvedores do sistema alteram o status do ticket.</p>}
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}

const columns = [
  { key: 'id', label: 'Ticket', value: (row) => row.id },
  { key: 'title', label: 'Título', value: (row) => row.title },
  { key: 'module', label: 'Módulo', value: (row) => moduleTitle(row.module, row.submodule) },
  { key: 'urgency', label: 'Urgência', value: (row) => urgencyRank[row.urgency], numeric: true },
  { key: 'status', label: 'Status', value: (row) => statusLabel(row.status) },
  { key: 'createdAt', label: 'Aberto em', value: (row) => Date.parse(row.createdAt), numeric: true },
  { key: 'author', label: 'Aberto por', value: (row) => row.createdByName },
  { key: 'files', label: 'Anexos', value: (row) => row.attachmentCount, numeric: true },
]

// Tickets de suporte: anyone of the portal opens a ticket for the developers; every ticket is listed below the form, with
// filters and charts that follow them. Only the developers close and reopen tickets.
export default function SupportTicketsScreen(props) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [filters, setFilters] = useState(noFilters), [openId, setOpenId] = useState(null)
  const reader = useMemo(() => latestOnly(() => payableRequest('/support-tickets')), [])
  const load = () => reader((result) => { setData(result); setError('') })
  useEffect(() => {
    // Opened from a notification: the ticket comes up.
    const wanted = sessionStorage.getItem('gmac-ticket-open')
    if (wanted) { setOpenId(wanted); sessionStorage.removeItem('gmac-ticket-open') }
    load().catch((caught) => setError(caught.message))
    const open = (event) => { sessionStorage.removeItem('gmac-ticket-open'); setOpenId(event.detail); load().catch(() => {}) }
    window.addEventListener('gmac-ticket-open', open)
    const stop = pollWhileVisible(() => load().catch(() => {}), 30000, ['data'])
    return () => { window.removeEventListener('gmac-ticket-open', open); stop() }
  }, [])
  const items = data?.items || [], viewer = data?.viewer || {}
  const set = (field, value) => setFilters((current) => ({ ...current, [field]: value }))
  const term = plain(filters.search.trim())
  const matches = (ticket, skipStatus = false) => (skipStatus || filters.status === 'all' || ticket.status === filters.status)
    && (!filters.urgency || ticket.urgency === filters.urgency) && (!filters.module || ticket.module === filters.module) && (!filters.submodule || ticket.submodule === filters.submodule)
    && (!filters.author || String(ticket.createdBy) === filters.author) && (!filters.mine || ticket.own)
    && (!filters.from || bahiaDate(ticket.createdAt) >= filters.from) && (!filters.to || bahiaDate(ticket.createdAt) <= filters.to)
    && (!term || plain(`${ticket.id} ${ticket.title} ${ticket.description} ${ticket.createdByName} ${moduleTitle(ticket.module, ticket.submodule)}`).includes(term))
  const visible = items.filter((ticket) => matches(ticket))
  const statusCounts = { all: 0, open: 0, closed: 0 }
  for (const ticket of items) if (matches(ticket, true)) { statusCounts.all += 1; statusCounts[ticket.status] += 1 }
  const authors = [...new Map(items.map((ticket) => [String(ticket.createdBy), ticket.createdByName])).entries()].sort((left, right) => left[1].localeCompare(right[1], 'pt-BR'))
  const filtering = JSON.stringify(filters) !== JSON.stringify(noFilters)
  const slots = useMemo(() => moduleSlots(items), [items])
  const urgencyRows = ticketUrgencies.map(([key, label]) => ({ key, label, count: visible.filter((ticket) => ticket.urgency === key).length, color: `var(--ticket-urgency-${key})` }))
  const detail = openId && items.find((ticket) => ticket.id === openId)
  return <AdminWorkspace {...props} title="Tickets de suporte">
    <div className="ticket-screen">
      <p className="payable-muted ticket-intro">Encontrou um problema no portal? Abra um ticket para os desenvolvedores do sistema. Todos os tickets ficam listados abaixo, com quem abriu, a data e a hora.</p>
      <NewTicketForm onCreated={async (item) => { await load().catch(() => {}); setFilters(noFilters); return item }} />
      <section className="ticket-list" aria-labelledby="ticket-list-heading">
        <div className="ticket-list-heading"><h2 id="ticket-list-heading">Tickets</h2>{data && <span className="payable-muted">{visible.length === items.length ? ticketCount(items.length) : `${visible.length} de ${ticketCount(items.length)}`}</span>}</div>
        {error && <p className="admin-tool-error" role="alert">{error}<button className="admin-tool-button" type="button" onClick={() => load().catch((caught) => setError(caught.message))}>Tentar novamente</button></p>}
        {!data ? !error && <p>Carregando...</p> : <>
          <div className="payable-status-filters ticket-status-filters" role="group" aria-label="Filtrar por status">{[['all', 'Todos'], ['open', 'Abertos'], ['closed', 'Fechados']].map(([key, label]) => <button key={key} className="admin-tool-button" type="button" aria-pressed={filters.status === key} onClick={() => set('status', key)}>{label}<span>{statusCounts[key]}</span></button>)}</div>
          <div className="ticket-filters">
            <label className="payable-search ticket-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Buscar tickets" placeholder="Número, título, descrição ou quem abriu" value={filters.search} onChange={(event) => set('search', event.target.value)} /></label>
            <label>Urgência<select aria-label="Filtrar por urgência" value={filters.urgency} onChange={(event) => set('urgency', event.target.value)}><option value="">Todas</option>{ticketUrgencies.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Módulo<select aria-label="Filtrar por módulo" value={filters.module} onChange={(event) => setFilters((current) => ({ ...current, module: event.target.value, submodule: '' }))}><option value="">Todos</option>{ticketModules.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            {submodulesOf(filters.module).length > 0 && <label>Sub-módulo<select aria-label="Filtrar por sub-módulo" value={filters.submodule} onChange={(event) => set('submodule', event.target.value)}><option value="">Todos</option>{submodulesOf(filters.module).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
            <label>Aberto por<select aria-label="Filtrar por quem abriu" value={filters.author} onChange={(event) => set('author', event.target.value)}><option value="">Todos</option>{authors.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
            <label>De<input type="date" aria-label="Aberto a partir de" max={filters.to || undefined} value={filters.from} onChange={(event) => set('from', event.target.value)} /></label>
            <label>Até<input type="date" aria-label="Aberto até" min={filters.from || undefined} value={filters.to} onChange={(event) => set('to', event.target.value)} /></label>
            <label className="ticket-mine"><input type="checkbox" checked={filters.mine} onChange={(event) => set('mine', event.target.checked)} />Meus tickets</label>
            <button className="admin-tool-button" type="button" disabled={!filtering} onClick={() => setFilters(noFilters)}><FilterX size={16} aria-hidden="true" />Limpar filtros</button>
          </div>
          <div className="ticket-charts">
            <TicketPie title="Módulos com mais problemas" description="Tickets por módulo do sistema, com os filtros aplicados." rows={moduleRows(visible, slots)} />
            <TicketPie title="Tickets por urgência" description="Quantos tickets de cada grau de urgência, com os filtros aplicados." rows={urgencyRows} />
            <TicketMonthly tickets={visible} from={filters.from} to={filters.to} />
          </div>
          <SortableRows rows={visible} columns={columns}>{(sorted) => <div className="ticket-table-scroll"><table className="ticket-table">
            <thead><tr>{sorted.columns.map((column) => <SortHeader key={column.key} column={column} list={sorted} />)}</tr></thead>
            <tbody>{sorted.rows.map((ticket) => <tr key={ticket.id} onClick={() => setOpenId(ticket.id)}>
              <td data-label="Ticket"><button className="ticket-open-button" type="button" onClick={(event) => { event.stopPropagation(); setOpenId(ticket.id) }}>{ticket.id}</button></td>
              <td data-label="Título" className="ticket-title-cell">{ticket.title}</td>
              <td data-label="Módulo"><span className="ticket-module-cell">{moduleLabel(ticket.module)}{ticket.submodule && <small>{submoduleLabel(ticket.module, ticket.submodule)}</small>}</span></td>
              <td data-label="Urgência"><UrgencyBadge value={ticket.urgency} /></td>
              <td data-label="Status"><StatusBadge value={ticket.status} /></td>
              <td data-label="Aberto em"><span className="ticket-when">{dateOf(ticket.createdAt)}<small>{timeOf(ticket.createdAt)}</small></span></td>
              <td data-label="Aberto por">{ticket.createdByName}</td>
              <td data-label="Anexos">{ticket.attachmentCount ? <span className="ticket-file-count" title={ticket.attachmentsLocked ? 'Os anexos abrem só para quem abriu o ticket e para os administradores' : undefined}>{ticket.attachmentsLocked ? <Lock size={13} aria-label="Restrito" /> : <Paperclip size={13} aria-hidden="true" />}{ticket.attachmentCount}</span> : <span className="payable-muted">—</span>}</td>
            </tr>)}
            {!sorted.rows.length && <tr><td colSpan={columns.length} className="payable-empty">{items.length ? 'Nenhum ticket encontrado com estes filtros.' : 'Nenhum ticket aberto ainda.'}</td></tr>}
            </tbody></table></div>}</SortableRows>
        </>}
      </section>
      {detail && <TicketDetail key={detail.id} ticket={detail} viewer={viewer} onClose={() => setOpenId(null)} onChanged={async () => { await load().catch(() => {}) }} />}
    </div>
  </AdminWorkspace>
}
