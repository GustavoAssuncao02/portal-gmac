import express from 'express'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { dataDirectory } from './dataDirectory.js'
import { readStore, mutateStore } from './offers.js'
import { receiveFile, sendStoredFile, uploadLimits } from './uploads.js'
import { readInvoices, invoicePdf } from './invoiceImport.js'
import { invoiceDuplicates, invoiceLabel, orderValue, postInvoiceAccount, receivableSummaries, receivablesDeleteBlock, removeReceivables } from './receivables.js'
import { classificationList } from './accountPlan.js'
import { operationStates } from './reportData.js'
import { labelQuoteRequired } from './labelQuoteRules.js'
import { recordOrderEvent } from './orderHistory.js'
import { cents } from './payableRules.js'

// NF-e da OS (2026-11-28): the third kind of attachment of an OS, after "Anexos da OS" and "Anexos administrativos". It is
// the PDF of the invoice issued for the service, in one of the layouts Contas a Receber already reads (server/
// invoiceImport.js). It is imported only once every piece is done (operation completed); each note read is checked by the
// user and becomes the account receivable of the OS, with the PDF attached, and the OS is concluded (the browser then
// calls acknowledge-completion). A possible duplicate is the user's call: post anyway, only attach, or cancel. Like the
// administrative attachments, administrators and administrative employees use it and operators never see it.
const fail = (message, status = 400, extra) => { throw Object.assign(new Error(message), { status, ...(extra ? { extra } : {}) }) }
const clean = (value, limit = 1000) => String(value ?? '').trim().slice(0, limit)
const digits = (value) => String(value ?? '').replace(/\D/g, '')
const filesDirectory = path.join(dataDirectory, 'files')
const accountFilesDirectory = path.join(dataDirectory, 'receivable-files')
const IMPORT_LIMIT = 50 * 1024 * 1024
export const invoiceNotCompleted = 'A OS não está concluída, não é possível importar a NF-e.'
export const invoiceNotRead = 'Não foi possível ler uma nota fiscal neste PDF. O portal lê a NFS-e de Feira de Santana (modelo antigo e novo), a DANFSe da NFS-e nacional e o DANFE da NF-e: confira se o arquivo é o PDF da nota emitida.'

const init = (store) => { store.orders ||= []; store.orderInvoiceUploads ||= [] }
function orderOf(store, code) {
  const order = (store.orders || []).find((item) => item.code === code)
  if (!order) fail('OS não encontrada.', 404)
  return order
}
// What the OS shows of each NF-e: the file and the accounts it generated that still exist.
const invoiceView = (store, invoice) => {
  const accounts = receivableSummaries(store, invoice.receivableIds || [])
  return { ...invoice, accounts, existing: receivableSummaries(store, invoice.existingReceivableIds || []), deleteBlock: accounts.length ? receivablesDeleteBlock(store, accounts.map((row) => row.id)) : null }
}

