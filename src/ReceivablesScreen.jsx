import { useEffect, useId, useState } from 'react'
import { Plus, Search, RotateCcw, Info, FileDown, Sheet, Check, Pencil, Undo2, Trash2, Save, Link2 } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { PayableModal } from './PayableModal.jsx'
import { money, decimal, dateLabel, payableRequest, downloadBlob } from './payablesApi.js'
import { todayBahia, cents } from '../server/payableRules.js'
import './payables.css'

export const receiptMethods = { pix: 'Pix', boleto: 'Boleto', transfer: 'Transferência', card: 'Cartão', cash: 'Dinheiro' }
const statusText = { pending: 'Pendente', overdue: 'Vencido', received: 'Recebido' }
const historyLabels = { created: 'Conta criada', edited: 'Conta editada', received: 'Recebimento baixado', reversed: 'Recebimento estornado', deleted: 'Conta excluída', status_changed: 'Status alterado' }
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const documentLabel = (digits) => !digits ? '—' : digits.length === 14 ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

export function ReceivableStatus({ row }) {
  const warning = row.status === 'pending' && row.daysUntil <= 3
  return <span className={`payable-status payable-status--${row.status === 'received' ? 'paid' : warning ? 'soon' : row.status}`}><strong>{statusText[row.status]}</strong>{!row.receipt && (row.daysUntil < 0 ? <small>Vencida há {Math.abs(row.daysUntil)} dias</small> : warning && <small>{row.daysUntil === 0 ? 'Vence hoje' : `Vence em ${row.daysUntil} dias`}</small>)}</span>
}

