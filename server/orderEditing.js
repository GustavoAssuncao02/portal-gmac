import { randomUUID } from 'node:crypto'
import { productionStages, stageLabel, readStageLayout, validStageLayout, serviceDetails } from './serviceStages.js'
import { cleanStageTimes } from './pieces.js'
import { realChangedFields } from './orderHistory.js'
import { activeSessions } from './operationSessions.js'
import { isClientDocument } from './clientDocument.js'

const fail = (status, message) => { const error = new Error(message); error.status = status; throw error }
const text = (value, limit = 160) => {
  if (typeof value !== 'string' || value.length > limit) fail(400, 'Confira os textos informados e seus limites de tamanho.')
  return value.trim()
}
const numeric = (value, label, { integer = false, min = 0, max = 1e12 } = {}) => {
  const result = Number(value)
  if (value === '' || value == null || !Number.isFinite(result) || result < min || result > max || integer && !Number.isInteger(result)) fail(400, `${label}: informe um valor válido.`)
  return result
}
const date = (value, label) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(400, `${label}: informe uma data válida.`)
  return value
}

export function operationVersion(state) {
  return { status: state.status, stages: state.stages, stageCounts: state.stageCounts, activeSessionIds: activeSessions(state).map((session) => session.id) }
}

export function editOrder(order, state, body) {
  if (body.expectedUpdatedAt !== (order.updatedAt || order.createdAt) || JSON.stringify(body.expectedOperation) !== JSON.stringify(operationVersion(state))) fail(409, 'A OS foi alterada enquanto você editava. Feche a edição e abra novamente para carregar os dados atuais.')
  if (state.status === 'completed' && body.confirmCompleted !== true) fail(409, 'Confirme a edição desta OS finalizada.')
  const source = body.order || {}
  const fields = Object.fromEntries([['company', 160], ['service', 160], ['description', 5000], ['labelNumber', 80]].map(([key, limit]) => [key, text(source[key], limit)]))
  // The label number is optional.
  if (['company', 'service', 'description'].some((key) => !fields[key])) fail(400, 'Preencha cliente, serviço e descrição.')
  fields.cnpj = text(source.cnpj, 18).replace(/\D/g, '')
  if (!isClientDocument(fields.cnpj)) fail(400, 'Informe o CNPJ (14 dígitos) ou o CPF (11 dígitos) do cliente.')
  // The same document keeps the way it was written.
  if (String(order.cnpj ?? '').replace(/\D/g, '') === fields.cnpj) fields.cnpj = order.cnpj
  fields.quantity = numeric(source.quantity, 'Quantidade da OS', { integer: true, min: 1, max: 1000000000 })
  fields.deadline = date(source.deadline, 'Prazo solicitado')
  if (typeof source.requestedAt !== 'string' || !Number.isFinite(Date.parse(source.requestedAt))) fail(400, 'Informe uma data de solicitação válida.')
  date(source.requestedAt.slice(0, 10), 'Data da solicitação')
  fields.requestedAt = new Date(source.requestedAt).toISOString()
  const resources = source.resources || {}
  if (!Array.isArray(resources.stages) || !resources.stages.length || resources.stages.length > 32 || new Set(resources.stages).size !== resources.stages.length) fail(400, 'Selecione de 1 a 32 etapas sem repetições.')
  const known = new Set(productionStages.map(([key]) => key))
  const existingNames = new Set(state.stages.map((stage) => stage.name))
  if (resources.stages.some((key) => typeof key !== 'string' || !known.has(key) && !existingNames.has(key))) fail(400, 'Etapa de serviço inválida.')
  if (!validStageLayout(resources.stageLayout)) fail(400, 'Ordem dos grupos ou subetapas inválida.')
  if (!['service', 'product'].includes(resources.kind) || typeof resources.strictProcess !== 'boolean' || resources.tempering != null && typeof resources.tempering !== 'boolean' || resources.manufacturedFrom != null && !['sample', 'drawing'].includes(resources.manufacturedFrom) || resources.urgency != null && !['normal', 'emergency'].includes(resources.urgency)) fail(400, 'Confira o tipo e as opções do processo.')
  const rows = (items, labor = false) => {
    if (!Array.isArray(items) || items.length > 200) fail(400, 'Lista de recursos inválida.')
    const ids = new Set()
    return items.map((item) => {
      const id = text(String(item.id || randomUUID()), 100)
      if (ids.has(id)) fail(400, 'Recursos duplicados.')
      ids.add(id)
      const previous = (labor ? order.resources?.laborEntries : order.resources?.materials)?.find((entry) => entry.id === id)
      if (labor) {
        const resource = text(item.resource)
        if (!resource || !['machine', 'person'].includes(item.type)) fail(400, 'Informe o recurso e o tipo da mão de obra.')
        return { ...previous, id, resource, type: item.type, machineId: item.type === 'machine' && previous?.resource === resource ? previous.machineId ?? null : null, laborServiceId: item.type === 'person' && previous?.resource === resource ? previous.laborServiceId ?? null : null, hours: numeric(item.hours, 'Horas previstas'), hourlyRate: numeric(item.hourlyRate, 'Valor por hora') }
      }
      const name = text(item.name)
      if (!name) fail(400, 'Informe o nome do material.')
      const detail = text(item.detail || '', 500)
      const unchangedMaterial = previous?.name === name && (previous.detail || '') === detail
      const quantity = numeric(item.quantity, 'Quantidade do material', { min: 0.001 })
      const stockAvailable = Number(previous?.stockAvailable || 0)
      return { ...(unchangedMaterial ? previous : {}), id: previous && !unchangedMaterial ? randomUUID() : id, name, detail, quantity, unitPrice: numeric(item.unitPrice, 'Valor por kg'), ...(unchangedMaterial && previous.stockAvailable != null ? { purchaseQuantity: Math.max(0, Number((quantity - stockAvailable).toFixed(3))), stockStatus: previous.inventoryId == null ? 'unknown' : stockAvailable <= 0 ? 'missing' : stockAvailable < quantity ? 'partial' : 'available' } : {}) }
    })
  }
  fields.resources = { ...order.resources, materials: rows(resources.materials), laborEntries: rows(resources.laborEntries, true), stages: [...resources.stages], stageLayout: readStageLayout(resources), kind: resources.kind, ...serviceDetails(resources), paintColor: text(resources.paintColor || ''), serviceDescription: text(resources.serviceDescription || '', 5000), stageTimes: cleanStageTimes(resources.stageTimes ?? order.resources?.stageTimes, resources.stages) }
  const proposal = source.proposal || {}
  if (!['A', 'B', 'C', 'D'].includes(proposal.key)) fail(400, 'Selecione uma opção de proposta válida.')
  fields.proposal = { ...order.proposal, key: proposal.key, title: text(proposal.title || '', 160), deadline: date(proposal.deadline, 'Prazo acordado'), machine: text(proposal.machine || ''), serviceTime: text(proposal.serviceTime || ''), stages: [...resources.stages], kind: resources.kind, strictProcess: resources.strictProcess }
  for (const [key, label] of [['serviceValue', 'Valor do serviço'], ['materials', 'Valor de materiais'], ['labor', 'Valor de mão de obra'], ['margin', 'Margem'], ['discount', 'Desconto']]) fields.proposal[key] = numeric(proposal[key], label, { max: ['margin', 'discount'].includes(key) ? 100 : 1e12 })
  // Proposals with an OS value keep the service value as the cost; the profit is what the customer pays beyond it.
  // Older ones kept the price in the service value.
  if (proposal.osValue != null) fields.proposal.osValue = numeric(proposal.osValue, 'Valor da OS', { max: 1e12 })
  if (proposal.totalTime != null) fields.proposal.totalTime = text(proposal.totalTime)
  fields.proposal.profit = fields.proposal.osValue != null ? Math.round((fields.proposal.osValue - fields.proposal.serviceValue) * 100) / 100 : fields.proposal.serviceValue - fields.proposal.materials - fields.proposal.labor
  // The profit is only recalculated when a value of the proposal changes; older proposals kept it computed another way.
  if (['serviceValue', 'materials', 'labor', 'margin', 'discount', 'osValue'].every((key) => Number(fields.proposal[key] ?? 0) === Number(order.proposal?.[key] ?? 0)) && order.proposal?.profit != null) fields.proposal.profit = order.proposal.profit
  const attachmentIds = source.attachmentIds
  if (!Array.isArray(attachmentIds) || new Set(attachmentIds).size !== attachmentIds.length || attachmentIds.some((id) => !order.attachments?.some((item) => item.id === id))) fail(400, 'Anexos inválidos.')
  fields.attachments = (order.attachments || []).filter((item) => attachmentIds.includes(item.id))
  const stages = resources.stages.map((code) => {
    const name = stageLabel(code)
    return state.stages.find((stage) => stage.name === name) || { key: `stage-${randomUUID()}`, name }
  })
  const counts = Object.fromEntries(stages.map((stage, index) => [stage.key, numeric(body.stageCounts?.[resources.stages[index]], `Peças de ${stage.name}`, { integer: true, max: fields.quantity })]))
  if (resources.strictProcess && stages.some((stage, index) => index > 0 && counts[stage.key] > counts[stages[index - 1].key])) fail(400, 'No processo sequencial, uma etapa não pode ter mais peças que a etapa anterior. Ajuste as quantidades ou desmarque Processo Injessado.')
  const productionChanged = fields.quantity !== Number(order.quantity) || resources.strictProcess !== serviceDetails(order.resources).strictProcess || JSON.stringify(stages) !== JSON.stringify(state.stages) || JSON.stringify(counts) !== JSON.stringify(state.stageCounts)
  if (activeSessions(state).length && productionChanged) fail(409, 'Encerre as sessões ativas antes de alterar etapas, processo ou quantidades produzidas.')
  const before = { ...Object.fromEntries(Object.keys(fields).map((key) => [key, structuredClone(order[key] ?? null)])), stages: structuredClone(state.stages), stageCounts: structuredClone(state.stageCounts) }
  // A new requested deadline must be justified; the last change stays on the OS and every change goes to the history.
  if (fields.deadline !== order.deadline) {
    const reason = text(body.deadlineReason || '', 1000)
    if (reason.length < 10) fail(400, 'Justifique a alteração do prazo solicitado (pelo menos 10 caracteres).')
    fields.deadlineChange = { from: order.deadline || null, to: fields.deadline, reason, by: body.actorName || 'Administrador', at: new Date().toISOString() }
  }
  Object.assign(order, fields, { updatedAt: new Date().toISOString() })
  state.stages = stages
  state.stageCounts = counts
  if (state.status !== 'completed') {
    const allDone = stages.every((stage) => counts[stage.key] === fields.quantity)
    state.status = activeSessions(state).length ? allDone ? 'finalizing' : 'running' : state.startedAt ? 'paused' : 'waiting'
  }
  const { deadlineChange: _deadlineChange, ...comparable } = fields
  const after = { ...comparable, stages: structuredClone(stages), stageCounts: structuredClone(counts) }
  const changed = realChangedFields({ before, after, changed: Object.keys(after) })
  return { before, after, changed }
}
