import { useState } from 'react'
import { Check, FileText, Save, TriangleAlert, UserPlus } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import { money, decimal, payableRequest } from './payablesApi.js'
import { cents } from '../server/payableRules.js'
import MoneyInput from './MoneyInput.jsx'
import ClassificationSelect, { classificationOptions } from './ClassificationSelect.jsx'
import ClientQuickForm from './ClientQuickForm.jsx'

// Contas a Receber from the PDF of the invoices: the server reads each NFS-e or DANFE, the user checks (and corrects)
// what was read, and each invoice checked becomes an account with its PDF attached. Nothing is posted before "Lançar".
const token = () => ({ Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}` })
const safeCents = (value) => { try { return cents(value || '0') } catch { return 0 } }
const plainDocument = (value) => String(value || '').replace(/\D/g, '')
const documentLabel = (digits) => digits.length === 14 ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : digits.length === 11 ? digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : digits || 'sem CPF/CNPJ'
const plainNumber = (value) => String(value || '').replace(/\D/g, '').replace(/^0+/, '')
// Service invoices go to Receita de Serviços a Prazo; product invoices (NF-e) to Receita de Industrialização a Prazo.
const DEFAULT_CODES = { nfse: '7.02', nfe: '7.04' }

// Reads one PDF; the server keeps the PDF of each invoice waiting to be attached.
export async function readInvoicePdf(file) {
  const response = await fetch(`/api/receivables/invoice-import?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { ...token(), 'Content-Type': 'application/octet-stream' }, body: file })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || `Não foi possível ler ${file.name}.`)
  return result
}

// The drafts of what was read, with the classification suggested for each kind of invoice. A second copy of the same
// invoice in this import comes unchecked, like one already posted.
export function invoiceDrafts(results, classifications) {
  const options = classificationOptions(classifications, 'receivable')
  const seen = new Set(), rows = []
  for (const result of results) for (const note of result.items) {
    const key = `${note.kind}:${plainNumber(note.documentNumber)}:${note.customerDocument}`
    const repeated = Boolean(plainNumber(note.documentNumber)) && seen.has(key)
    seen.add(key)
    const installments = note.installments.length ? note.installments : [{ dueDate: '', valueCents: note.valueCents }]
    rows.push({
      key: note.file.id, label: note.label, kind: note.kind, source: note.source, pages: note.pages, fileId: note.file.id, fileName: note.file.name,
      customerName: note.customerName, customerDocument: note.customerDocument, documentNumber: note.documentNumber, issueDate: note.issueDate || '', description: note.description,
      classificationId: options.find((item) => item.code === DEFAULT_CODES[note.kind])?.id || '', value: note.valueCents ? decimal(note.valueCents) : '', iss: note.issCents ? decimal(note.issCents) : '',
      installments: installments.map((row) => ({ dueDate: row.dueDate || '', value: row.valueCents ? decimal(row.valueCents) : '' })),
      warnings: note.warnings || [], duplicateOf: note.duplicateOf || (repeated ? 'nesta importação' : null), selected: !note.duplicateOf && !repeated, saved: null, error: '',
    })
  }
  return rows
}