async function exportReceivables(body) {
  const response = await fetch('/api/receivables/export', { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Falha ao exportar.')
  downloadBlob(await response.blob(), `gmac-${body.id || 'contas-a-receber'}.${body.format}`)
}

function ReceivableForm({ source, clients, onClose, onSaved }) {
  const formId = useId(), fromOrder = source?.origin === 'order'
  const [draft, setDraft] = useState(() => source ? { clientId: source.clientId || '', customerName: source.customerName, customerDocument: source.customerDocument || '', description: source.description, documentNumber: source.documentNumber, issueDate: source.issueDate, value: decimal(source.valueCents), dueDate: source.dueDate } : { clientId: '', customerName: '', customerDocument: '', description: '', documentNumber: '', issueDate: todayBahia(), value: '', dueDate: '' })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const change = (key, value) => setDraft({ ...draft, [key]: value })
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { const result = await payableRequest(source ? `/receivables/${source.id}` : '/receivables', source ? 'PUT' : 'POST', { ...draft, clientId: draft.clientId || undefined }); await onSaved(result.item) } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title={source ? `Editar ${source.id}` : 'Nova conta a receber'} className="payable-modal--form" wide busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" form={formId} type="submit" disabled={busy}><Save size={16} />{busy ? 'Salvando...' : 'Salvar conta'}</button></>}>
    <form id={formId} onSubmit={save} className="payable-form payable-entry-form"><fieldset disabled={busy}>
      {fromOrder ? <p className="payable-form-wide receivable-origin">Pagador da {source.orderCode}: <strong>{source.customerName}</strong>{source.customerDocument ? ` · ${documentLabel(source.customerDocument)}` : ''}</p> : <>
        <label className="payable-form-wide">Cliente cadastrado<select aria-label="Cliente cadastrado" value={draft.clientId} onChange={(event) => { const client = clients.find((row) => row.id === event.target.value); setDraft({ ...draft, clientId: event.target.value, customerName: client?.name || '', customerDocument: client?.document || '' }) }}><option value="">Outro pagador (informar abaixo)</option>{clients.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        {!draft.clientId && <><label>Nome do pagador<input required maxLength={160} value={draft.customerName} onChange={(event) => change('customerName', event.target.value)} /></label><label>CPF/CNPJ do pagador<input inputMode="numeric" maxLength={18} value={draft.customerDocument} onChange={(event) => change('customerDocument', event.target.value.replace(/\D/g, ''))} /></label></>}
      </>}
      <label className="payable-form-wide">Descrição<textarea aria-label="Descrição" rows={1} maxLength={5000} value={draft.description} onChange={(event) => change('description', event.target.value)} /></label>
      <label>Número do documento / boleto / nota fiscal<input maxLength={160} value={draft.documentNumber} onChange={(event) => change('documentNumber', event.target.value)} /></label>
      <label>Data de emissão<input type="date" required value={draft.issueDate} onChange={(event) => change('issueDate', event.target.value)} /></label>
      <label>Valor<input type="number" step="0.01" min="0.01" required value={draft.value} onChange={(event) => change('value', event.target.value)} /></label>
      <label>Data prevista de recebimento<input type="date" required value={draft.dueDate} onChange={(event) => change('dueDate', event.target.value)} /></label>
      {error && <p className="admin-tool-error payable-form-wide" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}

function ReceiptForm({ row, onClose, onSaved }) {
  const formId = useId(), [draft, setDraft] = useState({ date: todayBahia(), method: 'pix', interest: '', discount: '', note: '' }), [busy, setBusy] = useState(false), [error, setError] = useState('')
  let interest = 0, discount = 0
  try { interest = cents(draft.interest || '0'); discount = cents(draft.discount || '0') } catch { /* Numeric validation occurs on submit. */ }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await payableRequest(`/receivables/${row.id}/receive`, 'POST', draft); await onSaved() } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title={`Dar baixa · ${row.id}`} busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={formId} disabled={busy}><Check size={16} />Confirmar recebimento</button></>}>
    <form id={formId} className="payable-form" onSubmit={submit}><fieldset disabled={busy}>
      <label>Data do recebimento<input type="date" required max={todayBahia()} value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
      <label>Forma de recebimento<select aria-label="Forma de recebimento" value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value })}>{Object.entries(receiptMethods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Juros (R$)<input type="number" min="0" step="0.01" value={draft.interest} disabled={discount > 0} onChange={(event) => setDraft({ ...draft, interest: event.target.value })} /></label>
      <label>Desconto (R$)<input type="number" min="0" step="0.01" value={draft.discount} disabled={interest > 0} onChange={(event) => setDraft({ ...draft, discount: event.target.value })} /></label>
      <div className="payable-final"><span>{money(row.valueCents)}{interest ? ` + ${money(interest)} de juros` : ''}{discount ? ` − ${money(discount)} de desconto` : ''} =</span><strong>{money(row.valueCents + interest - discount)}</strong></div>
      <label>Observação<textarea aria-label="Observação" rows={3} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}

function History({ rows }) {
  return <ol className="payable-history">{rows.map((row) => <li key={row.id}><div><strong>{historyLabels[row.type] || row.type}</strong><span>{row.accountId}</span></div><small>{new Date(row.at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })} · {row.userName}</small>{row.reason && <p>{row.reason}</p>}{row.details?.text && <p>{row.details.text}</p>}{row.type === 'received' && <p>{money(row.details.finalCents)} · {dateLabel(row.details.date)} · {receiptMethods[row.details.method]}{row.details.note ? ` · ${row.details.note}` : ''}</p>}{row.type === 'edited' && row.changes && ['valueCents', 'dueDate', 'description'].filter((key) => row.changes.before[key] !== row.changes.after[key]).map((key) => <p key={key}>{{ valueCents: 'Valor', dueDate: 'Vencimento', description: 'Descrição' }[key]}: {key === 'valueCents' ? money(row.changes.before[key]) : key === 'dueDate' ? dateLabel(row.changes.before[key]) : row.changes.before[key] || '—'} → {key === 'valueCents' ? money(row.changes.after[key]) : key === 'dueDate' ? dateLabel(row.changes.after[key]) : row.changes.after[key] || '—'}</p>)}</li>)}{!rows.length && <li>Nenhuma movimentação.</li>}</ol>
}

function ReasonForm({ title, onClose, onConfirm }) {
  const formId = useId(), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <PayableModal title={title} busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={formId} disabled={busy}>Confirmar</button></>}><form id={formId} onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await onConfirm(reason) } catch (caught) { setError(caught.message) } finally { setBusy(false) } }}>{onConfirm.length ? <label>Motivo<textarea required minLength={10} maxLength={1000} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} /></label> : <p>Esta ação não pode ser desfeita.</p>}{error && <p className="admin-tool-error" role="alert">{error}</p>}</form></PayableModal>
}

