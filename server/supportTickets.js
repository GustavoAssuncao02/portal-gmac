import express from 'express'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { readStore, mutateStore } from './offers.js'
import { receiveFile, sendStoredFile } from './uploads.js'
import { dataDirectory } from './dataDirectory.js'
import { addNotification } from './notificationEvents.js'
import { createMailer } from './passwordReset.js'
import { COMMENT_MAX, DESCRIPTION_MAX, RESOLUTION_MAX, TITLE_MAX, moduleLabel, moduleTitle, submodulesOf, ticketModules, ticketPlace, ticketUrgencies, urgencyLabel } from './ticketRules.js'

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

// What one viewer receives of a ticket: the files only when they may open them; otherwise how many there are. How the
// e-mails went (of the ticket and of each comment) is shown to the developers only.
function ticketView(ticket, viewer) {
  const own = sameId(ticket.createdBy, viewer.id)
  const files = viewer.role !== 'staff' || own
  const { email, ...rest } = ticket
  const comments = (ticket.comments || []).map(({ email: delivery, ...comment }) => viewer.developer ? { ...comment, email: delivery || null } : comment)
  // Tickets of modules that became screens of a group (Estoque → Gestão Operacional) come in the group, like new ones.
  return { ...rest, ...ticketPlace(ticket.module, ticket.submodule), own, comments, attachments: files ? ticket.attachments || [] : [], attachmentCount: (ticket.attachments || []).length, attachmentsLocked: !files && (ticket.attachments || []).length > 0, ...(viewer.developer ? { email: email || null } : {}) }
}

// The e-mails of the tickets are read first on the phone, where only the subject and the start of the text show: the
// subject begins with what happened and the urgency (the same colors of the Ticket screen), the text begins with the
// subject of the ticket and, in a reply, the reply itself; who wrote comes after.
const urgencyMarks = {
  high: { dot: '🔴', word: 'alta', color: '#c5221f', background: '#fce8e6' },
  medium: { dot: '🟠', word: 'média', color: '#b45309', background: '#fff4e5' },
  low: { dot: '🔵', word: 'baixa', color: '#1a5ea0', background: '#e8f1fc' },
}
const urgencyMark = (key) => urgencyMarks[key] || urgencyMarks.low
const urgencyText = (key) => `${urgencyMark(key).dot} Urgência ${urgencyMark(key).word}`
const kinds = {
  opened: { label: 'Novo ticket', color: '#1f7a45', background: '#e6f4ec' },
  reply: { label: 'Nova resposta', color: '#0c4c91', background: '#e8f1fc' },
  support: { label: 'Resposta do suporte', color: '#5b3a9e', background: '#f0ebfa' },
}
const shortText = (value, limit = 160) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > limit ? `${text.slice(0, limit - 1)}…` : text }

