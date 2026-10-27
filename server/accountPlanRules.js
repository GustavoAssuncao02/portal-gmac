// Plano de contas: every classification belongs to a group (Grupos de contas) and sits on one line of the DRE. The line
// decides the nature of the classification: revenue lines take money in (Contas a Receber, Tesouraria entries), expense
// lines take money out (Contas a Pagar, Tesouraria exits) and the lines outside the result take both, without changing
// the profit. Shared by the server and the screens.
export const dreLines = {
  gross_revenue: { label: 'Receita bruta', nature: 'revenue' },
  deductions: { label: 'Deduções da receita', nature: 'expense' },
  costs: { label: 'Custos de produção', nature: 'expense' },
  operating: { label: 'Despesas operacionais', nature: 'expense' },
  financial_revenue: { label: 'Receitas financeiras', nature: 'revenue' },
  financial_expense: { label: 'Despesas financeiras', nature: 'expense' },
  income_tax: { label: 'IRPJ e CSLL', nature: 'expense' },
  tax_charges: { label: 'Multas, juros e parcelamentos tributários', nature: 'expense' },
  outside: { label: 'Fora do resultado', nature: 'both' },
}
export const behaviors = { fixed: 'Fixo', variable: 'Variável', mixed: 'Misto', none: 'Não se aplica' }
// Classifications the receipts and payments fill on their own: the ISS withheld, the interest and the discounts.
export const automaticSettings = [
  ['iss', 'ISS retido no recebimento', 'expense'],
  ['interestPaid', 'Juros pagos em contas a pagar', 'expense'],
  ['discountReceived', 'Descontos obtidos em contas a pagar', 'revenue'],
  ['interestReceived', 'Juros recebidos de clientes', 'revenue'],
  ['discountGiven', 'Descontos concedidos a clientes', 'expense'],
]

export const natureOf = (classification) => dreLines[classification?.dreLine]?.nature || 'expense'
// `use`: 'payable' (money out), 'receivable' (money in) or 'adjustment' (DRE adjustments: any line of the result).
export function fitsUse(classification, use) {
  const nature = natureOf(classification)
  if (use === 'adjustment') return classification?.dreLine !== 'outside'
  return nature === 'both' || nature === (use === 'receivable' ? 'revenue' : 'expense')
}

export const groupCodePattern = /^\d{1,2}$/
export const classificationCodePattern = /^\d{1,2}\.\d{2}$/
// 1.02 before 1.10 and 2 before 10: codes are compared number by number.
export function compareCodes(left, right) {
  const a = String(left || '').split('.').map(Number), b = String(right || '').split('.').map(Number)
  if (!left || !right) return left ? -1 : right ? 1 : 0
  for (let index = 0; index < Math.max(a.length, b.length); index++) if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0)
  return 0
}
export const classificationLabel = (classification) => classification ? [classification.code, classification.name].filter(Boolean).join(' · ') : ''

// À vista or a prazo: a receipt on the day of the document is à vista; a future date or installments make it a prazo.
// The pair is found by name ("Receita de Serviços à Vista" ↔ "Receita de Serviços a Prazo").
const plain = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
export const termOf = (name) => / a vista\b/.test(` ${plain(name)}`) ? 'vista' : / a prazo\b/.test(` ${plain(name)}`) ? 'prazo' : null
export function termCounterpart(classification, list) {
  const term = termOf(classification?.name)
  if (!term) return null
  const target = ` ${plain(classification.name)}`.replace(term === 'vista' ? / a vista\b/ : / a prazo\b/, term === 'vista' ? ' a prazo' : ' a vista').trim()
  return list.find((item) => item.id !== classification.id && plain(item.name) === target) || null
}
export function suggestedTerm({ treasury = false, kind, issueDate, dueDate } = {}) {
  if (treasury) return 'vista'
  if (kind === 'installment') return 'prazo'
  return dueDate && issueDate && dueDate > issueDate ? 'prazo' : 'vista'
}
