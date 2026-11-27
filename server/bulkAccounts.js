// Ações em massa de Contas a Pagar e Contas a Receber: Excluir, Desfazer baixa e Alterar classificação. Each account follows
// the same rule as the individual action. The server first previews what will happen, listing the accounts that cannot take
// the action and why; the confirmation carries the token of that preview and nothing is saved when anything changed since
// (someone else changed the accounts): the refusal brings the new preview.
import { createHash } from 'node:crypto'

export const bulkActions = ['delete', 'reverse', 'classify']

const dateLabel = (value) => value ? value.split('-').reverse().join('/') : ''

// `blockOf(row, allowedIds)` says why the account cannot take the action (null when it can). Accounts that depend on each
// other in the selection (a recurring account and the next one, a partial settlement and its account) are checked again
// until nothing changes, so a blocked account also blocks the one that needed it.
export function planBulk(rows, blockOf) {
  const allowed = new Set(rows.map((row) => row.id)), reasons = new Map()
  for (let changed = true; changed;) {
    changed = false
    for (const row of rows) {
      if (!allowed.has(row.id)) continue
      const reason = blockOf(row, allowed)
      if (reason) { allowed.delete(row.id); reasons.set(row.id, reason); changed = true }
    }
  }
  return { allowed: rows.filter((row) => allowed.has(row.id)), blocked: rows.filter((row) => !allowed.has(row.id)).map((row) => ({ row, reason: reasons.get(row.id) })) }
}

// The same accounts in the same state give the same token.
export const planToken = (plan, signature) => createHash('sha256').update(JSON.stringify([plan.allowed.map(signature), plan.blocked.map(({ row, reason }) => [row.id, reason])])).digest('hex').slice(0, 32)

// "Fornecedor: MINISTERIO DA FAZENDA (300), OUTRO (2)": the most frequent first, up to four names.
export function countsLine(label, values) {
  const counts = new Map()
  for (const value of values) counts.set(value || '—', (counts.get(value || '—') || 0) + 1)
  const sorted = [...counts].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]), 'pt-BR'))
  if (!sorted.length) return null
  return `${label}: ${sorted.slice(0, 4).map(([name, count]) => `${name} (${count})`).join(', ')}${sorted.length > 4 ? ` e mais ${sorted.length - 4}` : ''}`
}
export function dateRangeLine(label, dates) {
  const sorted = dates.filter(Boolean).sort()
  if (!sorted.length) return null
  return sorted[0] === sorted.at(-1) ? `${label} em ${dateLabel(sorted[0])}` : `${label} de ${dateLabel(sorted[0])} a ${dateLabel(sorted.at(-1))}`
}

export function bulkIds(body, fail) {
  if (!Array.isArray(body.ids) || !body.ids.length || new Set(body.ids).size !== body.ids.length) fail('Selecione contas válidas.')
  if (!bulkActions.includes(body.action)) fail('Ação inválida.')
  // The reason of Desfazer baixa is typed in the modal of the preview: it is required for the confirmation.
  if (body.action === 'reverse' && body.preview !== true && String(body.reason ?? '').trim().length < 10) fail('Informe um motivo com pelo menos 10 caracteres.')
  return body.ids
}

// What the modal shows. `name` and `amounts` come from the screen (supplier or client; value or gross, ISS and net).
export function previewOf(action, plan, { name, amounts, facts, signature }) {
  return {
    action,
    total: plan.allowed.length + plan.blocked.length,
    count: plan.allowed.length,
    ids: plan.allowed.map((row) => row.id),
    amounts: amounts(plan.allowed),
    facts: facts(plan.allowed).filter(Boolean),
    blocked: plan.blocked.map(({ row, reason }) => ({ id: row.id, name: name(row), valueCents: row.valueCents, reason })),
    token: planToken(plan, signature),
  }
}

// Nothing is written when the preview the user confirmed is not the current one.
export function assertSamePreview(body, preview, fail) {
  if (!preview.count) fail('Nenhuma das contas selecionadas pode receber esta ação.', 409)
  if (body.token === preview.token) return
  const error = new Error('As contas mudaram desde a prévia (outra pessoa pode ter alterado alguma). Nada foi gravado: confira a nova prévia.')
  error.status = 409
  error.extra = { code: 'BULK_CHANGED', preview }
  throw error
}
