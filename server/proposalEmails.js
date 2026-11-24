import express from 'express'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { rm, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { dataDirectory } from './dataDirectory.js'
import { mutateStore, proposalPdfFile, readStore } from './offers.js'
import { proposalSettings } from './proposalDocuments.js'
import { createMailer } from './passwordReset.js'
import { documentDigits } from './clientDocument.js'
import { actorOf, recordRegistryChange } from './registryHistory.js'
import { accountJobTitle, emailTemplates, fillTemplate } from './emailTemplates.js'
import { signatureAttachments, signatureHtml, signatureText } from './emailSignature.js'
import { offerRequesters } from './offerRequesters.js'
import { quantityLabel } from './quantityUnits.js'

// "Enviar E-mail" on the proposal screen: once the proposal PDF is generated, it goes from the commercial account of the
// portal (MAIL_FROM, the same SMTP of the site quotes) to the client and the buyer registered for the offer. The text comes
// from a template of Cadastros › Modelos de e-mail (emailTemplates.js; an etiqueta opens with "Medição de etiqueta") and
// everything but the signature is editable before sending: recipients, copy, subject, message and attachments (the PDF can
// be removed, other files added). The signature is drawn by the server (emailSignature.js) with the sender's name and role. The commercial account gets a blind copy, so the e-mail also shows up in its Outlook. Each e-mail is kept
// on the offer (`proposalEmails`) with a copy of the files exactly as they were sent.
const filesDirectory = path.join(dataDirectory, 'files')
// Microsoft 365 refuses messages over 35 MB once encoded (about 25 MB of files); 20 MB leaves room for the text.
export const PROPOSAL_EMAIL_MAX_BYTES = 20 * 1024 * 1024
const MAX_FILES = 10, MAX_RECIPIENTS = 20
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const clean = (value, limit) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, limit)
const emailPattern = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || ''

function addresses(list, label) {
  const values = (Array.isArray(list) ? list : String(list ?? '').split(/[,;\s]+/)).map((item) => String(item).trim().toLowerCase()).filter(Boolean)
  const wrong = values.find((item) => !emailPattern.test(item))
  if (wrong) fail(400, `E-mail inválido em ${label}: ${wrong}`)
  return [...new Set(values)]
}

// The issuer of the proposal (GMAC Usinagem or Metalúrgica) signs it; older proposals without a document use the first.
function issuerOf(store, offer) {
  const { issuers } = proposalSettings(store)
  return issuers.find((issuer) => issuer.id === offer.proposal?.document?.issuerId) || issuers[0]
}

// The {campos} of the templates for this offer.
export function templateValues(store, offer) {
  const issuer = issuerOf(store, offer)
  const document = offer.proposal?.document
  const name = firstName(offer.buyer) || firstName(offerRequesters(offer)[0]?.name)
  return { saudacao: name ? `Olá, ${name}!` : 'Olá!', nome: name, numero: document?.quoteNumber || document?.number || document?.labelNumber || offer.code, etiqueta: offer.labelNumber || document?.labelNumber || '', servico: offer.service, cliente: offer.company, quantidade: quantityLabel(offer.quantity, offer.quantityUnit), empresa: issuer.label, oferta: offer.code, os: offer.orderCode || '' }
}
const unique = (list) => list.map((item) => String(item || '').trim().toLowerCase()).filter((item, index, all) => item && emailPattern.test(item) && all.indexOf(item) === index)

