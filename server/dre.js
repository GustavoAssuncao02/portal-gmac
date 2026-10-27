import express from 'express'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { readStore, mutateStore } from './offers.js'
import { receiveFile, sendStoredFile } from './uploads.js'
import { dataDirectory } from './dataDirectory.js'
import { cents, shiftMonth, classificationParts, todayBahia } from './payableRules.js'
import { classificationList, entryClassification } from './accountPlan.js'
import { natureOf } from './accountPlanRules.js'
import { repeatedValues } from './dreRules.js'
import { drePdf, dreWorkbook } from './dreExport.js'

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const clean = (value, limit = 1000) => String(value ?? '').trim().slice(0, limit)
const directory = path.join(dataDirectory, 'dre-adjustment-files')
const init = (store) => { store.dreAdjustments ||= []; store.dreAdjustmentUploads ||= [] }
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/
export const addMonths = (month, count) => shiftMonth(`${month}-01`, count).slice(0, 7)
export function monthsBetween(start, end) {
  const months = []
  for (let month = start; month <= end; month = addMonths(month, 1)) months.push(month)
  return months
}

// Every amount that reaches the DRE, signed by its effect on the result (+ revenue, − expense; money outside the result
// keeps the direction it moved). `view` 'cash' places the accounts on the day the money moved, so only what was paid or
// received counts; 'accrual' (competência) places them on the issue date, paid or not. Interest and discounts happen on
// the settlement, in both views; the ISS withheld goes with its revenue. DRE adjustments count in both views.
export function dreEntries(store, view, from, to) {
  const classifications = new Map((store.classifications || []).map((item) => [item.id, item]))
  const suppliers = new Map((store.suppliers || []).map((row) => [String(row.id), row.name]))
  const settings = store.dreSettings || {}, list = []
  function add(date, classificationId, amount, fallback, entry) {
    if (!amount || !date || date.slice(0, 7) < from || date.slice(0, 7) > to) return
    const classification = classifications.get(classificationId), nature = classification ? natureOf(classification) : 'both'
    const sign = nature === 'revenue' ? 1 : nature === 'expense' ? -1 : fallback
    list.push({ date, month: date.slice(0, 7), classificationId: classification ? classification.id : null, valueCents: sign * amount, ...entry })
  }
  for (const row of store.payables || []) {
    const entry = (kind) => ({ source: 'payable', kind, refId: row.id, name: suppliers.get(String(row.supplierId)) || row.supplierName || '', description: row.description || '', documentNumber: row.documentNumber || '' })
    const payment = row.payment, date = view === 'cash' ? payment?.date : row.issueDate
    for (const part of classificationParts(row)) add(date, part.classificationId, part.valueCents, -1, entry('principal'))
    if (payment) { add(payment.date, settings.interestPaid, payment.interestCents, -1, entry('interest')); add(payment.date, settings.discountReceived, payment.discountCents, 1, entry('discount')) }
  }
  for (const row of store.receivables || []) {
    if (row.inactive) continue
    const entry = (kind) => ({ source: 'receivable', kind, refId: row.id, name: row.customerName || '', description: row.description || '', documentNumber: row.documentNumber || '' })
    const receipt = row.receipt, date = view === 'cash' ? receipt?.date : row.issueDate
    add(date, row.classificationId, row.valueCents, 1, entry('principal'))
    add(date, settings.iss, receipt ? receipt.issCents : view === 'cash' ? 0 : row.issCents, -1, entry('iss'))
    if (receipt) { add(receipt.date, settings.interestReceived, receipt.interestCents, 1, entry('interest')); add(receipt.date, settings.discountGiven, receipt.discountCents, -1, entry('discount')) }
  }
  for (const row of store.dreAdjustments || []) add(`${row.month}-01`, row.classificationId, row.valueCents, -1, { source: 'adjustment', kind: 'adjustment', refId: row.id, name: 'Ajuste da DRE', description: row.description || '', documentNumber: '' })
  return list.sort((a, b) => a.date.localeCompare(b.date) || a.refId.localeCompare(b.refId))
}

