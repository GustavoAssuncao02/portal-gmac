import { useEffect, useId, useState } from 'react'
import { Save, Plus } from 'lucide-react'
import { PayableModal, FilePicker } from './PayableModal.jsx'
import MoneyInput from './MoneyInput.jsx'
import { payableRequest, uploadPayableFiles, decimal, money, dateLabel } from './payablesApi.js'
import { todayBahia, makeInstallments, cents, shiftMonth } from '../server/payableRules.js'

const empty = () => ({ supplierId: '', description: '', classificationId: '', documentNumber: '', issueDate: todayBahia(), value: '', dueDate: '', kind: 'normal', recurrence: 'monthly', ahead: 11, orderCode: '', count: 1, installments: [] })
const safeCents = (value) => { try { return cents(value) } catch { return null } }

// Created over the account form so the draft is kept while a supplier is registered.
function SupplierQuickForm({ onClose, onCreated }) {
  const formId = useId(), [draft, setDraft] = useState({ name: '', document: '', email: '', phone: '' }), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { const result = await payableRequest('/suppliers', 'POST', draft); await onCreated(result.item) } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title="Novo fornecedor" busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={formId} disabled={busy}><Save size={16} />Salvar fornecedor</button></>}>
    <form id={formId} className="payable-form" onSubmit={save}><fieldset disabled={busy}>
      <label>Nome / razão social<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>CPF/CNPJ<input required inputMode="numeric" maxLength={18} value={draft.document} onChange={(event) => setDraft({ ...draft, document: event.target.value.replace(/\D/g, '') })} /></label>
      <label>E-mail<input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
      <label>Telefone<input type="tel" maxLength={30} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}

