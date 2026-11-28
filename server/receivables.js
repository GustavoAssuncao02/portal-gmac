import express from 'express'
import { randomUUID } from 'node:crypto'
import { receiveFile, sendStoredFile, uploadLimits } from './uploads.js'
import * as fs from 'node:fs/promises'
import { readInvoices, invoicePdf } from './invoiceImport.js'
import path from 'node:path'
import { dataDirectory } from './dataDirectory.js'
import { readStore, mutateStore } from './offers.js'
import { exportPdf, exportWorkbook } from './reports.js'
import { cents, validDate, todayBahia, daysUntil, makeInstallments, shiftMonth, matchesSearch, treasuryEntry, duplicateError, duplicateAccepted, MAX_SERIES, receivableDetailMatch, receivableKindLabels, receivableKindOf } from './payableRules.js'
import { notificationSettings } from './accounts.js'
import { assertNotReconciled, reconciledTransaction } from './bankStatements.js'
import { normalizeText } from './ofx.js'
import { osValueOf } from './proposalMath.js'
import { labelQuoteRequired } from './labelQuoteRules.js'
import { operationStates } from './reportData.js'
import { settlementBank, bankFilterNote } from './banks.js'
import { classificationList, entryClassification } from './accountPlan.js'
import { bulkActions, bulkIds, planBulk, previewOf, assertSamePreview, countsLine, dateRangeLine } from './bulkAccounts.js'

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const clean = (value, limit = 1000) => String(value ?? '').trim().slice(0, limit)
const money = (value) => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const receiptMethods = { pix: 'Pix', boleto: 'Boleto', transfer: 'Transferência', card: 'Cartão', cash: 'Dinheiro' }
const statusLabel = { pending: 'Pendente', overdue: 'Vencido', received: 'Recebido' }
const directory = path.join(dataDirectory, 'receivable-files')
const init = (store) => { store.receivables ||= []; store.receivableEvents ||= []; store.orders ||= []; store.receivableNotifications ||= []; store.receivableUploads ||= [] }
export const receivableStatus = (row, today = todayBahia()) => row.receipt ? 'received' : row.dueDate < today ? 'overdue' : 'pending'
function event(store, actor, type, accountId, details = {}) { store.receivableEvents.push({ id: randomUUID(), at: new Date().toISOString(), type, accountId, userId: actor?.id ?? null, userName: actor?.name || 'Sistema', ...details }) }
function find(store, id) { const row = store.receivables.find((item) => item.id === id); if (!row) fail('Conta a receber não encontrada.', 404); return row }
// The name follows a classification renamed later.
const classificationNameOf = (store, row) => (store.classifications || []).find((item) => item.id === row.classificationId)?.name || row.classificationName || ''
const view = (row, store) => ({ ...row, classificationName: classificationNameOf(store, row), attachments: row.attachments || [], status: receivableStatus(row), daysUntil: daysUntil(row.dueDate), ...(row.partialPaidCents ? { fullValueCents: row.valueCents + row.partialPaidCents, fullIssCents: (row.issCents || 0) + (row.partialIssCents || 0) } : {}), reconciled: Boolean(reconciledTransaction(store, 'receivable', row.id)) })
// Same search as payables: text, value as typed in Brazil and the payer CPF/CNPJ.
export const matchesReceivable = (row, search) => matchesSearch({ id: row.id, supplierName: row.customerName, supplierDocument: row.customerDocument, description: row.description, documentNumber: row.documentNumber, orderCode: row.orderCode, valueCents: row.valueCents }, search)
function claimFiles(store, ids, actor) {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) fail('Anexos inválidos.')
  const files = ids.map((id) => { const file = store.receivableUploads.find((item) => item.id === id && String(item.userId) === String(actor.id)); if (!file) fail('Anexo inválido ou já utilizado.'); const { userId, ...safe } = file; return safe })
  store.receivableUploads = store.receivableUploads.filter((item) => !ids.includes(item.id))
  return files
}
const dateLabel = (value) => value.split('-').reverse().join('/')
const groupOf = (store, row) => row.groupId ? store.receivables.filter((item) => item.groupId === row.groupId).sort((a, b) => a.installmentNumber - b.installmentNumber) : [row]
const hasReceiptHistory = (store, row) => Boolean(row.receipt) || store.receivableEvents.some((e) => e.accountId === row.id && ['received', 'reversed'].includes(e.type))
// Why an account (with its whole installment plan) cannot be deleted, or null when it can: a receipt history has to be
// preserved (a Tesouraria entry posted by mistake is the exception) and a bank reconciliation has to be undone first.
// Only a receipt the account has NOW blocks it: a reversed receipt (by hand or by undoing a reconciliation) leaves the
// account open, and the history keeps the receipt, the reversal and the deletion.
function deletionBlock(store, row, group = groupOf(store, row)) {
  if (group.some((item) => item.partialPaidCents)) return { message: 'Conta com recebimento parcial: estorne os recebimentos parciais antes de excluir.', status: 409 }
  if (!row.treasury && group.some((item) => Boolean(item.receipt))) return { message: row.groupId ? 'Há parcela com recebimento: preserve o histórico do parcelamento.' : 'Conta com recebimento: preserve o histórico.', status: 409 }
  for (const item of group) { try { assertNotReconciled(store, 'receivable', item.id, 'excluir') } catch (error) { return { message: error.message, status: error.status || 409 } } }
  return null
}
// The other accounts that can be deleted along with this one: the rest of its installment plan, or the occurrences of
// its recurring contract that have no receipt (each occurrence is independent).
function deletableOthers(store, row) {
  if (row.groupId) return groupOf(store, row)
  if (!row.seriesId) return [row]
  return store.receivables.filter((item) => item.seriesId === row.seriesId && (item === row || !deletionBlock(store, item, [item])))
}
const linkedReceivables = (store, orderCode) => store.receivables.filter((row) => row.orderCode === orderCode && !row.inactive)
// Reopening an OS may take the accounts posted for it along (the user decides); the history keeps what was deleted.
export function removeOrderReceivables(store, actor, orderCode) {
  init(store)
  const rows = linkedReceivables(store, orderCode), removed = [...new Set(rows.flatMap((row) => groupOf(store, row)))]
  for (const row of rows) { const block = deletionBlock(store, row); if (block) fail(`Não foi possível excluir ${row.id}. ${block.message}`, block.status) }
  for (const item of removed) event(store, actor, 'deleted', item.id, { details: { account: item, text: `Excluída ao reabrir a ${orderCode}` } })
  store.receivables = store.receivables.filter((item) => !removed.includes(item))
  return removed.map((item) => item.id)
}
// No expected receipt date (installments included) can come before the document's issue date.
function assertDueDates(parts, issueDate) {
  for (const part of parts) {
    if (!validDate(part.dueDate)) fail('Informe a data prevista de recebimento.')
    if (part.dueDate < issueDate) fail(`A data prevista de recebimento não pode ser anterior à data de emissão (${dateLabel(issueDate)}).`)
  }
}
// A single document can be received in installments; they must add up exactly to the total.
// The ISS expected for the document follows its parts: each occurrence of a contract carries it whole; installments split
// it in proportion to their values, the last one taking the rounding.
function withIss(parts, common) {
  const total = common.issCents || 0
  if (common.kind !== 'installment') return parts.map((part) => ({ ...part, issCents: total }))
  let given = 0
  return parts.map((part, index) => {
    const issCents = index === parts.length - 1 ? total - given : Math.round(total * part.valueCents / common.valueCents)
    given += issCents
    return { ...part, issCents }
  })
}
function partsOf(body, common, creating = false) {
  return withIss(splitParts(body, common, creating), common)
}
function splitParts(body, common, creating) {
  if (common.kind === 'recurring' && creating) {
    const ahead = Number(body.ahead ?? 0)
    if (!Number.isInteger(ahead) || ahead < 0 || ahead > MAX_SERIES) fail('Informe um número válido de ocorrências futuras.')
    // Each occurrence is issued in its own month, so the DRE by competência spreads the contract over its months.
    const step = common.recurrence === 'yearly' ? 12 : 1
    return Array.from({ length: ahead + 1 }, (_, index) => ({ valueCents: common.valueCents, issueDate: shiftMonth(common.issueDate, index * step), dueDate: shiftMonth(common.dueDate, index * step) }))
  }
  if (common.kind !== 'installment') return [{ valueCents: common.valueCents, dueDate: common.dueDate }]
  const count = Number(body.count)
  if (!Number.isInteger(count) || count < 2 || count > MAX_SERIES) fail('Informe um número válido de parcelas (a partir de 2).')
  if (body.installments !== undefined && !Array.isArray(body.installments)) fail('Parcelas inválidas.')
  let rows
  try { rows = body.installments?.length ? body.installments.map((row) => ({ valueCents: cents(row.value), dueDate: row.dueDate })) : makeInstallments(common.valueCents, common.dueDate, count) } catch (error) { fail(error.message) }
  if (rows.length !== count || rows.some((row) => !validDate(row.dueDate) || row.valueCents <= 0) || rows.reduce((sum, row) => sum + row.valueCents, 0) !== common.valueCents) fail('A soma das parcelas deve ser exatamente igual ao valor total, com datas e valores válidos.')
  return rows
}

