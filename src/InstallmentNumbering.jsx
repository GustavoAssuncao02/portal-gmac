// Numeração real de um parcelamento (2026-11-28): a plan already running elsewhere (a DAS "parcela 54/188") is launched
// with the number of its first installment and the total of the agreement, so the portal shows "54 de 188" and not
// "1 de 50". Only the numbering changes: values, dates and settlements stay. Used by Contas a Pagar and Contas a Receber;
// the server applies it (server/payableRules.js planNumbering), also to a plan that already has a settled installment.
const given = (value) => value !== undefined && value !== null && value !== ''

// The fields of the form: a plan being edited starts with its own numbering; a new one with 1 and the automatic total.
export const numberingDraft = (source, siblings = []) => source?.realNumbering && siblings.length
  ? { installmentStart: String(Math.min(...siblings.map((row) => row.installmentNumber))), installmentTotal: String(source.installmentCount) }
  : { installmentStart: '1', installmentTotal: '' }
export const numberingPayload = (draft) => ({ installmentStart: Number(draft.installmentStart) || 1, installmentTotal: given(draft.installmentTotal) ? Number(draft.installmentTotal) : null })
// The numbers shown on the installments of the form. The same installments of a plan being edited keep their gaps.
export function installmentNumbers(draft, count, siblings = []) {
  const start = Number(draft.installmentStart) || 1
  const previous = [...siblings].sort((a, b) => a.installmentNumber - b.installmentNumber)
  if (previous.length && previous.length === count) return previous.map((row) => row.installmentNumber - previous[0].installmentNumber + start)
  return Array.from({ length: count }, (_, index) => start + index)
}
export const installmentTotal = (draft, numbers) => given(draft.installmentTotal) ? Number(draft.installmentTotal) : Math.max(0, ...numbers)

export default function InstallmentNumbering({ draft, numbers, onChange, disabled = false }) {
  const last = Math.max(0, ...numbers), total = installmentTotal(draft, numbers)
  return <div className="installment-numbering payable-form-wide">
    <label>Começa na parcela nº<input type="number" aria-label="Começa na parcela nº" min={1} disabled={disabled} value={draft.installmentStart} onChange={(event) => onChange({ installmentStart: event.target.value })} /></label>
    <label>Total de parcelas do acordo<input type="number" aria-label="Total de parcelas do acordo" min={last || 1} placeholder={last ? String(last) : ''} disabled={disabled} value={draft.installmentTotal} onChange={(event) => onChange({ installmentTotal: event.target.value })} /></label>
    <p className="payable-hint">{numbers.length ? `Numeração: ${numbers.length > 1 ? `parcelas ${numbers[0]} a ${last}` : `parcela ${numbers[0]}`} de ${total}. ` : ''}Para um parcelamento que já está em andamento (ex.: parcela 54 de 188), informe a parcela de início e o total do acordo; só muda a numeração.</p>
  </div>
}
