import express from 'express'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readStore, mutateStore } from './offers.js'
import { parseOfx, normalizeText, operationLabels } from './ofx.js'
import { DAY } from './payableRules.js'

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'bank-statements')
// The portal serves a single company; the scope keeps FITID keys from colliding if more companies are added.
export const companyScope = () => process.env.COMPANY_SCOPE || 'gmac'
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ')
const dateLabel = (value) => value ? value.split('-').reverse().join('/') : ''
const init = (store) => { store.bankAccounts ||= []; store.bankImports ||= []; store.bankTransactions ||= []; store.bankBalances ||= []; store.bankConflicts ||= []; store.bankEvents ||= []; store.bankSettings ||= { dateToleranceDays: 3 }; store.payables ||= []; store.receivables ||= [] }
const transactionKey = (account, fitId) => [account.companyScope, account.bankId, account.accountId, fitId].join('|')
const daysBetween = (a, b) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / DAY)

export function reconciledTransaction(store, kind, recordId) {
  return (store.bankTransactions || []).find((row) => row.reconciliation?.kind === kind && row.reconciliation.recordId === recordId) || null
}
export function assertNotReconciled(store, kind, recordId, action = 'alterar') {
  const row = reconciledTransaction(store, kind, recordId)
  if (row) fail(`Este registro está conciliado com a movimentação bancária de ${dateLabel(row.bankDate)} (${money(Math.abs(row.amountCents))}). Desfaça a conciliação antes de ${action}.`, 409)
}