export default function createOrderInvoicesRouter({ pool, requireAdmin, accounts }) {
  const router = express.Router()
  // A prefix: it covers every route below (Express 4).
  router.use('/orders/:code/invoices', requireAdmin, async (request, _response, next) => {
    try { request.actor = await accounts.account(request.adminId); if (!request.actor) fail('Administrador não encontrado.', 401); next() } catch (error) { next(error) }
  })
  const handle = (task) => async (request, response, next) => { try { await task(request, response) } catch (error) { next(error) } }
  // With the database, the state of the operation lives in order_operations, not in the saved order.
  async function operationOf(order) {
    if (pool) {
      const [row] = await operationStates([order], pool)
      if (row) return typeof row.data === 'string' ? JSON.parse(row.data) : row.data
    }
    return order.operation || null
  }
  async function assertReady(order) {
    const operation = await operationOf(order)
    if (operation?.status !== 'completed') fail(invoiceNotCompleted, 409)
    if (order.labelQuote?.pending) fail(labelQuoteRequired, 409)
    return operation
  }
  const clientsList = async () => { try { return (await accounts.clients()).map((row) => ({ id: String(row.id), name: row.name, document: digits(row.document) })) } catch { return [] } }

  router.get('/orders/:code/invoices', handle(async (request, response) => {
    const store = await readStore(); init(store)
    const order = orderOf(store, request.params.code)
    const operation = await operationOf(order)
    response.set('Cache-Control', 'no-store').json({
      order: { code: order.code, offerId: order.offerId, company: order.company, cnpj: digits(order.cnpj), service: order.service, labelNumber: order.labelNumber || '', ...orderValue(order), completed: operation?.status === 'completed', concluded: Boolean(operation?.completionAcknowledgedAt), labelQuotePending: Boolean(order.labelQuote?.pending), invoiceSkipped: order.invoiceSkipped || null },
      invoices: (order.invoices || []).map((invoice) => invoiceView(store, invoice)),
      classifications: classificationList(store).filter((item) => !item.inactive && !item.groupInactive && item.nature !== 'expense'),
      clients: await clientsList(),
    })
  }))

  // Reads the PDF of the invoice(s). Nothing is posted here: the user checks what was read; the PDF of each note waits as an
  // upload of this OS. A PDF without any note the portal can read is refused.
  router.post('/orders/:code/invoices/read', handle(async (request, response) => {
    const before = await readStore(); init(before)
    const order = orderOf(before, request.params.code)
    await assertReady(order)
    const name = path.basename(clean(request.query.name, 200)) || 'nota.pdf', sourceId = randomUUID()
    const received = await receiveFile(request, filesDirectory, sourceId, { ...uploadLimits(), maxBytes: Math.min(uploadLimits().maxBytes, IMPORT_LIMIT) })
    if (!received) fail('Selecione o PDF da NF-e.')
    const files = []
    try {
      const bytes = await fs.readFile(path.join(filesDirectory, sourceId))
      if (bytes.subarray(0, 1024).indexOf('%PDF') < 0) fail('O arquivo não é um PDF. Selecione o PDF da NF-e.')
      let read
      try { read = await readInvoices(bytes) } catch { fail(invoiceNotRead) }
      const { notes, problems } = read
      if (!notes.length) fail(invoiceNotRead)
      const pageCount = notes.reduce((sum, note) => sum + note.pages.length, 0) + problems.length
      for (const note of notes) {
        const whole = note.pages.length === pageCount
        const file = { id: whole ? sourceId : randomUUID(), name: whole ? name : `${invoiceLabel[note.kind]} ${note.number || `pág. ${note.pages.join('-')}`}.pdf`.replace(/[\\/:*?"<>|]/g, '-'), contentType: 'application/pdf' }
        if (!whole) await fs.writeFile(path.join(filesDirectory, file.id), await invoicePdf(bytes, note.pages, pageCount))
        file.size = whole ? received.size : (await fs.stat(path.join(filesDirectory, file.id))).size
        files.push(file); note.file = { id: file.id, name: file.name }
      }
      if (!files.some((file) => file.id === sourceId)) await received.discard()
      const clients = await clientsList()
      const items = await mutateStore((store) => {
        init(store)
        store.orderInvoiceUploads.push(...files.map((file, index) => ({ ...file, orderCode: order.code, userId: request.actor.id, kind: notes[index].kind, at: new Date().toISOString() })))
        return notes.map((note) => ({
          ...note, label: invoiceLabel[note.kind], source: name,
          client: clients.find((client) => note.customerDocument && client.document === note.customerDocument) || null,
          duplicates: invoiceDuplicates(store, order.code, { documentNumber: note.documentNumber, customerName: note.customerName, customerDocument: note.customerDocument, valueCents: note.valueCents, dueDates: (note.installments || []).map((part) => part.dueDate) }),
        }))
      })
      response.json({ source: name, items, problems })
    } catch (error) {
      await received.discard()
      for (const file of files) if (file.id !== sourceId) await fs.rm(path.join(filesDirectory, file.id), { force: true }).catch(() => {})
      throw error
    }
  }))

  // Notes read and not attached (window closed, note taken out of the list): only the user's own uploads of this OS.
  router.post('/orders/:code/invoices/discard', handle(async (request, response) => {
    const ids = Array.isArray(request.body?.ids) ? request.body.ids.map(String) : []
    const removed = await mutateStore((store) => {
      init(store)
      const mine = store.orderInvoiceUploads.filter((file) => ids.includes(file.id) && file.orderCode === request.params.code && String(file.userId) === String(request.actor.id))
      store.orderInvoiceUploads = store.orderInvoiceUploads.filter((file) => !mine.includes(file))
      return mine.map((file) => file.id)
    })
    for (const id of removed) await fs.rm(path.join(filesDirectory, id), { force: true }).catch(() => {})
    response.json({ removed: removed.length })
  }))

  // Attaches the notes checked by the user. `mode` of each note: 'post' generates its account receivable (a possible
  // duplicate is refused with the accounts found until the user confirms it with `allowDuplicate`), 'attach' only keeps the
  // PDF on the OS. The OS is concluded by the browser right after (acknowledge-completion).
  router.post('/orders/:code/invoices', handle(async (request, response) => {
    const notes = Array.isArray(request.body?.notes) ? request.body.notes.slice(0, 20) : []
    if (!notes.length) fail('Selecione o PDF da NF-e.')
    const before = await readStore(); init(before)
    await assertReady(orderOf(before, request.params.code))
    const clients = await clientsList()
    // The PDF goes to the OS and a copy to each account (they are removed apart).
    const copies = new Map()
    try {
      for (const note of notes) {
        const upload = before.orderInvoiceUploads.find((file) => file.id === String(note?.fileId) && file.orderCode === request.params.code && String(file.userId) === String(request.actor.id))
        if (!upload) fail('A NF-e lida não está mais disponível. Selecione o PDF de novo.', 409)
        if (note.mode !== 'attach') {
          const id = randomUUID()
          await fs.mkdir(accountFilesDirectory, { recursive: true })
          await fs.copyFile(path.join(filesDirectory, upload.id), path.join(accountFilesDirectory, id))
          copies.set(upload.id, { id, name: upload.name, contentType: 'application/pdf', size: upload.size })
        }
      }
      const result = await mutateStore(async (store) => {
        init(store)
        const order = orderOf(store, request.params.code)
        const actorName = request.actor.name || request.adminName || 'Administrador'
        // Every possible duplicate is checked before anything is posted (two notes of the same OS would match each other).
        const prepared = notes.map((note) => {
          const upload = store.orderInvoiceUploads.find((file) => file.id === String(note.fileId) && file.orderCode === order.code && String(file.userId) === String(request.actor.id))
          if (!upload) fail('A NF-e lida não está mais disponível. Selecione o PDF de novo.', 409)
          const client = clients.find((item) => item.id === String(note.clientId))
          const installments = Array.isArray(note.installments) ? note.installments : []
          let valueCents = 0
          try { valueCents = cents(note.value || '0') } catch { valueCents = 0 }
          const duplicates = invoiceDuplicates(store, order.code, { documentNumber: note.documentNumber, customerName: client?.name || '', customerDocument: client?.document || '', valueCents, dueDates: installments.map((part) => part.dueDate) })
          return { note, upload, duplicates, valueCents }
        })
        const pending = prepared.find(({ note, duplicates }) => note.mode !== 'attach' && duplicates.length && note.allowDuplicate !== true)
        if (pending) fail(`Possível lançamento duplicado: a ${invoiceLabel[pending.upload.kind] || 'NF-e'} ${clean(pending.note.documentNumber, 40)} pode já estar em ${pending.duplicates.map((row) => row.id).join(', ')}.`, 409, { duplicate: true, fileId: pending.upload.id, matches: pending.duplicates })
        const added = []
        for (const { note, upload, duplicates, valueCents } of prepared) {
          const kind = upload.kind === 'nfe' ? 'nfe' : 'nfse'
          const receivableIds = note.mode === 'attach' ? [] : await postInvoiceAccount(store, request.actor, accounts, order, { ...note, kind, duplicateOf: duplicates.map((row) => row.id) }, copies.get(upload.id))
          const invoice = { id: upload.id, name: upload.name, size: upload.size, contentType: 'application/pdf', kind, label: invoiceLabel[kind], number: clean(note.documentNumber, 160), valueCents, uploadedAt: new Date().toISOString(), uploadedBy: actorName, receivableIds, existingReceivableIds: note.mode === 'attach' ? duplicates.map((row) => row.id) : [] }
          order.invoices = [...(order.invoices || []), invoice]
          store.orderInvoiceUploads = store.orderInvoiceUploads.filter((file) => file.id !== upload.id)
          recordOrderEvent(order, 'invoice_added', actorName, `${invoice.label} ${invoice.number} anexada${receivableIds.length ? `: conta a receber ${receivableIds.join(', ')}` : invoice.existingReceivableIds.length ? `, sem gerar conta a receber (já lançada em ${invoice.existingReceivableIds.join(', ')})` : ', sem gerar conta a receber'}.`)
          added.push(invoice)
        }
        // With its NF-e, an OS concluded without one is not "Sem NF-e" anymore.
        delete order.invoiceSkipped
        order.updatedAt = new Date().toISOString()
        return { items: added.map((invoice) => invoiceView(store, invoice)), invoices: order.invoices.map((invoice) => invoiceView(store, invoice)) }
      })
      response.status(201).json(result)
    } catch (error) {
      for (const copy of copies.values()) await fs.rm(path.join(accountFilesDirectory, copy.id), { force: true }).catch(() => {})
      throw error
    }
  }))

  router.get('/orders/:code/invoices/:fileId', handle(async (request, response) => {
    const store = await readStore()
    const file = orderOf(store, request.params.code).invoices?.find((item) => item.id === request.params.fileId)
    if (!file) fail('NF-e não encontrada.', 404)
    response.setHeader('Content-Type', 'application/pdf')
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    await sendStoredFile(response, path.join(filesDirectory, file.id))
  }))

  // Taking an NF-e out: the user chooses, with two boxes, whether the PDF leaves the OS and whether the accounts it
  // generated are deleted (an account with a receipt or reconciled stays, as everywhere in Contas a Receber).
  router.post('/orders/:code/invoices/:fileId/remove', handle(async (request, response) => {
    const removeFile = request.body?.file === true, removeAccounts = request.body?.receivables === true
    if (!removeFile && !removeAccounts) fail('Marque o que deseja remover: a NF-e, a conta a receber ou as duas.')
    const result = await mutateStore((store) => {
      init(store)
      const order = orderOf(store, request.params.code)
      const invoice = order.invoices?.find((item) => item.id === request.params.fileId)
      if (!invoice) fail('NF-e não encontrada.', 404)
      const actorName = request.actor.name || request.adminName || 'Administrador'
      const deleted = removeAccounts && invoice.receivableIds?.length ? removeReceivables(store, request.actor, invoice.receivableIds, `Excluída com a ${invoice.label} ${invoice.number} da ${order.code}`) : []
      if (removeAccounts) invoice.receivableIds = []
      if (removeFile) order.invoices = order.invoices.filter((item) => item !== invoice)
      recordOrderEvent(order, 'invoice_removed', actorName, [removeFile ? `${invoice.label} ${invoice.number} removida da OS` : `${invoice.label} ${invoice.number} mantida na OS`, deleted.length ? `conta a receber excluída: ${deleted.join(', ')}` : removeAccounts ? 'nenhuma conta a receber para excluir' : 'conta a receber mantida'].join('; ') + '.')
      order.updatedAt = new Date().toISOString()
      return { deleted, invoices: (order.invoices || []).map((item) => invoiceView(store, item)) }
    })
    if (removeFile) await fs.rm(path.join(filesDirectory, request.params.fileId), { force: true }).catch(() => {})
    response.json(result)
  }))
  return router
}

// Reopening an OS may take its NF-e along (the user chooses): the files are removed after the change is saved.
export async function removeInvoiceFiles(files = []) {
  for (const file of files) await fs.rm(path.join(filesDirectory, file.id), { force: true }).catch(() => {})
}
