import { useEffect, useId, useRef, useState } from 'react'
import { Plus, Search, RotateCcw, Info, FileDown, Sheet, Check, Pencil, Undo2, Trash2, Save, Link2, ArrowUpDown, ChevronLeft, ChevronRight, Download, Eye, Upload } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { PayableModal, FilePicker, FilePreview, previewable } from './PayableModal.jsx'
import { money, decimal, dateLabel, payableRequest, downloadBlob, uploadFiles, downloadFile } from './payablesApi.js'
import { todayBahia, cents, dueLabel, matchesSearch, shiftMonth, treasuryEntry } from '../server/payableRules.js'
import MoneyInput from './MoneyInput.jsx'
import { InstallmentFields, withInstallments, installmentPayload } from './ReceivableInstallments.jsx'
import { sumOf, dueShortcuts } from './financeFilters.js'
import { pollWhileVisible } from './polling.js'
import ReceivableForecast from './ReceivableForecast.jsx'
import BankSelect, { useBanks, bankOptionLabel } from './BankSelect.jsx'
import ClassificationSelect, { RevenueTermHint } from './ClassificationSelect.jsx'
import './payables.css'

export const receiptMethods = { pix: 'Pix', boleto: 'Boleto', transfer: 'Transferência', card: 'Cartão', cash: 'Dinheiro' }
const statusText = { pending: 'Pendente', overdue: 'Vencido', received: 'Recebido' }
const historyLabels = { created: 'Conta criada', edited: 'Conta editada', received: 'Recebimento baixado', reversed: 'Recebimento estornado', deleted: 'Conta excluída', status_changed: 'Status alterado', attachment_added: 'Anexo adicionado', attachment_removed: 'Anexo removido' }
const sortFields = [['id', 'ID'], ['customerName', 'Cliente'], ['documentNumber', 'Documento'], ['orderCode', 'Origem'], ['valueCents', 'Valor'], ['dueDate', 'Vencimento'], ['installmentNumber', 'Parcela'], ['status', 'Status']]
const kinds = [['single', 'Parcela única'], ['installment', 'Recebimento parcelado'], ['recurring', 'Contrato recorrente']]
const documentLabel = (digits) => !digits ? '—' : digits.length === 14 ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
const safeCents = (value) => { try { return cents(value || '0') } catch { return 0 } }
// Same search as Contas a Pagar: text, value as typed in Brazil and the payer CPF/CNPJ.
const matches = (row, search) => matchesSearch({ id: row.id, supplierName: row.customerName, supplierDocument: row.customerDocument, description: row.description, documentNumber: row.documentNumber, orderCode: row.orderCode, valueCents: row.valueCents }, search)
const initialFilters = () => ({ search: '', status: '', start: '', end: '', bankId: '' })
const beforeIssueMessage = 'A data prevista de recebimento não pode ser anterior à data de emissão.'

export function ReceivableStatus({ row }) {
  const warning = row.status === 'pending' && row.daysUntil <= 3
  return <span className={`payable-status payable-status--${row.status === 'received' ? 'paid' : warning ? 'soon' : row.status}`}><strong>{statusText[row.status]}</strong>{!row.receipt && (row.daysUntil < 0 || warning) && <small>{dueLabel(row.daysUntil)}</small>}</span>
}

