import express from 'express'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { readStore, mutateStore } from './offers.js'
import { receiveFile, sendStoredFile } from './uploads.js'
import { dataDirectory } from './dataDirectory.js'
import { addNotification } from './notificationEvents.js'
import { createMailer } from './passwordReset.js'
import { DESCRIPTION_MAX, RESOLUTION_MAX, TITLE_MAX, moduleLabel, ticketModules, ticketUrgencies, urgencyLabel } from './ticketRules.js'

// Tickets de suporte: administrators and administrative employees report problems of the portal to its developers.
// Everybody sees every ticket; the attachments (evidence of the problem) open for administrators and, for an
// administrative employee, only on the tickets they opened. Only the developers, the accounts of these CPFs, close and
// reopen a ticket; an account registered later with one of them becomes a developer without any change here.
export const developerCpfs = ['02427847550', '14303355640']
// A new ticket is also e-mailed to the developers (SUPPORT_TICKET_EMAILS, separated by commas, replaces the list).
export const ticketEmailRecipients = ['by.cmlla0107@gmail.com', 'Gustavo_Assuncao02@outlook.com']
export const ticketFilesDirectory = path.join(dataDirectory, 'support-ticket-files')
// A file sent from the form whose ticket was never saved (window closed, error) is removed after a day.
const STALE_UPLOAD_MS = 24 * 3600000

const digits = (value) => String(value ?? '').replace(/\D/g, '')
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const clean = (value, limit) => String(value ?? '').trim().slice(0, limit)
const multiline = (value, limit) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, limit)
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const bahiaTime = (at) => new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })
const init = (store) => { store.supportTickets ||= []; store.supportTicketUploads ||= [] }
const sameId = (left, right) => String(left) === String(right)
export const isDeveloper = (account, cpfs = developerCpfs) => Boolean(account?.cpf) && cpfs.includes(digits(account.cpf))

// What one viewer receives of a ticket: the files only when they may open them; otherwise how many there are.
function ticketView(ticket, viewer) {
  const own = sameId(ticket.createdBy, viewer.id)
  const files = viewer.role !== 'staff' || own
  const { email, ...rest } = ticket
  return { ...rest, own, attachments: files ? ticket.attachments || [] : [], attachmentCount: (ticket.attachments || []).length, attachmentsLocked: !files && (ticket.attachments || []).length > 0, ...(viewer.developer ? { email: email || null } : {}) }
}

