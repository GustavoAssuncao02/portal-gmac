import express from 'express'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readStore, mutateStore } from './offers.js'
import { exportPdf, exportWorkbook } from './reports.js'
import { cents, validDate, todayBahia, payableStatus, daysUntil, makeInstallments, shiftMonth, filterPayables } from './payableRules.js'
import { notificationSettings } from './accounts.js'

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'payable-files')
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const clean = (value, limit = 1000) => String(value ?? '').trim().slice(0, limit)
const money = (value) => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const statusLabel = { pending: 'Pendente', overdue: 'Vencido', paid: 'Pago' }
const actionLabel = { created: 'Conta criada', edited: 'Conta editada', paid: 'Pagamento baixado', reversed: 'Baixa estornada', deleted: 'Conta excluída', deactivated: 'Conta desativada', reactivated: 'Conta reativada', attachment_added: 'Anexo adicionado', attachment_removed: 'Anexo removido', status_changed: 'Status alterado' }
const paymentLabel = { pix: 'Pix', boleto: 'Boleto', card: 'Cartão' }
const detailLabel = { before: 'Antes', after: 'Depois', valueCents: 'Valor', finalCents: 'Valor pago', interestCents: 'Juros', discountCents: 'Desconto', dueDate: 'Vencimento', date: 'Data', method: 'Forma de pagamento', note: 'Observação', text: 'Descrição', name: 'Nome', supplierName: 'Fornecedor', classificationName: 'Classificação', description: 'Descrição', documentNumber: 'Documento', issueDate: 'Emissão', previousId: 'Origem recorrente', payment: 'Pagamento', bulk: 'Baixa em massa', receipt: 'Comprovante', changes: 'Alterações' }
function readableDetails(value, key = '') {
  if (value == null) return 'Não informado'
  if (Array.isArray(value)) return value.map((item) => readableDetails(item)).join('\n')
  if (typeof value === 'object') return Object.entries(value).map(([field, item]) => `${detailLabel[field] || field}: ${readableDetails(item, field)}`).join('\n')
  if (/Cents$/.test(key)) return money(Number(value))
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value).split('-').reverse().join('/')
  return Object.hasOwn(statusLabel, value) ? statusLabel[value] : Object.hasOwn(paymentLabel, value) ? paymentLabel[value] : String(value)
}
const init = (store) => { store.payables ||= []; store.payableEvents ||= []; store.classifications ||= []; store.payableNotifications ||= [] }
function event(store, actor, type, accountId, details = {}) {
  store.payableEvents.push({ id: randomUUID(), at: new Date().toISOString(), type, accountId, userId: actor?.id ?? null, userName: actor?.name || 'Sistema', ...details })
}
function find(store, id) { const row = store.payables.find((item) => item.id === id); if (!row) fail('Conta não encontrada.', 404); return row }
function editable(row) { if (row.payment || row.inactive) fail('Estorne a baixa antes de editar esta conta.', 409) }
function claimFiles(store, ids, actor) {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) fail('Anexos inválidos.')
  const files = ids.map((id) => { const file = (store.payableUploads || []).find((f) => f.id === id && String(f.userId) === String(actor.id)); if (!file) fail('Anexo inválido ou já utilizado.'); const { userId, ...safe } = file; return safe })
  store.payableUploads = (store.payableUploads || []).filter((f) => !ids.includes(f.id))
  return files
}
function duplicates(store, proposed, ignored = []) {
  const seen = new Set()
  for (const row of [...store.payables.filter((item) => !ignored.includes(item.id)), ...proposed]) {
    const key = JSON.stringify([String(row.supplierId), row.valueCents, row.dueDate])
    if (seen.has(key)) fail('Conta duplicada: fornecedor, valor e vencimento já cadastrados.', 409)
    seen.add(key)
  }
}
function fields(store, body, current) {
  const supplier = (store.suppliers || []).find((item) => String(item.id) === String(body.supplierId))
  if (!supplier) fail('Selecione um fornecedor cadastrado.')
  const classification = store.classifications.find((item) => item.id === body.classificationId)
  if (!classification || classification.inactive && classification.id !== current?.classificationId) fail('Selecione uma classificação ativa.')
  if (!validDate(body.issueDate) || !validDate(body.dueDate)) fail('Informe emissão e vencimento válidos.')
  if (!['normal', 'installment', 'recurring'].includes(body.kind)) fail('Tipo de conta inválido.')
  if (body.kind === 'recurring' && !['monthly', 'yearly'].includes(body.recurrence)) fail('Selecione recorrência mensal ou anual.')
  let valueCents
  try { valueCents = cents(body.value) } catch (error) { fail(error.message) }
  if (!valueCents) fail('O valor deve ser maior que zero.')
  return { supplierId: supplier.id, supplierName: supplier.name, classificationId: classification.id, classificationName: classification.name, description: clean(body.description, 5000), documentNumber: clean(body.documentNumber, 160), issueDate: body.issueDate, dueDate: body.dueDate, valueCents, kind: body.kind, recurrence: body.kind === 'recurring' ? body.recurrence : null }
}
function installments(body, valueCents, dueDate) {
  const count = Number(body.count ?? 1)
  if (body.installments !== undefined && !Array.isArray(body.installments)) fail('Parcelas inválidas.')
  let rows
  try { rows = body.installments === undefined ? makeInstallments(valueCents, dueDate, count) : body.installments.map((row) => ({ valueCents: cents(row.value), dueDate: row.dueDate })) } catch (error) { fail(error.message) }
  if (!Number.isInteger(count) || count < 1 || count > 120 || rows.length !== count || rows.some((row) => !validDate(row.dueDate) || row.valueCents <= 0) || rows.reduce((sum, row) => sum + row.valueCents, 0) !== valueCents) fail('A soma das parcelas deve ser exatamente igual ao valor total, com datas e valores válidos.')
  return rows
}
function payment(body, valueCents, bulk = false) {
  if (!validDate(body.date) || body.date > todayBahia()) fail('Data de pagamento inválida ou futura.')
  if (!['pix', 'boleto', 'card'].includes(body.method)) fail('Selecione Pix, Boleto ou Cartão.')
  let interestCents = 0, discountCents = 0
  try { interestCents = cents(body.interest || '0'); discountCents = cents(body.discount || '0') } catch (error) { fail(error.message) }
  if (interestCents && discountCents || bulk && (interestCents || discountCents || body.receipts?.length || body.fileIds?.length)) fail('Juros e desconto são exclusivos; baixa em massa não aceita ajustes nem comprovante compartilhado.')
  const finalCents = valueCents + interestCents - discountCents
  if (finalCents < 0) fail('O desconto não pode ultrapassar o valor da conta.')
  return { date: body.date, method: body.method, interestCents, discountCents, finalCents, note: clean(body.note, 5000), receipts: [] }
}
function view(row, store) {
  return { ...row, supplierName: (store.suppliers || []).find((item) => String(item.id) === String(row.supplierId))?.name || row.supplierName, classificationName: store.classifications.find((item) => item.id === row.classificationId)?.name || row.classificationName, status: payableStatus(row), daysUntil: daysUntil(row.dueDate) }
}
export function activeNotifications(store, userId) {
  const { payableReminderDays } = notificationSettings(store, userId)
  if (payableReminderDays === 'never') return []
  return (store.payableNotifications || []).filter((notice) => {
    const row = (store.payables || []).find((item) => item.id === notice.accountId)
    return row && !row.payment && !row.inactive && notice.dueDate === row.dueDate && [0, payableReminderDays].includes(notice.days)
  })
}
export function notificationItems(store, userId) {
  return activeNotifications(store, userId).map(({ readBy, ...notice }) => ({ ...notice, readAt: readBy?.find((entry) => String(entry.userId) === String(userId))?.at || null, account: view(find(store, notice.accountId), store) })).reverse()
}
function report(rows, store, individual = false, filters = {}) {
  const columns = ['ID', 'Fornecedor', 'Descrição', 'Classificação', 'Documento', 'Emissão', 'Valor (R$)', 'Vencimento', 'Status', 'Parcela', 'Pagamento', 'Forma', 'Juros (R$)', 'Desconto (R$)', 'Pago (R$)', 'Observação da baixa', 'Compra original (R$)', 'Origem recorrente']
  const sections = [{ name: 'Contas a pagar', columns, rows: rows.map((raw) => { const r = view(raw, store), p = r.payment; return [r.id, r.supplierName, `${r.description}${r.inactive ? ' (D)' : ''}`, r.classificationName, r.documentNumber, r.issueDate, r.valueCents / 100, r.dueDate, `${statusLabel[r.status]}${r.inactive ? ' (D)' : ''}`, r.groupId ? `${r.installmentNumber} de ${r.installmentCount}` : '', p?.date, paymentLabel[p?.method] || p?.method, (p?.interestCents || 0) / 100, (p?.discountCents || 0) / 100, p ? p.finalCents / 100 : '', p?.note, (r.originalTotalCents || r.valueCents) / 100, r.previousId] }) }]
  if (individual) {
    const ids = rows.map((row) => row.id)
    sections.push({ name: 'Histórico', columns: ['Conta', 'Data/hora (Bahia)', 'Usuário', 'Ação', 'Detalhes'], rows: store.payableEvents.filter((e) => ids.includes(e.accountId)).map((e) => [e.accountId, new Date(e.at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }), e.userName, actionLabel[e.type] || e.type, [e.reason, readableDetails(e.changes || e.details || '')].filter(Boolean).join('\n')]) })
    sections.push({ name: 'Anexos e comprovantes', columns: ['Conta', 'Arquivo', 'Tipo', 'Tamanho (bytes)'], rows: rows.flatMap((r) => [...(r.attachments || []), ...(r.payment?.receipts || [])].map((f) => [r.id, f.name, f.contentType, f.size])) })
  }
  const notes = individual ? [] : [`Situação: ${{ all: 'Todas', inactive: 'Desativadas', ...statusLabel }[filters.status] || 'Pendentes e vencidas'}`, ...(filters.search ? [`Busca: ${filters.search}`] : []), ...(filters.supplierId ? [`Fornecedor: ${store.suppliers?.find((row) => row.id === filters.supplierId)?.name || filters.supplierId}`] : []), ...(filters.classificationId ? [`Classificação: ${store.classifications.find((row) => row.id === filters.classificationId)?.name || filters.classificationId}`] : [])]
  return { title: individual ? `Conta ${rows[0]?.id || ''}` : 'Contas a pagar', eyebrow: 'Financeiro', generatedAt: new Date().toISOString(), start: filters.start, end: filters.end, summary: [['Contas', rows.length], ['Valor original', money(rows.reduce((sum, r) => sum + r.valueCents, 0))]], notes, sections }
}