async function exportReceivables(body) {
  const response = await fetch('/api/receivables/export', { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Falha ao exportar.')
  downloadBlob(await response.blob(), `gmac-${body.id || 'contas-a-receber'}.${body.format}`)
}

// Created over the receivable form so the draft is kept while the client is registered.
function ClientQuickForm({ onClose, onCreated }) {
  const formId = useId(), [draft, setDraft] = useState({ name: '', document: '', email: '' }), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (![11, 14].includes(draft.document.length)) throw new Error('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).')
      const result = await payableRequest('/clients', 'POST', { ...draft, documentType: draft.document.length === 14 ? 'cnpj' : 'cpf' })
      await onCreated(result.item)
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title="Novo cliente" busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={formId} disabled={busy}><Save size={16} />Salvar cliente</button></>}>
    <form id={formId} className="payable-form" onSubmit={save}><fieldset disabled={busy}>
      <label>Nome / razão social<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>CPF/CNPJ<input required inputMode="numeric" maxLength={18} value={draft.document} onChange={(event) => setDraft({ ...draft, document: event.target.value.replace(/\D/g, '') })} /></label>
      <label>E-mail<input type="email" maxLength={160} value={draft.email} placeholder="Opcional" onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}

// `treasury` posts money already received (Tesouraria): the same account data, with the receipt date and
// the way of receiving in place of the expected date and the type.
export function ReceivableForm({ source, siblings = [], structureLocked: receivedStructure = false, treasury: asTreasury = false, clients, classifications = [], onClose, onSaved, onClientCreated }) {
  const formId = useId(), fromOrder = source?.origin === 'order', grouped = Boolean(source?.groupId), treasury = asTreasury || treasuryEntry(source), structureLocked = receivedStructure && !treasury
  // An OS (or an entry with interest or discount) has a value apart from what was received; the difference is interest or discount.
  const adjusted = treasury && Boolean(source) && (fromOrder || source.receipt?.interestCents > 0 || source.receipt?.discountCents > 0)
  const [draft, setDraft] = useState(() => source ? { clientId: source.clientId || '', customerName: source.customerName, customerDocument: source.customerDocument || '', description: source.description, documentNumber: source.documentNumber, issueDate: source.issueDate, value: decimal(grouped ? source.originalTotalCents : source.valueCents), dueDate: grouped ? siblings[0]?.dueDate || source.dueDate : source.dueDate, kind: grouped ? 'installment' : source.kind === 'recurring' ? 'recurring' : 'single', recurrence: source.recurrence || 'monthly', ahead: 0, count: grouped ? source.installmentCount : 2, installments: grouped ? siblings.map((row) => ({ value: decimal(row.valueCents), dueDate: row.dueDate })) : [], iss: decimal(grouped ? siblings.reduce((sum, row) => sum + (row.issCents || 0), 0) : source.issCents || 0), date: source.receipt?.date || todayBahia(), method: source.receipt?.method || 'pix', bankId: source.receipt?.bankId || '', received: source.receipt ? decimal(source.receipt.finalCents) : '', classificationId: source.classificationId || '' } : { classificationId: '', clientId: '', customerName: '', customerDocument: '', description: '', documentNumber: '', issueDate: todayBahia(), value: '', dueDate: '', kind: 'single', recurrence: 'monthly', ahead: 11, count: 2, installments: [], iss: '', date: todayBahia(), method: 'pix', bankId: '' })
  const [files, setFiles] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [creatingClient, setCreatingClient] = useState(false), [newClients, setNewClients] = useState([])
  const dueInput = useRef(null)
  const clientOptions = [...clients, ...newClients.filter((row) => !clients.some((item) => item.id === row.id))]
  const change = (key, value) => { const next = { ...draft, [key]: value }; setDraft(['value', 'dueDate', 'kind'].includes(key) ? withInstallments(next) : next) }
  const installment = !treasury && draft.kind === 'installment', recurring = !treasury && draft.kind === 'recurring'
  const valueLabel = installment ? 'Valor total' : adjusted ? fromOrder ? 'Valor da OS' : 'Valor da conta' : 'Valor'
  const valueCents = safeCents(draft.value), receivedCents = safeCents(draft.received), difference = receivedCents - valueCents, issCents = safeCents(draft.iss)
  // Expected receipt dates can never come before the issue date.
  const beforeIssue = Boolean(!treasury && draft.dueDate && draft.issueDate && draft.dueDate < draft.issueDate)
  useEffect(() => { setError('') }, [draft])
  useEffect(() => { dueInput.current?.setCustomValidity(beforeIssue ? beforeIssueMessage : '') }, [beforeIssue])
  function chooseClient(id) { const client = clientOptions.find((row) => String(row.id) === String(id)); setDraft({ ...draft, clientId: id, customerName: client?.name || '', customerDocument: client?.document || '' }) }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (installment && !structureLocked && draft.installments.reduce((sum, row) => sum + cents(row.value || '0'), 0) !== cents(draft.value)) throw new Error('A soma das parcelas deve ser exatamente igual ao valor total.')
      if (installment && draft.installments.some((row) => row.dueDate < draft.issueDate)) throw new Error('Nenhuma parcela pode ser prevista antes da data de emissão.')
      if (treasury && draft.date > todayBahia()) throw new Error('O recebimento não pode ter data futura.')
      if (!treasury && issCents >= valueCents && issCents) throw new Error('O ISS deve ser menor que o valor da conta.')
      const fileIds = source ? [] : await uploadFiles('/receivables', files)
      const result = await payableRequest(source ? `/receivables/${source.id}` : '/receivables', source ? 'PUT' : 'POST', { ...draft, ...(treasury ? { treasury: true, kind: 'single', count: 1, installments: undefined, ...(adjusted ? { received: draft.received } : {}) } : installmentPayload(draft)), ...(recurring ? { kind: 'recurring', ahead: Number(draft.ahead) || 0 } : {}), clientId: draft.clientId || undefined, fileIds })
      if (source && files.length) await uploadFiles('/receivables', files, result.item.id)
      await onSaved(result.item)
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  const aheadCount = Number(draft.ahead) || 0, lastDue = draft.dueDate && aheadCount ? shiftMonth(draft.dueDate, aheadCount * (draft.recurrence === 'yearly' ? 12 : 1)) : null
  return <PayableModal title={source ? `Editar ${source.id}` : treasury ? 'Nova entrada' : 'Nova conta a receber'} className="payable-modal--form" wide busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" form={formId} type="submit" disabled={busy}><Save size={16} />{busy ? 'Salvando...' : treasury ? 'Salvar entrada' : 'Salvar conta'}</button></>}>
    <form id={formId} onSubmit={save} className="payable-form payable-entry-form"><fieldset disabled={busy}>
      {fromOrder ? <p className="payable-form-wide receivable-origin">Pagador da {source.orderCode}: <strong>{source.customerName}</strong>{source.customerDocument ? ` · ${documentLabel(source.customerDocument)}` : ''}</p> : <>
        <div className="payable-supplier-field payable-form-wide"><label>Cliente cadastrado<select aria-label="Cliente cadastrado" value={draft.clientId} onChange={(event) => chooseClient(event.target.value)}><option value="">Outro pagador (informar abaixo)</option>{clientOptions.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><button type="button" className="payable-link" onClick={() => setCreatingClient(true)}>Cadastrar cliente</button></div>
        {!draft.clientId && <><label>Nome do pagador<input required maxLength={160} value={draft.customerName} onChange={(event) => change('customerName', event.target.value)} /></label><label>CPF/CNPJ do pagador<input inputMode="numeric" maxLength={18} value={draft.customerDocument} onChange={(event) => change('customerDocument', event.target.value.replace(/\D/g, ''))} /></label></>}
      </>}
      <label className="payable-form-wide">Descrição<textarea aria-label="Descrição" rows={1} maxLength={5000} value={draft.description} onChange={(event) => change('description', event.target.value)} /></label>
      <label>Classificação<ClassificationSelect classifications={classifications} use="receivable" keep={source?.classificationId ? [source.classificationId] : []} value={draft.classificationId} onChange={(id) => setDraft({ ...draft, classificationId: id })} /><RevenueTermHint classifications={classifications} value={draft.classificationId} onChange={(id) => setDraft({ ...draft, classificationId: id })} context={{ treasury, kind: draft.kind, issueDate: draft.issueDate, dueDate: draft.dueDate }} /></label>
      <label>Número do documento / boleto / nota fiscal<input maxLength={160} value={draft.documentNumber} onChange={(event) => change('documentNumber', event.target.value)} /></label>
      {!treasury && <><label>Data de emissão<input type="date" aria-label="Data de emissão" required value={draft.issueDate} onChange={(event) => change('issueDate', event.target.value)} /></label>
      <fieldset className="payable-type payable-form-wide" disabled={structureLocked}><legend>Tipo do recebimento</legend>{kinds.filter(([key]) => !source || key !== 'recurring' || draft.kind === 'recurring').map(([key, label]) => <label className="payable-radio" key={key}><input name={`${formId}-kind`} type="radio" checked={draft.kind === key} onChange={() => change('kind', key)} />{label}</label>)}</fieldset></>}
      <label>{valueLabel}<MoneyInput aria-label={valueLabel} required positive disabled={structureLocked} value={draft.value} onChange={(value) => change('value', value)} /></label>
      {!treasury && <><label>ISS retido (R$)<MoneyInput aria-label="ISS retido (R$)" disabled={structureLocked} value={draft.iss} onChange={(value) => setDraft({ ...draft, iss: value })} /><small className="payable-hint">{installment ? 'ISS total do documento, dividido entre as parcelas na proporção do valor.' : recurring ? 'ISS de cada ocorrência do contrato.' : 'Opcional: quando o cliente já informou quanto vai reter.'}</small></label>
        {issCents > 0 && <div className="payable-final payable-form-wide"><span>{money(valueCents)} − {money(issCents)} de ISS =</span><strong>{money(Math.max(0, valueCents - issCents))} líquido</strong></div>}</>}
      {treasury ? <><label>Data do recebimento<input type="date" aria-label="Data do recebimento" required max={todayBahia()} value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
        <label>Forma de recebimento<select aria-label="Forma de recebimento" value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value })}>{Object.entries(receiptMethods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><small className="payable-hint">A entrada já fica como recebida, sem precisar dar baixa.</small></label>
        <BankSelect value={draft.bankId} onChange={(bankId) => setDraft({ ...draft, bankId })} />
        {adjusted && <><label>Valor recebido<MoneyInput aria-label="Valor recebido" required positive value={draft.received} onChange={(value) => setDraft({ ...draft, received: value })} /><small className="payable-hint">Se for diferente de {money(valueCents)}, a diferença é registrada como juros ou desconto.</small></label>
          <div className="payable-final payable-form-wide"><span>{money(valueCents)}{difference > 0 ? ` + ${money(difference)} de juros` : ''}{difference < 0 ? ` − ${money(-difference)} de desconto` : ''} =</span><strong>{money(receivedCents)}</strong></div></>}</>
        : <label>{installment ? 'Data da 1ª parcela' : 'Data prevista de recebimento'}<input ref={dueInput} type="date" aria-label={installment ? 'Data da 1ª parcela' : 'Data prevista de recebimento'} required min={draft.issueDate || undefined} disabled={structureLocked} value={draft.dueDate} onChange={(event) => change('dueDate', event.target.value)} />{beforeIssue && <small className="payable-hint receivable-sum--off">{beforeIssueMessage}</small>}</label>}
      {recurring && <><label>Recorrência<select aria-label="Recorrência" value={draft.recurrence} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value, ahead: source ? 0 : event.target.value === 'yearly' ? 1 : 11 })}><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></label>
        {!source && <label>Ocorrências futuras geradas agora<input type="number" aria-label="Ocorrências futuras geradas agora" aria-describedby={`${formId}-ahead`} min={0} max={24} required value={draft.ahead} onChange={(event) => change('ahead', event.target.value)} /><small id={`${formId}-ahead`} className="payable-hint">{aheadCount ? `Serão criadas ${aheadCount + 1} contas${safeCents(draft.value) ? ` de ${money(safeCents(draft.value))}` : ''}${lastDue ? `, até ${dateLabel(lastDue)}` : ''}. Cada uma pode ser editada ou recebida separadamente.` : 'Só esta conta.'}</small></label>}
      </>}
      {installment && <InstallmentFields draft={draft} setDraft={setDraft} minDate={draft.issueDate} disabled={structureLocked} />}
      {structureLocked && <p className="payable-hint payable-form-wide">Há parcela recebida: valores, datas e parcelas ficam bloqueados. Estorne o recebimento para reestruturar o parcelamento.</p>}
      <FilePicker title="Anexos (NF, boleto, contrato)" files={files} setFiles={setFiles} disabled={busy} />
      {error && <p className="admin-tool-error payable-form-wide" role="alert">{error}</p>}
    </fieldset></form>
    {creatingClient && <ClientQuickForm onClose={() => setCreatingClient(false)} onCreated={async (client) => { const option = { id: String(client.id), name: client.name, document: client.document }; setNewClients((rows) => [...rows, option]); setCreatingClient(false); setDraft((current) => ({ ...current, clientId: option.id, customerName: option.name, customerDocument: option.document })); await onClientCreated?.() }} />}
  </PayableModal>
}