// The lines of the DRE, top to bottom. The result lines add up every section above them.
const sections = [
  { key: 'gross_revenue', label: '(+) Receita bruta', lines: ['gross_revenue'], nature: 'revenue' },
  { key: 'deductions', label: '(−) Deduções da receita', lines: ['deductions'], nature: 'expense' },
  { key: 'net_revenue', label: '(=) Receita líquida', result: true },
  { key: 'costs', label: '(−) Custos de produção', lines: ['costs'], nature: 'expense' },
  { key: 'gross_profit', label: '(=) Lucro bruto', result: true },
  { key: 'operating', label: '(−) Despesas operacionais', lines: ['operating'], nature: 'expense' },
  { key: 'operating_result', label: '(=) Resultado operacional', result: true },
  { key: 'financial', label: '(±) Resultado financeiro', lines: ['financial_revenue', 'financial_expense'], nature: 'both' },
  { key: 'pretax', label: '(=) Resultado antes do IRPJ e da CSLL', result: true },
  { key: 'income_tax', label: '(−) IRPJ e CSLL', lines: ['income_tax'], nature: 'expense' },
  { key: 'tax_charges', label: '(−) Multas, juros e parcelamentos tributários', lines: ['tax_charges'], nature: 'expense' },
  { key: 'net_income', label: '(=) Lucro líquido', result: true },
]

// The DRE of the months from `start` to `end` (YYYY-MM). The values also cover the month before `start`, for the
// comparison with the previous month. Inactive classifications only appear when they have values.
export function dreReport(store, { view, start, end }) {
  const months = monthsBetween(start, end), previousMonth = addMonths(start, -1), all = [previousMonth, ...months]
  const entries = dreEntries(store, view, previousMonth, end), list = classificationList(store)
  const empty = () => Object.fromEntries(all.map((month) => [month, 0]))
  const sums = new Map()
  for (const entry of entries) {
    if (!entry.classificationId) continue
    const values = sums.get(entry.classificationId) || empty()
    values[entry.month] += entry.valueCents
    sums.set(entry.classificationId, values)
  }
  const sum = (rows) => { const values = empty(); for (const row of rows) for (const month of all) values[month] += row.values[month]; return values }
  const shown = (lines) => list.filter((item) => lines.includes(item.dreLine) && (!item.inactive && !item.groupInactive || sums.has(item.id)))
  // A section with classifications of more than one group (administrative and commercial expenses) shows each group's subtotal.
  function block(key, label, type, items, nature) {
    const lines = items.map((item) => ({ key: item.id, type: 'line', label: item.name, code: item.code, classificationId: item.id, groupId: item.groupId, nature: item.nature, values: sums.get(item.id) || empty() }))
    const groups = [...new Set(items.map((item) => item.groupId))]
    const head = { key, type, label, nature, values: sum(lines), depth: 0 }
    if (type === 'info') for (const row of lines) row.outside = true
    if (groups.length < 2) return [head, ...lines.map((row) => ({ ...row, depth: 1 }))]
    return [head, ...groups.flatMap((groupId) => {
      const own = lines.filter((row) => row.groupId === groupId), first = items.find((item) => item.groupId === groupId)
      return [{ key: `${key}:${groupId}`, type: 'group', label: first.groupName, code: first.groupCode, nature, values: sum(own), depth: 1 }, ...own.map((row) => ({ ...row, depth: 2 }))]
    })]
  }
  const rows = [], result = empty()
  for (const section of sections) {
    if (section.result) { rows.push({ key: section.key, type: 'result', label: section.label, nature: 'both', values: { ...result }, depth: 0 }); continue }
    const part = block(section.key, section.label, 'section', shown(section.lines), section.nature)
    for (const month of all) result[month] += part[0].values[month]
    rows.push(...part)
  }
  rows.push(...block('outside', 'Movimentações fora do resultado (não entram no lucro)', 'info', shown(['outside']), 'both'))
  const inPeriod = (values) => months.reduce((total, month) => total + values[month], 0)
  const revenue = inPeriod(rows[0].values)
  for (const row of rows) { row.total = inPeriod(row.values); row.percent = revenue && row.type !== 'info' && !row.outside ? row.total / revenue * 100 : null }
  // The entries of the month before come along: the single month view compares with it and opens its entries too.
  const unclassified = entries.filter((entry) => !entry.classificationId && months.includes(entry.month))
  return { view, start, end, months, previousMonth, rows, entries, unclassified: { count: unclassified.length, inCents: unclassified.filter((entry) => entry.valueCents > 0).reduce((total, entry) => total + entry.valueCents, 0), outCents: -unclassified.filter((entry) => entry.valueCents < 0).reduce((total, entry) => total + entry.valueCents, 0) }, generatedAt: new Date().toISOString() }
}

