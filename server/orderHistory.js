import { randomUUID } from 'node:crypto'
import { stageLabel, serviceDetails } from './serviceStages.js'

// The same value written another way is not a change: CNPJ punctuation, blank fields, defaults of fields added later
// (proposal type, stage times) and the gross profit, which is derived from the proposal values.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    const clean = canonical(item)
    if (clean == null || clean === '' || typeof clean === 'object' && !Array.isArray(clean) && !Object.keys(clean).length) continue
    result[key] = clean
  }
  return result
}
const comparable = (key, value) => key === 'cnpj' ? String(value ?? '').replace(/\D/g, '') : key === 'resources' ? canonical({ ...value, ...serviceDetails(value || {}) }) : key === 'proposal' ? canonical({ ...value, profit: undefined }) : canonical(value)
export const sameOrderField = (key, left, right) => JSON.stringify(comparable(key, left)) === JSON.stringify(comparable(key, right))
export const realChangedFields = (changes) => (changes?.changed || []).filter((key) => !sameOrderField(key, changes.before?.[key], changes.after?.[key]))

// Everything done with an OS, in one list: production (operation events), administrative actions recorded on the
// order itself, and the accounts payable/receivable linked to it. Only administrators receive the last two groups.

const fieldLabels = { company: 'Cliente', cnpj: 'CNPJ/CPF', service: 'Serviço', description: 'Descrição', labelNumber: 'Etiqueta', quantity: 'Quantidade da OS', deadline: 'Prazo solicitado', requestedAt: 'Data da solicitação', resources: 'Materiais e processo', proposal: 'Proposta', attachments: 'Anexos', stages: 'Etapas', stageCounts: 'Peças por etapa' }
const resourceLabels = { kind: 'Tipo', manufacturedFrom: 'Fabricado a partir de', tempering: 'Têmpera', urgency: 'Tipo de proposta', paintColor: 'Cor/Tipo', serviceDescription: 'Descrição do serviço', strictProcess: 'Processo Injessado' }
const valueLabels = { service: 'Serviço', product: 'Produto', sample: 'Amostra', drawing: 'Desenho', normal: 'Normal', emergency: 'Emergencial' }
const proposalLabels = { value: 'Valor', deadline: 'Prazo de entrega', margin: 'Margem (%)', discount: 'Desconto (%)', materials: 'Custo de materiais', labor: 'Custo de mão de obra', machine: 'Tempo de máquina', serviceTime: 'Tempo de serviço' }