export default function PayableForm({ suppliers, classifications, orders = [], items = [], source, edit = false, siblings = [], structureLocked, onClose, onSaved, onSupplierCreated }) {
  const formId = useId()
  const initial = source ? { ...empty(), ...source, orderCode: source.orderCode || '', ahead: 0, previousId: source.nextRecurrence ? source.id : edit ? source.previousId : undefined, value: decimal(source.groupId ? source.originalTotalCents : source.valueCents), count: source.kind === 'installment' ? source.installmentCount || 1 : 1, kind: source.kind, installments: edit ? siblings.map((r) => ({ value: decimal(r.valueCents), dueDate: r.dueDate })) : [] } : empty()
  const [draft, setDraft] = useState(initial), [files, setFiles] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [creatingSupplier, setCreatingSupplier] = useState(false), [newSuppliers, setNewSuppliers] = useState([]), [suggested, setSuggested] = useState(false)
  const supplierOptions = [...suppliers, ...newSuppliers.filter((row) => !suppliers.some((item) => item.id === row.id))]
  useEffect(() => { if (!edit && draft.kind === 'installment') recalculate(draft) }, [])
  function recalculate(next) {
    try { if (next.value && next.dueDate) next = { ...next, installments: makeInstallments(cents(next.value), next.dueDate, Number(next.count)).map((r) => ({ value: decimal(r.valueCents), dueDate: r.dueDate })) } } catch { next = { ...next, installments: [] } }
    setDraft(next)
  }
  function change(key, value) { const next = { ...draft, [key]: value }; if (['count', 'value', 'dueDate', 'kind'].includes(key) && next.kind === 'installment') recalculate(next); else setDraft(next) }
  // The classification last used with a supplier is suggested, never forced over a manual choice.
  function chooseSupplier(supplierId) {
    const last = edit ? null : [...items].filter((row) => String(row.supplierId) === String(supplierId)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).find((row) => classifications.some((item) => item.id === row.classificationId && !item.inactive))
    const keep = draft.classificationId && !suggested
    setDraft({ ...draft, supplierId, classificationId: keep || !last ? draft.classificationId : last.classificationId })
    setSuggested(!keep && Boolean(last))
  }
  async function save(event) {
    event.preventDefault(); setError(''); setBusy(true)
    const another = event.nativeEvent.submitter?.value === 'another'
    try {
      if (files.some((f) => f.size > 20 * 1024 * 1024)) throw new Error('Cada arquivo deve ter até 20 MB.')
      if (draft.kind === 'installment' && draft.installments.reduce((sum, r) => sum + cents(r.value), 0) !== cents(draft.value)) throw new Error('A soma das parcelas deve ser exatamente igual ao valor total.')
      const fileIds = await uploadPayableFiles(files)
      const payload = { ...draft, supplierId: draft.supplierId, ahead: draft.kind === 'recurring' && !edit ? Number(draft.ahead) : 0, ...(draft.kind === 'installment' ? {} : { count: 1, installments: undefined }), fileIds }
      const result = await payableRequest(edit ? `/payables/${source.id}` : '/payables', edit ? 'PUT' : 'POST', payload)
      await onSaved(result.items, !another)
      if (another) { setDraft(empty()); setFiles([]); setSuggested(false) }
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  let installmentSum = null
  try { installmentSum = draft.installments.reduce((sum, r) => sum + cents(r.value), 0) } catch { /* Incomplete currency input is validated on submit. */ }
  const aheadCount = Number(draft.ahead) || 0, step = draft.recurrence === 'yearly' ? 12 : 1, valueCents = safeCents(draft.value)
  const lastDue = draft.dueDate && aheadCount ? shiftMonth(draft.dueDate, aheadCount * step) : null
  return <PayableModal title={edit ? `Editar ${source.id}` : 'Nova conta a pagar'} className="payable-modal--form" wide busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" form={formId} type="submit" disabled={busy}><Save size={16} />{busy ? 'Salvando...' : 'Salvar conta'}</button>{!edit && <button className="admin-tool-button" form={formId} type="submit" value="another" disabled={busy}><Plus size={16} />Salvar e criar outra</button>}</>}>
    <form id={formId} onSubmit={save} className="payable-form payable-entry-form"><fieldset disabled={busy}>
      <div className="payable-supplier-field"><label>Fornecedor<select aria-label="Fornecedor" required value={draft.supplierId} onChange={(event) => chooseSupplier(event.target.value)}><option value="">Selecione</option>{supplierOptions.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label><button type="button" className="payable-link" onClick={() => setCreatingSupplier(true)}>Cadastrar fornecedor</button></div>
      <label>OS vinculada (custo)<select aria-label="OS vinculada (custo)" value={draft.orderCode} onChange={(event) => change('orderCode', event.target.value)}><option value="">Nenhuma</option>{orders.map((order) => <option key={order.code} value={order.code}>{order.code} · {order.service}{order.company ? ` · ${order.company}` : ''}</option>)}</select></label>
      <label className="payable-form-wide">Descrição<textarea aria-label="Descrição" rows={1} value={draft.description} maxLength={5000} onChange={(event) => change('description', event.target.value)} /></label>
      <label>Classificação<select aria-label="Classificação" required value={draft.classificationId} onChange={(event) => { setSuggested(false); change('classificationId', event.target.value) }}><option value="">Selecione</option>{classifications.filter((c) => !c.inactive || edit && c.id === source.classificationId).map((c) => <option key={c.id} value={c.id}>{c.name}{c.inactive ? ' (D)' : ''}</option>)}</select>{suggested && <small className="payable-hint">Sugerida pelo último lançamento deste fornecedor.</small>}</label>
      <label>Número do documento / boleto / nota fiscal<input value={draft.documentNumber} maxLength={160} onChange={(event) => change('documentNumber', event.target.value)} /></label>
      <label>Data de emissão<input type="date" required value={draft.issueDate} onChange={(event) => change('issueDate', event.target.value)} /></label>
      <label>{edit && source.groupId ? 'Valor total original' : 'Valor'}<MoneyInput aria-label={edit && source.groupId ? 'Valor total original' : 'Valor'} required positive value={draft.value} disabled={edit && Boolean(source.groupId)} onChange={(value) => change('value', value)} /></label>
      <label>Vencimento<input type="date" required value={draft.dueDate} disabled={structureLocked} onChange={(event) => change('dueDate', event.target.value)} /></label>
      <fieldset className="payable-type" disabled={structureLocked || edit && Boolean(source.groupId)}><legend>Tipo da conta</legend>{[['normal', 'Normal'], ['installment', 'Parcelada'], ['recurring', 'Recorrente']].map(([key, label]) => <label className="payable-radio" key={key}><input name={`${formId}-kind`} type="radio" checked={draft.kind === key} onChange={() => change('kind', key)} />{label}</label>)}</fieldset>
      {draft.kind === 'recurring' && <><label>Recorrência<select aria-label="Recorrência" value={draft.recurrence} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value, ahead: event.target.value === 'yearly' ? 1 : 11 })}><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></label>
        {!edit && <label>Ocorrências futuras geradas agora<input type="number" aria-label="Ocorrências futuras geradas agora" aria-describedby={`${formId}-ahead`} min={0} max={24} required value={draft.ahead} onChange={(event) => change('ahead', event.target.value)} /><small id={`${formId}-ahead`} className="payable-hint">{aheadCount ? `Serão criadas ${aheadCount + 1} contas${valueCents ? ` de ${money(valueCents)}` : ''}${lastDue ? `, até ${dateLabel(lastDue)}` : ''}. Cada uma pode ser editada ou paga separadamente.` : 'Só esta conta; a próxima é oferecida após o pagamento.'}</small></label>}
      </>}
      {draft.kind === 'installment' && <section className="payable-installments"><label>Quantidade de parcelas<input type="number" min={1} max={120} required disabled={structureLocked} value={draft.count} onChange={(event) => change('count', Number(event.target.value))} /></label>{draft.installments.map((r, index) => <div className="payable-installment" key={index}><strong>{index + 1}/{draft.count}</strong><label>Valor da parcela {index + 1}<MoneyInput aria-label={`Valor da parcela ${index + 1}`} required positive value={r.value} disabled={structureLocked} onChange={(value) => setDraft({ ...draft, installments: draft.installments.map((part, i) => i === index ? { ...part, value } : part) })} /></label><label>Vencimento da parcela {index + 1}<input type="date" required value={r.dueDate} disabled={structureLocked} onChange={(event) => setDraft({ ...draft, installments: draft.installments.map((part, i) => i === index ? { ...part, dueDate: event.target.value } : part) })} /></label></div>)}<p className="payable-sum">Soma das parcelas: {installmentSum === null ? '—' : money(installmentSum)}</p>{structureLocked && <p>Existe parcela paga. A estrutura está bloqueada.</p>}</section>}
      <FilePicker files={files} setFiles={setFiles} disabled={busy} />{error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
    {creatingSupplier && <SupplierQuickForm onClose={() => setCreatingSupplier(false)} onCreated={async (supplier) => { setNewSuppliers((rows) => [...rows, supplier]); setCreatingSupplier(false); chooseSupplier(supplier.id); await onSupplierCreated?.() }} />}
  </PayableModal>
}