// The e-mail of an offer in each template; an etiqueta comes with "Medição de etiqueta", the others with "Proposta comercial".
export function proposalEmailDraft({ store, offer, client, senderName, jobTitle = '', from, templateId }) {
  const buyer = (store.buyers || []).find((row) => row.id === offer.buyerId)
  // The requesters registered for the offer (Cadastros › Solicitantes, up to 5) also receive it, like the client and the buyer.
  const requesterIds = new Set(offerRequesters(offer).map((item) => item.id).filter((id) => id != null))
  const requesterEmails = (store.requesters || []).filter((row) => requesterIds.has(row.id)).map((row) => row.email)
  const issuer = issuerOf(store, offer)
  const values = templateValues(store, offer)
  // A oferta do site não tem solicitante cadastrado: o e-mail informado no formulário entra como destinatário sugerido.
  const contacts = [offer.siteContact?.email, client?.email, ...requesterEmails, buyer?.email]
  const templates = emailTemplates(store).map((template) => ({ id: template.id, name: template.name, builtin: Boolean(template.builtin), subject: fillTemplate(template.subject, values), message: fillTemplate(template.message, values), to: unique(template.to || []), cc: unique(template.cc || []) }))
  const chosen = templates.find((template) => template.id === templateId) || templates.find((template) => template.id === (offer.labelQuote ? 'label' : 'proposal')) || templates[0]
  return {
    from, templateId: chosen.id, templates,
    to: unique([...contacts, ...chosen.to]), cc: chosen.cc,
    subject: chosen.subject, message: chosen.message,
    signature: signatureText({ name: senderName, jobTitle, issuer }),
    signatureHtml: signatureHtml({ name: senderName, jobTitle, issuer, images: 'data' }),
  }
}

const sendProblem = (error) => {
  if (error.code === 'EAUTH' || /SmtpClientAuthentication is disabled/i.test(String(error.response || ''))) return 'A conta de e-mail do portal recusou o login (SMTP). Fale com o TI.'
  if (['ETIMEDOUT', 'ECONNECTION', 'ECONNREFUSED', 'EDNS', 'ESOCKET'].includes(error.code)) return 'Sem conexão com o servidor de e-mail. Tente de novo em instantes.'
  if (error.code === 'EENVELOPE') return 'O servidor de e-mail recusou um dos destinatários. Confira os endereços.'
  return 'O servidor de e-mail recusou o envio. Tente de novo ou fale com o TI.'
}

const html = (message, signature) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2d3d">${escapeHtml(message).replace(/\n/g, '<br>')}<br><br><p style="margin:0 0 12px">Atenciosamente,</p>${signature}</div>`