// The OS price is the OS value of the accepted proposal: what the customer pays, already with margin and discount.
export function orderValue(order) {
  const proposal = order?.proposal || {}
  // A proposal made with the commercial models states the amount agreed with the customer; newer ones carry the OS value.
  if (Number(proposal.document?.total) > 0 || proposal.osValue != null) {
    const valueCents = Math.round(osValueOf(proposal) * 100)
    return { serviceCents: valueCents, discount: 0, valueCents }
  }
  // Proposals saved before the OS value existed: the service value was the price, with the discount applied.
  const serviceCents = Math.round(Number(proposal.serviceValue || 0) * 100)
  const discount = Math.min(100, Math.max(0, Number(proposal.discount || 0)))
  return { serviceCents, discount, valueCents: Math.round(serviceCents * (100 - discount) / 100) }
}

export function filterReceivables(rows, filters = {}, today = todayBahia()) {
  return rows.filter((row) => {
    if (filters.start && row.dueDate < filters.start || filters.end && row.dueDate > filters.end) return false
    if (!matchesReceivable(row, filters.search)) return false
    if (!receivableDetailMatch(row, filters)) return false
    // Only received accounts have a bank: filtering by bank lists the receipts that entered it.
    if (filters.bankId && row.receipt?.bankId !== filters.bankId) return false
    const status = receivableStatus(row, today)
    if (filters.status === 'all' || filters.bankId && !filters.status) return true
    return filters.status ? status === filters.status : status !== 'received'
  })
}