function period(source) {
  const view = source.view === 'accrual' ? 'accrual' : 'cash', start = clean(source.start, 7) || todayBahia().slice(0, 7), end = clean(source.end, 7) || start
  if (!monthPattern.test(start) || !monthPattern.test(end) || start > end) fail('Informe um período válido: o mês inicial não pode vir depois do mês final.')
  if (monthsBetween(start, end).length > 36) fail('Escolha um período de até 36 meses.')
  return { view, start, end }
}

// Ajustes da DRE: amounts that do not go through the bank (depreciation, provisions for vacation and the 13th salary)
// posted straight to a month of the DRE. A reversal is negative. They count in both views and never touch Tesouraria.
function adjustmentFields(store, body, current) {
  const month = clean(body.month, 7)
  if (!monthPattern.test(month)) fail('Informe o mês de competência do ajuste.')
  const item = entryClassification(store, body.classificationId, 'adjustment', current ? [current.classificationId] : [])
  if (!item) fail('Selecione uma classificação ativa da DRE (as movimentações fora do resultado não recebem ajustes).')
  let valueCents
  try { valueCents = cents(body.value) } catch (error) { fail(error.message) }
  if (!valueCents) fail('O valor deve ser maior que zero.')
  const description = clean(body.description, 1000)
  if (!description) fail('Descreva o ajuste (ex.: depreciação das máquinas de outubro).')
  return { month, classificationId: item.id, classificationName: item.name, valueCents: body.reversal === true ? -valueCents : valueCents, description }
}
function variationOf(value) {
  if (value === undefined || value === null || value === '') return 0
  const number = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(number) || number <= -100 || number > 100) fail('A variação por mês deve ficar entre -99,99% e 100%.')
  return number
}
function adjustmentView(store, row) {
  const item = (store.classifications || []).find((entry) => entry.id === row.classificationId)
  return { ...row, attachments: row.attachments || [], classificationName: item?.name || row.classificationName, classificationCode: item?.code || '', nature: item ? natureOf(item) : 'expense' }
}
function claimFiles(store, ids, actor) {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) fail('Anexos inválidos.')
  const files = ids.map((id) => { const file = store.dreAdjustmentUploads.find((item) => item.id === id && String(item.userId) === String(actor.id)); if (!file) fail('Anexo inválido ou já utilizado.'); const { userId, ...safe } = file; return safe })
  store.dreAdjustmentUploads = store.dreAdjustmentUploads.filter((item) => !ids.includes(item.id))
  return files
}