export function ReceiptForm({ rows, bulk = false, onClose, onSaved }) {
  // The ISS registered with the account comes filled in; it can still be corrected to what was really withheld.
  const formId = useId(), total = rows.reduce((sum, row) => sum + row.valueCents, 0), expectedIss = rows.reduce((sum, row) => sum + (row.issCents || 0), 0)
  const [draft, setDraft] = useState({ date: todayBahia(), method: 'pix', bankId: '', interest: '', discount: '', iss: decimal(expectedIss), received: decimal(total - expectedIss), note: '' }), [files, setFiles] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const interest = safeCents(draft.interest), discount = safeCents(draft.discount), iss = safeCents(draft.iss)
  // Typing the amount actually received fills interest (received more) or discount (received less), after the ISS withheld.
  const adjust = (key, value) => { const next = { ...draft, [key]: value }; setDraft({ ...next, received: decimal(Math.max(0, total + safeCents(next.interest) - safeCents(next.discount) - safeCents(next.iss))) }) }
  const receive = (value) => { const difference = safeCents(value) - (total - iss); setDraft({ ...draft, received: value, interest: difference > 0 ? decimal(difference) : '', discount: difference < 0 && value ? decimal(-difference) : '' }) }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const { received, ...body } = draft
      if (bulk) await payableRequest('/receivables/bulk', 'POST', { action: 'receive', ids: rows.map((row) => row.id), date: body.date, method: body.method, bankId: body.bankId })
      else await payableRequest(`/receivables/${rows[0].id}/receive`, 'POST', { ...body, fileIds: await uploadFiles('/receivables', files) })
      await onSaved()
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title={bulk ? 'Confirmar recebimento em massa' : `Dar baixa · ${rows[0].id}`} busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={formId} disabled={busy}><Check size={16} />Confirmar recebimento</button></>}>
    <form id={formId} className="payable-form" onSubmit={submit}><fieldset disabled={busy}>
      {bulk && <><p>{rows.length} contas selecionadas · {money(total)}</p><div className="payable-bulk-list">{rows.map((row) => <div key={row.id}><strong>{row.id} · {row.customerName}</strong><span>{row.description || '—'}</span><span>{dateLabel(row.dueDate)} · {money(row.valueCents)}</span></div>)}</div></>}
      <label>Data do recebimento<input type="date" required max={todayBahia()} value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
      <label>Forma de recebimento<select aria-label="Forma de recebimento" value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value })}>{Object.entries(receiptMethods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <BankSelect value={draft.bankId} onChange={(bankId) => setDraft({ ...draft, bankId })} />
      {!bulk && <><label>Valor recebido<MoneyInput aria-label="Valor recebido" required value={draft.received} onChange={receive} /><small className="payable-hint">Se for diferente de {money(total - iss)}, juros ou desconto são preenchidos automaticamente.</small></label>
        <div className="payable-adjustments payable-adjustments--three"><label>Juros (R$)<MoneyInput aria-label="Juros (R$)" value={draft.interest} disabled={discount > 0} onChange={(value) => adjust('interest', value)} /></label><label>Desconto (R$)<MoneyInput aria-label="Desconto (R$)" value={draft.discount} disabled={interest > 0} onChange={(value) => adjust('discount', value)} /></label><label>ISS (R$)<MoneyInput aria-label="ISS (R$)" value={draft.iss} onChange={(value) => adjust('iss', value)} /></label></div></>}
      <div className="payable-final"><span>{money(total)}{interest ? ` + ${money(interest)} de juros` : ''}{discount ? ` − ${money(discount)} de desconto` : ''}{iss ? ` − ${money(iss)} de ISS` : ''} =</span><strong>{money(total + interest - discount - iss)}</strong></div>
      {!bulk && <><label>Observação<textarea aria-label="Observação" rows={3} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label><FilePicker title="Comprovantes" files={files} setFiles={setFiles} disabled={busy} /></>}
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}

function History({ rows }) {
  return <ol className="payable-history">{rows.map((row) => <li key={row.id}><div><strong>{historyLabels[row.type] || row.type}</strong><span>{row.accountId}</span></div><small>{new Date(row.at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })} · {row.userName}</small>{row.reason && <p>{row.reason}</p>}{row.details?.name && <p>{row.details.name}</p>}{row.details?.text && <p>{row.details.text}</p>}{row.type === 'received' && <p>{money(row.details.finalCents)} · {dateLabel(row.details.date)} · {receiptMethods[row.details.method]}{row.details.bulk ? ' · Baixa em massa' : ''}{row.details.note ? ` · ${row.details.note}` : ''}</p>}{row.type === 'edited' && row.changes && ['valueCents', 'dueDate', 'description'].filter((key) => row.changes.before[key] !== row.changes.after[key]).map((key) => <p key={key}>{{ valueCents: 'Valor', dueDate: 'Vencimento', description: 'Descrição' }[key]}: {key === 'valueCents' ? money(row.changes.before[key]) : key === 'dueDate' ? dateLabel(row.changes.before[key]) : row.changes.before[key] || '—'} → {key === 'valueCents' ? money(row.changes.after[key]) : key === 'dueDate' ? dateLabel(row.changes.after[key]) : row.changes.after[key] || '—'}</p>)}</li>)}{!rows.length && <li>Nenhuma movimentação.</li>}</ol>
}

