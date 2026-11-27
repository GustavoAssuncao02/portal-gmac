import express from 'express'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { readStore, mutateStore } from './offers.js'
import { receiveFile, sendStoredFile } from './uploads.js'
import { dataDirectory } from './dataDirectory.js'
import { addNotification } from './notificationEvents.js'
import { createMailer } from './passwordReset.js'
import { wantsEmail } from './accounts.js'
import { emailNotificationsOff } from './notificationRules.js'
import { developerCpfs, isDeveloper } from './developers.js'
import { COMMENT_MAX, DESCRIPTION_MAX, RESOLUTION_MAX, TITLE_MAX, moduleLabel, moduleTitle, statusLabel, submodulesOf, ticketModules, ticketPlace, ticketUrgencies, urgencyLabel } from './ticketRules.js'
import { zipFiles } from './zipFile.js'

// Tickets de suporte: administrators and administrative employees report problems of the portal to its developers.
// Everybody sees every ticket; the attachments (evidence of the problem) open for administrators and, for an
// administrative employee, only on the tickets they opened. Only the developers, the accounts of these CPFs, close and
// reopen a ticket; an account registered later with one of them becomes a developer without any change here. Anyone may
// comment on a ticket and follow it (the bell) to be told of what happens in it, like whoever opened it.
export { developerCpfs, isDeveloper }
// A new ticket is also e-mailed to the developers (SUPPORT_TICKET_EMAILS, separated by commas, replaces the list).
export const ticketEmailRecipients = ['by.cmlla0107@gmail.com', 'Gustavo_Assuncao02@outlook.com']
export const ticketFilesDirectory = path.join(dataDirectory, 'support-ticket-files')
// A file sent from the form whose ticket was never saved (window closed, error) is removed after a day.
const STALE_UPLOAD_MS = 24 * 3600000

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const clean = (value, limit) => String(value ?? '').trim().slice(0, limit)
const multiline = (value, limit) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, limit)
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const bahiaTime = (at) => new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })
const init = (store) => { store.supportTickets ||= []; store.supportTicketUploads ||= [] }
const sameId = (left, right) => String(left) === String(right)
// The same person once, whatever the type of the id (number or text).
const uniqueIds = (ids) => [...new Map(ids.filter((id) => id != null).map((id) => [String(id), id])).values()]

// The files sent from the form (POST /support-tickets/uploads) and claimed by a ticket or by a message of its
// conversation: only by whoever sent them, and only once.
function readFileIds(value) {
  const ids = value ?? []
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) fail('Anexos inválidos.')
  return ids
}
function claimUploads(store, fileIds, userId) {
  const attachments = fileIds.map((id) => {
    const file = store.supportTicketUploads.find((item) => item.id === id && sameId(item.userId, userId))
    if (!file) fail('Anexo inválido ou já utilizado. Envie o arquivo novamente.')
    return { id: file.id, name: file.name, contentType: file.contentType, size: file.size, uploadedAt: file.at }
  })
  store.supportTicketUploads = store.supportTicketUploads.filter((item) => !fileIds.includes(item.id))
  return attachments
}