export default function createPayablesRouter(accounts, requireAdmin) {
  const router = express.Router()
  router.use(['/payables', '/classifications', '/suppliers'], requireAdmin)
  router.use(['/payables', '/classifications', '/suppliers'], async (request, _response, next) => { try { request.actor = (await accounts.admins()).find((item) => String(item.id) === String(request.adminId)); if (!request.actor) fail('Administrador não encontrado.', 401); next() } catch (error) { next(error) } })
  const handle = (fn) => async (req, res, next) => { try { await fn(req, res) } catch (error) { next(error) } }
  async function sweep(userId) {
    const today = todayBahia()
    const snapshot = await readStore(); init(snapshot)
    const reminderDay = (store, row) => {
      const { payableReminderDays } = notificationSettings(store, userId)
      const days = daysUntil(row.dueDate, today)
      return payableReminderDays !== 'never' && days >= 0 && days <= payableReminderDays ? days === 0 ? 0 : payableReminderDays : null
    }
    const needsWrite = snapshot.payables.some((row) => {
      const days = reminderDay(snapshot, row)
      return row.lastStatus !== payableStatus(row, today) || !row.payment && !row.inactive && days !== null && !snapshot.payableNotifications.some((n) => n.id === `${row.id}:${row.dueDate}:${days}`)
    })
    if (!needsWrite) return snapshot
    return mutateStore((store) => {
      init(store)
      for (const row of store.payables) {
        const status = payableStatus(row, today)
        if (row.lastStatus !== status) { event(store, null, 'status_changed', row.id, { details: { before: row.lastStatus || 'pending', after: status } }); row.lastStatus = status }
        const days = reminderDay(store, row)
        if (!row.payment && !row.inactive && days !== null) {
          const id = `${row.id}:${row.dueDate}:${days}`
          if (!store.payableNotifications.some((n) => n.id === id)) store.payableNotifications.push({ id, accountId: row.id, dueDate: row.dueDate, days, at: new Date().toISOString() })
        }
      }
      return store
    })
  }
  router.get('/payables', handle(async (_req, res) => { const store = await sweep(); res.json({ items: store.payables.map((r) => view(r, store)), classifications: store.classifications, suppliers: store.suppliers || [] }) }))
  router.get('/payables/history', handle(async (_req, res) => { const store = await sweep(); res.json({ items: [...store.payableEvents].reverse() }) }))
  router.get('/payables/notifications', handle(async (req, res) => { const store = await sweep(req.actor.id); res.set('Cache-Control', 'no-store').json({ items: notificationItems(store, req.actor.id) }) }))
  router.post('/payables/notifications/read-all', handle(async (req, res) => {
    let store = await sweep(req.actor.id)
    if (notificationItems(store, req.actor.id).some((notice) => !notice.readAt)) {
      store = await mutateStore((current) => {
        init(current)
        const at = new Date().toISOString()
        for (const notice of activeNotifications(current, req.actor.id)) {
          notice.readBy ||= []
          if (!notice.readBy.some((entry) => String(entry.userId) === String(req.actor.id))) notice.readBy.push({ userId: req.actor.id, at })
        }
        return current
      })
    }
    res.json({ items: notificationItems(store, req.actor.id) })
  }))
  router.get('/payables/:id', handle(async (req, res) => { const store = await sweep(), row = find(store, req.params.id); const siblings = row.groupId ? store.payables.filter((r) => r.groupId === row.groupId) : []; res.json({ item: view(row, store), siblings: siblings.map((r) => view(r, store)), structureLocked: siblings.some((r) => r.payment), canDelete: !row.payment && !row.groupId && !store.payableEvents.some((e) => e.accountId === row.id && ['paid', 'reversed'].includes(e.type)) && !store.payables.some((r) => r.previousId === row.id), history: store.payableEvents.filter((e) => e.accountId === row.id).reverse() }) }))
  router.post('/payables', handle(async (req, res) => {
    const result = await mutateStore((store) => {
      init(store)
      const common = fields(store, req.body)
      const parts = common.kind === 'installment' ? installments(req.body, common.valueCents, common.dueDate) : [{ valueCents: common.valueCents, dueDate: common.dueDate }]
      if (common.kind !== 'installment' && (Number(req.body.count || 1) !== 1 || req.body.installments?.length > 1)) fail('Recorrência e parcelamento não podem ser combinados.')
      const previous = req.body.previousId ? find(store, req.body.previousId) : null
      if (previous && (!previous.payment || previous.kind !== 'recurring' || common.kind !== 'recurring')) fail('Origem recorrente inválida.')
      const groupId = common.kind === 'installment' ? randomUUID() : null
      const proposed = parts.map((part, index) => ({ ...common, ...part, groupId, installmentNumber: index + 1, installmentCount: parts.length, originalTotalCents: common.valueCents, previousId: previous?.id || null, inactive: false, payment: null, attachments: [], createdAt: new Date().toISOString() }))
      duplicates(store, proposed)
      const attachments = claimFiles(store, req.body.fileIds || [], req.actor)
      for (const row of proposed) {
        row.attachments = [...attachments]
        store.payableSequence = (store.payableSequence || 0) + 1; row.id = `PAG-${String(store.payableSequence).padStart(6, '0')}`; row.lastStatus = payableStatus(row); store.payables.push(row)
        event(store, req.actor, 'created', row.id, { details: { valueCents: row.valueCents, dueDate: row.dueDate, previousId: row.previousId, text: previous ? `Criada a partir de ${previous.id}` : '' } })
        for (const file of attachments) event(store, req.actor, 'attachment_added', row.id, { details: { name: file.name } })
      }
      return proposed
    }); res.status(201).json({ items: result })
  }))
  router.put('/payables/:id', handle(async (req, res) => {
    const result = await mutateStore((store) => {
      init(store); const row = find(store, req.params.id); editable(row)
      const common = fields(store, req.body, row)
      const attachments = claimFiles(store, req.body.fileIds || [], req.actor)
      const addAttachments = (target) => { target.attachments.push(...attachments); for (const file of attachments) event(store, req.actor, 'attachment_added', target.id, { details: { name: file.name } }) }
      if (row.kind === 'installment') {
        const siblings = store.payables.filter((r) => r.groupId === row.groupId).sort((a, b) => a.installmentNumber - b.installmentNumber)
        if (common.kind !== 'installment' || common.valueCents !== row.originalTotalCents) fail('Preserve o parcelamento e o valor total original.')
        const parts = installments(req.body, row.originalTotalCents, common.dueDate)
        if (siblings.some((r) => r.payment)) {
          if (parts.length !== siblings.length || parts.some((p, i) => p.valueCents !== siblings[i].valueCents || p.dueDate !== siblings[i].dueDate) || common.dueDate !== row.dueDate) fail('Existe parcela paga. A estrutura do parcelamento está bloqueada.', 409)
          const before = { ...row }; Object.assign(row, common, { valueCents: row.valueCents, originalTotalCents: row.originalTotalCents }); event(store, req.actor, 'edited', row.id, { changes: { before, after: { ...row } } }); addAttachments(row); return [row]
        }
        const proposed = parts.map((part, index) => ({ ...(siblings[index] || row), ...common, ...part, originalTotalCents: row.originalTotalCents, installmentNumber: index + 1, installmentCount: parts.length, attachments: siblings[index]?.attachments || [], id: siblings[index]?.id }))
        duplicates(store, proposed, siblings.map((r) => r.id))
        if (siblings.slice(parts.length).some((r) => r.attachments.length || store.payables.some((p) => p.previousId === r.id) || store.payableEvents.some((e) => e.accountId === r.id && ['paid', 'reversed'].includes(e.type)))) fail('Não é possível remover parcelas com anexos, pagamentos anteriores ou vínculos.', 409)
        store.payables = store.payables.filter((r) => r.groupId !== row.groupId)
        for (const [index, updated] of proposed.entries()) {
          if (!updated.id) { store.payableSequence++; updated.id = `PAG-${String(store.payableSequence).padStart(6, '0')}` }
          const before = siblings[index] || null; updated.lastStatus = payableStatus(updated); store.payables.push(updated); event(store, req.actor, 'edited', updated.id, { changes: { before, after: updated } })
        }
        for (const removed of siblings.slice(parts.length)) event(store, req.actor, 'deleted', removed.id, { details: { installmentRestructure: true } })
        addAttachments(proposed.find((r) => r.id === row.id) || proposed[0])
        return proposed
      }
      if (common.kind === 'installment') {
        const parts = installments(req.body, common.valueCents, common.dueDate), groupId = randomUUID(), before = { ...row }
        const proposed = parts.map((part, index) => ({ ...row, ...common, ...part, id: index === 0 ? row.id : undefined, groupId, installmentNumber: index + 1, installmentCount: parts.length, originalTotalCents: common.valueCents, previousId: index === 0 ? row.previousId : null, attachments: index === 0 ? [...row.attachments] : [], createdAt: index === 0 ? row.createdAt : new Date().toISOString() }))
        duplicates(store, proposed, [row.id])
        store.payables = store.payables.filter((r) => r.id !== row.id)
        for (const [index, updated] of proposed.entries()) {
          if (!updated.id) { store.payableSequence++; updated.id = `PAG-${String(store.payableSequence).padStart(6, '0')}` }
          updated.lastStatus = payableStatus(updated); store.payables.push(updated)
          event(store, req.actor, index === 0 ? 'edited' : 'created', updated.id, index === 0 ? { changes: { before, after: { ...updated } } } : { details: { valueCents: updated.valueCents, dueDate: updated.dueDate, groupId } })
        }
        addAttachments(proposed[0]); return proposed
      }
      duplicates(store, [{ ...row, ...common }], [row.id])
      const before = { ...row }; Object.assign(row, common, { originalTotalCents: common.valueCents, lastStatus: payableStatus({ ...row, ...common }) }); event(store, req.actor, 'edited', row.id, { changes: { before, after: { ...row } } }); addAttachments(row); return [row]
    }); res.json({ items: result })
  }))
  router.post('/payables/bulk', handle(async (req, res) => {
    const result = await mutateStore((store) => {
      init(store)
      if (!Array.isArray(req.body.ids) || !req.body.ids.length || new Set(req.body.ids).size !== req.body.ids.length) fail('Selecione contas válidas.')
      const rows = req.body.ids.map((id) => find(store, id))
      if (!['pay', 'deactivate'].includes(req.body.action)) fail('Ação inválida.')
      if (req.body.action === 'pay') {
        for (const row of rows) editable(row)
        const data = rows.map((row) => payment(req.body, row.valueCents, true))
        rows.forEach((row, i) => { row.payment = data[i]; row.lastStatus = 'paid'; event(store, req.actor, 'paid', row.id, { details: { ...data[i], bulk: true } }) })
      } else {
        if (rows.some((row) => !row.payment || row.inactive)) fail('Somente contas pagas e ativas podem ser desativadas.')
        for (const row of rows) { row.inactive = true; event(store, req.actor, 'deactivated', row.id) }
      }
      return rows
    }); res.json({ items: result })
  }))
  router.post('/payables/:id/pay', handle(async (req, res) => { const item = await mutateStore((store) => { init(store); const row = find(store, req.params.id); editable(row); const data = payment(req.body, row.valueCents); data.receipts = claimFiles(store, req.body.fileIds || [], req.actor); row.payment = data; row.lastStatus = 'paid'; event(store, req.actor, 'paid', row.id, { details: row.payment }); for (const file of data.receipts) event(store, req.actor, 'attachment_added', row.id, { details: { name: file.name, receipt: true } }); return row }); res.json({ item }) }))
  router.post('/payables/:id/reverse', handle(async (req, res) => { const item = await mutateStore((store) => { init(store); const row = find(store, req.params.id); if (!row.payment || row.inactive) fail('Reative a conta antes de estornar.', 409); const reason = clean(req.body.reason); if (reason.length < 10) fail('Informe um motivo com pelo menos 10 caracteres.'); event(store, req.actor, 'reversed', row.id, { reason, details: { payment: row.payment } }); row.payment = null; row.lastStatus = payableStatus(row); return row }); res.json({ item }) }))
  router.post('/payables/:id/activation', handle(async (req, res) => { const item = await mutateStore((store) => { init(store); const row = find(store, req.params.id); if (!row.payment || typeof req.body.inactive !== 'boolean') fail('Somente contas pagas podem ser desativadas ou reativadas.'); if (row.inactive !== req.body.inactive) { row.inactive = req.body.inactive; event(store, req.actor, row.inactive ? 'deactivated' : 'reactivated', row.id) } return row }); res.json({ item }) }))
  router.delete('/payables/:id', handle(async (req, res) => { await mutateStore((store) => { init(store); const row = find(store, req.params.id); if (row.payment || store.payableEvents.some((e) => e.accountId === row.id && ['paid', 'reversed'].includes(e.type)) || row.groupId || store.payables.some((r) => r.previousId === row.id)) fail('Conta com pagamento, parcelamento ou vínculo: preserve o histórico; desative quando paga.', 409); event(store, req.actor, 'deleted', row.id, { details: { account: row } }); store.payables = store.payables.filter((r) => r.id !== row.id) }); res.json({ ok: true }) }))
  router.post('/payables/uploads', express.raw({ type: 'application/octet-stream', limit: '20mb' }), handle(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) fail('Selecione um arquivo, com até 20 MB.')
    const file = { id: randomUUID(), name: path.basename(clean(req.query.name, 200)), contentType: clean(req.query.type, 160) || 'application/octet-stream', size: req.body.length, userId: req.actor.id }
    if (!file.name) fail('Nome de arquivo inválido.')
    await mutateStore(async (store) => { store.payableUploads ||= []; await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, file.id), req.body); store.payableUploads.push(file) }); res.status(201).json({ item: { id: file.id } })
  }))
  router.post('/payables/:id/files', express.raw({ type: 'application/octet-stream', limit: '20mb' }), handle(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) fail('Selecione um arquivo, com até 20 MB.')
    const file = { id: randomUUID(), name: path.basename(clean(req.query.name, 200)), contentType: clean(req.query.type, 160) || 'application/octet-stream', size: req.body.length }
    if (!file.name) fail('Nome de arquivo inválido.')
    await mutateStore(async (store) => { init(store); const row = find(store, req.params.id); editable(row); await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, file.id), req.body); row.attachments.push(file); event(store, req.actor, 'attachment_added', row.id, { details: { name: file.name } }) }); res.status(201).json({ item: file })
  }))
  router.get('/payables/:id/files/:fileId', handle(async (req, res) => { const store = await readStore(); init(store); const row = find(store, req.params.id); const file = [...row.attachments, ...(row.payment?.receipts || [])].find((f) => f.id === req.params.fileId); if (!file) fail('Arquivo não encontrado.', 404); res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`); res.send(await readFile(path.join(directory, file.id))) }))
  router.delete('/payables/:id/files/:fileId', handle(async (req, res) => { await mutateStore((store) => { init(store); const row = find(store, req.params.id); editable(row); const file = row.attachments.find((f) => f.id === req.params.fileId); if (!file) fail('Arquivo não encontrado.', 404); row.attachments = row.attachments.filter((f) => f.id !== file.id); event(store, req.actor, 'attachment_removed', row.id, { details: { name: file.name } }) }); res.json({ ok: true }) }))
  router.post('/payables/export', handle(async (req, res) => { const store = await sweep(); if (req.body.ids !== undefined && !Array.isArray(req.body.ids)) fail('Seleção inválida.'); const rows = req.body.id ? [find(store, req.body.id)] : filterPayables(store.payables.map((r) => view(r, store)), req.body.filters).filter((r) => !req.body.ids || req.body.ids.includes(r.id)); if (!['pdf', 'xlsx'].includes(req.body.format)) fail('Formato inválido.'); const data = report(rows, store, Boolean(req.body.id), req.body.filters); const output = req.body.format === 'pdf' ? await exportPdf(data) : await exportWorkbook(data); res.setHeader('Content-Type', req.body.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="gmac-contas-a-pagar.${req.body.format}"`); res.send(Buffer.from(output)) }))
  router.get('/suppliers', handle(async (_req, res) => { res.json({ items: (await readStore()).suppliers || [] }) }))
  for (const method of ['post', 'put']) router[method](method === 'post' ? '/suppliers' : '/suppliers/:id', handle(async (req, res) => { const item = await mutateStore((store) => {
    init(store); store.suppliers ||= []
    const fields = { name: clean(req.body.name, 120), document: String(req.body.document || '').replace(/\D/g, ''), email: clean(req.body.email, 160), phone: clean(req.body.phone, 30) }
    if (!fields.name || ![11, 14].includes(fields.document.length)) fail('Informe nome e CPF/CNPJ com 11 ou 14 dígitos.')
    if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) fail('E-mail inválido.')
    if (store.suppliers.some((s) => s.id !== req.params.id && s.document === fields.document)) fail('Fornecedor já cadastrado.', 409)
    let row = store.suppliers.find((s) => s.id === req.params.id); if (method === 'put' && !row) fail('Fornecedor não encontrado.', 404)
    const before = row ? { ...row } : null
    if (!row) { row = { id: randomUUID(), createdAt: new Date().toISOString() }; store.suppliers.push(row) }
    Object.assign(row, fields); event(store, req.actor, before ? 'supplier_edited' : 'supplier_created', null, { details: { before, after: row } }); return row
  }); res.json({ item }) }))
  router.delete('/suppliers/:id', handle(async (req, res) => { await mutateStore((store) => { init(store); const row = (store.suppliers || []).find((s) => s.id === req.params.id); if (!row) fail('Fornecedor não encontrado.', 404); if (store.payables.some((r) => String(r.supplierId) === row.id)) fail('Existem contas vinculadas a este fornecedor.', 409); store.suppliers = store.suppliers.filter((s) => s.id !== row.id); event(store, req.actor, 'supplier_deleted', null, { details: row }) }); res.json({ ok: true }) }))
  router.get('/classifications', handle(async (_req, res) => { const store = await sweep(); res.json({ items: store.classifications.map((c) => ({ ...c, count: store.payables.filter((r) => r.classificationId === c.id).length })) }) }))
  for (const method of ['post', 'put']) router[method](method === 'post' ? '/classifications' : '/classifications/:id', handle(async (req, res) => { const item = await mutateStore((store) => { init(store); const name = clean(req.body.name, 120); if (!name) fail('Informe o nome.'); if (store.classifications.some((c) => c.id !== req.params.id && c.name.toLocaleLowerCase() === name.toLocaleLowerCase())) fail('Classificação já cadastrada.', 409); let row = store.classifications.find((c) => c.id === req.params.id); if (method === 'put' && !row) fail('Classificação não encontrada.', 404); const before = row ? { ...row } : null; if (!row) { row = { id: randomUUID(), inactive: false }; store.classifications.push(row) } row.name = name; if (typeof req.body.inactive === 'boolean') row.inactive = req.body.inactive; event(store, req.actor, before ? 'classification_edited' : 'classification_created', null, { details: { before, after: row } }); return row }); res.json({ item }) }))
  router.delete('/classifications/:id', handle(async (req, res) => { await mutateStore((store) => { init(store); const row = store.classifications.find((c) => c.id === req.params.id); if (!row) fail('Classificação não encontrada.', 404); if (store.payables.some((r) => r.classificationId === row.id)) fail('Existem contas usando esta classificação.', 409); store.classifications = store.classifications.filter((c) => c.id !== row.id); event(store, req.actor, 'classification_deleted', null, { details: row }) }); res.json({ ok: true }) }))
  router.sweep = sweep
  return router
}