function InvoiceCard({ row, client, classifications, disabled, onChange, onRegister }) {
  const change = (patch) => onChange({ ...patch, error: '' })
  const valueCents = safeCents(row.value), issCents = safeCents(row.iss), many = row.installments.length > 1
  const sum = row.installments.reduce((total, part) => total + safeCents(part.value), 0)
  const title = `${row.label} ${row.documentNumber || 'sem número'}`
  if (row.saved) return <article className="invoice-import-card invoice-import-card--saved" aria-label={title}><header><strong>{title}</strong><span className="invoice-import-saved"><Check size={14} aria-hidden="true" />Lançada em {row.saved.join(', ')}</span></header></article>
  return <article className={`invoice-import-card ${row.selected ? '' : 'invoice-import-card--off'}`} aria-label={title}>
    <header>
      <label className="invoice-import-check"><input type="checkbox" aria-label={`Lançar ${title}`} checked={row.selected} disabled={disabled} onChange={(event) => change({ selected: event.target.checked })} /><strong>{title}</strong></label>
      <small><FileText size={13} aria-hidden="true" />{row.source}{row.pages.length ? ` · pág. ${row.pages.join(', ')}` : ''}</small>
    </header>
    {row.duplicateOf && <p className="invoice-import-warning" role="note"><TriangleAlert size={14} aria-hidden="true" />{row.duplicateOf === 'nesta importação' ? 'Esta nota aparece mais de uma vez nesta importação.' : `Esta nota já foi lançada em ${row.duplicateOf}.`} Ficou desmarcada para não lançar duas vezes.</p>}
    {row.warnings.map((text) => <p className="invoice-import-warning" role="note" key={text}><TriangleAlert size={14} aria-hidden="true" />{text}</p>)}
    {client ? <p className="invoice-import-client"><span>Cliente</span><strong>{client.name}</strong><small>{documentLabel(plainDocument(client.document))}</small></p>
      : <div className="invoice-import-client invoice-import-client--missing"><span>Cliente não cadastrado</span><strong>{row.customerName || 'Nome não encontrado na nota'}</strong><small>{documentLabel(row.customerDocument)}</small><button type="button" className="admin-tool-button" disabled={disabled} onClick={onRegister}><UserPlus size={15} />Cadastrar cliente</button></div>}
    <fieldset className="payable-form invoice-import-fields" disabled={disabled || !row.selected}>
      <label>Número da nota<input aria-label={`Número da nota de ${title}`} required maxLength={160} value={row.documentNumber} onChange={(event) => change({ documentNumber: event.target.value })} /></label>
      <label>Data de emissão<input type="date" aria-label={`Data de emissão de ${title}`} required value={row.issueDate} onChange={(event) => change({ issueDate: event.target.value })} /></label>
      <label className="payable-form-wide">Descrição<textarea aria-label={`Descrição de ${title}`} rows={2} maxLength={5000} value={row.description} onChange={(event) => change({ description: event.target.value })} /></label>
      <label>Classificação<ClassificationSelect classifications={classifications} use="receivable" label={`Classificação de ${title}`} value={row.classificationId} onChange={(id) => change({ classificationId: id })} /></label>
      <label>Valor da nota<MoneyInput aria-label={`Valor de ${title}`} required positive value={row.value} onChange={(value) => change({ value, installments: many ? row.installments : [{ ...row.installments[0], value }] })} /></label>
      <label>ISS retido (R$)<MoneyInput aria-label={`ISS retido de ${title}`} value={row.iss} onChange={(iss) => change({ iss })} /></label>
      <p className="invoice-import-net"><span>Líquido a receber</span><strong>{money(Math.max(0, valueCents - issCents))}</strong></p>
      {many ? <div className="invoice-import-installments payable-form-wide" role="group" aria-label={`Parcelas de ${title}`}>
        <span>{row.installments.length} parcelas (duplicatas da nota)</span>
        {row.installments.map((part, index) => <div key={index}>
          <label>Vencimento {index + 1}<input type="date" aria-label={`Vencimento ${index + 1} de ${title}`} required min={row.issueDate || undefined} value={part.dueDate} onChange={(event) => change({ installments: row.installments.map((item, i) => i === index ? { ...item, dueDate: event.target.value } : item) })} /></label>
          <label>Valor {index + 1}<MoneyInput aria-label={`Valor da parcela ${index + 1} de ${title}`} required positive value={part.value} onChange={(value) => change({ installments: row.installments.map((item, i) => i === index ? { ...item, value } : item) })} /></label>
        </div>)}
        {sum !== valueCents && <small className="receivable-sum--off">A soma das parcelas ({money(sum)}) é diferente do valor da nota ({money(valueCents)}).</small>}
      </div> : <label>Vencimento<input type="date" aria-label={`Vencimento de ${title}`} required min={row.issueDate || undefined} value={row.installments[0].dueDate} onChange={(event) => change({ installments: [{ ...row.installments[0], dueDate: event.target.value }] })} /></label>}
    </fieldset>
    {row.error && <p className="admin-tool-error" role="alert">{row.error}</p>}
  </article>
}

// Why a checked invoice cannot be posted yet, or ''.
function blockOf(row, client) {
  if (!client) return 'Cadastre o cliente antes de lançar esta nota.'
  if (!row.documentNumber.trim()) return 'Informe o número da nota.'
  if (!row.issueDate) return 'Informe a data de emissão.'
  if (!row.classificationId) return 'Selecione a classificação.'
  const valueCents = safeCents(row.value)
  if (!valueCents) return 'Informe o valor da nota.'
  if (safeCents(row.iss) >= valueCents) return 'O ISS deve ser menor que o valor da nota.'
  if (row.installments.some((part) => !part.dueDate)) return 'Informe o vencimento.'
  if (row.installments.some((part) => part.dueDate < row.issueDate)) return 'O vencimento não pode ser anterior à data de emissão.'
  if (row.installments.length > 1 && row.installments.reduce((sum, part) => sum + safeCents(part.value), 0) !== valueCents) return 'A soma das parcelas deve ser igual ao valor da nota.'
  return ''
}