function ReceivableDetails({ id, refreshVersion, onClose, onEdit, onReceive, onChanged }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [confirm, setConfirm] = useState(null), [version, setVersion] = useState(0), [exporting, setExporting] = useState(false)
  useEffect(() => { let active = true; payableRequest(`/receivables/${id}`).then((result) => { if (active) { setData(result); setError('') } }).catch((caught) => { if (active) setError(caught.message) }); return () => { active = false } }, [id, version, refreshVersion])
  const row = data?.item, received = Boolean(row?.receipt)
  const actions = row ? [['edit', 'Editar', Pencil, received || row.reconciled], ['receive', 'Dar baixa', Check, received], ['reverse', 'Estornar recebimento', Undo2, !received || row.reconciled], ['delete', 'Excluir', Trash2, !data.canDelete || row.reconciled], ['pdf', 'Gerar PDF individual', FileDown, exporting]] : []
  async function run(key) {
    if (key === 'edit') return onEdit(row)
    if (key === 'receive') return onReceive(row)
    if (key === 'pdf') { setExporting(true); try { await exportReceivables({ format: 'pdf', id: row.id }) } catch (caught) { setError(caught.message) } finally { setExporting(false) } return }
    setConfirm(key === 'reverse' ? { title: 'Estornar recebimento', onConfirm: async (reason) => { await payableRequest(`/receivables/${row.id}/reverse`, 'POST', { reason }); setConfirm(null); setVersion((v) => v + 1); await onChanged() } } : { title: `Excluir ${row.id}?`, onConfirm: async () => { await payableRequest(`/receivables/${row.id}`, 'DELETE'); setConfirm(null); await onChanged(); onClose() } })
  }
  return <PayableModal title={id} wide onClose={onClose} footer={row && <div className="payable-detail-actions">{actions.map(([key, label, Icon, disabled]) => <button type="button" className={`admin-tool-button ${key === 'receive' ? 'admin-tool-button--primary' : ''}`} key={key} disabled={disabled} onClick={() => run(key)}><Icon size={15} />{label}</button>)}</div>}>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}{!row ? !error && <p>Carregando conta...</p> : <>
      <section><h3>Dados principais</h3><dl className="payable-facts">{[['Cliente', row.customerName], ['CPF/CNPJ', documentLabel(row.customerDocument)], ['Descrição', row.description || '—'], ['Origem', row.orderCode ? `Conclusão da ${row.orderCode}` : 'Lançamento manual'], ['Documento / boleto / NF', row.documentNumber || '—'], ['Emissão', dateLabel(row.issueDate)], ['Valor', money(row.valueCents)], ['Recebimento previsto', dateLabel(row.dueDate)], ['Status', statusText[row.status]], ['Conciliação bancária', row.reconciled ? 'Conciliada com o extrato' : 'Não conciliada']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {received && <><h3>Recebimento</h3><dl className="payable-facts">{[['Data', dateLabel(row.receipt.date)], ['Forma', receiptMethods[row.receipt.method]], ['Juros', money(row.receipt.interestCents)], ['Desconto', money(row.receipt.discountCents)], ['Valor recebido', money(row.receipt.finalCents)], ['Observação', row.receipt.note || '—']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></>}
        {row.reconciled && <p className="payable-muted"><Link2 size={14} aria-hidden="true" /> Para editar, estornar ou excluir, desfaça antes a conciliação em Conciliação bancária.</p>}
      </section>
      <section><h3>Histórico</h3><History rows={data.history} /></section>
    </>}
    {confirm && <ReasonForm {...confirm} onClose={() => setConfirm(null)} />}
  </PayableModal>
}

export default function ReceivablesScreen(props) {
  const [data, setData] = useState({ items: [], clients: [] }), [loading, setLoading] = useState(true), [error, setError] = useState(''), [version, setVersion] = useState(0)
  const [filters, setFilters] = useState({ search: '', status: '' }), [detailId, setDetailId] = useState(''), [form, setForm] = useState(null), [receiving, setReceiving] = useState(null), [history, setHistory] = useState(null), [exporting, setExporting] = useState(false)
  async function refresh() { const result = await payableRequest('/receivables'); setData(result); setVersion((v) => v + 1); setError(''); return result }
  useEffect(() => {
    let active = true
    const load = () => payableRequest('/receivables').then((result) => { if (active) { setData(result); setError(''); setLoading(false) } }).catch((caught) => { if (active) { setError(caught.message); setLoading(false) } })
    load(); const timer = setInterval(load, 30000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  const search = normalize(filters.search)
  const rows = data.items.filter((row) => (!search || normalize([row.id, row.customerName, row.customerDocument, row.description, row.documentNumber, row.orderCode].join(' ')).includes(search)) && (filters.status === 'all' || (filters.status ? row.status === filters.status : row.status !== 'received'))).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
  const totals = { pending: 0, overdue: 0, received: 0 }
  for (const row of data.items) totals[row.status] += row.receipt ? row.receipt.finalCents : row.valueCents
  async function exportRows(format) { setExporting(true); setError(''); try { await exportReceivables({ format, filters }) } catch (caught) { setError(caught.message) } finally { setExporting(false) } }
  return <AdminWorkspace {...props} title="Contas a Receber">
    <div className="payable-heading-actions"><button type="button" className="payable-icon" title="Histórico geral" aria-label="Histórico geral" onClick={async () => { try { setHistory((await payableRequest('/receivables/history')).items) } catch (caught) { setError(caught.message) } }}><Info size={21} /></button><button className="admin-tool-button admin-tool-button--primary" onClick={() => setForm({})}><Plus size={17} />Nova conta a receber</button></div>
    {error && <p className="admin-tool-error" role="alert">{error}<button className="admin-tool-button" onClick={() => refresh().catch((caught) => setError(caught.message))}>Tentar novamente</button></p>}
    {loading ? <p>Carregando...</p> : <>
      <div className="receivable-summary">{[['pending', 'A receber'], ['overdue', 'Vencido'], ['received', 'Recebido']].map(([key, label]) => <article className={`payable-metric payable-metric--${key === 'received' ? 'paid' : key}`} key={key}><span>{label}</span><strong>{money(totals[key])}</strong><small>{data.items.filter((row) => row.status === key).length} contas</small></article>)}</div>
      <div className="payable-toolbar"><label className="payable-search"><Search size={18} /><input aria-label="Busca rápida" placeholder="ID, cliente, descrição, documento ou OS" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label><button className="admin-tool-button" onClick={() => setFilters({ search: '', status: '' })}><RotateCcw size={16} />Limpar filtros</button><button className="admin-tool-button" disabled={exporting} onClick={() => exportRows('pdf')}><FileDown size={16} />PDF</button><button className="admin-tool-button" disabled={exporting} onClick={() => exportRows('xlsx')}><Sheet size={16} />Excel</button></div>
      <div className="payable-status-filters">{[['pending', 'Pendentes'], ['overdue', 'Vencidas'], ['received', 'Recebidas'], ['all', 'Todas']].map(([key, label]) => <button className="admin-tool-button" aria-pressed={filters.status === key} key={key} onClick={() => setFilters({ ...filters, status: filters.status === key ? '' : key })}>{label}<span>{key === 'all' ? data.items.length : data.items.filter((row) => row.status === key).length}</span></button>)}</div>
      <div className="payable-table-scroll"><table className="payable-table receivable-table"><thead><tr><th>ID</th><th>Cliente</th><th>Descrição</th><th>Origem</th><th>Valor</th><th>Vencimento</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} tabIndex={0} onClick={() => setDetailId(row.id)} onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) setDetailId(row.id) }}><td className="payable-id">{row.id}</td><td data-label="Cliente">{row.customerName}</td><td data-label="Descrição">{row.description || '—'}</td><td data-label="Origem">{row.orderCode || 'Manual'}</td><td data-label="Valor" className="payable-value">{money(row.valueCents)}</td><td data-label="Vencimento">{dateLabel(row.dueDate)}</td><td data-label="Status"><ReceivableStatus row={row} />{row.reconciled && <small className="receivable-reconciled"><Link2 size={12} aria-hidden="true" />Conciliada</small>}</td></tr>)}{!rows.length && <tr><td colSpan={7} className="payable-empty">Nenhuma conta encontrada.</td></tr>}</tbody></table></div>
      <p className="payable-pagination"><span>{rows.length} contas</span></p>
    </>}
    {detailId && <ReceivableDetails id={detailId} key={detailId} refreshVersion={version} onClose={() => setDetailId('')} onEdit={(row) => { setDetailId(''); setForm({ source: row }) }} onReceive={(row) => { setDetailId(''); setReceiving(row) }} onChanged={refresh} />}
    {form && <ReceivableForm {...form} clients={data.clients} onClose={() => setForm(null)} onSaved={async (item) => { await refresh(); setForm(null); setDetailId(item.id) }} />}
    {receiving && <ReceiptForm row={receiving} onClose={() => setReceiving(null)} onSaved={async () => { const id = receiving.id; await refresh(); setReceiving(null); setDetailId(id) }} />}
    {history && <PayableModal title="Histórico geral · Contas a Receber" wide onClose={() => setHistory(null)}><History rows={history} /></PayableModal>}
  </AdminWorkspace>
}
