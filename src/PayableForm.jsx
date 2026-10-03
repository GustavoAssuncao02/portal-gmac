import { useEffect, useId, useState } from 'react'
import { Save, Plus } from 'lucide-react'
import { PayableModal, FilePicker } from './PayableModal.jsx'
import { payableRequest, uploadPayableFiles, decimal, money } from './payablesApi.js'
import { todayBahia, makeInstallments, cents } from '../server/payableRules.js'

const empty = () => ({ supplierId: '', description: '', classificationId: '', documentNumber: '', issueDate: todayBahia(), value: '', dueDate: '', kind: 'normal', recurrence: 'monthly', count: 1, installments: [] })
export default function PayableForm({ suppliers, classifications, source, edit = false, siblings = [], structureLocked, onClose, onSaved, onSupplier }) {
  const formId = useId()
  const initial = source ? { ...empty(), ...source, previousId: source.nextRecurrence ? source.id : edit ? source.previousId : undefined, value: decimal(source.groupId ? source.originalTotalCents : source.valueCents), count: source.kind === 'installment' ? source.installmentCount || 1 : 1, kind: source.kind, installments: edit ? siblings.map((r) => ({ value: decimal(r.valueCents), dueDate: r.dueDate })) : [] } : empty()
  const [draft, setDraft] = useState(initial), [files, setFiles] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { if (!edit && draft.kind === 'installment') recalculate(draft) }, [])
  function recalculate(next) {
    try { if (next.value && next.dueDate) next = { ...next, installments: makeInstallments(cents(next.value), next.dueDate, Number(next.count)).map((r) => ({ value: decimal(r.valueCents), dueDate: r.dueDate })) } } catch { next = { ...next, installments: [] } }
    setDraft(next)
  }
  function change(key, value) { const next = { ...draft, [key]: value }; if (['count', 'value', 'dueDate', 'kind'].includes(key) && next.kind === 'installment') recalculate(next); else setDraft(next) }
  async function save(event) {
    event.preventDefault(); setError(''); setBusy(true)
    const another = event.nativeEvent.submitter?.value === 'another'
    try {
      if (files.some((f) => f.size > 20 * 1024 * 1024)) throw new Error('Cada arquivo deve ter até 20 MB.')
      if (draft.kind === 'installment' && draft.installments.reduce((sum, r) => sum + cents(r.value), 0) !== cents(draft.value)) throw new Error('A soma das parcelas deve ser exatamente igual ao valor total.')
      const fileIds = await uploadPayableFiles(files)
      const payload = { ...draft, supplierId: draft.supplierId, ...(draft.kind === 'installment' ? {} : { count: 1, installments: undefined }), fileIds }
      const result = await payableRequest(edit ? `/payables/${source.id}` : '/payables', edit ? 'PUT' : 'POST', payload)
      await onSaved(result.items, !another)
      if (another) { setDraft(empty()); setFiles([]) }
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  let installmentSum = null
  try { installmentSum = draft.installments.reduce((sum, r) => sum + cents(r.value), 0) } catch { /* Incomplete currency input is validated on submit. */ }
  return <PayableModal title={edit ? `Editar ${source.id}` : 'Nova conta a pagar'} className="payable-modal--form" wide busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" form={formId} type="submit" disabled={busy}><Save size={16} />{busy ? 'Salvando...' : 'Salvar conta'}</button>{!edit && <button className="admin-tool-button" form={formId} type="submit" value="another" disabled={busy}><Plus size={16} />Salvar e criar outra</button>}</>}>
    <form id={formId} onSubmit={save} className="payable-form payable-entry-form"><fieldset disabled={busy}>
      <div className="payable-supplier-field payable-form-wide"><label>Fornecedor<select aria-label="Fornecedor" required value={draft.supplierId} onChange={(event) => change('supplierId', event.target.value)}><option value="">Selecione</option>{suppliers.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label><button type="button" className="payable-link" onClick={onSupplier}>Cadastrar fornecedor</button></div>
      <label className="payable-form-wide">Descrição<textarea aria-label="Descrição" rows={1} value={draft.description} maxLength={5000} onChange={(event) => change('description', event.target.value)} /></label>
      <label>Classificação<select aria-label="Classificação" required value={draft.classificationId} onChange={(event) => change('classificationId', event.target.value)}><option value="">Selecione</option>{classifications.filter((c) => !c.inactive || edit && c.id === source.classificationId).map((c) => <option key={c.id} value={c.id}>{c.name}{c.inactive ? ' (D)' : ''}</option>)}</select></label>
      <label>Número do documento / boleto / nota fiscal<input value={draft.documentNumber} maxLength={160} onChange={(event) => change('documentNumber', event.target.value)} /></label>
      <label>Data de emissão<input type="date" required value={draft.issueDate} onChange={(event) => change('issueDate', event.target.value)} /></label>
      <label>{edit && source.groupId ? 'Valor total original' : 'Valor'}<input type="number" step="0.01" min="0.01" required value={draft.value} disabled={edit && Boolean(source.groupId)} onChange={(event) => change('value', event.target.value)} /></label>
      <label>Vencimento<input type="date" required value={draft.dueDate} disabled={structureLocked} onChange={(event) => change('dueDate', event.target.value)} /></label>
      <fieldset className="payable-type" disabled={structureLocked || edit && Boolean(source.groupId)}><legend>Tipo da conta</legend>{[['normal', 'Normal'], ['installment', 'Parcelada'], ['recurring', 'Recorrente']].map(([key, label]) => <label className="payable-radio" key={key}><input name={`${formId}-kind`} type="radio" checked={draft.kind === key} onChange={() => change('kind', key)} />{label}</label>)}</fieldset>
      {draft.kind === 'recurring' && <label>Recorrência<select aria-label="Recorrência" value={draft.recurrence} onChange={(event) => change('recurrence', event.target.value)}><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></label>}
      {draft.kind === 'installment' && <section className="payable-installments"><label>Quantidade de parcelas<input type="number" min={1} max={120} required disabled={structureLocked} value={draft.count} onChange={(event) => change('count', Number(event.target.value))} /></label>{draft.installments.map((r, index) => <div className="payable-installment" key={index}><strong>{index + 1}/{draft.count}</strong><label>Valor da parcela {index + 1}<input type="number" min="0.01" step="0.01" required value={r.value} disabled={structureLocked} onChange={(event) => setDraft({ ...draft, installments: draft.installments.map((part, i) => i === index ? { ...part, value: event.target.value } : part) })} /></label><label>Vencimento da parcela {index + 1}<input type="date" required value={r.dueDate} disabled={structureLocked} onChange={(event) => setDraft({ ...draft, installments: draft.installments.map((part, i) => i === index ? { ...part, dueDate: event.target.value } : part) })} /></label></div>)}<p className="payable-sum">Soma das parcelas: {installmentSum === null ? '—' : money(installmentSum)}</p>{structureLocked && <p>Existe parcela paga. A estrutura está bloqueada.</p>}</section>}
      <FilePicker files={files} setFiles={setFiles} disabled={busy} />{error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}