export default function ReceivableInvoiceImport({ initialRows, problems = [], clients, classifications, onClose, onDone, onClientCreated }) {
  const [rows, setRows] = useState(initialRows), [busy, setBusy] = useState(false), [error, setError] = useState(''), [registering, setRegistering] = useState(null), [newClients, setNewClients] = useState([])
  const allClients = [...clients, ...newClients]
  const clientOf = (row) => row.customerDocument ? allClients.find((item) => plainDocument(item.document) === row.customerDocument) : null
  const update = (key, patch) => setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row))
  const pending = rows.filter((row) => !row.saved), chosen = pending.filter((row) => row.selected), saved = rows.filter((row) => row.saved)
  // The PDFs of invoices not posted would wait forever as uploads: they are let go when the window closes.
  async function close() {
    const ids = pending.map((row) => row.fileId)
    if (ids.length) payableRequest('/receivables/uploads/discard', 'POST', { ids }).catch(() => {})
    onClose(saved.length)
  }
  async function post(event) {
    event.preventDefault(); setError('')
    const blocked = chosen.map((row) => [row, blockOf(row, clientOf(row))]).filter(([, message]) => message)
    if (blocked.length) { setRows((current) => current.map((row) => { const found = blocked.find(([item]) => item.key === row.key); return found ? { ...row, error: found[1] } : row })); setError(`Confira ${blocked.length === 1 ? 'a nota marcada' : `as ${blocked.length} notas marcadas`} abaixo.`); return }
    setBusy(true)
    let posted = 0
    for (const row of chosen) {
      const many = row.installments.length > 1
      try {
        const result = await payableRequest('/receivables', 'POST', { clientId: clientOf(row).id, description: row.description, documentNumber: row.documentNumber.trim(), issueDate: row.issueDate, value: row.value, iss: row.iss || '', classificationId: row.classificationId, dueDate: row.installments[0].dueDate, ...(many ? { kind: 'installment', count: row.installments.length, installments: row.installments } : { kind: 'single', count: 1 }), fileIds: [row.fileId] })
        update(row.key, { saved: result.items.map((item) => item.id), error: '' }); posted++
      } catch (caught) { update(row.key, { error: caught.message }) }
    }
    setBusy(false)
    if (posted < chosen.length) { setError('Algumas notas não foram lançadas. Veja o motivo em cada uma.'); return }
    // Everything checked was posted: the notes left unchecked are let go.
    const left = pending.filter((row) => !row.selected).map((row) => row.fileId)
    if (left.length) payableRequest('/receivables/uploads/discard', 'POST', { ids: left }).catch(() => {})
    onDone(saved.length + posted)
  }
  const footer = <><button className="admin-tool-button" type="button" disabled={busy} onClick={close}>{saved.length ? 'Fechar' : 'Cancelar'}</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form="invoice-import-form" disabled={busy || !chosen.length}><Save size={16} />{busy ? 'Lançando...' : `Lançar ${chosen.length} ${chosen.length === 1 ? 'conta' : 'contas'}`}</button></>
  return <PayableModal title="Importar notas (PDF)" className="payable-modal--form invoice-import-modal" wide busy={busy} onClose={close} footer={footer}>
    <form id="invoice-import-form" className="invoice-import" onSubmit={post} noValidate>
      <p className="payable-hint">Confira o que foi lido de cada nota. Só as notas marcadas viram contas a receber, cada uma com o PDF da nota anexado.</p>
      {problems.length > 0 && <ul className="invoice-import-problems" aria-label="Páginas não lidas">{problems.map((item) => <li key={`${item.source}-${item.page}`}><TriangleAlert size={14} aria-hidden="true" />{item.source}{item.page ? `, página ${item.page}` : ''}: {item.message}</li>)}</ul>}
      {rows.map((row) => <InvoiceCard key={row.key} row={row} client={clientOf(row)} classifications={classifications} disabled={busy} onChange={(patch) => update(row.key, patch)} onRegister={() => setRegistering(row)} />)}
      {!rows.length && <p className="payable-empty">Nenhuma nota foi encontrada nos arquivos.</p>}
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </form>
    {registering && <ClientQuickForm initial={{ name: registering.customerName, document: registering.customerDocument }} onClose={() => setRegistering(null)} onCreated={async (client) => { setNewClients((current) => [...current, { id: String(client.id), name: client.name, document: client.document }]); setRegistering(null); await onClientCreated?.() }} />}
  </PayableModal>
}