export default function createDreRouter(accounts, requireAdmin) {
  const router = express.Router()
  router.use(['/dre', '/dre-adjustments'], requireAdmin, async (request, _response, next) => { try { request.actor = await accounts.account(request.adminId); if (!request.actor) fail('Administrador não encontrado.', 401); next() } catch (error) { next(error) } })
  const handle = (fn) => async (req, res, next) => { try { await fn(req, res) } catch (error) { next(error) } }
  const find = (store, id) => { const row = store.dreAdjustments.find((item) => item.id === id); if (!row) fail('Ajuste não encontrado.', 404); return row }

  router.get('/dre', handle(async (req, res) => { res.set('Cache-Control', 'no-store').json(dreReport(await readStore(), period(req.query))) }))
  router.post('/dre/export', handle(async (req, res) => {
    if (!['pdf', 'xlsx'].includes(req.body.format)) fail('Formato inválido.')
    const store = await readStore(), report = dreReport(store, period(req.body))
    const output = req.body.format === 'pdf' ? await drePdf(report) : await dreWorkbook(report, classificationList(store))
    res.setHeader('Content-Type', req.body.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="gmac-dre-${report.start}${report.end === report.start ? '' : `-a-${report.end}`}.${req.body.format}"`)
    res.send(Buffer.from(output))
  }))

  router.get('/dre-adjustments', handle(async (_req, res) => {
    const store = await readStore(); init(store)
    res.json({ items: store.dreAdjustments.map((row) => adjustmentView(store, row)).sort((a, b) => b.month.localeCompare(a.month) || b.id.localeCompare(a.id)), classifications: classificationList(store) })
  }))
  router.post('/dre-adjustments', handle(async (req, res) => {
    const items = await mutateStore((store) => {
      init(store)
      const data = adjustmentFields(store, req.body), repeat = Number(req.body.repeat ?? 1)
      if (!Number.isInteger(repeat) || repeat < 1 || repeat > 60) fail('Repita o ajuste por 1 a 60 meses.')
      const values = repeatedValues(data.valueCents, repeat, variationOf(req.body.variation))
      if (values.some((value) => !value)) fail('Com essa variação o ajuste chegaria a zero; diminua a variação ou a quantidade de meses.')
      const files = claimFiles(store, req.body.fileIds || [], req.actor)
      const seriesId = repeat > 1 ? randomUUID() : null, at = new Date().toISOString(), by = req.actor.name || 'Sistema'
      return values.map((valueCents, index) => {
        store.dreAdjustmentSequence = (store.dreAdjustmentSequence || 0) + 1
        const row = { ...data, id: `AJ-${String(store.dreAdjustmentSequence).padStart(6, '0')}`, month: addMonths(data.month, index), valueCents, seriesId, seriesIndex: seriesId ? index + 1 : null, seriesCount: seriesId ? repeat : null, attachments: index ? [] : files, createdAt: at, createdBy: by, updatedAt: at, updatedBy: by }
        store.dreAdjustments.push(row)
        return adjustmentView(store, row)
      })
    }); res.status(201).json({ items })
  }))
  router.put('/dre-adjustments/:id', handle(async (req, res) => {
    const item = await mutateStore((store) => {
      init(store); const row = find(store, req.params.id)
      Object.assign(row, adjustmentFields(store, req.body, row), { updatedAt: new Date().toISOString(), updatedBy: req.actor.name || 'Sistema' })
      row.attachments = [...(row.attachments || []), ...claimFiles(store, req.body.fileIds || [], req.actor)]
      return adjustmentView(store, row)
    }); res.json({ item })
  }))
  // `scope=following` also removes the next months of a repeated adjustment.
  router.delete('/dre-adjustments/:id', handle(async (req, res) => {
    const removed = await mutateStore((store) => {
      init(store); const row = find(store, req.params.id)
      const gone = req.query.scope === 'following' && row.seriesId ? store.dreAdjustments.filter((item) => item.seriesId === row.seriesId && item.month >= row.month) : [row]
      store.dreAdjustments = store.dreAdjustments.filter((item) => !gone.includes(item))
      return gone.map((item) => item.id)
    }); res.json({ ok: true, ids: removed })
  }))
  // Files of any size: written to the disk first, then recorded; a record that is not saved removes its file.
  router.post('/dre-adjustments/uploads', handle(async (req, res) => {
    const file = { id: randomUUID(), name: path.basename(clean(req.query.name, 200)), contentType: clean(req.query.type, 160) || 'application/octet-stream', userId: req.actor.id }
    if (!file.name) fail('Nome de arquivo inválido.')
    const received = await receiveFile(req, directory, file.id)
    if (!received) fail('Selecione um arquivo.')
    file.size = received.size
    await mutateStore((store) => { init(store); store.dreAdjustmentUploads.push(file) }).catch(async (error) => { await received.discard(); throw error })
    res.status(201).json({ item: { id: file.id } })
  }))
  router.get('/dre-adjustments/:id/files/:fileId', handle(async (req, res) => {
    const store = await readStore(); init(store)
    const file = (find(store, req.params.id).attachments || []).find((item) => item.id === req.params.fileId)
    if (!file) fail('Arquivo não encontrado.', 404)
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    await sendStoredFile(res, path.join(directory, file.id))
  }))
  router.delete('/dre-adjustments/:id/files/:fileId', handle(async (req, res) => {
    await mutateStore((store) => {
      init(store); const row = find(store, req.params.id)
      if (!(row.attachments || []).some((item) => item.id === req.params.fileId)) fail('Arquivo não encontrado.', 404)
      row.attachments = row.attachments.filter((item) => item.id !== req.params.fileId)
    }); res.json({ ok: true })
  }))
  return router
}