export default function createProposalEmailsRouter(accounts, requireAdmin, { mailer = createMailer(), env = process.env } = {}) {
  const router = express.Router()
  const sender = () => env.MAIL_FROM?.trim() || 'comercial@gmacmetalurgica.com.br'
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PROPOSAL_EMAIL_MAX_BYTES, files: MAX_FILES, fields: 4, fieldSize: 200000 } })
  const handle = (task) => async (request, response) => {
    try { await task(request, response) } catch (error) {
      if (error instanceof multer.MulterError) return response.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Os anexos passam de 20 MB, o limite do e-mail.' : `Anexos demais: o limite é ${MAX_FILES}.` })
      if (!error.status) console.error('Falha no e-mail da proposta:', error)
      response.status(error.status || 500).json({ message: error.status ? error.message : 'Não foi possível enviar o e-mail agora. Confira a conexão e tente de novo.' })
    }
  }
  const offerWithProposal = async (id) => {
    const store = await readStore()
    const offer = store.offers.find((item) => item.id === id)
    if (!offer) fail(404, 'Oferta não encontrada.')
    if (!offer.proposal) fail(409, 'Gere a proposta em PDF antes de enviar o e-mail.')
    return { store, offer }
  }
  const clientOf = async (offer) => (await accounts.clients()).find((client) => documentDigits(client.document) === documentDigits(offer.cnpj))

  // The registered client of the offer and its buyer: the screen warns when one of them has no e-mail yet.
  const contactsOf = (store, offer, client) => {
    const buyer = (store.buyers || []).find((row) => row.id === offer.buyerId)
    return { client: client ? { id: client.id, name: client.name, email: client.email || '' } : null, buyer: buyer ? { id: buyer.id, name: buyer.name, email: buyer.email || '' } : null }
  }

  router.get('/offers/:id/proposal-email', requireAdmin, handle(async (request, response) => {
    const { store, offer } = await offerWithProposal(request.params.id)
    const pdf = await proposalPdfFile(offer)
    const client = await clientOf(offer)
    const draft = proposalEmailDraft({ store, offer, client, senderName: request.adminName, jobTitle: accountJobTitle(store, request.adminId), from: sender(), templateId: String(request.query.template || '') })
    response.set('Cache-Control', 'no-store').json({ draft, contacts: contactsOf(store, offer, client), proposal: { name: pdf.name, size: pdf.content.length }, configured: mailer.configured(), maxBytes: PROPOSAL_EMAIL_MAX_BYTES })
  }))

  // A client or buyer without e-mail gets the address typed for it, once the e-mail went out, so the next one comes filled.
  // Only when it still has none and the address is among the recipients; a failure here does not undo the e-mail.
  async function registerContacts(offer, register, recipients, actor) {
    const note = `E-mail incluído ao enviar a proposta da oferta ${offer.code}.`
    const typed = (value) => { const email = String(value || '').trim().toLowerCase(); return emailPattern.test(email) && recipients.includes(email) ? email : '' }
    const registered = [], warnings = []
    const clientEmail = typed(register?.client)
    const client = clientEmail && await clientOf(offer)
    if (client && !client.email) {
      try { await accounts.save('clients', client.id, { ...client, email: clientEmail }, { actor, note }); registered.push({ kind: 'client', name: client.name, email: clientEmail }) }
      catch (error) { warnings.push(`O e-mail ${clientEmail} não foi cadastrado para o cliente ${client.name}: ${error.status ? error.message : 'erro ao salvar.'}`) }
    }
    const buyerEmail = typed(register?.buyer)
    if (buyerEmail && offer.buyerId) {
      const buyer = await mutateStore((store) => {
        const row = (store.buyers || []).find((entry) => entry.id === offer.buyerId)
        if (!row || row.email) return null
        Object.assign(row, { email: buyerEmail, updatedAt: new Date().toISOString() })
        recordRegistryChange(store, { registry: 'buyers', recordId: row.id, type: 'edited', actor, before: { email: '' }, after: { email: buyerEmail }, note })
        return row
      })
      if (buyer) registered.push({ kind: 'buyer', name: buyer.name, email: buyerEmail })
    }
    return { registered, warnings }
  }

  // multipart: `email` (JSON with to, cc, subject, message, signature, includeProposal and the `fileNames`, in UTF-8, of
  // the new files) and the new files in `files`.
  router.post('/offers/:id/proposal-email', requireAdmin, handle(async (request, response) => {
    if (!mailer.configured()) fail(503, 'O envio de e-mail não está configurado no portal (SMTP). Fale com o TI.')
    // The files are kept in memory: a form announced over the 20 MB of the e-mail plus its fields, which would be refused
    // after the upload anyway, is refused before it takes up memory.
    if (Number(request.get('content-length')) > PROPOSAL_EMAIL_MAX_BYTES + 1024 * 1024) fail(400, 'Os anexos passam de 20 MB, o limite do e-mail.')
    await new Promise((resolve, reject) => upload.array('files', MAX_FILES)(request, response, (error) => error ? reject(error) : resolve()))
    let input
    try { input = JSON.parse(request.body?.email || '{}') } catch { fail(400, 'Dados do e-mail inválidos.') }
    const to = addresses(input.to, 'Para'), cc = addresses(input.cc, 'Cc')
    if (!to.length) fail(400, 'Informe pelo menos um destinatário em Para.')
    if (to.length + cc.length > MAX_RECIPIENTS) fail(400, `São no máximo ${MAX_RECIPIENTS} destinatários.`)
    const subject = clean(input.subject, 250).replace(/\s+/g, ' ')
    if (!subject) fail(400, 'Informe o assunto do e-mail.')
    const message = clean(input.message, 20000)
    if (!message) fail(400, 'Escreva a mensagem do e-mail.')
    const { store, offer } = await offerWithProposal(request.params.id)
    // The signature is always the one of who sends, as the e-mail screen shows it; it is not typed.
    const issuer = issuerOf(store, offer), jobTitle = accountJobTitle(store, request.adminId)
    const signature = signatureText({ name: request.adminName, jobTitle, issuer })
    const templateId = emailTemplates(store).some((template) => template.id === input.templateId) ? input.templateId : null
    const names = Array.isArray(input.fileNames) ? input.fileNames : []
    const files = (request.files || []).map((file, index) => ({ name: path.basename(String(names[index] || file.originalname)).slice(0, 180) || 'anexo', contentType: file.mimetype || 'application/octet-stream', content: file.buffer }))
    if (input.includeProposal !== false) {
      const pdf = await proposalPdfFile(offer)
      files.unshift({ name: pdf.name, contentType: 'application/pdf', content: pdf.content, proposal: true })
    }
    if (!files.length) fail(400, 'Anexe a proposta ou outro arquivo antes de enviar.')
    if (files.reduce((total, file) => total + file.content.length, 0) > PROPOSAL_EMAIL_MAX_BYTES) fail(400, 'Os anexos passam de 20 MB, o limite do e-mail.')

    // The copies are written before sending: an e-mail that went out always has its files; a failed one leaves nothing.
    const stored = files.map((file) => ({ ...file, id: randomUUID() }))
    await mkdir(filesDirectory, { recursive: true })
    const discard = () => Promise.all(stored.map((file) => rm(path.join(filesDirectory, file.id), { force: true }).catch(() => {})))
    try { await Promise.all(stored.map((file) => writeFile(path.join(filesDirectory, file.id), file.content))) } catch (error) { await discard(); throw error }
    const from = sender()
    try {
      await mailer.send({ from, to, cc, bcc: from, replyTo: from, subject, text: `${message}\n\n${signature}`.trim(), html: html(message, signatureHtml({ name: request.adminName, jobTitle, issuer })), attachments: [...stored.map((file) => ({ filename: file.name, content: file.content, contentType: file.contentType })), ...signatureAttachments(issuer)] })
    } catch (error) {
      await discard()
      console.error('Falha no envio do e-mail da proposta:', error)
      fail(502, `O e-mail não foi enviado. ${sendProblem(error)}`)
    }
    const { registered, warnings } = await registerContacts(offer, input.register, [...to, ...cc], actorOf(request))
    const record = { id: randomUUID(), sentAt: new Date().toISOString(), sentBy: request.adminId ?? null, sentByName: request.adminName || 'Administrador', from, to, cc, subject, message, signature, templateId, registered, attachments:stored.map(({ id, name, contentType, content, proposal }) => ({ id, name, contentType, size: content.length, proposal: Boolean(proposal) })) }
    const item = await mutateStore((store) => {
      const current = store.offers.find((entry) => entry.id === offer.id)
      if (!current) return null
      current.proposalEmails = [record, ...(current.proposalEmails || [])]
      return current
    })
    if (!item) console.error(`E-mail da proposta enviado, mas a oferta ${offer.code} sumiu antes do registro.`)
    response.status(201).json({ item, email: record, registered, warnings })
  }))

  router.get('/offers/:id/proposal-emails/:emailId/files/:fileId', requireAdmin, handle(async (request, response) => {
    const offer = (await readStore()).offers.find((item) => item.id === request.params.id)
    const file = offer?.proposalEmails?.find((email) => email.id === request.params.emailId)?.attachments.find((item) => item.id === request.params.fileId)
    if (!file) fail(404, 'Anexo não encontrado.')
    response.download(path.join(filesDirectory, file.id), file.name)
  }))
  return router
}