function ticketEmail({ kind, ticket, preview, facts, messageLabel, message, greeting = '', closing }) {
  const type = kinds[kind], urgency = urgencyMark(ticket.urgency)
  const text = [preview, '', greeting, `${type.label} · ${ticket.id}`, ticket.title, '', ...facts.map(([label, value]) => `${label}: ${value}`), '', `${messageLabel}:`, message, '', closing].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n').trim()
  const cell = 'font-family:Arial,Helvetica,sans-serif'
  const pill = (label, color, background) => `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${background};color:${color};font-size:12px;font-weight:bold;letter-spacing:.3px">${label}</span>`
  const html = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fa;padding:20px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe3ec;border-radius:10px">
<tr><td style="${cell};padding:18px 22px 6px">${pill(type.label.toUpperCase(), type.color, type.background)}&nbsp;${pill(`${urgency.dot} Urgência ${urgency.word}`, urgency.color, urgency.background)}</td></tr>
${greeting ? `<tr><td style="${cell};padding:10px 22px 0;color:#33475b;font-size:14px">${escapeHtml(greeting)}</td></tr>` : ''}
<tr><td style="${cell};padding:10px 22px 4px;color:#5b6f86;font-size:13px;font-weight:bold">${escapeHtml(ticket.id)}</td></tr>
<tr><td style="${cell};padding:0 22px 14px;color:#12345a;font-size:20px;font-weight:bold;line-height:1.3">${escapeHtml(ticket.title)}</td></tr>
<tr><td style="padding:0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e3e9f0">${facts.map(([label, value]) => `<tr><td style="${cell};padding:7px 12px 7px 0;color:#5b6f86;font-size:13px;width:130px;vertical-align:top">${escapeHtml(label)}</td><td style="${cell};padding:7px 0;color:#1d2f44;font-size:13px;font-weight:bold">${escapeHtml(value)}</td></tr>`).join('')}</table></td></tr>
<tr><td style="${cell};padding:16px 22px 6px;color:#5b6f86;font-size:12px;font-weight:bold;letter-spacing:.4px">${escapeHtml(messageLabel.toUpperCase())}</td></tr>
<tr><td style="padding:0 22px 4px"><div style="${cell};white-space:pre-wrap;padding:12px 14px;border-left:4px solid ${type.color};background:#f6f9fc;color:#1d2f44;font-size:14px;line-height:1.5">${escapeHtml(message)}</div></td></tr>
<tr><td style="${cell};padding:14px 22px 20px;color:#5b6f86;font-size:12px">${escapeHtml(closing)}</td></tr>
</table></td></tr></table>`
  return { text, html }
}

export function ticketMail(ticket, recipients) {
  const files = ticket.attachments || []
  const fileLine = files.length ? `${files.length} ${files.length === 1 ? 'anexo' : 'anexos'}: ${files.map((file) => file.name).join(', ')}` : 'Sem anexos'
  const module = moduleTitle(ticket.module, ticket.submodule)
  return {
    to: recipients.join(', '),
    subject: `Novo ticket · ${urgencyText(ticket.urgency)} · ${ticket.id} · ${ticket.title}`,
    ...ticketEmail({
      kind: 'opened', ticket,
      preview: `${ticket.title} · ${module} · aberto por ${ticket.createdByName}`,
      facts: [['Módulo', module], ['Aberto por', ticket.createdByName], ['Data e hora', `${bahiaTime(ticket.createdAt)} (horário da Bahia)`], ['Anexos', fileLine]],
      messageLabel: 'Descrição', message: ticket.description,
      closing: 'Os anexos e a conversa ficam no Portal GMAC, no menu Ticket.',
    }),
  }
}

// A reply of whoever opened the ticket, e-mailed to the developers (the same list of a new ticket).
export function replyMail(ticket, comment, recipients) {
  return {
    to: recipients.join(', '),
    subject: `Resposta · ${urgencyText(ticket.urgency)} · ${ticket.id} · ${ticket.title}`,
    ...ticketEmail({
      kind: 'reply', ticket,
      preview: `${ticket.title} · ${comment.userName} respondeu: “${shortText(comment.text)}”`,
      facts: [['Módulo', moduleTitle(ticket.module, ticket.submodule)], ['Respondido por', comment.userName], ['Data e hora', `${bahiaTime(comment.at)} (horário da Bahia)`]],
      messageLabel: 'Resposta', message: comment.text,
      closing: 'Veja a conversa completa no Portal GMAC, no menu Ticket.',
    }),
  }
}

// A developer's comment, e-mailed to whoever opened the ticket.
export function commentMail(ticket, comment, author) {
  return {
    to: author.email,
    subject: `Resposta do suporte · ${ticket.id} · ${ticket.title}`,
    ...ticketEmail({
      kind: 'support', ticket, greeting: `Olá, ${author.name}.`,
      preview: `${ticket.title} · ${comment.userName} comentou no seu ticket: “${shortText(comment.text)}”`,
      facts: [['Módulo', moduleTitle(ticket.module, ticket.submodule)], ['Comentado por', comment.userName], ['Data e hora', `${bahiaTime(comment.at)} (horário da Bahia)`]],
      messageLabel: 'Comentário', message: comment.text,
      closing: 'Para responder, abra o Portal GMAC, no menu Ticket.',
    }),
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

  // The e-mails go after the record is saved and do not hold the answer: their outcome is written on the ticket (or on
  // the comment), where the developers see it.
  async function deliver(what, message, save) {
    let email
    try {
      if (!message.to) email = { skippedAt: new Date().toISOString(), reason: 'Quem abriu o ticket não tem e-mail cadastrado.' }
      else if (!mailer.configured()) email = { skippedAt: new Date().toISOString(), reason: 'SMTP não configurado no servidor.' }
      else {
        await mailer.send(message)
        email = { sentAt: new Date().toISOString(), to: message.to }
      }
    } catch (error) {
      console.error(`Falha ao enviar o e-mail ${what}:`, error.message)
      email = { failedAt: new Date().toISOString(), reason: 'O servidor de e-mail recusou ou não respondeu.' }
    }
    await mutateStore((store) => { init(store); save(store, email) }).catch((error) => console.error(`Falha ao registrar o e-mail ${what}:`, error.message))
  }
  const emailTicket = (ticket) => deliver(`do ticket ${ticket.id}`, ticketMail(ticket, recipients()), (store, email) => {
    const row = store.supportTickets.find((item) => item.id === ticket.id)
    if (row) row.email = email
  })

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
    // Gestão Operacional, Cadastros, Operação and Gestão Financeira also ask for the screen involved; the others have none.
    const screens = submodulesOf(module), submodule = screens.length ? clean(req.body.submodule, 40) : ''
    if (screens.length && !screens.some(([key]) => key === submodule)) fail(`Escolha o sub-módulo de ${moduleLabel(module)} onde está o problema.`)
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
      const row = { id: `TCK-${String(store.supportTicketSequence).padStart(4, '0')}`, urgency, module, ...(submodule ? { submodule } : {}), title, description, attachments, status: 'open', createdAt: at, createdBy: req.viewer.id, createdByName: req.viewer.name, createdByRole: req.viewer.role, history: [{ type: 'opened', at, userId: req.viewer.id, userName: req.viewer.name }] }
      store.supportTickets.push(row)
      addNotification(store, { id: `ticket-opened:${row.id}`, type: 'ticket-opened', at, ticketId: row.id, authorId: req.viewer.id, recipientIds: notify, title: `Novo ticket ${row.id} · urgência: ${urgencyLabel(urgency)}`, description: `${moduleTitle(module, submodule)} · ${title}`, employeeName: req.viewer.name })
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

  // The conversation of a ticket. A developer's comment (an activity that will be fixed, a question): everybody sees it,
  // and whoever opened the ticket is told in the bell and by e-mail. Whoever opened it answers back while it is open
  // ("deu certo, obrigado"), and the developers are told the same way; only the developers close it.
  router.post('/support-tickets/:id/comments', handle(async (req, res) => {
    const developer = req.viewer.developer
    const text = multiline(req.body.text, COMMENT_MAX)
    if (!text) fail(developer ? 'Escreva o comentário.' : 'Escreva a resposta.')
    const notify = developer ? [] : await developerIds()
    const { ticket, comment } = await mutateStore((store) => {
      init(store)
      const row = find(store, req.params.id), at = new Date().toISOString(), selfAuthored = sameId(row.createdBy, req.viewer.id)
      if (!developer && !selfAuthored) fail('Somente quem abriu o ticket e os desenvolvedores do sistema respondem nele.', 403)
      if (!developer && row.status === 'closed') fail('Este ticket está fechado. Se o problema continuar, abra um novo ticket.', 409)
      const added = { id: randomUUID(), text, at, userId: req.viewer.id, userName: req.viewer.name, byDeveloper: developer, ...(developer && selfAuthored ? { email: { skippedAt: at, reason: 'O comentário é de quem abriu o ticket.' } } : {}) }
      row.comments = [...(row.comments || []), added]
      const summary = `${row.title} · ${text.length > 120 ? `${text.slice(0, 117)}...` : text}`
      if (developer) addNotification(store, { type: 'ticket-comment', at, ticketId: row.id, commentId: added.id, authorId: req.viewer.id, recipientIds: [row.createdBy], title: `Novo comentário no ticket ${row.id}`, description: summary, employeeName: req.viewer.name })
      else addNotification(store, { type: 'ticket-comment', at, ticketId: row.id, commentId: added.id, authorId: req.viewer.id, recipientIds: notify, title: `Nova resposta no ticket ${row.id}`, description: summary, employeeName: req.viewer.name })
      return { ticket: row, comment: added }
    })
    const saveEmail = (store, email) => {
      const item = store.supportTickets.find((row) => row.id === ticket.id)?.comments?.find((entry) => entry.id === comment.id)
      if (item) item.email = email
    }
    if (!developer) deliver(`da resposta no ticket ${ticket.id}`, replyMail(ticket, comment, recipients()), saveEmail)
    else if (!comment.email) {
      const author = await accounts.account(ticket.createdBy).catch(() => null)
      deliver(`do comentário no ticket ${ticket.id}`, commentMail(ticket, comment, { name: author?.name || ticket.createdByName, email: author?.email || '' }), (store, email) => {
        const item = store.supportTickets.find((row) => row.id === ticket.id)?.comments?.find((entry) => entry.id === comment.id)
        if (item) item.email = email
      })
    }
    res.status(201).json({ item: ticketView(ticket, req.viewer) })
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
