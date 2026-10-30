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

// "Enviar E-mail" on the proposal screen: once the proposal PDF is generated, it goes from the commercial account of the
// portal (MAIL_FROM, the same SMTP of the site quotes) to the client and the buyer registered for the offer. Everything is
// editable before sending: recipients, copy, subject, message, signature and attachments (the PDF can be removed, other
// files added). The commercial account gets a blind copy, so the e-mail also shows up in its Outlook. Each e-mail is kept
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

export function proposalEmailDraft({ store, offer, client, senderName, from }) {
  const buyer = (store.buyers || []).find((row) => row.id === offer.buyerId)
  const issuer = issuerOf(store, offer)
  const document = offer.proposal?.document
  const number = document?.quoteNumber || document?.number || document?.labelNumber || offer.code
  const greeting = firstName(offer.buyer) || firstName(offer.requester)
  return {
    from,
    to: [client?.email, buyer?.email].map((item) => String(item || '').trim().toLowerCase()).filter((item, index, list) => item && emailPattern.test(item) && list.indexOf(item) === index),
    cc: [],
    subject: `Proposta comercial nº ${number} · ${offer.service} · ${issuer.label}`,
    message: [`${greeting ? `Olá, ${greeting}!` : 'Olá!'}`, '', `Segue em anexo a nossa proposta comercial nº ${number} para ${offer.company}, referente a ${offer.service} (${offer.quantity} ${Number(offer.quantity) === 1 ? 'unidade' : 'unidades'}).`, '', 'Ficamos à disposição para esclarecer qualquer dúvida. Se estiver de acordo, é só responder este e-mail para darmos andamento ao serviço.', '', 'Obrigado pela confiança!'].join('\n'),
    signature: ['Atenciosamente,', '', senderName || 'Equipe Comercial', `Comercial · ${issuer.label}`, ...[[issuer.phone, issuer.email].filter(Boolean).join(' · '), issuer.website].filter(Boolean), '', 'Enviado pelo Sistema GMAC'].join('\n'),
  }
}

const sendProblem = (error) => {
  if (error.code === 'EAUTH' || /SmtpClientAuthentication is disabled/i.test(String(error.response || ''))) return 'A conta de e-mail do portal recusou o login (SMTP). Fale com o TI.'
  if (['ETIMEDOUT', 'ECONNECTION', 'ECONNREFUSED', 'EDNS', 'ESOCKET'].includes(error.code)) return 'Sem conexão com o servidor de e-mail. Tente de novo em instantes.'
  if (error.code === 'EENVELOPE') return 'O servidor de e-mail recusou um dos destinatários. Confira os endereços.'
  return 'O servidor de e-mail recusou o envio. Tente de novo ou fale com o TI.'
}

const html = (message, signature) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2d3d">${escapeHtml(message).replace(/\n/g, '<br>')}<br><br><div style="color:#4a5d72;border-top:1px solid #dce6ef;padding-top:12px">${escapeHtml(signature).replace(/\n/g, '<br>')}</div></div>`

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
    const draft = proposalEmailDraft({ store, offer, client, senderName: request.adminName, from: sender() })
    response.set('Cache-Control', 'no-store').json({ draft, contacts: contactsOf(store, offer, client), proposal: { name: pdf.name, size: pdf.content.length }, configured: mailer.configured(), maxBytes: PROPOSAL_EMAIL_MAX_BYTES })
  }))

  // A client or buyer without e-mail gets the address typed for it, once the e-mail went out, so the next one comes filled.
  // Only when it still has none and the address is among the recipients; a failure here does not undo the e-mail.
  async function registerContacts(offer, register, recipients) {
    const typed = (value) => { const email = String(value || '').trim().toLowerCase(); return emailPattern.test(email) && recipients.includes(email) ? email : '' }
    const registered = [], warnings = []
    const clientEmail = typed(register?.client)
    const client = clientEmail && await clientOf(offer)
    if (client && !client.email) {
      try { await accounts.save('clients', client.id, { ...client, email: clientEmail }); registered.push({ kind: 'client', name: client.name, email: clientEmail }) }
      catch (error) { warnings.push(`O e-mail ${clientEmail} não foi cadastrado para o cliente ${client.name}: ${error.status ? error.message : 'erro ao salvar.'}`) }
    }
    const buyerEmail = typed(register?.buyer)
    if (buyerEmail && offer.buyerId) {
      const buyer = await mutateStore((store) => {
        const row = (store.buyers || []).find((entry) => entry.id === offer.buyerId)
        if (!row || row.email) return null
        Object.assign(row, { email: buyerEmail, updatedAt: new Date().toISOString() })
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
    await new Promise((resolve, reject) => upload.array('files', MAX_FILES)(request, response, (error) => error ? reject(error) : resolve()))
    let input
    try { input = JSON.parse(request.body?.email || '{}') } catch { fail(400, 'Dados do e-mail inválidos.') }
    const to = addresses(input.to, 'Para'), cc = addresses(input.cc, 'Cc')
    if (!to.length) fail(400, 'Informe pelo menos um destinatário em Para.')
    if (to.length + cc.length > MAX_RECIPIENTS) fail(400, `São no máximo ${MAX_RECIPIENTS} destinatários.`)
    const subject = clean(input.subject, 250).replace(/\s+/g, ' ')
    if (!subject) fail(400, 'Informe o assunto do e-mail.')
    const message = clean(input.message, 20000), signature = clean(input.signature, 2000)
    if (!message) fail(400, 'Escreva a mensagem do e-mail.')
    const { offer } = await offerWithProposal(request.params.id)
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
      await mailer.send({ from, to, cc, bcc: from, replyTo: from, subject, text: `${message}\n\n${signature}`.trim(), html: html(message, signature), attachments: stored.map((file) => ({ filename: file.name, content: file.content, contentType: file.contentType })) })
    } catch (error) {
      await discard()
      console.error('Falha no envio do e-mail da proposta:', error)
      fail(502, `O e-mail não foi enviado. ${sendProblem(error)}`)
    }
    const { registered, warnings } = await registerContacts(offer, input.register, [...to, ...cc])
    const record = { id: randomUUID(), sentAt: new Date().toISOString(), sentBy: request.adminId ?? null, sentByName: request.adminName || 'Administrador', from, to, cc, subject, message, signature, registered, attachments:stored.map(({ id, name, contentType, content, proposal }) => ({ id, name, contentType, size: content.length, proposal: Boolean(proposal) })) }
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