// What one viewer receives of a ticket: the files only when they may open them; otherwise how many there are. The
// files of a message of the conversation follow the same rule, and whoever sent them always opens them. How the e-mails
// went (of the ticket, of each message and of each closing or reopening, also to each person told one by one) is shown
// to the developers only.
function ticketView(ticket, viewer) {
  const own = sameId(ticket.createdBy, viewer.id)
  const files = viewer.role !== 'staff' || own
  const { email, followers = [], ...rest } = ticket
  // `followerEmails` is the name of the list in the messages of the first day (2026-11-23), before it had the author too.
  const comments = (ticket.comments || []).map(({ email: delivery, personEmails, followerEmails, attachments = [], ...comment }) => {
    const open = files || sameId(comment.userId, viewer.id)
    return { ...comment, attachments: open ? attachments : [], attachmentCount: attachments.length, attachmentsLocked: !open && attachments.length > 0, ...(viewer.developer ? { email: delivery || null, personEmails: personEmails || followerEmails || [] } : {}) }
  })
  const history = (ticket.history || []).map(({ emails, ...entry }) => viewer.developer ? { ...entry, emails: emails || [] } : entry)
  const opening = (ticket.attachments || []).length
  const lockedCount = (files ? 0 : opening) + comments.reduce((sum, comment) => sum + (comment.attachmentsLocked ? comment.attachmentCount : 0), 0)
  // Tickets of modules that became screens of a group (Estoque → Gestão Operacional) come in the group, like new ones.
  return { ...rest, ...ticketPlace(ticket.module, ticket.submodule), own, history, following: followers.some((entry) => sameId(entry.userId, viewer.id)), followers: followers.map(({ userId, userName }) => ({ userId, userName })), comments, attachments: files ? ticket.attachments || [] : [], attachmentCount: opening + comments.reduce((sum, comment) => sum + comment.attachmentCount, 0), attachmentsLocked: lockedCount > 0, lockedCount, ...(viewer.developer ? { email: email || null } : {}) }
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
  comment: { label: 'Novo comentário', color: '#0f6e6e', background: '#e3f4f4' },
  support: { label: 'Resposta do suporte', color: '#5b3a9e', background: '#f0ebfa' },
  closed: { label: 'Ticket fechado', color: '#1f7a45', background: '#e6f4ec' },
  reopened: { label: 'Ticket reaberto', color: '#0c4c91', background: '#e8f1fc' },
}
// Who wrote a message: a developer, whoever opened the ticket, or anybody else of the portal (2026-11-23: everybody
// comments). The words of the e-mail follow.
const nonDeveloperWriter = (ticket, comment) => comment.userId == null || sameId(comment.userId, ticket.createdBy) ? 'author' : 'other'
const writerOf = (ticket, comment) => comment.byDeveloper !== false ? 'developer' : nonDeveloperWriter(ticket, comment)
const writers = {
  developer: { kind: 'support', subject: 'Resposta do suporte', verb: 'comentou', who: 'Comentado por', label: 'Comentário' },
  author: { kind: 'reply', subject: 'Resposta', verb: 'respondeu', who: 'Respondido por', label: 'Resposta' },
  other: { kind: 'comment', subject: 'Comentário', verb: 'comentou', who: 'Comentado por', label: 'Comentário' },
}
const followingClosing = 'Você recebe este e-mail porque acompanha este ticket. Para deixar de receber, desmarque o sininho do ticket no Portal GMAC, no menu Ticket.'
const shortText = (value, limit = 160) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > limit ? `${text.slice(0, limit - 1)}…` : text }
const filesCount = (files) => `${files.length} ${files.length === 1 ? 'anexo' : 'anexos'}`
const filesLine = (files = []) => files.length ? `${filesCount(files)}: ${files.map((file) => file.name).join(', ')}` : 'Sem anexos'
// A message of the conversation may be only files (a new print of the screen): the e-mail then says what was sent.
const messageText = (comment) => comment.text || `Enviou ${filesCount(comment.attachments || [])} na conversa do ticket.`
const messagePreview = (comment) => comment.text ? `“${shortText(comment.text)}”` : `enviou ${filesCount(comment.attachments || [])}`
const messageFacts = (ticket, comment, who) => [['Módulo', moduleTitle(ticket.module, ticket.submodule)], [who, comment.userName], ['Data e hora', `${bahiaTime(comment.at)} (horário da Bahia)`], ...(comment.attachments?.length ? [['Anexos', filesLine(comment.attachments)]] : [])]

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
  const fileLine = filesLine(ticket.attachments)
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

// A reply of whoever opened the ticket, or a comment of anybody else who is not a developer, e-mailed to the developers
// (the same list of a new ticket).
export function replyMail(ticket, comment, recipients) {
  const writer = writers[nonDeveloperWriter(ticket, comment)]
  return {
    to: recipients.join(', '),
    subject: `${writer.subject} · ${urgencyText(ticket.urgency)} · ${ticket.id} · ${ticket.title}`,
    ...ticketEmail({
      kind: writer.kind, ticket,
      preview: `${ticket.title} · ${comment.userName} ${writer.verb}: ${messagePreview(comment)}`,
      facts: messageFacts(ticket, comment, writer.who),
      messageLabel: writer.label, message: messageText(comment),
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
      preview: `${ticket.title} · ${comment.userName} comentou no seu ticket: ${messagePreview(comment)}`,
      facts: messageFacts(ticket, comment, 'Comentado por'),
      messageLabel: 'Comentário', message: messageText(comment),
      closing: 'Para responder, abra o Portal GMAC, no menu Ticket.',
    }),
  }
}

