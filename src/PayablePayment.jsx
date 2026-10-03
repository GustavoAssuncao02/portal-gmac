import { useId, useState } from 'react'
import { Check } from 'lucide-react'
import { PayableModal, FilePicker } from './PayableModal.jsx'
import { todayBahia, cents } from '../server/payableRules.js'
import { payableRequest, money, uploadPayableFiles, dateLabel } from './payablesApi.js'

export default function PayablePayment({ rows, bulk = false, onClose, onSaved }) {
  const formId = useId(), total = rows.reduce((sum, r) => sum + r.valueCents, 0)
  const [draft, setDraft] = useState({ date: todayBahia(), method: 'pix', interest: '', discount: '', note: '' }), [files, setFiles] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  let interest = 0, discount = 0
  try { interest = cents(draft.interest || '0'); discount = cents(draft.discount || '0') } catch { /* Numeric validation occurs on submit. */ }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (draft.date > todayBahia()) throw new Error('O pagamento não pode ter data futura.')
      if (files.some((f) => f.size > 20 * 1024 * 1024)) throw new Error('Cada arquivo deve ter até 20 MB.')
      const fileIds = bulk ? [] : await uploadPayableFiles(files)
      await payableRequest(bulk ? '/payables/bulk' : `/payables/${rows[0].id}/pay`, 'POST', { ...draft, fileIds, ...(bulk ? { action: 'pay', ids: rows.map((r) => r.id) } : {}) })
      await onSaved(bulk ? null : rows[0])
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title={bulk ? 'Confirmar baixa em massa' : `Dar baixa · ${rows[0].id}`} onClose={onClose} busy={busy} footer={<><button className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={formId} disabled={busy}><Check size={16} />Confirmar baixa</button></>}>
    <form id={formId} className="payable-form" onSubmit={submit}><fieldset disabled={busy}>{bulk && <><p>{rows.length} contas selecionadas</p><div className="payable-bulk-list">{rows.map((r) => <div key={r.id}><strong>{r.id} · {r.supplierName}</strong><span>{r.description} · {r.classificationName}</span><span>{dateLabel(r.dueDate)} · {money(r.valueCents)}</span></div>)}</div></>}
      <label>Data do pagamento<input type="date" required value={draft.date} max={todayBahia()} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label><label>Forma de pagamento<select aria-label="Forma de pagamento" value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value })}><option value="pix">Pix</option><option value="boleto">Boleto</option><option value="card">Cartão</option></select></label>
      {!bulk && <><label>Juros (R$)<input type="number" min="0" step="0.01" value={draft.interest} disabled={discount > 0} onChange={(event) => setDraft({ ...draft, interest: event.target.value })} /></label><label>Desconto (R$)<input type="number" min="0" step="0.01" value={draft.discount} disabled={interest > 0} onChange={(event) => setDraft({ ...draft, discount: event.target.value })} /></label></>}
      <div className="payable-final"><span>{money(total)}{interest ? ` + ${money(interest)} de juros` : ''}{discount ? ` − ${money(discount)} de desconto` : ''} =</span><strong>{money(total + interest - discount)}</strong></div>
      {!bulk && <><label>Observação do pagamento<textarea aria-label="Observação do pagamento" rows={3} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label><FilePicker title="Comprovantes" files={files} setFiles={setFiles} disabled={busy} /></>}{error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}