const shown = (value) => {
  if (value == null || value === '') return 'vazio'
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value).split('-').reverse().join('/')
  return valueLabels[value] || String(value)
}
const names = (rows, pick) => (rows || []).map(pick)
export const minutesText = (minutes) => minutes ? `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h` : ''}${minutes % 60 ? ` ${minutes % 60}min` : ''}`.trim() : 'sem tempo'
function listChange(label, before, after) {
  const added = after.filter((item) => !before.includes(item)), removed = before.filter((item) => !after.includes(item))
  return [...(added.length ? [`${label} incluído(s): ${added.join(', ')}`] : []), ...(removed.length ? [`${label} removido(s): ${removed.join(', ')}`] : [])]
}

// Turns the before/after snapshot of an OS edition into readable lines: "Campo: antes → depois".
export function describeOrderChanges(changes) {
  if (!changes?.changed) return []
  const { before = {}, after = {} } = changes
  return realChangedFields(changes).flatMap((key) => {
    const left = key === 'resources' ? { ...before[key], ...serviceDetails(before[key] || {}) } : before[key], right = key === 'resources' ? { ...after[key], ...serviceDetails(after[key] || {}) } : after[key]
    if (key === 'attachments') return listChange('Anexo', names(left, (row) => row.name), names(right, (row) => row.name))
    if (key === 'stages') return [`Etapas: ${(left || []).map(stageLabel).join(' > ') || 'nenhuma'} → ${(right || []).map(stageLabel).join(' > ') || 'nenhuma'}`]
    if (key === 'stageCounts') return Object.keys({ ...left, ...right }).filter((stage) => Number(left?.[stage] || 0) !== Number(right?.[stage] || 0)).map((stage) => `Peças em ${stageLabel(stage)}: ${Number(left?.[stage] || 0)} → ${Number(right?.[stage] || 0)}`)
    if (key === 'resources') {
      const material = (row) => `${row.name}${row.detail ? ` (${row.detail})` : ''} ${row.quantity ?? ''} kg`.trim()
      const labor = (row) => `${row.resource || row.type} ${row.hours ?? ''} h`.trim()
      return [...listChange('Material', names(left?.materials, material), names(right?.materials, material)), ...listChange('Mão de obra', names(left?.laborEntries, labor), names(right?.laborEntries, labor)),
        ...Object.keys(resourceLabels).filter((field) => JSON.stringify(left?.[field] ?? null) !== JSON.stringify(right?.[field] ?? null)).map((field) => `${resourceLabels[field]}: ${shown(left?.[field])} → ${shown(right?.[field])}`),
        ...Object.keys({ ...left?.stageTimes, ...right?.stageTimes }).filter((code) => (left?.stageTimes?.[code] ?? null) !== (right?.stageTimes?.[code] ?? null)).map((code) => `Tempo previsto de ${stageLabel(code)}: ${minutesText(left?.stageTimes?.[code])} → ${minutesText(right?.stageTimes?.[code])}`)]
    }
    if (key === 'proposal') return Object.keys(proposalLabels).filter((field) => JSON.stringify(left?.[field] ?? null) !== JSON.stringify(right?.[field] ?? null)).map((field) => `${proposalLabels[field]}: ${shown(left?.[field])} → ${shown(right?.[field])}`)
    return [`${fieldLabels[key] || key}: ${shown(left)} → ${shown(right)}`]
  })
}

export function recordOrderEvent(order, type, actorName, details) {
  order.auditEvents ||= []
  order.auditEvents.push({ id: randomUUID(), type, at: new Date().toISOString(), employeeName: actorName || 'Administrador', details })
}

const financeLabels = { created: 'criada', edited: 'editada', paid: 'baixada (paga)', received: 'baixada (recebida)', reversed: 'baixa estornada', deleted: 'excluída', deactivated: 'desativada', reactivated: 'reativada', attachment_added: 'anexo adicionado', attachment_removed: 'anexo removido' }
const money = (cents) => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function orderHistory(store, order, operationEvents, admin) {
  const operation = operationEvents.map((event) => {
    if (!admin) { const { changes, ...publicEvent } = event; return publicEvent }
    if (event.type !== 'order_edited' || !event.changes) return event
    // The summary is rebuilt from the real differences, so editions saved before this check also read correctly.
    const justification = String(event.details || '').match(/Justificativa do novo prazo: .*/)?.[0]
    const fields = realChangedFields(event.changes).map((key) => fieldLabels[key] || key)
    return { ...event, lines: describeOrderChanges(event.changes), details: `Campos atualizados: ${fields.join(', ') || 'nenhuma alteração'}.${justification ? ` ${justification}` : ''}` }
  })
  if (!admin) return operation
  const audit = [...(order.auditEvents || [])]
  if (!audit.some((event) => event.type === 'order_created') && order.createdAt) audit.push({ id: `${order.code}:created`, type: 'order_created', at: order.createdAt, employeeName: 'Sistema', details: 'OS gerada a partir da proposta aceita.' })
  const finance = (kind, rows, events) => {
    const ids = new Set(rows.filter((row) => row.orderCode === order.code).map((row) => row.id))
    return (events || []).filter((event) => ids.has(event.accountId)).map((event) => ({ id: `${kind}:${event.id}`, type: kind, at: event.at, employeeName: event.userName, details: `${event.accountId} ${financeLabels[event.type] || event.type}${event.details?.finalCents != null ? ` · ${money(event.details.finalCents)}` : event.details?.valueCents != null ? ` · ${money(event.details.valueCents)}` : ''}${event.reason ? ` · Motivo: ${event.reason}` : ''}` }))
  }
  return [...operation, ...audit, ...finance('payable_event', store.payables || [], store.payableEvents), ...finance('receivable_event', store.receivables || [], store.receivableEvents)]
}