// Each new message of the conversation, e-mailed to one person: whoever follows the ticket (the bell of the Ticket
// screen) or, for a comment of somebody who is not a developer, whoever opened it (`own`).
export function followerMail(ticket, comment, person, { own = false } = {}) {
  const writer = writers[writerOf(ticket, comment)]
  return {
    to: person.email,
    subject: `${writer.subject} · ${urgencyText(ticket.urgency)} · ${ticket.id} · ${ticket.title}`,
    ...ticketEmail({
      kind: writer.kind, ticket, greeting: `Olá, ${person.name}.`,
      preview: `${ticket.title} · ${comment.userName} ${writer.verb} ${own ? 'no seu ticket' : 'no ticket que você acompanha'}: ${messagePreview(comment)}`,
      facts: messageFacts(ticket, comment, writer.who),
      messageLabel: writer.label, message: messageText(comment),
      closing: own ? 'Para responder, abra o Portal GMAC, no menu Ticket.' : followingClosing,
    }),
  }
}

// A ticket closed (with how the problem was solved) or reopened, e-mailed to whoever opened it (`own`) and to whoever
// follows it.
export function statusMail(ticket, change, person, { own = false } = {}) {
  const closed = change.type === 'closed'
  return {
    to: person.email,
    subject: `${closed ? 'Ticket fechado' : 'Ticket reaberto'} · ${urgencyText(ticket.urgency)} · ${ticket.id} · ${ticket.title}`,
    ...ticketEmail({
      kind: closed ? 'closed' : 'reopened', ticket, greeting: `Olá, ${person.name}.`,
      preview: `${ticket.title} · ${change.userName} ${closed ? 'fechou' : 'reabriu'} ${own ? 'o seu ticket' : 'o ticket que você acompanha'}${change.note ? `: “${shortText(change.note)}”` : ''}`,
      facts: [['Módulo', moduleTitle(ticket.module, ticket.submodule)], [closed ? 'Fechado por' : 'Reaberto por', change.userName], ['Data e hora', `${bahiaTime(change.at)} (horário da Bahia)`]],
      messageLabel: closed ? 'Como foi resolvido' : 'Motivo da reabertura', message: change.note || 'Sem motivo informado.',
      closing: own ? (closed ? 'Se o problema continuar, responda no Portal GMAC, no menu Ticket.' : 'Acompanhe a conversa no Portal GMAC, no menu Ticket.') : followingClosing,
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
  const developerAccounts = async () => (await Promise.all(cpfs.map((cpf) => accounts.accountByCpf(cpf)))).filter(Boolean)
  const developerIds = async () => (await developerAccounts()).map((account) => account.id)
  // "Notificações do sistema por e-mail" (Configurações): an account that turned it off gets no e-mail of the tickets,
  // only the bell. If the preference cannot be read, the e-mail goes as before.
  const emailAllowed = async (userId) => { try { return wantsEmail(await readStore(), userId) } catch { return true } }
  // The developers' list, without the address of a developer whose account turned the e-mails off.
  async function developerList() {
    try {
      const store = await readStore()
      const off = new Set((await developerAccounts()).filter((account) => !wantsEmail(store, account.id)).map((account) => String(account.email || '').trim().toLowerCase()).filter(Boolean))
      return recipients().filter((address) => !off.has(address.toLowerCase()))
    } catch { return recipients() }
  }
  const optedOut = () => ({ skippedAt: new Date().toISOString(), reason: emailNotificationsOff })

  // The e-mails go after the record is saved and do not hold the answer: their outcome is written on the ticket (or on
  // the comment), where the developers see it.
  const record = (what, save, email) => mutateStore((store) => { init(store); save(store, email) }).catch((error) => console.error(`Falha ao registrar o e-mail ${what}:`, error.message))
  async function deliver(what, message, save, noAddress = 'Quem abriu o ticket não tem e-mail cadastrado.') {
    let email
    try {
      if (!message.to) email = { skippedAt: new Date().toISOString(), reason: noAddress }
      else if (!mailer.configured()) email = { skippedAt: new Date().toISOString(), reason: 'SMTP não configurado no servidor.' }
      else {
        await mailer.send(message)
        email = { sentAt: new Date().toISOString(), to: message.to }
      }
    } catch (error) {
      console.error(`Falha ao enviar o e-mail ${what}:`, error.message)
      email = { failedAt: new Date().toISOString(), reason: 'O servidor de e-mail recusou ou não respondeu.' }
    }
    await record(what, save, email)
  }
  const developersOff = 'Os desenvolvedores desativaram as notificações por e-mail.'
  const emailTicket = async (ticket) => deliver(`do ticket ${ticket.id}`, ticketMail(ticket, await developerList()), (store, email) => {
    const row = store.supportTickets.find((item) => item.id === ticket.id)
    if (row) row.email = email
  }, developersOff)
  const onComment = (ticket, comment, change) => (store, email) => {
    const item = store.supportTickets.find((row) => row.id === ticket.id)?.comments?.find((entry) => entry.id === comment.id)
    if (item) change(item, email)
  }
  // E-mails to people one by one (whoever opened the ticket, whoever follows it): `list` gives the entries written on the
  // record beforehand, each one filled with how its e-mail went. An address that already got this e-mail (the
  // developers' list, an earlier entry) is not written to twice.
  async function emailEach(what, people, alreadyTold, mailFor, saveEntry) {
    const told = new Set(alreadyTold.map((address) => String(address || '').trim().toLowerCase()).filter(Boolean))
    for (const entry of people) {
      const save = (store, email) => saveEntry(store, entry, email)
      if (!await emailAllowed(entry.userId)) { await record(what, save, optedOut()); continue }
      const account = await accounts.account(entry.userId).catch(() => null)
      const address = String(account?.email || '').trim()
      if (address && told.has(address.toLowerCase())) { await record(what, save, { skippedAt: new Date().toISOString(), reason: 'Este endereço já recebeu o mesmo e-mail.' }); continue }
      if (address) told.add(address.toLowerCase())
      deliver(what, mailFor({ name: account?.name || entry.userName, email: address }, entry), save, 'Sem e-mail cadastrado.')
    }
  }
  const fillEntry = (list, entry, email) => { const row = (list || []).find((item) => sameId(item.userId, entry.userId)); if (row) Object.assign(row, email) }
  const emailPeopleOfComment = (ticket, comment, alreadyTold) => emailEach(`da mensagem no ticket ${ticket.id}`, comment.personEmails || [], alreadyTold,
    (person, entry) => followerMail(ticket, comment, person, { own: Boolean(entry.author) }),
    (store, entry, email) => onComment(ticket, comment, (item) => fillEntry(item.personEmails, entry, email))(store))
  const emailPeopleOfChange = (ticket, change) => emailEach(`do status do ticket ${ticket.id}`, change.emails || [], [],
    (person, entry) => statusMail(ticket, change, person, { own: Boolean(entry.author) }),
    (store, entry, email) => fillEntry(store.supportTickets.find((row) => row.id === ticket.id)?.history?.find((item) => item.id === change.id)?.emails, entry, email))

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
    const fileIds = readFileIds(req.body.fileIds)
    const notify = await developerIds()
    const ticket = await mutateStore((store) => {
      init(store)
      const attachments = claimUploads(store, fileIds, req.viewer.id)
      store.supportTicketSequence = Math.max(store.supportTicketSequence || 0, store.supportTickets.length) + 1
      const at = new Date().toISOString()
      const row = { id: `TCK-${String(store.supportTicketSequence).padStart(4, '0')}`, urgency, module, ...(submodule ? { submodule } : {}), title, description, attachments, status: 'open', createdAt: at, createdBy: req.viewer.id, createdByName: req.viewer.name, createdByRole: req.viewer.role, history: [{ type: 'opened', at, userId: req.viewer.id, userName: req.viewer.name }] }
      store.supportTickets.push(row)
      addNotification(store, { id: `ticket-opened:${row.id}`, type: 'ticket-opened', at, ticketId: row.id, authorId: req.viewer.id, recipientIds: notify, title: `Novo ticket ${row.id} · urgência: ${urgencyLabel(urgency)}`, description: `${moduleTitle(module, submodule)} · ${title}`, employeeName: req.viewer.name })
      return row
    })
    emailTicket(ticket).catch((error) => console.error(`Falha ao enviar o e-mail do ticket ${ticket.id}:`, error.message))
    res.status(201).json({ item: ticketView(ticket, req.viewer) })
  }))

  // Administrators open every attachment (of the opening and of the conversation); an administrative employee only those
  // of the tickets they opened, and the ones they sent themselves.
  router.get('/support-tickets/:id/files/:fileId', handle(async (req, res) => {
    const store = await readStore(); init(store)
    const ticket = find(store, req.params.id)
    const sent = [...(ticket.attachments || []).map((file) => ({ file })), ...(ticket.comments || []).flatMap((comment) => (comment.attachments || []).map((file) => ({ file, by: comment.userId })))]
    const found = sent.find((entry) => entry.file.id === req.params.fileId)
    if (req.viewer.role === 'staff' && !sameId(ticket.createdBy, req.viewer.id) && !(found && sameId(found.by, req.viewer.id))) fail('Os anexos deste ticket abrem só para quem o abriu e para os administradores.', 403)
    const file = found?.file || fail('Arquivo não encontrado.', 404)
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    await sendStoredFile(res, path.join(ticketFilesDirectory, file.id))
  }))

  // Ticket › Exportar (developers only): everything the ticket keeps (conversation, history, followers, how each e-mail
  // went), with the readable names of its module, urgency and status and the people in it, in a light file to hand to
  // whoever fixes it. Without attachments (or `?format=json`, for "Copiar JSON") the .json alone; with them a .zip with
  // ticket.json and the files in anexos/. A file missing on the disk is listed as such.
  router.get('/support-tickets/:id/export', handle(async (req, res) => {
    if (!req.viewer.developer) fail('Só os desenvolvedores exportam tickets.', 403)
    const store = await readStore(); init(store)
    const ticket = find(store, req.params.id)
    const sent = [
      ...(ticket.attachments || []).map((file) => ({ file, sentIn: 'abertura', sentBy: ticket.createdByName, sentAt: ticket.createdAt })),
      ...(ticket.comments || []).flatMap((comment) => (comment.attachments || []).map((file) => ({ file, sentIn: 'conversa', commentId: comment.id, sentBy: comment.userName, sentAt: comment.at }))),
    ]
    const json = req.query.format === 'json'
    const files = [], attachments = []
    for (const [index, { file, ...origin }] of sent.entries()) {
      const inZip = `anexos/${String(index + 1).padStart(2, '0')} - ${String(file.name || file.id).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')}`
      let data = null
      if (!json) {
        try { data = await readFile(path.join(ticketFilesDirectory, file.id)) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      attachments.push({ ...file, ...origin, ...(json ? {} : data ? { fileInZip: inZip } : { missing: 'Arquivo não encontrado no servidor.' }) })
      if (data) files.push({ name: inZip, data })
    }
    const ids = uniqueIds([ticket.createdBy, ...(ticket.followers || []).map((entry) => entry.userId), ...(ticket.comments || []).map((comment) => comment.userId), ...(ticket.history || []).map((entry) => entry.userId)])
    const people = []
    for (const id of ids) {
      const person = await accounts.account(id).catch(() => null)
      people.push(person ? { id: person.id, name: person.name, role: person.role, email: person.email || null, developer: isDeveloper(person, cpfs) } : { id, missing: 'Conta não encontrada.' })
    }
    const exported = {
      exportedAt: new Date().toISOString(), exportedBy: req.viewer.name,
      ticket: { ...ticket, moduleTitle: moduleTitle(ticket.module, ticket.submodule), urgencyLabel: urgencyLabel(ticket.urgency), statusLabel: statusLabel(ticket.status) },
      attachments, people,
    }
    const text = JSON.stringify(exported, null, 2)
    res.set('Cache-Control', 'no-store')
    if (json || !files.length) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${ticket.id}.json"`)
      return res.send(text)
    }
    res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', `attachment; filename="${ticket.id}.zip"`)
    res.send(zipFiles([{ name: 'ticket.json', data: text }, ...files]))
  }))

  // Who follows the ticket and is told of what someone else did in it (whoever opened it is always told).
  const followersOf = (row, actorId) => (row.followers || []).filter((entry) => !sameId(entry.userId, actorId) && !sameId(entry.userId, row.createdBy))
  // The people told one by one of what someone did in the ticket: whoever opened it (unless it was them, or the
  // `authorTold` some other way) and whoever follows it.
  const peopleOf = (row, actorId, authorTold = false) => [
    ...(!authorTold && !sameId(row.createdBy, actorId) ? [{ userId: row.createdBy, userName: row.createdByName, author: true }] : []),
    ...followersOf(row, actorId).map(({ userId, userName }) => ({ userId, userName })),
  ]

  // The conversation of a ticket, open to everybody (2026-11-23) and also after it is closed. A developer's comment (an
  // activity that will be fixed, a question): whoever opened the ticket is told in the bell and by e-mail. Whoever opened
  // it answers back ("deu certo, obrigado"; "voltou a acontecer") and anybody else comments ("comigo também"): the
  // developers are told the same way, and whoever opened it too. A closed ticket stays closed, only the developers reopen
  // it. A message may bring new files (more evidence), or be only files. Whoever follows the ticket (the bell) is told of
  // every message, in the bell and by e-mail.
  router.post('/support-tickets/:id/comments', handle(async (req, res) => {
    const developer = req.viewer.developer
    const text = multiline(req.body.text, COMMENT_MAX)
    const fileIds = readFileIds(req.body.fileIds)
    if (!text && !fileIds.length) fail(developer ? 'Escreva o comentário ou anexe um arquivo.' : 'Escreva a mensagem ou anexe um arquivo.')
    const notify = developer ? [] : await developerIds()
    const { ticket, comment } = await mutateStore((store) => {
      init(store)
      const row = find(store, req.params.id), at = new Date().toISOString(), selfAuthored = sameId(row.createdBy, req.viewer.id)
      const attachments = claimUploads(store, fileIds, req.viewer.id)
      // A developer's comment goes to whoever opened the ticket in its own e-mail (`email`); the others go to the
      // developers' list, and whoever opened it is told with the people who follow it.
      const people = peopleOf(row, req.viewer.id, developer)
      const added = { id: randomUUID(), text, ...(attachments.length ? { attachments } : {}), at, userId: req.viewer.id, userName: req.viewer.name, byDeveloper: developer, ...(developer && selfAuthored ? { email: { skippedAt: at, reason: 'O comentário é de quem abriu o ticket.' } } : {}), ...(people.length ? { personEmails: people } : {}) }
      row.comments = [...(row.comments || []), added]
      const said = text || `Enviou ${attachments.length} ${attachments.length === 1 ? 'anexo' : 'anexos'}.`
      const summary = `${row.title} · ${said.length > 120 ? `${said.slice(0, 117)}...` : said}`
      const recipientIds = uniqueIds([row.createdBy, ...notify, ...followersOf(row, req.viewer.id).map((entry) => entry.userId)])
      addNotification(store, { type: 'ticket-comment', at, ticketId: row.id, commentId: added.id, authorId: req.viewer.id, recipientIds, title: `${!developer && selfAuthored ? 'Nova resposta' : 'Novo comentário'} no ticket ${row.id}`, description: summary, employeeName: req.viewer.name })
      return { ticket: row, comment: added }
    })
    const saveEmail = onComment(ticket, comment, (item, email) => { item.email = email })
    let told = []
    if (!developer) {
      told = await developerList()
      deliver(`da mensagem no ticket ${ticket.id}`, replyMail(ticket, comment, told), saveEmail, developersOff)
    } else if (!comment.email && !await emailAllowed(ticket.createdBy)) {
      record(`do comentário no ticket ${ticket.id}`, saveEmail, optedOut())
    } else if (!comment.email) {
      const author = await accounts.account(ticket.createdBy).catch(() => null)
      told = [author?.email]
      deliver(`do comentário no ticket ${ticket.id}`, commentMail(ticket, comment, { name: author?.name || ticket.createdByName, email: author?.email || '' }), saveEmail)
    }
    emailPeopleOfComment(ticket, comment, told).catch((error) => console.error(`Falha ao avisar as pessoas do ticket ${ticket.id}:`, error.message))
    res.status(201).json({ item: ticketView(ticket, req.viewer) })
  }))

  // The bell of a ticket: whoever marks it is told of everything that happens in it (each message and each closing or
  // reopening, in the bell and by e-mail), like whoever opened it. Whoever opened it is always told: no bell.
  router.post('/support-tickets/:id/follow', handle(async (req, res) => {
    const following = req.body.following
    if (typeof following !== 'boolean') fail('Escolha se quer acompanhar o ticket.')
    const item = await mutateStore((store) => {
      init(store)
      const ticket = find(store, req.params.id)
      if (sameId(ticket.createdBy, req.viewer.id)) fail('Você abriu este ticket e já recebe os avisos dele.', 409)
      const others = (ticket.followers || []).filter((entry) => !sameId(entry.userId, req.viewer.id))
      const mine = (ticket.followers || []).find((entry) => sameId(entry.userId, req.viewer.id))
      ticket.followers = following ? [...others, mine || { userId: req.viewer.id, userName: req.viewer.name, at: new Date().toISOString() }] : others
      if (!ticket.followers.length) delete ticket.followers
      return ticket
    })
    res.json({ item: ticketView(item, req.viewer) })
  }))

  // Closing asks how the problem was solved, and the answer shows on the ticket; a closed ticket can be reopened. Whoever
  // opened it and whoever follows it are told in the bell and by e-mail (2026-11-23).
  router.post('/support-tickets/:id/status', handle(async (req, res) => {
    if (!req.viewer.developer) fail('Somente os desenvolvedores do sistema alteram o status do ticket.', 403)
    const status = req.body.status
    if (!['open', 'closed'].includes(status)) fail('Status inválido.')
    const note = multiline(req.body.note, RESOLUTION_MAX)
    if (status === 'closed' && !note) fail('Escreva a resposta: como o problema foi resolvido.')
    const { item, change } = await mutateStore((store) => {
      init(store)
      const ticket = find(store, req.params.id)
      if (ticket.status === status) fail(status === 'closed' ? 'Este ticket já está fechado.' : 'Este ticket já está aberto.', 409)
      const at = new Date().toISOString(), by = { userId: req.viewer.id, userName: req.viewer.name }
      ticket.status = status
      if (status === 'closed') Object.assign(ticket, { closedAt: at, closedBy: req.viewer.id, closedByName: req.viewer.name, resolution: note })
      else { delete ticket.closedAt; delete ticket.closedBy; delete ticket.closedByName; delete ticket.resolution }
      const people = peopleOf(ticket, req.viewer.id)
      const entry = { id: randomUUID(), type: status === 'closed' ? 'closed' : 'reopened', at, ...by, ...(note ? { note } : {}), ...(people.length ? { emails: people } : {}) }
      ticket.history = [...(ticket.history || []), entry]
      addNotification(store, { type: 'ticket-status', at, ticketId: ticket.id, authorId: req.viewer.id, recipientIds: uniqueIds([ticket.createdBy, ...followersOf(ticket, req.viewer.id).map((follower) => follower.userId)]), title: `Ticket ${ticket.id} ${status === 'closed' ? 'fechado' : 'reaberto'}`, description: ticket.title, employeeName: req.viewer.name })
      return { item: ticket, change: entry }
    })
    emailPeopleOfChange(item, change).catch((error) => console.error(`Falha ao avisar as pessoas do ticket ${item.id}:`, error.message))
    res.json({ item: ticketView(item, req.viewer) })
  }))
  return router
}