const STOPWORDS = new Set(['LTDA', 'S', 'SA', 'A', 'DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'ME', 'EPP', 'EIRELI', 'CIA', 'I', 'C', 'P', 'L', 'T'])
const tokens = (value) => new Set(normalizeText(value).replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter((word) => word.length > 1 && !STOPWORDS.has(word)))
export function nameSimilarity(a, b) {
  const left = tokens(a), right = tokens(b)
  if (!left.size || !right.size) return 0
  const shared = [...left].filter((word) => right.has(word)).length
  return shared / Math.min(left.size, right.size)
}

function financialRecords(store, kind) {
  // Both the settlement date (when there is one) and the due date are compared with the bank date.
  const dates = (settledOn, settledKind, dueDate) => [...(settledOn ? [{ date: settledOn, kind: settledKind }] : []), { date: dueDate, kind: 'vencimento' }]
  if (kind === 'payable') return store.payables.filter((row) => !row.inactive).map((row) => ({ kind, id: row.id, name: row.supplierName, document: (store.suppliers || []).find((item) => String(item.id) === String(row.supplierId))?.document || null, valueCents: row.payment ? row.payment.finalCents : row.valueCents, date: row.payment?.date || row.dueDate, dateKind: row.payment ? 'pagamento' : 'vencimento', dates: dates(row.payment?.date, 'pagamento', row.dueDate), description: row.description, settled: Boolean(row.payment) }))
  return store.receivables.filter((row) => !row.inactive).map((row) => ({ kind, id: row.id, name: row.customerName, document: row.customerDocument || null, valueCents: row.receipt ? row.receipt.finalCents : row.valueCents, date: row.receipt?.date || row.dueDate, dateKind: row.receipt ? 'recebimento' : 'vencimento', dates: dates(row.receipt?.date, 'recebimento', row.dueDate), description: row.description, settled: Boolean(row.receipt) }))
}

// Evidence ladder: value is always exact; document, name and date only add confidence. Nothing is chosen automatically.
// Same CPF/CNPJ with a date outside the tolerance (up to 90 days) is still offered, as the weakest level, for the user to check.
const OUTSIDE_TOLERANCE_DAYS = 90
export function reconciliationCandidates(store, transaction, toleranceDays = store.bankSettings?.dateToleranceDays ?? 3) {
  const kind = transaction.direction === 'out' ? 'payable' : transaction.direction === 'in' ? 'receivable' : null
  if (!kind) return { kind, candidates: [], ambiguous: false, toleranceDays }
  const amount = Math.abs(transaction.amountCents)
  const taken = new Set(store.bankTransactions.filter((row) => row.reconciliation && row.id !== transaction.id).map((row) => `${row.reconciliation.kind}:${row.reconciliation.recordId}`))
  const candidates = []
  for (const record of financialRecords(store, kind)) {
    if (record.valueCents !== amount || taken.has(`${kind}:${record.id}`)) continue
    const nearest = record.dates.map((item) => ({ ...item, days: daysBetween(item.date, transaction.bankDate) })).sort((a, b) => a.days - b.days)[0]
    const days = nearest.days
    const documentMatch = Boolean(transaction.counterpartyDocument && record.document && record.document === transaction.counterpartyDocument)
    const similarity = transaction.counterpartyName ? nameSimilarity(transaction.counterpartyName, record.name) : 0
    const level = documentMatch && days === 0 ? 1 : documentMatch && days <= toleranceDays ? 2 : similarity >= 0.6 && days <= toleranceDays ? 3 : days === 0 ? 4 : documentMatch && days <= OUTSIDE_TOLERANCE_DAYS ? 5 : null
    if (!level) continue
    const reasons = [`Valor exato: ${money(amount)}`]
    if (documentMatch) reasons.push(`${record.document.length === 14 ? 'CNPJ' : 'CPF'} coincide com o histórico bancário`)
    if (!documentMatch && similarity >= 0.6) reasons.push(`Nome semelhante: "${transaction.counterpartyName}" × "${record.name}"`)
    reasons.push(days === 0 ? `Mesma data de ${nearest.kind}` : level === 5 ? `Data de ${nearest.kind} a ${days} dias do banco, fora da tolerância de ${toleranceDays}: confira antes de conciliar` : `Data de ${nearest.kind} a ${days} dia${days === 1 ? '' : 's'} (tolerância de ${toleranceDays})`)
    const { dates: _dates, ...summary } = record
    candidates.push({ ...summary, date: nearest.date, dateKind: nearest.kind, level, strength: { 1: 'Forte', 2: 'Boa', 3: 'Média', 4: 'Fraca', 5: 'Conferir data' }[level], days, reasons })
  }
  candidates.sort((a, b) => a.level - b.level || a.days - b.days || a.id.localeCompare(b.id))
  const best = candidates[0]?.level
  return { kind, candidates, ambiguous: candidates.filter((row) => row.level === best).length > 1, toleranceDays }
}

// The statement balance warning only appears above R$ 10,00 (company's choice); the difference itself stays in the validation.
const DIVERGENCE_WARNING_CENTS = 1000
// Stored warnings stay complete for audit; this is what the screens show. A header declaring another encoding over valid UTF-8 changes nothing for the user.
export function visibleWarnings(item) {
  return (item.warnings || []).filter((row) => row.code !== 'encoding-mismatch' && (row.code !== 'balance-divergence' || Math.abs(item.validation?.differenceCents || 0) > DIVERGENCE_WARNING_CENTS))
}

function snapshot(row) { return { bankDate: row.bankDate, amountCents: row.amountCents, memo: row.memo } }
function event(store, actor, type, details = {}) { store.bankEvents.push({ id: randomUUID(), at: new Date().toISOString(), type, userId: actor?.id ?? null, userName: actor?.name || 'Sistema', ...details }) }

export function applyImport(store, parsed, file, actor) {
  init(store)
  const scope = companyScope()
  const { statement } = parsed
  let account = store.bankAccounts.find((row) => row.companyScope === scope && row.bankId === statement.bankId && row.accountId === statement.accountId)
  if (!account) {
    account = { id: randomUUID(), companyScope: scope, bankId: statement.bankId, branchId: statement.branchId, accountId: statement.accountId, accountType: statement.accountType, currency: statement.currency, createdAt: new Date().toISOString() }
    store.bankAccounts.push(account)
  }
  store.bankImportSequence = (store.bankImportSequence || 0) + 1
  const importId = `EXT-${String(store.bankImportSequence).padStart(6, '0')}`
  const counts = { records: parsed.records.length, transactions: parsed.transactions.length, balances: parsed.balances.length, credits: parsed.validation.creditCount, debits: parsed.validation.debitCount, new: 0, existing: 0, conflicts: 0, duplicatesInFile: 0, invalid: parsed.records.length - parsed.transactions.length - parsed.balances.length, balancesNew: 0, balancesExisting: 0 }
  const transactions = new Map(store.bankTransactions.map((row) => [row.key, row]))
  const balances = new Map(store.bankBalances.map((row) => [row.key, row]))
  const inFile = new Map()
  const conflict = (key, existing, incoming, collection) => {
    const fields = ['bankDate', 'amountCents', 'memo'].filter((field) => existing[field] !== incoming[field])
    const open = store.bankConflicts.find((row) => row.key === key && row.status === 'open' && JSON.stringify(row.incoming) === JSON.stringify(snapshot(incoming)))
    if (!open) store.bankConflicts.push({ id: randomUUID(), key, collection, bankAccountId: account.id, fitId: incoming.fitId, importId, existingId: existing.id || null, existing: snapshot(existing), incoming: snapshot(incoming), fields, status: 'open', at: new Date().toISOString() })
    counts.conflicts++
  }
  for (const row of parsed.transactions) {
    const key = transactionKey(account, row.fitId)
    const sameFile = inFile.get(key)
    if (sameFile) { if (JSON.stringify(snapshot(sameFile)) === JSON.stringify(snapshot(row))) counts.duplicatesInFile++; else conflict(key, sameFile, row, 'transaction'); continue }
    inFile.set(key, row)
    const existing = transactions.get(key)
    if (existing) {
      if (JSON.stringify(snapshot(existing)) === JSON.stringify(snapshot(row))) { counts.existing++; if (!existing.importIds.includes(importId)) existing.importIds.push(importId) }
      else conflict(key, existing, row, 'transaction')
      continue
    }
    const created = { id: randomUUID(), key, companyScope: scope, bankAccountId: account.id, importId, importIds: [importId], position: row.position, fitId: row.fitId, checkNum: row.checkNum, trnType: row.trnType, postedRaw: row.postedRaw, bankDate: row.bankDate, postedTime: row.posted.time, postedOffset: row.posted.offset, amountCents: row.amountCents, direction: row.direction, typeConsistency: row.consistency, memo: row.memo, normalizedMemo: row.normalizedMemo, operationType: row.operationType, counterpartyName: row.counterpartyName, counterpartyNameNormalized: row.counterpartyName ? normalizeText(row.counterpartyName) : null, counterpartyReference: row.counterpartyReference, counterpartyDocument: row.counterpartyDocument, documentType: row.documentType, raw: row.raw, reconciliation: null, createdAt: new Date().toISOString() }
    store.bankTransactions.push(created); transactions.set(key, created); counts.new++
  }
  for (const row of parsed.balances) {
    const key = transactionKey(account, row.fitId)
    const existing = balances.get(key)
    if (existing) {
      if (JSON.stringify(snapshot(existing)) === JSON.stringify(snapshot(row))) { counts.balancesExisting++; if (!existing.importIds.includes(importId)) existing.importIds.push(importId) }
      else conflict(key, existing, row, 'balance')
      continue
    }
    const created = { id: randomUUID(), key, bankAccountId: account.id, importId, importIds: [importId], position: row.position, fitId: row.fitId, checkNum: row.checkNum, trnType: row.trnType, kind: row.kind, postedRaw: row.postedRaw, bankDate: row.bankDate, amountCents: row.amountCents, memo: row.memo, raw: row.raw }
    store.bankBalances.push(created); balances.set(key, created); counts.balancesNew++
  }
  const warnings = parsed.warnings.map((warning) => ({ ...warning, level: 'info' }))
  const { validation } = parsed
  if (validation.differenceCents) warnings.unshift({ code: 'balance-divergence', level: 'warning', message: `Divergência de saldo do extrato: ${money(Math.abs(validation.differenceCents))}.`, detail: `Saldo informado pelo banco (LEDGERBAL) ${money(validation.ledgerCents)} − saldo calculado pelas movimentações ${money(validation.computedFinalCents)} = ${money(validation.differenceCents)}. Nenhum lançamento de ajuste foi criado.` })
  if (validation.openingCents == null) warnings.push({ code: 'no-opening-balance', level: 'warning', message: 'O extrato não traz o registro SALDO ANTERIOR; os saldos diários não puderam ser validados.' })
  for (const day of validation.days.filter((row) => row.matches === false)) warnings.push({ code: 'daily-balance-divergence', level: 'warning', message: `Saldo do dia ${dateLabel(day.date)}: calculado ${money(day.closingCents)}, informado ${money(day.reportedCents)}.` })
  if (counts.conflicts) warnings.push({ code: 'conflicts', level: 'warning', message: `${counts.conflicts} registro${counts.conflicts === 1 ? '' : 's'} com FITID já importado e dados diferentes. Nada foi substituído; confira os conflitos.` })
  const sameFile = store.bankImports.filter((row) => row.fileSha256 === file.sha256).map((row) => row.id)
  const record = { id: importId, bankAccountId: account.id, fileName: file.name, fileSha256: file.sha256, fileSize: file.size, sameFileImportIds: sameFile, encoding: parsed.encoding, header: parsed.header, period: { start: parsed.statement.start, end: parsed.statement.end }, ledgerBalance: statement.ledgerBalance, availableBalance: statement.availableBalance, counts, validation, warnings, importedAt: new Date().toISOString(), userId: actor?.id ?? null, userName: actor?.name || 'Sistema' }
  store.bankImports.push(record)
  event(store, actor, 'imported', { importId, details: { fileName: file.name, new: counts.new, existing: counts.existing, conflicts: counts.conflicts } })
  return record
}

function transactionView(store, row) {
  const reconciliation = row.reconciliation && { ...row.reconciliation, record: financialRecords(store, row.reconciliation.kind).find((item) => item.id === row.reconciliation.recordId) || null }
  return { ...row, operationLabel: operationLabels[row.operationType] || row.operationType, reconciliation }
}

export default function createBankStatementsRouter(accounts, requireAdmin) {
  const router = express.Router()
  router.use('/bank-statements', requireAdmin, async (request, _response, next) => { try { request.actor = (await accounts.admins()).find((item) => String(item.id) === String(request.adminId)); if (!request.actor) fail('Administrador não encontrado.', 401); next() } catch (error) { next(error) } })
  const handle = (fn) => async (req, res, next) => { try { await fn(req, res) } catch (error) { next(error) } }
  router.get('/bank-statements', handle(async (_req, res) => {
    const store = await readStore(); init(store)
    res.json({ accounts: store.bankAccounts, imports: [...store.bankImports].reverse().map(({ header, ...row }) => ({ ...row, warnings: visibleWarnings(row) })), transactions: store.bankTransactions.map((row) => transactionView(store, row)), balances: store.bankBalances, conflicts: store.bankConflicts, settings: store.bankSettings, operationLabels })
  }))
  router.post('/bank-statements/import', express.raw({ type: 'application/octet-stream', limit: '10mb' }), handle(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) fail('Selecione um arquivo OFX com até 10 MB.')
    const name = path.basename(String(req.query.name || 'extrato.ofx')).slice(0, 200)
    let parsed
    try { parsed = parseOfx(req.body) } catch (error) { fail(error.status ? error.message : `Não foi possível ler o arquivo OFX: ${error.message}`) }
    const file = { name, size: req.body.length, sha256: createHash('sha256').update(req.body).digest('hex') }
    const record = await mutateStore(async (store) => {
      const result = applyImport(store, parsed, file, req.actor)
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, `${result.id}.ofx`), req.body)
      return result
    })
    res.status(201).json({ item: { ...record, warnings: visibleWarnings(record) } })
  }))
  router.put('/bank-statements/settings', handle(async (req, res) => {
    const days = Number(req.body.dateToleranceDays)
    if (!Number.isInteger(days) || days < 0 || days > 30) fail('Informe uma tolerância de 0 a 30 dias.')
    const settings = await mutateStore((store) => { init(store); const before = store.bankSettings.dateToleranceDays; store.bankSettings.dateToleranceDays = days; event(store, req.actor, 'settings', { details: { before, after: days } }); return store.bankSettings })
    res.json({ settings })
  }))
  router.get('/bank-statements/transactions/:id/candidates', handle(async (req, res) => {
    const store = await readStore(); init(store)
    const row = store.bankTransactions.find((item) => item.id === req.params.id)
    if (!row) fail('Movimentação não encontrada.', 404)
    res.json(reconciliationCandidates(store, row))
  }))
  router.post('/bank-statements/transactions/:id/reconcile', handle(async (req, res) => {
    const item = await mutateStore((store) => {
      init(store)
      const row = store.bankTransactions.find((entry) => entry.id === req.params.id)
      if (!row) fail('Movimentação não encontrada.', 404)
      if (row.reconciliation) fail('Esta movimentação já está conciliada.', 409)
      const kind = row.direction === 'out' ? 'payable' : row.direction === 'in' ? 'receivable' : null
      if (!kind || req.body.kind !== kind) fail(row.direction === 'out' ? 'Saídas só podem ser conciliadas com contas a pagar.' : 'Entradas só podem ser conciliadas com contas a receber.')
      const record = financialRecords(store, kind).find((entry) => entry.id === req.body.recordId)
      if (!record) fail('Registro financeiro não encontrado ou desativado.', 404)
      if (record.valueCents !== Math.abs(row.amountCents)) fail('A conciliação integral exige valor exato. Conciliações parciais ou agrupadas não são suportadas.', 409)
      const other = reconciledTransaction(store, kind, record.id)
      if (other) fail(`Este registro já está conciliado com a movimentação de ${dateLabel(other.bankDate)}.`, 409)
      const evidence = reconciliationCandidates(store, row).candidates.find((entry) => entry.id === record.id)
      row.reconciliation = { kind, recordId: record.id, level: evidence?.level ?? null, reasons: evidence?.reasons || [`Valor exato: ${money(record.valueCents)}`, 'Vínculo confirmado manualmente'], at: new Date().toISOString(), userId: req.actor.id, userName: req.actor.name }
      event(store, req.actor, 'reconciled', { transactionId: row.id, fitId: row.fitId, details: { kind, recordId: record.id } })
      return transactionView(store, row)
    })
    res.json({ item })
  }))
  router.delete('/bank-statements/transactions/:id/reconcile', handle(async (req, res) => {
    const item = await mutateStore((store) => {
      init(store)
      const row = store.bankTransactions.find((entry) => entry.id === req.params.id)
      if (!row) fail('Movimentação não encontrada.', 404)
      if (!row.reconciliation) fail('Esta movimentação não está conciliada.', 409)
      event(store, req.actor, 'unreconciled', { transactionId: row.id, fitId: row.fitId, details: { ...row.reconciliation } })
      row.reconciliation = null
      return transactionView(store, row)
    })
    res.json({ item })
  }))
  router.post('/bank-statements/conflicts/:id/review', handle(async (req, res) => {
    const item = await mutateStore((store) => {
      init(store)
      const row = store.bankConflicts.find((entry) => entry.id === req.params.id)
      if (!row) fail('Conflito não encontrado.', 404)
      row.status = 'reviewed'; row.reviewedAt = new Date().toISOString(); row.reviewedBy = req.actor.name
      event(store, req.actor, 'conflict_reviewed', { conflictId: row.id, fitId: row.fitId })
      return row
    })
    res.json({ item })
  }))
  return router
}