async function fields(store, body, accounts, current) {
  let customer
  if (body.clientId) {
    const client = (await accounts.clients()).find((item) => String(item.id) === String(body.clientId))
    if (!client) fail('Cliente não encontrado.')
    customer = { clientId: String(client.id), customerName: client.name, customerDocument: String(client.document || '').replace(/\D/g, '') || null }
  } else customer = { clientId: null, customerName: clean(body.customerName, 160), customerDocument: String(body.customerDocument || '').replace(/\D/g, '') || null }
  if (!customer.customerName) fail('Selecione um cliente ou informe o nome do pagador.')
  if (customer.customerDocument && ![11, 14].includes(customer.customerDocument.length)) fail('O CPF/CNPJ do cliente deve ter 11 ou 14 dígitos.')
  if (!validDate(body.dueDate)) fail('Informe a data prevista de recebimento.')
  const issueDate = body.issueDate || current?.issueDate || todayBahia()
  if (!validDate(issueDate)) fail('Data de emissão inválida.')
  if (issueDate > body.dueDate) fail(`A data prevista de recebimento não pode ser anterior à data de emissão (${dateLabel(issueDate)}).`)
  const kind = ['installment', 'recurring'].includes(body.kind) ? body.kind : 'single'
  if (kind === 'recurring' && !['monthly', 'yearly'].includes(body.recurrence)) fail('Selecione recorrência mensal ou anual.')
  let valueCents
  try { valueCents = cents(body.value) } catch (error) { fail(error.message) }
  if (!valueCents) fail('O valor deve ser maior que zero.')
  // ISS the customer already said will be withheld: the account shows the net value before the money arrives.
  let issCents = 0
  try { issCents = cents(body.iss || '0') } catch (error) { fail(error.message) }
  if (issCents >= valueCents) fail('O ISS deve ser menor que o valor da conta.')
  return { ...customer, description: clean(body.description, 5000), documentNumber: clean(body.documentNumber, 160), issueDate, dueDate: body.dueDate, valueCents, issCents, kind, recurrence: kind === 'recurring' ? body.recurrence : null }
}
// Another account with the same payer, value and expected date is a possible duplicate: the form warns and names it, and
// the user may still post it after confirming (`allowDuplicate`, TCK-0007). An edit that keeps payer, value and date
// does not warn again about a match already accepted. Tesouraria entries are not checked: two equal sales on the same
// day are legitimate. Returns, for each proposed account, the ids of the matches the user accepted.
const duplicateFields = 'cliente, valor e data prevista'
function duplicates(store, proposed, ignored = [], allowed = false) {
  const key = (row) => JSON.stringify([normalizeText(row.customerName), row.valueCents, row.dueDate])
  const kept = new Set(store.receivables.filter((row) => ignored.includes(row.id)).map(key))
  const others = store.receivables.filter((row) => !ignored.includes(row.id) && !row.inactive && !row.treasury)
  const found = proposed.map((row) => kept.has(key(row)) ? [] : others.filter((item) => key(item) === key(row)))
  const matches = [...new Set(found.flat())]
  if (allowed || !matches.length) return found.map((rows) => rows.map((item) => item.id))
  throw duplicateError(matches, duplicateFields, (item) => ({ id: item.id, name: item.customerName, description: item.description || '', documentNumber: item.documentNumber || '', valueCents: item.valueCents, dueDate: item.dueDate, status: receivableStatus(item) }))
}
const acceptedText = (ids) => duplicateAccepted(ids, duplicateFields)
// Money in takes a revenue classification (or one outside the result, like a loan received). Without one in the request,
// an account being edited keeps the classification it has.
function revenueClassification(store, body, current) {
  const id = body.classificationId || current?.classificationId
  const item = entryClassification(store, id, 'receivable', current?.classificationId ? [current.classificationId] : [])
  if (!item) fail('Selecione a classificação da receita.')
  return { classificationId: item.id, classificationName: item.name }
}
// `expectedIss`: the ISS registered with the account; a bulk receipt applies it, since it accepts no adjustment typed by hand.
// With `store`, the bank of the settlement is required once banks are registered (Cadastros > Bancos).
function receipt(body, valueCents, bulk = false, expectedIss = 0, store = null) {
  if (!validDate(body.date) || body.date > todayBahia()) fail('Data de recebimento inválida ou futura.')
  if (!Object.hasOwn(receiptMethods, body.method)) fail('Selecione a forma de recebimento.')
  // The ISS withheld by the customer is subtracted from what arrives, like the discount, and may come with interest or discount.
  let interestCents = 0, discountCents = 0, issCents = 0
  try { interestCents = cents(body.interest || '0'); discountCents = cents(body.discount || '0'); issCents = cents(body.iss || '0') } catch (error) { fail(error.message) }
  if (interestCents && discountCents) fail('Juros e desconto são exclusivos.')
  if (bulk && (interestCents || discountCents || issCents || body.fileIds?.length)) fail('A baixa em massa não aceita juros, desconto, ISS ou comprovante; faça a baixa individual.')
  if (bulk) issCents = expectedIss
  const finalCents = valueCents + interestCents - discountCents - issCents
  if (finalCents < 0) fail('O desconto e o ISS não podem ultrapassar o valor da conta.')
  return { date: body.date, method: body.method, interestCents, discountCents, issCents, finalCents, note: clean(body.note, 5000), receipts: [], ...(store ? settlementBank(store, body.bankId) : {}) }
}
// Tesouraria posts money already received: a single account, issued, due and received on the same date.
const treasuryBody = (body) => ({ ...body, kind: 'single', issueDate: body.date, dueDate: body.date, ahead: 0, count: 1, installments: undefined })
// When the amount received (`received`) differs from the value of the account, the difference is interest (more) or discount (less).
function treasuryReceipt(body, valueCents, store) {
  const base = { date: body.date, method: body.method, note: body.note, bankId: body.bankId }
  if (body.received === undefined || body.received === null || body.received === '') return receipt(base, valueCents, false, 0, store)
  let receivedCents
  try { receivedCents = cents(body.received) } catch (error) { fail(error.message) }
  if (!receivedCents) fail('O valor recebido deve ser maior que zero.')
  const difference = receivedCents - valueCents
  return receipt({ ...base, interest: difference > 0 ? (difference / 100).toFixed(2) : '', discount: difference < 0 ? (-difference / 100).toFixed(2) : '' }, valueCents, false, 0, store)
}
// Reminders mirror Contas a Pagar (N days before and on the day) plus one notice once the date has passed.
export function activeReceivableNotices(store, userId) {
  const { receivableReminderDays } = notificationSettings(store, userId)
  if (receivableReminderDays === 'never') return []
  return (store.receivableNotifications || []).filter((notice) => {
    const row = (store.receivables || []).find((item) => item.id === notice.accountId)
    return row && !row.receipt && !row.inactive && notice.dueDate === row.dueDate && [0, receivableReminderDays, 'overdue'].includes(notice.days)
  })
}
export function receivableNotificationItems(store, userId) {
  return activeReceivableNotices(store, userId).map(({ readBy, ...notice }) => ({ ...notice, readAt: readBy?.find((entry) => String(entry.userId) === String(userId))?.at || null, account: view(store.receivables.find((row) => row.id === notice.accountId), store) })).reverse()
}
// The ISS of an open account is the one expected; of a received one, the one actually withheld. Net = value − ISS.
const issOf = (row) => row.receipt ? row.receipt.issCents || 0 : row.issCents || 0
const netOf = (row) => row.valueCents - issOf(row)
const brDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : value || ''
// Excel "Resumo": the main columns of each account and a TOTAL line at the end.
function receivablesSummary(rows) {
  const total = (pick) => rows.reduce((sum, row) => sum + pick(row), 0) / 100
  return { name: 'Resumo', totalRow: true, columns: ['Cliente', 'Descrição', 'Documento', 'Valor bruto (R$)', 'ISS (R$)', 'Valor líquido (R$)', 'Vencimento'], rows: [...rows.map((row) => [row.customerName, row.description || '', row.documentNumber || '', row.valueCents / 100, issOf(row) / 100, netOf(row) / 100, brDate(row.dueDate)]), ['TOTAL', `${rows.length} ${rows.length === 1 ? 'conta' : 'contas'}`, '', total((row) => row.valueCents), total(issOf), total(netOf), '']] }
}
export function receivablesReport(rows, filters = {}, individual = false, store = {}, variant = 'full') {
  const columns = ['ID', 'Cliente', 'CPF/CNPJ', 'Descrição', 'Classificação', 'Origem', 'Documento', 'Parcela', 'Emissão', 'Valor bruto (R$)', 'ISS retido (R$)', 'Valor líquido (R$)', 'Vencimento', 'Status', 'Recebimento', 'Forma', 'Banco', 'Juros (R$)', 'Desconto (R$)', 'Recebido (R$)', 'Observação']
  const full = { title: individual ? `Conta ${rows[0]?.id || ''}` : 'Contas a receber', eyebrow: 'Financeiro', generatedAt: new Date().toISOString(), start: filters.start, end: filters.end, summary: [['Contas', rows.length], ['Valor bruto', money(rows.reduce((sum, row) => sum + row.valueCents, 0))], ['Valor líquido', money(rows.reduce((sum, row) => sum + netOf(row), 0))]], notes: individual ? [] : [`Situação: ${{ all: 'Todas', ...statusLabel }[filters.status] || (filters.bankId ? 'Recebidas' : 'Pendentes e vencidas')}`, ...bankFilterNote(store, filters.bankId), ...(filters.search ? [`Busca: ${filters.search}`] : []), ...(filters.clientId ? [`Cliente: ${(store.receivables || []).find((row) => String(row.clientId) === String(filters.clientId))?.customerName || filters.clientId}`] : []), ...(filters.classificationId ? [`Classificação: ${(store.classifications || []).find((row) => row.id === filters.classificationId)?.name || filters.classificationId}`] : []), ...(receivableKindLabels[filters.kind] ? [`Tipo do recebimento: ${receivableKindLabels[filters.kind]}`] : [])], sections: [{ name: 'Contas a receber', columns, rows: rows.map((row) => { const r = row.receipt; return [row.id, row.customerName, row.customerDocument, row.description, row.classificationName || '', row.orderCode || 'Manual', row.documentNumber, row.groupId ? `${row.installmentNumber} de ${row.installmentCount}` : '', row.issueDate, row.valueCents / 100, issOf(row) / 100, netOf(row) / 100, row.dueDate, statusLabel[receivableStatus(row)], r?.date, receiptMethods[r?.method] || '', r?.bankName || '', (r?.interestCents || 0) / 100, (r?.discountCents || 0) / 100, r ? r.finalCents / 100 : '', r?.note] }) }] }
  return variant === 'summary' ? { ...full, title: 'Contas a receber · Resumo', sections: [receivablesSummary(rows)] } : full
}

// What remains of the plan of a removed account is numbered again, so "parcela x de y" and the total stay right.
function renumberReceivables(store, row) {
  const rest = row.groupId ? store.receivables.filter((item) => item.groupId === row.groupId) : row.seriesId ? store.receivables.filter((item) => item.seriesId === row.seriesId) : []
  if (row.groupId) rest.sort((a, b) => a.installmentNumber - b.installmentNumber).forEach((item, index) => { item.installmentNumber = index + 1; item.installmentCount = rest.length; item.originalTotalCents = rest.reduce((sum, other) => sum + other.valueCents, 0) })
  else rest.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).forEach((item, index) => { item.seriesIndex = index + 1; item.seriesCount = rest.length })
}
// Estorno of a receipt (individual or in bulk, `mark` tags the history of a bulk action). A partial receipt: its value (and
// the ISS it took) goes back to the balance of the account it came from, and the record leaves the lists (its history stays).
function reverseReceivable(store, actor, row, reason, mark = {}) {
  if (!row.receipt) fail('Esta conta não possui recebimento.', 409)
  assertNotReconciled(store, 'receivable', row.id, 'estornar')
  if (reason.length < 10) fail('Informe um motivo com pelo menos 10 caracteres.')
  const parent = row.partialOf ? store.receivables.find((item) => item.id === row.partialOf) : null
  if (parent) {
    if (parent.receipt || parent.inactive) fail(`Estorne o recebimento final de ${parent.id} (ou reative a conta) antes de estornar este recebimento parcial.`, 409)
    assertNotReconciled(store, 'receivable', parent.id, 'estornar recebimento parcial de')
    parent.valueCents += row.valueCents
    parent.issCents = (parent.issCents || 0) + (row.issCents || 0)
    parent.partialPaidCents = (parent.partialPaidCents || 0) - row.valueCents
    parent.partialIssCents = (parent.partialIssCents || 0) - (row.issCents || 0)
    parent.partialIds = (parent.partialIds || []).filter((id) => id !== row.id)
    if (!parent.partialPaidCents) { delete parent.partialPaidCents; delete parent.partialIssCents; delete parent.partialIds }
    event(store, actor, 'reversed', row.id, { reason, details: { ...mark, receipt: row.receipt, partialOf: parent.id, text: `Recebimento parcial estornado: ${money(row.valueCents)} voltaram ao saldo de ${parent.id}` } })
    event(store, actor, 'partial_reversed', parent.id, { reason, details: { ...mark, partialId: row.id, valueCents: row.valueCents, balanceCents: parent.valueCents } })
    store.receivables = store.receivables.filter((item) => item.id !== row.id)
    parent.lastStatus = receivableStatus(parent)
    return parent
  }
  event(store, actor, 'reversed', row.id, { reason, details: { ...mark, receipt: row.receipt } }); row.receipt = null; row.lastStatus = receivableStatus(row)
  return row
}

