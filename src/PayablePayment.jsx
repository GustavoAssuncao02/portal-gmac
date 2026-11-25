import { useId, useState } from 'react'
import { Check } from 'lucide-react'
import { PayableModal, FilePicker } from './PayableModal.jsx'
import MoneyInput from './MoneyInput.jsx'
import { todayBahia, cents } from '../server/payableRules.js'
import { payableRequest, money, uploadPayableFiles, dateLabel, decimal } from './payablesApi.js'
import BankSelect from './BankSelect.jsx'

const safeCents = (value) => { try { return cents(value || '0') } catch { return 0 } }

export default function PayablePayment({ rows, bulk = false, onClose, onSaved }) {
  const formId = useId(), total = rows.reduce((sum, r) => sum + r.valueCents, 0)
  const [partial, setPartial] = useState(false)
  const [draft, setDraft] = useState({ date: todayBahia(), method: 'pix', bankId: '', interest: '', discount: '', paid: decimal(total), note: '', balanceDueDate: rows[0]?.dueDate || todayBahia() }), [files, setFiles] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const interest = safeCents(draft.interest), discount = safeCents(draft.discount)
  // Typing the amount actually paid fills interest (paid more) or discount (paid less); editing those updates the amount.
  const adjust = (key, value) => { const next = { ...draft, [key]: value }; const final = total + safeCents(next.interest) - safeCents(next.discount); setDraft({ ...next, paid: decimal(Math.max(0, final)) }) }
  // Baixa parcial: only the amount paid now; the balance stays open with the due date chosen here. Interest and discount wait for the final settlement.
  const paidNow = safeCents(draft.paid), partialOk = partial && paidNow > 0 && paidNow < total
  const choose = (next) => { setPartial(next); setDraft({ ...draft, interest: '', discount: '', paid: next ? '' : decimal(total) }) }
  const pay = (value) => { const difference = safeCents(value) - total; setDraft({ ...draft, paid: value, interest: difference > 0 ? decimal(difference) : '', discount: difference < 0 && value ? decimal(-difference) : '' }) }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (draft.date > todayBahia()) throw new Error('O pagamento não pode ter data futura.')
      const fileIds = bulk ? [] : await uploadPayableFiles(files)
      if (partial) {
        if (!partialOk) throw new Error(`Informe um valor maior que zero e menor que ${money(total)}. Para pagar tudo, use a baixa total.`)
        await payableRequest(`/payables/${rows[0].id}/partial`, 'POST', { date: draft.date, method: draft.method, bankId: draft.bankId, note: draft.note, paid: draft.paid, balanceDueDate: draft.balanceDueDate, fileIds })
        await onSaved(rows[0], true)
        return
      }
      const { paid, balanceDueDate, ...body } = draft
      await payableRequest(bulk ? '/payables/bulk' : `/payables/${rows[0].id}/pay`, 'POST', { ...body, fileIds, ...(bulk ? { action: 'pay', ids: rows.map((r) => r.id) } : {}) })
      await onSaved(bulk ? null : rows[0])
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title={bulk ? 'Confirmar baixa em massa' : `${partial ? 'Baixa parcial' : 'Dar baixa'} · ${rows[0].id}`} onClose={onClose} busy={busy} footer={<><button className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={formId} disabled={busy}><Check size={16} />{partial ? 'Confirmar baixa parcial' : 'Confirmar baixa'}</button></>}>
    <form id={formId} className="payable-form" onSubmit={submit}><fieldset disabled={busy}>{bulk && <><p>{rows.length} contas selecionadas · {money(total)}</p><div className="payable-bulk-list">{rows.map((r) => <div key={r.id}><strong>{r.id} · {r.supplierName}</strong><span>{r.description} · {r.classificationName}</span><span>{dateLabel(r.dueDate)} · {money(r.valueCents)}</span></div>)}</div></>}
      {!bulk && <div className="payable-mode" role="group" aria-label="Tipo de baixa"><button type="button" aria-pressed={!partial} onClick={() => choose(false)}>Baixa total</button><button type="button" aria-pressed={partial} onClick={() => choose(true)}>Baixa parcial</button></div>}
      <label>Data do pagamento<input type="date" required value={draft.date} max={todayBahia()} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label><label>Forma de pagamento<select aria-label="Forma de pagamento" value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value })}><option value="pix">Pix</option><option value="boleto">Boleto</option><option value="card">Cartão</option></select></label>
      <BankSelect value={draft.bankId} onChange={(bankId) => setDraft({ ...draft, bankId })} />
      {partial && <><label>Valor pago agora<MoneyInput aria-label="Valor pago agora" required value={draft.paid} onChange={(value) => setDraft({ ...draft, paid: value })} /><small className="payable-hint">Saldo da conta: {money(total)}. Juros e desconto entram só na baixa final.</small></label>
        <label>Vencimento do saldo<input type="date" aria-label="Vencimento do saldo" required value={draft.balanceDueDate} onChange={(event) => setDraft({ ...draft, balanceDueDate: event.target.value })} /></label>
        <div className="payable-final"><span>{money(total)} − {money(paidNow)} pago agora = saldo que continua em aberto</span><strong>{money(Math.max(0, total - paidNow))}</strong></div></>}
      {!bulk && !partial && <><label>Valor pago<MoneyInput aria-label="Valor pago" required value={draft.paid} onChange={pay} /><small className="payable-hint">Se for diferente de {money(total)}, juros ou desconto são preenchidos automaticamente.</small></label><div className="payable-adjustments"><label>Juros (R$)<MoneyInput aria-label="Juros (R$)" value={draft.interest} disabled={discount > 0} onChange={(value) => adjust('interest', value)} /></label><label>Desconto (R$)<MoneyInput aria-label="Desconto (R$)" value={draft.discount} disabled={interest > 0} onChange={(value) => adjust('discount', value)} /></label></div></>}
      {!partial && <div className="payable-final"><span>{money(total)}{interest ? ` + ${money(interest)} de juros` : ''}{discount ? ` − ${money(discount)} de desconto` : ''} =</span><strong>{money(total + interest - discount)}</strong></div>}
      {!bulk && <><label>Observação do pagamento<textarea aria-label="Observação do pagamento" rows={3} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label><FilePicker title="Comprovantes" files={files} setFiles={setFiles} disabled={busy} /></>}{error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}
