import MoneyInput from './MoneyInput.jsx'
import { money, decimal } from './payablesApi.js'
import { cents, makeInstallments } from '../server/payableRules.js'

const safeCents = (value) => { try { return cents(value) } catch { return null } }

// Splits the total into monthly installments from the first expected date; the first ones absorb the rounding cents.
export function withInstallments(draft) {
  if (draft.kind !== 'installment') return draft
  const total = safeCents(draft.value), count = Number(draft.count)
  if (!total || !draft.dueDate || !Number.isInteger(count) || count < 2 || count > 120) return { ...draft, installments: [] }
  return { ...draft, installments: makeInstallments(total, draft.dueDate, count).map((row) => ({ value: decimal(row.valueCents), dueDate: row.dueDate })) }
}
export const installmentPayload = (draft) => draft.kind === 'installment' ? { kind: 'installment', count: Number(draft.count), installments: draft.installments } : { kind: 'single', count: 1, installments: undefined }

export function InstallmentFields({ draft, setDraft, minDate, disabled = false }) {
  const sum = draft.installments.reduce((total, row) => total + (safeCents(row.value) ?? 0), 0), total = safeCents(draft.value)
  const edit = (index, key, value) => setDraft({ ...draft, installments: draft.installments.map((row, i) => i === index ? { ...row, [key]: value } : row) })
  return <section className="payable-installments receivable-installments payable-form-wide">
    <label>Quantidade de parcelas<input type="number" aria-label="Quantidade de parcelas" min={2} max={120} required disabled={disabled} value={draft.count} onChange={(event) => setDraft(withInstallments({ ...draft, count: event.target.value }))} /></label>
    {!draft.installments.length && <p className="payable-hint">Informe o valor total e a data da 1ª parcela para gerar as parcelas.</p>}
    {draft.installments.map((row, index) => <div className="payable-installment" key={index}><strong>{index + 1}/{draft.installments.length}</strong>
      <label>Valor da parcela {index + 1}<MoneyInput aria-label={`Valor da parcela ${index + 1}`} required positive disabled={disabled} value={row.value} onChange={(value) => edit(index, 'value', value)} /></label>
      <label>Recebimento da parcela {index + 1}<input type="date" aria-label={`Recebimento da parcela ${index + 1}`} required min={minDate} disabled={disabled} value={row.dueDate} onChange={(event) => edit(index, 'dueDate', event.target.value)} /></label>
    </div>)}
    {draft.installments.length > 0 && <p className={`payable-sum${total != null && sum !== total ? ' receivable-sum--off' : ''}`}>Soma das parcelas: {money(sum)}{total != null && sum !== total ? ` · diferença de ${money(total - sum)} para o total` : ''}</p>}
  </section>
}