// Ações em massa (server/bulkAccounts.js): each account follows the rule of the individual action.
const reconciledBlock = (store, id) => reconciledTransaction(store, 'receivable', id) ? 'Lançamento conciliado: desfaça antes a conciliação em Conciliação bancária.' : null
const grossNet = (rows) => ({ grossCents: rows.reduce((sum, row) => sum + row.valueCents, 0), issCents: rows.reduce((sum, row) => sum + issOf(row), 0), netCents: rows.reduce((sum, row) => sum + netOf(row), 0) })
function receivableBulkPlan(store, body) {
  const rows = bulkIds(body, fail).map((id) => find(store, id))
  const target = body.action === 'classify' ? entryClassification(store, body.classificationId, 'receivable') : null
  if (body.action === 'classify' && !target) fail('Selecione a classificação da receita.')
  const blocks = {
    delete: (row) => deletionBlock(store, row)?.message || null,
    reverse: (row, allowed) => {
      if (!row.receipt) return 'Conta sem recebimento.'
      const parent = row.partialOf ? store.receivables.find((item) => item.id === row.partialOf) : null
      if (parent?.inactive) return `Recebimento parcial de ${parent.id}, que está desativada: reative a conta antes.`
      if (parent?.receipt && !allowed.has(parent.id)) return `Recebimento parcial de ${parent.id}: desfaça antes o recebimento final de ${parent.id}.`
      return reconciledBlock(store, row.id) || (parent && reconciledBlock(store, parent.id))
    },
    classify: (row) => {
      if (row.treasury) return 'Lançamento da Tesouraria: altere na conta.'
      if (row.receipt) return 'Conta recebida: desfaça o recebimento antes de alterar a classificação.'
      if (row.classificationId === target.id) return `Já está em ${target.name}.`
      return reconciledBlock(store, row.id)
    },
  }
  const plan = planBulk(rows, blocks[body.action])
  const nameOf = (row) => row.customerName
  const facts = {
    delete: (rows) => {
      const kept = new Set(rows.map((row) => row.id))
      const series = [...new Set(rows.filter((row) => row.seriesId).map((row) => row.seriesId))].filter((id) => !store.receivables.some((row) => row.seriesId === id && !kept.has(row.id) && !row.receipt && !row.inactive))
      return [dateRangeLine('Vencimentos', rows.map((row) => row.dueDate)), countsLine('Cliente', rows.map(nameOf)), countsLine('Tipo', rows.map((row) => receivableKindLabels[receivableKindOf(row)])), series.length ? `${series.length} ${series.length === 1 ? 'contrato recorrente fica' : 'contratos recorrentes ficam'} sem lançamentos em aberto` : null]
    },
    reverse: (rows) => [dateRangeLine('Recebimentos', rows.map((row) => row.receipt?.date)), countsLine('Banco', rows.map((row) => row.receipt?.bankName || 'Sem banco')), countsLine('Cliente', rows.map(nameOf))],
    classify: (rows) => [`Nova classificação: ${target.name}`, countsLine('Classificação atual', rows.map((row) => classificationNameOf(store, row) || 'Sem classificação')), countsLine('Cliente', rows.map(nameOf))],
  }
  const preview = previewOf(body.action, plan, { name: nameOf, amounts: grossNet, facts: facts[body.action], signature: (row) => [row.id, row.valueCents, row.issCents ?? 0, row.dueDate, row.receipt?.date ?? null, row.receipt?.finalCents ?? null, row.partialPaidCents ?? 0, row.classificationId ?? null] })
  return { plan, preview, target }
}
function applyReceivableBulk(store, actor, body, { plan, target }) {
  const rows = plan.allowed, count = rows.length
  if (body.action === 'delete') {
    for (const row of rows) event(store, actor, 'deleted', row.id, { details: { account: row, bulk: true, text: `Exclusão em massa (${count} ${count === 1 ? 'conta' : 'contas'})` } })
    store.receivables = store.receivables.filter((row) => !rows.includes(row))
    // Each plan that lost accounts is numbered again once.
    for (const row of new Map(rows.filter((row) => row.groupId || row.seriesId).map((row) => [row.groupId || row.seriesId, row])).values()) renumberReceivables(store, row)
  }
  // A final receipt goes back before the partial ones of the same account.
  if (body.action === 'reverse') for (const row of [...rows].sort((left, right) => Number(Boolean(left.partialOf)) - Number(Boolean(right.partialOf)))) reverseReceivable(store, actor, row, clean(body.reason), { bulk: true, text: 'Recebimento desfeito em massa' })
  if (body.action === 'classify') for (const row of rows) {
    const before = { ...row }, from = classificationNameOf(store, row) || 'Sem classificação'
    Object.assign(row, { classificationId: target.id, classificationName: target.name })
    event(store, actor, 'edited', row.id, { changes: { before, after: { ...row } }, details: { bulk: true, text: `Classificação alterada em massa: ${from} → ${target.name}` } })
  }
  return { ok: true, count, ids: rows.map((row) => row.id) }
}

// The number of an invoice as it may have been typed: without dots and leading zeros; an NFS-e number (2026000000451)
// also as the year followed by its sequence (2026451), the way the company names the files.
const plainNumber = (value) => String(value || '').replace(/\D/g, '').replace(/^0+/, '')
function invoiceKeys(number) {
  const plain = plainNumber(number)
  const nfse = /^(20\d{2})0*(\d+)$/.exec(plain)
  return plain ? [plain, ...(nfse && plain.length === 13 ? [nfse[1] + nfse[2]] : [])] : []
}
// An account already posted for the same invoice of the same client (an OS keeps its code as the document).
function postedInvoice(store, note) {
  const keys = invoiceKeys(note.documentNumber), name = normalizeText(note.customerName)
  if (!keys.length) return null
  return store.receivables.find((row) => !row.inactive && row.origin !== 'order' && keys.includes(plainNumber(row.documentNumber)) && (note.customerDocument && row.customerDocument ? row.customerDocument === note.customerDocument : normalizeText(row.customerName) === name)) || null
}
const IMPORT_LIMIT = 50 * 1024 * 1024
export const invoiceLabel = { nfse: 'NFS-e', nfe: 'NF-e' }

// ---------- NF-e of an OS (server/orderInvoices.js): the invoice attached to the OS becomes its account receivable.
// Accounts that may already charge this invoice: the same invoice of the same client, any account of the OS, and another
// account of the same client with the same value and due date. The user decides: post anyway, only attach, or cancel.
// `note`: { documentNumber, customerName, customerDocument, valueCents, dueDates }.
export function invoiceDuplicates(store, orderCode, note) {
  init(store)
  const name = normalizeText(note.customerName), dues = new Set((note.dueDates || []).filter(Boolean))
  const sameClient = (row) => note.customerDocument && row.customerDocument ? row.customerDocument === note.customerDocument : normalizeText(row.customerName) === name
  const found = new Map()
  const add = (row) => { if (row && !row.inactive && !row.partialOf && !found.has(row.groupId || row.id)) found.set(row.groupId || row.id, row) }
  add(postedInvoice(store, note))
  // Another NF-e of the same OS (an OS may have several) is not this one.
  const number = plainNumber(note.documentNumber)
  for (const row of linkedReceivables(store, orderCode)) if (!(row.origin === 'invoice' && number && plainNumber(row.documentNumber) !== number)) add(row)
  if (note.valueCents) for (const row of store.receivables) if (!row.treasury && (row.originalTotalCents || row.valueCents) === note.valueCents && dues.has(row.dueDate) && sameClient(row)) add(row)
  return [...found.values()].map((row) => ({ id: row.id, customerName: row.customerName, description: row.description || '', documentNumber: row.documentNumber || '', valueCents: row.originalTotalCents || row.valueCents, dueDate: row.dueDate, status: receivableStatus(row), orderCode: row.orderCode || null, installments: row.groupId ? row.installmentCount : 1 }))
}