function ReasonForm({ title, onClose, onConfirm }) {
  const formId = useId(), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <PayableModal title={title} busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={formId} disabled={busy}>Confirmar</button></>}><form id={formId} onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await onConfirm(reason) } catch (caught) { setError(caught.message) } finally { setBusy(false) } }}>{onConfirm.length ? <label>Motivo<textarea required minLength={10} maxLength={1000} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} /></label> : <p>Esta ação não pode ser desfeita.</p>}{error && <p className="admin-tool-error" role="alert">{error}</p>}</form></PayableModal>
}

export function ReceivableDetails({ id, refreshVersion, onClose, onEdit, onReceive, onChanged, onOpen }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [confirm, setConfirm] = useState(null), [version, setVersion] = useState(0), [busy, setBusy] = useState(false), [preview, setPreview] = useState(null)
  useEffect(() => { let active = true; payableRequest(`/receivables/${id}`).then((result) => { if (active) { setData(result); setError('') } }).catch((caught) => { if (active) setError(caught.message) }); return () => { active = false } }, [id, version, refreshVersion])
  // An entry posted in Tesouraria stays received while it is corrected.
  const row = data?.item, received = Boolean(row?.receipt), grouped = Boolean(row?.groupId), locked = received && !treasuryEntry(row)
  const actions = row ? [['edit', 'Editar', Pencil, locked || row.reconciled], ['receive', 'Dar baixa', Check, received], ['reverse', 'Estornar recebimento', Undo2, !received || row.reconciled], ['delete', grouped ? 'Excluir parcelamento' : 'Excluir', Trash2, !data.canDelete || row.reconciled], ['pdf', 'Gerar PDF individual', FileDown, busy]] : []
  async function run(fn) { setBusy(true); setError(''); try { await fn(); setVersion((v) => v + 1) } catch (caught) { setError(caught.message) } finally { setBusy(false) } }
  async function act(key) {
    if (key === 'edit') return onEdit(data)
    if (key === 'receive') return onReceive(row)
    if (key === 'pdf') return run(() => exportReceivables({ format: 'pdf', id: row.id }))
    setConfirm(key === 'reverse' ? { title: 'Estornar recebimento', onConfirm: async (reason) => { await payableRequest(`/receivables/${row.id}/reverse`, 'POST', { reason }); setConfirm(null); setVersion((v) => v + 1); await onChanged() } } : { title: grouped ? `Excluir o parcelamento (${row.installmentCount} parcelas)?` : `Excluir ${row.id}?`, onConfirm: async () => { await payableRequest(`/receivables/${row.id}`, 'DELETE'); setConfirm(null); await onChanged(); onClose() } })
  }
  const files = row ? [...row.attachments, ...(row.receipt?.receipts || [])] : []
  return <PayableModal title={id} wide busy={busy} onClose={onClose} footer={row && <div className="payable-detail-actions">{actions.map(([key, label, Icon, disabled]) => <button type="button" className={`admin-tool-button ${key === 'receive' ? 'admin-tool-button--primary' : ''}`} key={key} disabled={disabled || busy} onClick={() => act(key)}><Icon size={15} />{label}</button>)}</div>}>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}{!row ? !error && <p>Carregando conta...</p> : <>
      <section><h3>Dados principais</h3><dl className="payable-facts">{[['Cliente', row.customerName], ['CPF/CNPJ', documentLabel(row.customerDocument)], ['Descrição', row.description || '—'], ['Classificação', row.classificationName || 'Sem classificação'], ['Origem', `${row.orderCode ? `Conclusão da ${row.orderCode}` : row.treasury ? 'Tesouraria' : 'Lançamento manual'}${row.treasury ? ' · lançada já recebida' : ''}`], ['Documento / boleto / NF', row.documentNumber || '—'], ['Emissão', dateLabel(row.issueDate)], ['Valor', money(row.valueCents)], ...(row.issCents ? [['ISS retido previsto', money(row.issCents)], ['Valor líquido', money(row.valueCents - row.issCents)]] : []), ...(grouped ? [['Parcela', `${row.installmentNumber} de ${row.installmentCount}`], ['Valor total do acordo', money(row.originalTotalCents)]] : []), ...(row.kind === 'recurring' ? [['Tipo', `Contrato recorrente · ${row.recurrence === 'yearly' ? 'Anual' : 'Mensal'}${row.seriesId ? ` · ocorrência ${row.seriesIndex} de ${row.seriesCount}` : ''}`]] : []), ['Recebimento previsto', dateLabel(row.dueDate)], ['Status', statusText[row.status]], ['Conciliação bancária', row.reconciled ? 'Conciliada com o extrato' : 'Não conciliada']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {received && <><h3>Recebimento</h3><dl className="payable-facts">{[['Data', dateLabel(row.receipt.date)], ['Forma', receiptMethods[row.receipt.method]], ...(row.receipt.bankName ? [['Banco', row.receipt.bankName]] : []), ['Juros', money(row.receipt.interestCents)], ['Desconto', money(row.receipt.discountCents)], ['ISS', money(row.receipt.issCents || 0)], ['Valor recebido', money(row.receipt.finalCents)], ['Observação', row.receipt.note || '—']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></>}
        {grouped && <><h3>Parcelas do recebimento</h3><div className="payable-siblings">{data.siblings.map((part) => <button type="button" key={part.id} aria-current={part.id === row.id || undefined} onClick={() => onOpen(part.id)}><strong>{part.id} · {part.installmentNumber}/{part.installmentCount}</strong><span>{money(part.valueCents)} · {dateLabel(part.dueDate)} · {statusText[part.status]}</span></button>)}</div></>}
        {row.reconciled && <p className="payable-muted"><Link2 size={14} aria-hidden="true" /> Para editar, estornar ou excluir, desfaça antes a conciliação em Conciliação bancária.</p>}
      </section>
      <section><h3>Anexos</h3><ul className="payable-attachments">{files.map((file) => <li key={file.id}><span><strong>{file.name}</strong><small>{file.contentType} · {(file.size / 1024).toFixed(1)} KB</small></span>{previewable(file) && <button type="button" className="payable-icon" aria-label={`Visualizar ${file.name}`} title="Visualizar" onClick={() => setPreview(file)}><Eye size={17} /></button>}<button type="button" className="payable-icon" aria-label={`Baixar ${file.name}`} title="Baixar arquivo" onClick={() => run(() => downloadFile(`/api/receivables/${id}/files/${file.id}`, file.name))}><Download size={17} /></button>{row.attachments.includes(file) && <button type="button" className="payable-icon" aria-label={`Excluir anexo ${file.name}`} title="Excluir anexo" disabled={locked || busy} onClick={() => run(() => payableRequest(`/receivables/${id}/files/${file.id}`, 'DELETE'))}><Trash2 size={17} /></button>}</li>)}</ul>{!files.length && <p className="payable-muted">Nenhum anexo.</p>}<label className={`admin-tool-button payable-upload-button ${locked ? 'is-disabled' : ''}`}><Upload size={16} />Adicionar anexos<input type="file" multiple hidden disabled={locked || busy} onChange={(event) => { const picked = [...event.target.files]; event.target.value = ''; run(() => uploadFiles('/receivables', picked, id)) }} /></label></section>
      <section><h3>Histórico</h3><History rows={data.history} /></section>
    </>}
    {confirm && <ReasonForm {...confirm} onClose={() => setConfirm(null)} />}
    {preview && <FilePreview url={`/api/receivables/${id}/files/${preview.id}`} file={preview} onClose={() => setPreview(null)} />}
  </PayableModal>
}

export default function ReceivablesScreen(props) {
  const banks = useBanks()
  const [data, setData] = useState({ items: [], clients: [] }), [loading, setLoading] = useState(true), [error, setError] = useState(''), [version, setVersion] = useState(0)
  const [filters, setFilters] = useState(initialFilters), [detailId, setDetailId] = useState(() => sessionStorage.getItem('gmac-receivable-open') || ''), [form, setForm] = useState(null), [receiving, setReceiving] = useState(null), [history, setHistory] = useState(null), [exporting, setExporting] = useState(false)
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [sort, setSort] = useState({ key: 'dueDate', direction: 1 }), [selected, setSelected] = useState([])
  async function refresh() { const result = await payableRequest('/receivables'); setData(result); setVersion((v) => v + 1); setError(''); return result }
  useEffect(() => {
    let active = true
    const load = () => payableRequest('/receivables').then((result) => { if (active) { setData(result); setError(''); setLoading(false) } }).catch((caught) => { if (active) { setError(caught.message); setLoading(false) } })
    load(); const stopPolling = pollWhileVisible(load, 30000, ['finance'])
    // The bell opens a receivable directly.
    const open = (event) => { setDetailId(event.detail); sessionStorage.removeItem('gmac-receivable-open') }
    window.addEventListener('gmac-receivable-open', open); sessionStorage.removeItem('gmac-receivable-open')
    return () => { active = false; stopPolling(); window.removeEventListener('gmac-receivable-open', open) }
  }, [])
  useEffect(() => { setPage(1); setSelected([]) }, [filters, pageSize])
  // A bank shows the receipts that entered it, whatever the situation filter.
  const inPeriod = (row) => (!filters.start || row.dueDate >= filters.start) && (!filters.end || row.dueDate <= filters.end) && matches(row, filters.search) && (!filters.bankId || row.receipt?.bankId === filters.bankId)
  const base = data.items.filter(inPeriod)
  const filtered = base.filter((row) => filters.status === 'all' || (filters.status ? row.status === filters.status : filters.bankId || row.status !== 'received')).sort((a, b) => { const av = a[sort.key] ?? '', bv = b[sort.key] ?? ''; return sort.direction * (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'pt-BR')) || a.id.localeCompare(b.id) })
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), currentPage = Math.min(page, pages), visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const selection = data.items.filter((row) => selected.includes(row.id))
  const pageSelected = visible.length > 0 && visible.every((row) => selected.includes(row.id))
  const selectPage = (checked) => setSelected(checked ? [...new Set([...selected, ...visible.map((row) => row.id)])] : selected.filter((rowId) => !visible.some((row) => row.id === rowId)))
  const sortBy = (key) => setSort({ key, direction: sort.key === key ? -sort.direction : 1 })
  const totals = { pending: 0, overdue: 0, received: 0 }
  for (const row of data.items) totals[row.status] += row.receipt ? row.receipt.finalCents : row.valueCents
  async function exportRows(format, ids) { setExporting(true); setError(''); try { await exportReceivables({ format, filters, ids }) } catch (caught) { setError(caught.message) } finally { setExporting(false) } }
  return <AdminWorkspace {...props} title="Contas a Receber">
    <div className="payable-heading-actions"><button type="button" className="payable-icon" title="Histórico geral" aria-label="Histórico geral" onClick={async () => { try { setHistory((await payableRequest('/receivables/history')).items) } catch (caught) { setError(caught.message) } }}><Info size={21} /></button><button className="admin-tool-button admin-tool-button--primary" onClick={() => setForm({})}><Plus size={17} />Nova conta a receber</button></div>
    {error && <p className="admin-tool-error" role="alert">{error}<button className="admin-tool-button" onClick={() => refresh().catch((caught) => setError(caught.message))}>Tentar novamente</button></p>}
    {loading ? <p>Carregando...</p> : <>
      <div className="receivable-summary">{[['pending', 'A receber'], ['overdue', 'Vencido'], ['received', 'Recebido']].map(([key, label]) => <article className={`payable-metric payable-metric--${key === 'received' ? 'paid' : key}`} key={key}><span>{label}</span><strong>{money(totals[key])}</strong><small>{data.items.filter((row) => row.status === key).length} contas</small></article>)}</div>
      <div className="payable-toolbar"><label className="payable-search"><Search size={18} /><input aria-label="Busca rápida" placeholder="ID, cliente, CNPJ, valor, descrição, documento ou OS" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label><label className="payable-bank-filter"><span className="sr-only">Banco do recebimento</span><select aria-label="Banco do recebimento" value={filters.bankId} onChange={(event) => setFilters({ ...filters, bankId: event.target.value })}><option value="">Todos os bancos</option>{(banks || []).map((bank) => <option key={bank.id} value={bank.id}>{bankOptionLabel(bank)}</option>)}</select></label><button className="admin-tool-button" onClick={() => setFilters(initialFilters())}><RotateCcw size={16} />Limpar filtros</button><button className="admin-tool-button" disabled={exporting} onClick={() => exportRows('pdf')}><FileDown size={16} />PDF</button><button className="admin-tool-button" disabled={exporting} onClick={() => exportRows('xlsx')}><Sheet size={16} />Excel</button></div>
      <div className="payable-quick-filters"><div className="payable-status-filters" role="group" aria-label="Situação">{[['pending', 'Pendentes'], ['overdue', 'Vencidas'], ['received', 'Recebidas'], ['all', 'Todas']].map(([key, label]) => { const group = key === 'all' ? base : base.filter((row) => row.status === key); return <button className="admin-tool-button" aria-pressed={filters.status === key} key={key} onClick={() => setFilters({ ...filters, status: filters.status === key ? '' : key })}>{label}<span>{group.length}</span><small>{money(sumOf(group))}</small></button> })}</div>
        <div className="payable-status-filters payable-due-filters" role="group" aria-label="Vencimento"><span className="payable-quick-label" aria-hidden="true">Vencimento:</span>{dueShortcuts().map(([key, label, start, end]) => { const active = filters.start === start && filters.end === end; return <button className="admin-tool-button" aria-pressed={active} key={key} onClick={() => setFilters({ ...filters, start: active ? '' : start, end: active ? '' : end })}>{label}</button> })}</div></div>
      {selected.length > 0 && <div className="payable-bulk-actions"><strong>{selection.length} selecionadas · {money(sumOf(selection))}</strong><button className="payable-link" onClick={() => setSelected(filtered.map((row) => row.id))}>Selecionar todas as contas do filtro atual ({filtered.length})</button><button className="admin-tool-button" disabled={!selection.length || selection.some((row) => row.receipt)} onClick={() => setReceiving({ rows: selection, bulk: true })}><Check size={15} />Dar baixa</button><button className="admin-tool-button" disabled={exporting} onClick={() => exportRows('pdf', selected)}><FileDown size={15} />PDF</button><button className="admin-tool-button" disabled={exporting} onClick={() => exportRows('xlsx', selected)}><Sheet size={15} />Excel</button></div>}
      <div className="payable-mobile-controls"><label>Ordenar por<select aria-label="Ordenar por" value={sort.key} onChange={(event) => setSort({ ...sort, key: event.target.value })}>{sortFields.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className="payable-icon" type="button" aria-label={sort.direction === 1 ? 'Ordem crescente; inverter ordenação' : 'Ordem decrescente; inverter ordenação'} title="Inverter ordenação" onClick={() => setSort({ ...sort, direction: -sort.direction })}><ArrowUpDown size={18} /></button><label className="payable-mobile-select"><input type="checkbox" checked={pageSelected} onChange={(event) => selectPage(event.target.checked)} />Selecionar contas da página</label></div>
      <div className="payable-table-scroll"><table className="payable-table receivable-table"><thead><tr><th><input type="checkbox" aria-label="Selecionar contas da página" checked={pageSelected} onChange={(event) => selectPage(event.target.checked)} /></th>{sortFields.map(([key, label]) => <th key={key} aria-sort={sort.key === key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button onClick={() => sortBy(key)}>{label}<ArrowUpDown size={12} /></button></th>)}</tr></thead><tbody>{visible.map((row) => <tr key={row.id} tabIndex={0} onClick={() => setDetailId(row.id)} onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) setDetailId(row.id) }}><td onClick={(event) => event.stopPropagation()}><label className="payable-row-select"><input type="checkbox" aria-label={`Selecionar ${row.id}`} checked={selected.includes(row.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, row.id] : selected.filter((rowId) => rowId !== row.id))} /></label></td><td className="payable-id">{row.id}</td><td data-label="Cliente">{row.customerName}</td><td data-label="Documento" title="Documento / boleto / NF">{row.documentNumber || '—'}</td><td data-label="Origem">{row.orderCode || (row.treasury ? 'Tesouraria' : row.kind === 'recurring' ? 'Contrato' : 'Manual')}</td><td data-label="Valor" className="payable-value">{money(row.valueCents)}</td><td data-label="Vencimento">{dateLabel(row.dueDate)}</td><td data-label="Parcela">{row.groupId ? `${row.installmentNumber} de ${row.installmentCount}` : '—'}</td><td data-label="Status"><ReceivableStatus row={row} />{row.reconciled && <small className="receivable-reconciled"><Link2 size={12} aria-hidden="true" />Conciliada</small>}</td></tr>)}{!visible.length && <tr><td colSpan={9} className="payable-empty">Nenhuma conta encontrada.</td></tr>}</tbody></table></div>
      <div className="payable-pagination"><span>{filtered.length} contas · {money(sumOf(filtered))}</span><label>Por página<select aria-label="Por página" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{[20, 50, 100].map((n) => <option key={n}>{n}</option>)}</select></label><button className="payable-icon" title="Página anterior" aria-label="Página anterior" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button><span>{currentPage} / {pages}</span><button className="payable-icon" title="Próxima página" aria-label="Próxima página" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div>
      <ReceivableForecast rows={data.items} />
    </>}
    {detailId && <ReceivableDetails id={detailId} key={detailId} refreshVersion={version} onClose={() => setDetailId('')} onEdit={(detail) => { setDetailId(''); setForm({ source: detail.item, siblings: detail.siblings, structureLocked: detail.structureLocked }) }} onReceive={(row) => { setDetailId(''); setReceiving({ rows: [row], bulk: false }) }} onChanged={refresh} onOpen={setDetailId} />}
    {form && <ReceivableForm {...form} clients={data.clients} classifications={data.classifications || []} onClose={() => setForm(null)} onSaved={async (item) => { await refresh(); setForm(null); setDetailId(item.id) }} onClientCreated={() => refresh().catch(() => {})} />}
    {receiving && <ReceiptForm {...receiving} onClose={() => setReceiving(null)} onSaved={async () => { const single = !receiving.bulk && receiving.rows[0].id; await refresh(); setReceiving(null); setSelected([]); if (single) setDetailId(single) }} />}
    {history && <PayableModal title="Histórico geral · Contas a Receber" wide onClose={() => setHistory(null)}><History rows={history} /></PayableModal>}
  </AdminWorkspace>
}
