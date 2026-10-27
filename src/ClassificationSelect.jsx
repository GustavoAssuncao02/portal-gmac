import { fitsUse, termOf, termCounterpart, suggestedTerm, classificationLabel } from '../server/accountPlanRules.js'

// The classifications a form offers, by group of accounts and in the order of the codes. `use` keeps only what fits the
// entry (money out, money in or a DRE adjustment); `keep` are the ones the entry already has, shown even when deactivated.
export const classificationOptions = (classifications, use, keep = []) => classifications.filter((item) => keep.includes(item.id) || !item.inactive && !item.groupInactive && fitsUse(item, use))

export default function ClassificationSelect({ classifications = [], use, keep = [], exclude = [], value, onChange, required = true, label = 'Classificação', placeholder = 'Selecione', ...props }) {
  const options = classificationOptions(classifications, use, [...keep, value].filter(Boolean)).filter((item) => item.id === value || !exclude.includes(item.id))
  const groups = [...new Map(options.map((item) => [item.groupId, `${item.groupCode} · ${item.groupName || 'Sem grupo'}`])).entries()]
  return <select aria-label={label} required={required} value={value} onChange={(event) => onChange(event.target.value)} {...props}>
    <option value="">{placeholder}</option>
    {groups.map(([groupId, groupLabel]) => <optgroup key={groupId || 'none'} label={groupLabel}>{options.filter((item) => item.groupId === groupId).map((item) => <option key={item.id} value={item.id}>{classificationLabel(item)}{item.inactive || item.groupInactive ? ' (D)' : ''}</option>)}</optgroup>)}
  </select>
}

// À vista or a prazo: when the chosen revenue has a pair with the other term and the dates point to it, offers the switch.
export function RevenueTermHint({ classifications = [], value, onChange, context }) {
  const term = suggestedTerm(context), chosen = classifications.find((item) => item.id === value)
  const reason = term === 'vista' ? context.treasury ? 'dinheiro já recebido' : 'recebimento na data da emissão' : context.kind === 'installment' ? 'recebimento parcelado' : 'recebimento depois da emissão'
  if (!chosen) return classifications.some((item) => termOf(item.name)) ? <small className="payable-hint">Sugestão: receita {term === 'vista' ? 'à vista' : 'a prazo'} ({reason}).</small> : null
  const other = termOf(chosen.name) && termOf(chosen.name) !== term ? termCounterpart(chosen, classificationOptions(classifications, 'receivable')) : null
  if (!other) return null
  return <small className="payable-hint classification-term-hint">Sugestão para {reason}: <button type="button" className="payable-link" onClick={() => onChange(other.id)}>usar {classificationLabel(other)}</button></small>
}