// The account of one NF-e of an OS (one per duplicate of an NF-e), linked to the OS, with the PDF of the note attached.
// Same rules as an account typed in Contas a Receber; administrative employees post it too, without the finance screens.
export async function postInvoiceAccount(store, actor, accounts, order, input, attachment) {
  init(store)
  const installments = Array.isArray(input.installments) && input.installments.length ? input.installments : [{ dueDate: input.dueDate, value: input.value }]
  const many = installments.length > 1
  const body = { clientId: input.clientId, description: input.description, documentNumber: input.documentNumber, issueDate: input.issueDate, value: input.value, iss: input.iss, classificationId: input.classificationId, dueDate: installments[0]?.dueDate, ...(many ? { kind: 'installment', count: installments.length, installments } : { kind: 'single', count: 1 }) }
  if (!clean(body.documentNumber)) fail('Informe o número da nota.')
  if (!body.clientId) fail('Cadastre o cliente da nota antes de lançar.')
  const common = { ...await fields(store, body, accounts), ...revenueClassification(store, body) }
  const parts = partsOf(body, common, true)
  assertDueDates(parts, common.issueDate)
  const groupId = parts.length > 1 ? randomUUID() : null, createdAt = new Date().toISOString(), label = `${invoiceLabel[input.kind] || 'NF-e'} ${common.documentNumber}`
  const rows = parts.map((part, index) => ({ origin: 'invoice', orderCode: order.code, offerId: order.offerId || null, ...common, ...part, kind: groupId ? 'installment' : 'single', groupId, installmentNumber: groupId ? index + 1 : 1, installmentCount: groupId ? parts.length : 1, seriesId: null, seriesIndex: null, seriesCount: null, originalTotalCents: groupId ? common.valueCents : part.valueCents, receipt: null, inactive: false, createdAt, attachments: attachment ? [{ ...attachment }] : [] }))
  for (const row of rows) {
    store.receivableSequence = (store.receivableSequence || 0) + 1
    row.id = `REC-${String(store.receivableSequence).padStart(6, '0')}`
    row.lastStatus = receivableStatus(row)
    store.receivables.push(row)
    event(store, actor, 'created', row.id, { details: { valueCents: row.valueCents, dueDate: row.dueDate, text: [`${label} anexada na ${order.code}`, groupId ? `Parcela ${row.installmentNumber} de ${rows.length} de ${money(common.valueCents)}` : '', input.duplicateOf?.length ? `Possível duplicidade com ${input.duplicateOf.join(', ')} confirmada pelo usuário` : ''].filter(Boolean).join(' · ') } })
    for (const file of row.attachments) event(store, actor, 'attachment_added', row.id, { details: { name: file.name } })
  }
  return rows.map((row) => row.id)
}

// Why these accounts (each with its whole installment plan) cannot be deleted, or null.
export function receivablesDeleteBlock(store, ids) {
  init(store)
  for (const row of store.receivables.filter((item) => ids.includes(item.id) && !item.inactive)) { const block = deletionBlock(store, row); if (block) return `${row.id}: ${block.message}` }
  return null
}
// Deletes these accounts (with their installment plans); the history keeps them, with `text` saying why.
export function removeReceivables(store, actor, ids, text) {
  init(store)
  const rows = store.receivables.filter((row) => ids.includes(row.id) && !row.inactive), removed = [...new Set(rows.flatMap((row) => groupOf(store, row)))]
  for (const row of removed) { const block = deletionBlock(store, row); if (block) fail(`Não foi possível excluir ${row.id}. ${block.message}`, block.status) }
  for (const item of removed) event(store, actor, 'deleted', item.id, { details: { account: item, text } })
  store.receivables = store.receivables.filter((item) => !removed.includes(item))
  return removed.map((item) => item.id)
}
// The accounts of a list of ids that still exist, as the NF-e of an OS shows them.
export const receivableSummaries = (store, ids = []) => { init(store); return store.receivables.filter((row) => ids.includes(row.id) && !row.inactive).map((row) => ({ id: row.id, valueCents: row.valueCents, dueDate: row.dueDate, status: receivableStatus(row), installmentNumber: row.installmentNumber, installmentCount: row.installmentCount })) }