function ticketMail(ticket, recipients) {
  const files = ticket.attachments || []
  const rows = [['Ticket', ticket.id], ['Urgência', urgencyLabel(ticket.urgency)], ['Módulo', moduleLabel(ticket.module)], ['Aberto por', ticket.createdByName], ['Data e hora', `${bahiaTime(ticket.createdAt)} (horário da Bahia)`], ['Título', ticket.title]]
  const fileLine = files.length ? `${files.length} ${files.length === 1 ? 'anexo' : 'anexos'}: ${files.map((file) => file.name).join(', ')}` : 'Sem anexos'
  return {
    to: recipients.join(', '),
    subject: `Portal GMAC: novo ticket ${ticket.id} (urgência: ${urgencyLabel(ticket.urgency)}) · ${ticket.title}`,
    text: `Um novo ticket de suporte foi aberto no Portal GMAC.\n\n${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\nDescrição:\n${ticket.description}\n\n${fileLine}. Os anexos abrem no portal, no menu Ticket.`,
    html: `<p>Um novo ticket de suporte foi aberto no Portal GMAC.</p><table cellpadding="4" style="border-collapse:collapse">${rows.map(([label, value]) => `<tr><th align="left" style="padding-right:12px">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</table><p><strong>Descrição</strong></p><p style="white-space:pre-wrap">${escapeHtml(ticket.description)}</p><p>${escapeHtml(fileLine)}. Os anexos abrem no portal, no menu Ticket.</p>`,
  }
}

export default function createSupportTicketsRouter(accounts, requireAdmin, { mailer = createMailer(), env = process.env, cpfs = developerCpfs } = {}) {
  const router = express.Router()
  const recipients = () => {
    const configured = String(env.SUPPORT_TICKET_EMAILS || '').split(',').map((item) => item.trim()).filter(Boolean)
    return configured.length ? configured : ticketEmailRecipients
  }
  router.use('/support-tickets', requireAdmin, async (request, _response, next) => {
    try {
      const actor = await accounts.account(request.adminId)
      if (!actor) fail('Entre novamente para usar os tickets.', 401)
      request.viewer = { id: actor.id, name: actor.name, role: actor.role, developer: isDeveloper(actor, cpfs) }
      next()
    } catch (error) { next(error) }
  })
  const handle = (fn) => async (req, res, next) => { try { await fn(req, res) } catch (error) { next(error) } }
  const find = (store, id) => store.supportTickets.find((item) => item.id === id) || fail('Ticket não encontrado.', 404)
  const developerIds = async () => (await Promise.all(cpfs.map((cpf) => accounts.accountByCpf(cpf)))).filter(Boolean).map((account) => account.id)

  // The e-mail goes after the ticket is saved and does not hold the answer: its outcome is written on the ticket, where
  // the developers see it.
  async function emailTicket(ticket) {
    let email
    try {
      if (!mailer.configured()) email = { skippedAt: new Date().toISOString(), reason: 'SMTP não configurado no servidor.' }
      else {
        const to = recipients()
        await mailer.send(ticketMail(ticket, to))
        email = { sentAt: new Date().toISOString(), to }
      }
    } catch (error) {
      console.error(`Falha ao enviar o e-mail do ticket ${ticket.id}:`, error.message)
      email = { failedAt: new Date().toISOString(), reason: 'O servidor de e-mail recusou ou não respondeu.' }
    }
    await mutateStore((store) => { init(store); const row = store.supportTickets.find((item) => item.id === ticket.id); if (row) row.email = email })
      .catch((error) => console.error(`Falha ao registrar o e-mail do ticket ${ticket.id}:`, error.message))
  }

  router.get('/support-tickets', handle(async (req, res) => {
    const store = await readStore(); init(store)
    const items = [...store.supportTickets].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).map((ticket) => ticketView(ticket, req.viewer))
    res.set('Cache-Control', 'no-store').json({ items, viewer: req.viewer })
  }))

  // Files up to the attachment limit (uploads.js): written to the disk first, then recorded, and claimed by the ticket.
  router.post('/support-tickets/uploads', handle(async (req, res) => {
    const file = { id: randomUUID(), name: path.basename(clean(req.query.name, 200)), contentType: clean(req.query.type, 160) || 'application/octet-stream', userId: req.viewer.id, at: new Date().toISOString() }
    if (!file.name) fail('Nome de arquivo inválido.')
    const received = await receiveFile(req, ticketFilesDirectory, file.id)
    if (!received) fail('Selecione um arquivo.')
    file.size = received.size
    const stale = await mutateStore((store) => {
      init(store)
      const old = store.supportTicketUploads.filter((item) => Date.now() - Date.parse(item.at || 0) > STALE_UPLOAD_MS)
      store.supportTicketUploads = [...store.supportTicketUploads.filter((item) => !old.includes(item)), file]
      return old
    }).catch(async (error) => { await received.discard(); throw error })
    for (const item of stale) await rm(path.join(ticketFilesDirectory, item.id), { force: true }).catch(() => {})
    res.status(201).json({ item: { id: file.id } })
  }))

  router.post('/support-tickets', handle(async (req, res) => {
    const urgency = clean(req.body.urgency, 20), module = clean(req.body.module, 40)
    if (!ticketUrgencies.some(([key]) => key === urgency)) fail('Escolha o grau de urgência: baixo, médio ou alto.')
    if (!ticketModules.some(([key]) => key === module)) fail('Escolha o módulo do sistema onde está o problema.')
    const title = clean(req.body.title, TITLE_MAX).replace(/\s+/g, ' ')
    if (!title) fail('Dê um título ao ticket.')
    const description = multiline(req.body.description, DESCRIPTION_MAX)
    if (!description) fail('Descreva o problema.')
    const fileIds = req.body.fileIds ?? []
    if (!Array.isArray(fileIds) || new Set(fileIds).size !== fileIds.length) fail('Anexos inválidos.')
    const notify = await developerIds()
    const ticket = await mutateStore((store) => {
      init(store)
      const attachments = fileIds.map((id) => {
        const file = store.supportTicketUploads.find((item) => item.id === id && sameId(item.userId, req.viewer.id))
        if (!file) fail('Anexo inválido ou já utilizado. Envie o arquivo novamente.')
        return { id: file.id, name: file.name, contentType: file.contentType, size: file.size, uploadedAt: file.at }
      })
      store.supportTicketUploads = store.supportTicketUploads.filter((item) => !fileIds.includes(item.id))
      store.supportTicketSequence = Math.max(store.supportTicketSequence || 0, store.supportTickets.length) + 1
      const at = new Date().toISOString()
      const row = { id: `TCK-${String(store.supportTicketSequence).padStart(4, '0')}`, urgency, module, title, description, attachments, status: 'open', createdAt: at, createdBy: req.viewer.id, createdByName: req.viewer.name, createdByRole: req.viewer.role, history: [{ type: 'opened', at, userId: req.viewer.id, userName: req.viewer.name }] }
      store.supportTickets.push(row)
      addNotification(store, { id: `ticket-opened:${row.id}`, type: 'ticket-opened', at, ticketId: row.id, authorId: req.viewer.id, recipientIds: notify, title: `Novo ticket ${row.id} · urgência: ${urgencyLabel(urgency)}`, description: `${moduleLabel(module)} · ${title}`, employeeName: req.viewer.name })
      return row
    })
    emailTicket(ticket)
    res.status(201).json({ item: ticketView(ticket, req.viewer) })
  }))

  // Administrators open every attachment; an administrative employee only those of the tickets they opened.
  router.get('/support-tickets/:id/files/:fileId', handle(async (req, res) => {
    const store = await readStore(); init(store)
    const ticket = find(store, req.params.id)
    if (req.viewer.role === 'staff' && !sameId(ticket.createdBy, req.viewer.id)) fail('Os anexos deste ticket abrem só para quem o abriu e para os administradores.', 403)
    const file = (ticket.attachments || []).find((item) => item.id === req.params.fileId) || fail('Arquivo não encontrado.', 404)
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    await sendStoredFile(res, path.join(ticketFilesDirectory, file.id))
  }))

  // Closing asks how the problem was solved, and the answer shows on the ticket; a closed ticket can be reopened.
  router.post('/support-tickets/:id/status', handle(async (req, res) => {
    if (!req.viewer.developer) fail('Somente os desenvolvedores do sistema alteram o status do ticket.', 403)
    const status = req.body.status
    if (!['open', 'closed'].includes(status)) fail('Status inválido.')
    const note = multiline(req.body.note, RESOLUTION_MAX)
    if (status === 'closed' && !note) fail('Escreva a resposta: como o problema foi resolvido.')
    const item = await mutateStore((store) => {
      init(store)
      const ticket = find(store, req.params.id)
      if (ticket.status === status) fail(status === 'closed' ? 'Este ticket já está fechado.' : 'Este ticket já está aberto.', 409)
      const at = new Date().toISOString(), by = { userId: req.viewer.id, userName: req.viewer.name }
      ticket.status = status
      if (status === 'closed') Object.assign(ticket, { closedAt: at, closedBy: req.viewer.id, closedByName: req.viewer.name, resolution: note })
      else { delete ticket.closedAt; delete ticket.closedBy; delete ticket.closedByName; delete ticket.resolution }
      ticket.history = [...(ticket.history || []), { type: status === 'closed' ? 'closed' : 'reopened', at, ...by, ...(note ? { note } : {}) }]
      addNotification(store, { type: 'ticket-status', at, ticketId: ticket.id, authorId: req.viewer.id, recipientIds: [ticket.createdBy], title: `Ticket ${ticket.id} ${status === 'closed' ? 'fechado' : 'reaberto'}`, description: ticket.title, employeeName: req.viewer.name })
      return ticket
    })
    res.json({ item: ticketView(item, req.viewer) })
  }))
  return router
}