export default function createReceivablesRouter(accounts, requireAdmin, pool = null) {
  const router = express.Router()
  router.use('/receivables', requireAdmin, async (request, _response, next) => { try { request.actor = await accounts.account(request.adminId); if (!request.actor) fail('Administrador não encontrado.', 401); next() } catch (error) { next(error) } })
  const handle = (fn) => async (req, res, next) => { try { await fn(req, res) } catch (error) { next(error) } }
  // With the database, the state of the operation (and so whether the OS is finished) lives in order_operations, not in the saved order.
  async function operationStatus(order) {
    if (pool) {
      const [row] = await operationStates([order], pool)
      if (row) return (typeof row.data === 'string' ? JSON.parse(row.data) : row.data)?.status
    }
    return order.operation?.status
  }
  async function sweep(userId) {
    const today = todayBahia(), snapshot = await readStore(); init(snapshot)
    const noticeDay = (store, row) => {
      const { receivableReminderDays } = notificationSettings(store, userId), days = daysUntil(row.dueDate, today)
      if (days < 0) return 'overdue'
      return receivableReminderDays !== 'never' && days <= receivableReminderDays ? days === 0 ? 0 : receivableReminderDays : null
    }
    const pending = (store) => store.receivables.filter((row) => !row.receipt && !row.inactive)
    const missing = (store) => pending(store).some((row) => { const days = noticeDay(store, row); return days !== null && !store.receivableNotifications.some((n) => n.id === `${row.id}:${row.dueDate}:${days}`) })
    const statusChanged = (store) => store.receivables.some((row) => row.lastStatus !== receivableStatus(row, today))
    if (!missing(snapshot) && !statusChanged(snapshot)) return snapshot
    return mutateStore((store) => {
      init(store)
      for (const row of store.receivables) {
        const status = receivableStatus(row, today)
        if (row.lastStatus !== status) { event(store, null, 'status_changed', row.id, { details: { before: row.lastStatus || 'pending', after: status } }); row.lastStatus = status }
      }
      for (const row of pending(store)) {
        const days = noticeDay(store, row), id = `${row.id}:${row.dueDate}:${days}`
        if (days !== null && !store.receivableNotifications.some((n) => n.id === id)) store.receivableNotifications.push({ id, accountId: row.id, dueDate: row.dueDate, days, at: new Date().toISOString() })
      }
      return store
    })
  }
  router.sweep = sweep
  router.get('/receivables', handle(async (req, res) => {
    const store = await sweep(req.actor.id); init(store)
    let clients = []
    try { clients = await accounts.clients() } catch { /* The list still works when the client registry is unavailable. */ }
    res.json({ items: store.receivables.map((row) => view(row, store)), clients: clients.map((row) => ({ id: String(row.id), name: row.name, document: row.document })), classifications: classificationList(store) })
  }))
  router.get('/receivables/history', handle(async (_req, res) => { const store = await readStore(); init(store); res.json({ items: [...store.receivableEvents].reverse() }) }))
  router.get('/receivables/order/:code', handle(async (req, res) => {
    const store = await readStore(); init(store)
    const order = store.orders.find((item) => item.code === req.params.code)
    if (!order) fail('OS não encontrada.', 404)
    const existing = linkedReceivables(store, order.code).filter((row) => !row.partialOf).sort((a, b) => (a.installmentNumber || 1) - (b.installmentNumber || 1))
    // `deleteBlock` tells why the accounts cannot be removed (when reopening the OS, for instance).
    const deleteBlock = existing.map((row) => deletionBlock(store, row)).find(Boolean)?.message || null
    res.json({ order: { code: order.code, company: order.company, cnpj: String(order.cnpj || '').replace(/\D/g, ''), service: order.service, completed: await operationStatus(order) === 'completed', labelQuotePending: Boolean(order.labelQuote?.pending), ...orderValue(order) }, item: existing.length ? view(existing[0], store) : null, items: existing.map((row) => view(row, store)), deleteBlock, classifications: classificationList(store).filter((item) => !item.inactive && !item.groupInactive && item.nature !== 'expense') })
  }))
  router.get('/receivables/:id', handle(async (req, res) => {
    const store = await readStore(); init(store); const row = find(store, req.params.id), group = groupOf(store, row)
    const linkedOrder = row.orderCode ? (store.orders || []).find((order) => order.code === row.orderCode) : null
    res.json({ item: view(row, store), purchaseOrderNumber: linkedOrder?.purchaseOrderNumber || null, entryInvoiceNumber: linkedOrder?.entryInvoiceNumber || null, siblings: row.groupId ? group.map((item) => view(item, store)) : [], structureLocked: group.some((item) => item.receipt || item.partialPaidCents), partials: (row.partialIds || []).map((id) => store.receivables.find((item) => item.id === id)).filter(Boolean).map((item) => view(item, store)), canDelete: !deletionBlock(store, row, group), deleteBlock: deletionBlock(store, row, group)?.message || null, deleteOthers: deletionBlock(store, row, group) ? 0 : deletableOthers(store, row).length - 1, history: store.receivableEvents.filter((e) => e.accountId === row.id).reverse() })
  }))
  router.post('/receivables', handle(async (req, res) => {
    const treasury = req.body.treasury === true
    // The date and the way of receiving are checked before the account fields that derive from them.
    if (treasury) treasuryReceipt(req.body, 0)
    const body = treasury ? treasuryBody(req.body) : req.body
    const draft = body.orderCode ? null : await fields(null, body, accounts)
    const item = await mutateStore(async (store) => {
      init(store)
      let common = draft, origin = 'manual', order = null
      if (body.orderCode) {
        order = store.orders.find((row) => row.code === body.orderCode)
        if (order?.labelQuote?.pending) fail(labelQuoteRequired, 409)
        if (!order) fail('OS não encontrada.', 404)
        if (await operationStatus(order) !== 'completed') fail('A OS precisa estar concluída para programar o recebimento.', 409)
        const existing = store.receivables.find((row) => row.orderCode === order.code && !row.inactive)
        if (existing) fail(`Esta OS já possui a conta a receber ${existing.id}.`, 409)
        const document = String(order.cnpj || '').replace(/\D/g, '')
        common = await fields(store, { customerName: order.company, customerDocument: [11, 14].includes(document.length) ? document : '', description: body.description || `${order.code} · ${order.service}`, documentNumber: order.code, value: body.value, iss: body.iss, issueDate: treasury ? body.issueDate : undefined, dueDate: body.dueDate, kind: body.kind }, accounts)
        origin = 'order'
      }
      common = { ...common, ...revenueClassification(store, body) }
      const parts = partsOf(body, common, true)
      assertDueDates(parts, common.issueDate)
      const recurring = common.kind === 'recurring'
      const groupId = parts.length > 1 && !recurring ? randomUUID() : null, seriesId = recurring && parts.length > 1 ? randomUUID() : null, createdAt = new Date().toISOString()
      const rows = parts.map((part, index) => ({ origin, orderCode: order?.code || null, offerId: order?.offerId || null, ...common, ...part, kind: recurring ? 'recurring' : groupId ? 'installment' : 'single', groupId, installmentNumber: groupId ? index + 1 : 1, installmentCount: groupId ? parts.length : 1, seriesId, seriesIndex: seriesId ? index + 1 : null, seriesCount: seriesId ? parts.length : null, originalTotalCents: groupId ? common.valueCents : part.valueCents, receipt: null, inactive: false, createdAt }))
      // An OS is unique by its code; equal client/value/date across different OSs is legitimate.
      const accepted = origin === 'manual' && !treasury ? duplicates(store, rows, [], req.body.allowDuplicate === true) : []
      const attachments = claimFiles(store, req.body.fileIds || [], req.actor)
      for (const [index, row] of rows.entries()) {
        // Installments share the document's files; a recurring contract keeps them on its first occurrence.
        row.attachments = common.kind === 'recurring' && index > 0 ? [] : [...attachments]
        if (treasury) Object.assign(row, { treasury: true, receipt: treasuryReceipt(req.body, row.valueCents, store) })
        store.receivableSequence = (store.receivableSequence || 0) + 1
        row.id = `REC-${String(store.receivableSequence).padStart(6, '0')}`
        row.lastStatus = receivableStatus(row)
        store.receivables.push(row)
        event(store, req.actor, 'created', row.id, { details: { valueCents: row.valueCents, dueDate: row.dueDate, text: [treasury ? `Entrada lançada na Tesouraria, já recebida${order ? `, na conclusão da ${order.code}` : ''}` : order ? `Programada na conclusão da ${order.code}` : '', groupId ? `Parcela ${row.installmentNumber} de ${rows.length} de ${money(common.valueCents)}` : '', seriesId ? `Contrato recorrente: ocorrência ${row.seriesIndex} de ${rows.length}` : '', acceptedText(accepted[index] || [])].filter(Boolean).join(' · ') } })
        if (treasury) event(store, req.actor, 'received', row.id, { details: { ...row.receipt, treasury: true } })
        for (const file of row.attachments) event(store, req.actor, 'attachment_added', row.id, { details: { name: file.name } })
      }
      return rows.map((row) => view(row, store))
    })
    res.status(201).json({ item: item[0], items: item })
  }))
  router.put('/receivables/:id', handle(async (req, res) => {
    const item = await mutateStore(async (store) => {
      init(store); const row = find(store, req.params.id), group = groupOf(store, row)
      // A Tesouraria entry is corrected in place and stays received.
      if (treasuryEntry(row) && req.body.treasury === true) {
        assertNotReconciled(store, 'receivable', row.id, 'editar')
        treasuryReceipt(req.body, 0)
        const body = treasuryBody(req.body)
        const common = { ...await fields(store, row.origin === 'order' ? { ...body, clientId: undefined, customerName: row.customerName, customerDocument: row.customerDocument ?? '' } : body, accounts, row), ...revenueClassification(store, body, row) }
        const before = { ...row }
        Object.assign(row, common, { originalTotalCents: common.valueCents, receipt: { ...treasuryReceipt(req.body, common.valueCents, store), receipts: row.receipt.receipts || [] }, lastStatus: 'received' })
        event(store, req.actor, 'edited', row.id, { changes: { before, after: { ...row } } })
        return [view(row, store)]
      }
      if (row.receipt) fail('Estorne o recebimento antes de editar esta conta.', 409)
      assertNotReconciled(store, 'receivable', row.id, 'editar')
      // The payer of an OS receivable comes from the OS and stays fixed.
      const common = { ...(row.origin === 'order' ? await fields(store, { ...req.body, clientId: undefined, customerName: row.customerName, customerDocument: row.customerDocument ?? '' }, accounts, row) : await fields(store, req.body, accounts, row)), ...revenueClassification(store, req.body, row) }
      if (group.some((item) => item.receipt || item.partialPaidCents)) {
        const { valueCents, dueDate, kind, issCents, ...descriptive } = common
        const before = { ...row }; Object.assign(row, descriptive); row.lastStatus = receivableStatus(row)
        event(store, req.actor, 'edited', row.id, { changes: { before, after: { ...row } }, details: { text: 'Parcelamento com parcela recebida: valores e datas preservados.' } })
        return [view(row, store)]
      }
      const parts = partsOf(req.body, common)
      assertDueDates(parts, common.issueDate)
      for (const item of group) assertNotReconciled(store, 'receivable', item.id, 'alterar o parcelamento')
      const removed = group.slice(parts.length)
      if (removed.some((item) => hasReceiptHistory(store, item))) fail('Não é possível remover parcelas com histórico de recebimento.', 409)
      const groupId = parts.length > 1 ? row.groupId || randomUUID() : null, ids = group.map((item) => item.id)
      const updated = parts.map((part, index) => ({ target: group[index], data: { ...common, ...part, kind: groupId ? 'installment' : common.kind === 'recurring' ? 'recurring' : 'single', groupId, installmentNumber: index + 1, installmentCount: parts.length, originalTotalCents: common.valueCents } }))
      const accepted = row.origin === 'manual' ? duplicates(store, updated.map(({ data }) => data), ids, req.body.allowDuplicate === true) : []
      const result = []
      for (const [index, { target, data }] of updated.entries()) {
        const acceptance = acceptedText(accepted[index] || [])
        if (target) {
          const before = { ...target }; Object.assign(target, data); target.lastStatus = receivableStatus(target)
          event(store, req.actor, 'edited', target.id, { changes: { before, after: { ...target } }, ...(acceptance ? { details: { text: acceptance } } : {}) })
          result.push(target)
        } else {
          store.receivableSequence = (store.receivableSequence || 0) + 1
          const created = { origin: row.origin, orderCode: row.orderCode, offerId: row.offerId, ...data, id: `REC-${String(store.receivableSequence).padStart(6, '0')}`, attachments: [...(row.attachments || [])], receipt: null, inactive: false, createdAt: row.createdAt }
          created.lastStatus = receivableStatus(created); store.receivables.push(created)
          event(store, req.actor, 'created', created.id, { details: { valueCents: created.valueCents, dueDate: created.dueDate, text: [`Parcela ${created.installmentNumber} de ${parts.length}, criada ao editar o parcelamento`, acceptance].filter(Boolean).join(' · ') } })
          result.push(created)
        }
      }
      for (const item of removed) event(store, req.actor, 'deleted', item.id, { details: { account: item, text: 'Parcela removida ao editar o parcelamento' } })
      store.receivables = store.receivables.filter((item) => !removed.includes(item))
      return result.map((item) => view(item, store))
    })
    res.json({ item: item.find((row) => row.id === req.params.id) || item[0], items: item })
  }))
  router.post('/receivables/:id/receive', handle(async (req, res) => {
    const item = await mutateStore((store) => {
      init(store); const row = find(store, req.params.id)
      if (row.receipt) fail('Esta conta já foi recebida.', 409)
      const data = receipt(req.body, row.valueCents, false, 0, store); data.receipts = claimFiles(store, req.body.fileIds || [], req.actor)
      row.receipt = data; row.lastStatus = 'received'; event(store, req.actor, 'received', row.id, { details: row.receipt })
      for (const file of data.receipts) event(store, req.actor, 'attachment_added', row.id, { details: { name: file.name, receipt: true } })
      return view(row, store)
    })
    res.json({ item })
  }))
  // Recebimento parcial: receives part of an open account; the balance stays open (with the due date the user gives it) and the
  // part becomes a received account linked to it. Interest and discount only come with the final receipt. The ISS withheld
  // by the customer leaves with this receipt ('now') or with the last one ('last'), as the user chooses.
  router.post('/receivables/:id/partial', handle(async (req, res) => {
    const result = await mutateStore((store) => {
      init(store); const row = find(store, req.params.id)
      if (row.receipt || row.inactive) fail('Só uma conta em aberto e ativa aceita recebimento parcial.', 409)
      assertNotReconciled(store, 'receivable', row.id, 'dar baixa parcial em')
      let receivedCents
      try { receivedCents = cents(req.body.received) } catch (error) { fail(error.message) }
      if (receivedCents <= 0) fail('Informe o valor recebido agora.')
      if (!['now', 'last'].includes(req.body.issMode ?? 'last')) fail('Escolha quando o ISS retido sai.')
      const issNow = req.body.issMode === 'now' ? row.issCents || 0 : 0, portionCents = receivedCents + issNow
      if (portionCents >= row.valueCents) fail(`O valor recebido deve ser menor que o saldo de ${money(row.valueCents - issNow)}${issNow ? ' (já descontado o ISS deste recebimento)' : ''}. Para receber tudo, use a baixa total.`)
      if (row.valueCents - portionCents <= (row.issCents || 0) - issNow) fail('O saldo restante ficaria menor ou igual ao ISS que ainda falta sair. Escolha o ISS neste recebimento ou use a baixa total.')
      const balanceDueDate = req.body.balanceDueDate || row.dueDate
      if (!validDate(balanceDueDate)) fail('Informe um vencimento válido para o saldo.')
      const data = receipt({ date: req.body.date, method: req.body.method, note: req.body.note, bankId: req.body.bankId, iss: issNow ? (issNow / 100).toFixed(2) : '' }, portionCents, false, 0, store)
      data.receipts = claimFiles(store, req.body.fileIds || [], req.actor)
      store.receivableSequence = (store.receivableSequence || 0) + 1
      const { partialPaidCents, partialIssCents, partialIds, ...base } = row
      const child = { ...base, id: `REC-${String(store.receivableSequence).padStart(6, '0')}`, valueCents: portionCents, issCents: issNow, kind: 'single', recurrence: null, groupId: null, installmentNumber: 1, installmentCount: 1, seriesId: null, seriesIndex: null, seriesCount: null, originalTotalCents: portionCents, attachments: [], receipt: data, partialOf: row.id, inactive: false, createdAt: new Date().toISOString(), lastStatus: 'received' }
      const dueBefore = row.dueDate
      Object.assign(row, { valueCents: row.valueCents - portionCents, issCents: (row.issCents || 0) - issNow, dueDate: balanceDueDate, partialPaidCents: (row.partialPaidCents || 0) + portionCents, partialIssCents: (row.partialIssCents || 0) + issNow, partialIds: [...(row.partialIds || []), child.id] })
      row.lastStatus = receivableStatus(row)
      store.receivables.push(child)
      event(store, req.actor, 'created', child.id, { details: { valueCents: portionCents, dueDate: dueBefore, partialOf: row.id, text: `Recebimento parcial de ${row.id}` } })
      event(store, req.actor, 'received', child.id, { details: { ...data, partialOf: row.id } })
      for (const file of data.receipts) event(store, req.actor, 'attachment_added', child.id, { details: { name: file.name, receipt: true } })
      event(store, req.actor, 'partial_received', row.id, { details: { partialId: child.id, valueCents: portionCents, receivedCents, issCents: issNow, balanceCents: row.valueCents, dueDateBefore: dueBefore, dueDateAfter: balanceDueDate, date: data.date, text: `Recebimento parcial de ${money(receivedCents)}${issNow ? ` (com ISS de ${money(issNow)})` : ''}; saldo de ${money(row.valueCents)} com vencimento em ${dateLabel(balanceDueDate)}` } })
      return { item: view(row, store), partial: view(child, store) }
    })
    res.status(201).json(result)
  }))
  router.post('/receivables/bulk', handle(async (req, res) => {
    // Excluir, Desfazer baixa and Alterar classificação: preview first, then the confirmation with the preview token.
    if (bulkActions.includes(req.body.action)) {
      if (req.body.preview === true) { const store = await readStore(); init(store); return res.json({ preview: receivableBulkPlan(store, req.body).preview }) }
      return res.json(await mutateStore((store) => { init(store); const planned = receivableBulkPlan(store, req.body); assertSamePreview(req.body, planned.preview, fail); return applyReceivableBulk(store, req.actor, req.body, planned) }))
    }
    const items = await mutateStore((store) => {
      init(store)
      if (req.body.action !== 'receive') fail('Ação inválida.')
      if (!Array.isArray(req.body.ids) || !req.body.ids.length || new Set(req.body.ids).size !== req.body.ids.length) fail('Selecione contas válidas.')
      const rows = req.body.ids.map((id) => find(store, id))
      if (rows.some((row) => row.receipt || row.inactive)) fail('Selecione apenas contas ainda não recebidas.', 409)
      const data = rows.map((row) => receipt(req.body, row.valueCents, true, row.issCents || 0, store))
      rows.forEach((row, index) => { row.receipt = data[index]; row.lastStatus = 'received'; event(store, req.actor, 'received', row.id, { details: { ...data[index], bulk: true } }) })
      return rows.map((row) => view(row, store))
    })
    res.json({ items })
  }))
  // Files up to the attachment limit (uploads.js): written to the disk first, then recorded; a record that is not saved removes its file.
  // Reads the invoices of a PDF (NFS-e or DANFE, one or more per file). Nothing is posted here: the user checks what was
  // read and saves each account with POST /receivables; the PDF of each invoice waits as an upload to be attached.
  router.post('/receivables/invoice-import', handle(async (req, res) => {
    const name = path.basename(clean(req.query.name, 200)) || 'notas.pdf', sourceId = randomUUID()
    const received = await receiveFile(req, directory, sourceId, { ...uploadLimits(), maxBytes: Math.min(uploadLimits().maxBytes, IMPORT_LIMIT) })
    if (!received) fail('Selecione um arquivo PDF.')
    const files = []
    try {
      const bytes = await fs.readFile(path.join(directory, sourceId))
      if (bytes.subarray(0, 1024).indexOf('%PDF') < 0) fail('O arquivo não é um PDF.')
      const { notes, problems } = await readInvoices(bytes)
      const pageCount = notes.reduce((sum, note) => sum + note.pages.length, 0) + problems.length
      for (const note of notes) {
        const whole = note.pages.length === pageCount
        const file = { id: whole ? sourceId : randomUUID(), name: whole ? name : `${invoiceLabel[note.kind]} ${note.number || `pág. ${note.pages.join('-')}`}.pdf`.replace(/[\\/:*?"<>|]/g, '-'), contentType: 'application/pdf', userId: req.actor.id }
        if (!whole) await fs.writeFile(path.join(directory, file.id), await invoicePdf(bytes, note.pages, pageCount))
        file.size = whole ? received.size : (await fs.stat(path.join(directory, file.id))).size
        files.push(file); note.file = { id: file.id, name: file.name }
      }
      if (!files.some((file) => file.id === sourceId)) await received.discard()
      const items = await mutateStore((store) => {
        init(store); store.receivableUploads.push(...files)
        return notes.map((note) => ({ ...note, label: invoiceLabel[note.kind], source: name, duplicateOf: postedInvoice(store, note)?.id || null }))
      })
      res.json({ source: name, items, problems })
    } catch (error) {
      await received.discard()
      for (const file of files) if (file.id !== sourceId) await fs.rm(path.join(directory, file.id), { force: true }).catch(() => {})
      throw error
    }
  }))
  // Files read for an import and not posted: only the user's own uploads still waiting are removed.
  router.post('/receivables/uploads/discard', handle(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : []
    const removed = await mutateStore((store) => {
      init(store)
      const mine = store.receivableUploads.filter((file) => ids.includes(file.id) && String(file.userId) === String(req.actor.id))
      store.receivableUploads = store.receivableUploads.filter((file) => !mine.includes(file))
      return mine.map((file) => file.id)
    })
    for (const id of removed) await fs.rm(path.join(directory, id), { force: true }).catch(() => {})
    res.json({ removed: removed.length })
  }))
  router.post('/receivables/uploads', handle(async (req, res) => {
    const file = { id: randomUUID(), name: path.basename(clean(req.query.name, 200)), contentType: clean(req.query.type, 160) || 'application/octet-stream', userId: req.actor.id }
    if (!file.name) fail('Nome de arquivo inválido.')
    const received = await receiveFile(req, directory, file.id)
    if (!received) fail('Selecione um arquivo.')
    file.size = received.size
    await mutateStore((store) => { init(store); store.receivableUploads.push(file) }).catch(async (error) => { await received.discard(); throw error })
    res.status(201).json({ item: { id: file.id } })
  }))
  router.post('/receivables/:id/files', handle(async (req, res) => {
    const file = { id: randomUUID(), name: path.basename(clean(req.query.name, 200)), contentType: clean(req.query.type, 160) || 'application/octet-stream' }
    if (!file.name) fail('Nome de arquivo inválido.')
    const received = await receiveFile(req, directory, file.id)
    if (!received) fail('Selecione um arquivo.')
    file.size = received.size
    await mutateStore((store) => {
      init(store); const row = find(store, req.params.id)
      if (row.receipt && !treasuryEntry(row)) fail('Estorne o recebimento antes de alterar os anexos.', 409)
      row.attachments = [...(row.attachments || []), file]; event(store, req.actor, 'attachment_added', row.id, { details: { name: file.name } })
    }).catch(async (error) => { await received.discard(); throw error })
    res.status(201).json({ item: file })
  }))
  router.get('/receivables/:id/files/:fileId', handle(async (req, res) => {
    const store = await readStore(); init(store); const row = find(store, req.params.id)
    const file = [...(row.attachments || []), ...(row.receipt?.receipts || [])].find((item) => item.id === req.params.fileId)
    if (!file) fail('Arquivo não encontrado.', 404)
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    await sendStoredFile(res, path.join(directory, file.id))
  }))
  router.delete('/receivables/:id/files/:fileId', handle(async (req, res) => {
    await mutateStore((store) => {
      init(store); const row = find(store, req.params.id)
      if (row.receipt && !treasuryEntry(row)) fail('Estorne o recebimento antes de alterar os anexos.', 409)
      const file = (row.attachments || []).find((item) => item.id === req.params.fileId)
      if (!file) fail('Arquivo não encontrado.', 404)
      row.attachments = row.attachments.filter((item) => item.id !== file.id); event(store, req.actor, 'attachment_removed', row.id, { details: { name: file.name } })
    })
    res.json({ ok: true })
  }))
  router.post('/receivables/:id/reverse', handle(async (req, res) => {
    const item = await mutateStore((store) => { init(store); return view(reverseReceivable(store, req.actor, find(store, req.params.id), clean(req.body.reason)), store) })
    res.json({ item })
  }))
  router.delete('/receivables/:id', handle(async (req, res) => {
    const removed = await mutateStore((store) => {
      init(store); const row = find(store, req.params.id), group = groupOf(store, row)
      const block = deletionBlock(store, row, group)
      if (block) fail(block.message, block.status)
      // "Só esta" or "esta e as demais"; without a choice an installment plan goes as a whole, as before.
      const all = req.query.scope ? req.query.scope === 'all' : Boolean(row.groupId)
      const targets = !all ? [row] : row.groupId ? group : deletableOthers(store, row)
      const plan = row.groupId ? 'Parcelamento' : row.seriesId ? 'Recorrência' : ''
      for (const item of targets) event(store, req.actor, 'deleted', item.id, { details: { account: item, text: plan && targets.length > 1 ? `${plan} excluído (${targets.length} contas)` : plan ? `${plan}: só esta conta excluída` : '' } })
      store.receivables = store.receivables.filter((item) => !targets.includes(item))
      renumberReceivables(store, row)
      return targets.map((item) => item.id)
    })
    res.json({ ok: true, removed })
  }))
  router.post('/receivables/export', handle(async (req, res) => {
    const store = await readStore(); init(store)
    if (!['pdf', 'xlsx'].includes(req.body.format)) fail('Formato inválido.')
    if (req.body.ids !== undefined && !Array.isArray(req.body.ids)) fail('Seleção inválida.')
    const rows = req.body.id ? [find(store, req.body.id)] : filterReceivables(store.receivables, req.body.filters).filter((row) => !req.body.ids || req.body.ids.includes(row.id))
    // The summary exists for the spreadsheet only; the PDF stays the complete one.
    const variant = req.body.variant === 'summary' && req.body.format === 'xlsx' && !req.body.id ? 'summary' : 'full'
    const data = receivablesReport(rows.map((row) => ({ ...row, classificationName: classificationNameOf(store, row) })), req.body.filters, Boolean(req.body.id), store, variant)
    const output = req.body.format === 'pdf' ? await exportPdf(data) : await exportWorkbook(data)
    res.setHeader('Content-Type', req.body.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="gmac-contas-a-receber${variant === 'summary' ? '-resumo' : ''}.${req.body.format}"`)
    res.send(Buffer.from(output))
  }))
  return router
}
