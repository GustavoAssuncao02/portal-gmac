import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'

// Cadastros › Modelos de e-mail (2026-11-14): the texts of the e-mails sent with a proposal. Two come with the portal —
// "Proposta comercial" (a normal proposal) and "Medição de etiqueta" (the quote of an etiqueta, sent once the service is
// done) — and can be edited but not deleted. Anyone of the administrative portal (administrators and administrative
// employees) creates others, and every one is seen by all. On the e-mail screen the one of the kind of offer comes chosen
// and another can be picked. The {campos} are filled with the data of the offer when the e-mail is opened.
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const emailPattern = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/
const clean = (value, limit) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, limit)
const plain = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

export const builtinEmailTemplates = [
  {
    id: 'proposal', name: 'Proposta comercial', subject: 'Proposta comercial nº {numero} · {servico} · {empresa}', to: [], cc: [],
    message: ['{saudacao}', '', 'Segue em anexo a nossa proposta comercial nº {numero} para {cliente}, referente a {servico} ({quantidade}).', '', 'Ficamos à disposição para esclarecer qualquer dúvida. Se estiver de acordo, é só responder este e-mail para darmos andamento ao serviço.', '', 'Obrigado pela confiança!'].join('\n'),
  },
  {
    id: 'label', name: 'Medição de etiqueta', subject: 'MEDIÇÃO ETIQUETA Nº {etiqueta}', to: [], cc: [],
    message: ['Prezados,', '', 'Conforme programação, segue em anexo a medição referente aos serviços executados para análise e validação.', '', 'Etiqueta Nº: {etiqueta}', '', 'Solicitamos, por gentileza, a conferência e, estando tudo em conformidade, a aprovação da medição para prosseguimento do processo de faturamento.', '', 'Permanecemos à disposição para quaisquer esclarecimentos.'].join('\n'),
  },
]
export const emailTemplateFields = [
  ['saudacao', 'Olá com o primeiro nome do comprador (ou do solicitante): "Olá, Carla!"'],
  ['nome', 'Primeiro nome do comprador (ou do solicitante)'],
  ['numero', 'Número da proposta (cotação ou etiqueta)'],
  ['etiqueta', 'Número da etiqueta'],
  ['servico', 'Peça ou serviço'],
  ['cliente', 'Nome do cliente'],
  ['quantidade', 'Quantidade com a medida: "2 unidades", "2 pares" ou "2 conjuntos"'],
  ['empresa', 'Empresa emissora: GMAC Usinagem ou GMAC Metalúrgica'],
  ['oferta', 'Código da oferta'],
  ['os', 'Código da OS'],
]

// The list: the two of the portal first (as edited, when they were), then the others by name.
export function emailTemplates(store) {
  const saved = store.emailTemplates || []
  const builtin = builtinEmailTemplates.map((template) => ({ ...template, ...saved.find((item) => item.id === template.id), id: template.id, builtin: true }))
  const own = saved.filter((item) => !builtinEmailTemplates.some((template) => template.id === item.id)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  return [...builtin, ...own]
}

// "{campo}" becomes its value; an unknown name stays as typed, so a typo shows up in the e-mail before it goes.
export const fillTemplate = (text, values) => String(text ?? '').replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key] ?? '') : match)

function addresses(list, label) {
  const values = (Array.isArray(list) ? list : String(list ?? '').split(/[,;\s]+/)).map((item) => String(item).trim().toLowerCase()).filter(Boolean)
  const wrong = values.find((item) => !emailPattern.test(item))
  if (wrong) fail(`E-mail inválido em ${label}: ${wrong}`)
  return [...new Set(values)]
}

function templateFields(body) {
  const name = clean(body?.name, 80).replace(/\s+/g, ' ')
  const subject = clean(body?.subject, 250).replace(/\s+/g, ' ')
  const message = clean(body?.message, 20000)
  if (!name) fail('Informe o nome do modelo.')
  if (!subject) fail('Informe o assunto do e-mail.')
  if (!message) fail('Escreva o texto do e-mail.')
  const to = addresses(body?.to, 'Para'), cc = addresses(body?.cc, 'Cc')
  if (to.length + cc.length > 20) fail('São no máximo 20 destinatários.')
  return { name, subject, message, to, cc }
}

// The role shown under the name in the signature: each person fills in their own (Configurações › Dados da conta).
export const accountJobTitle = (store, accountId) => String(store.accountProfiles?.[String(accountId)]?.jobTitle || '').trim()

export default function createEmailTemplatesRouter(requireAdmin) {
  const router = express.Router()
  router.use(['/email-templates', '/account/email-signature'], requireAdmin)
  const handle = (task) => async (request, response) => {
    try { await task(request, response) } catch (error) {
      if (!error.status) console.error('Falha nos modelos de e-mail:', error)
      response.status(error.status || 500).json({ message: error.status ? error.message : 'Não foi possível salvar o modelo de e-mail.' })
    }
  }
  const author = (request) => ({ updatedAt: new Date().toISOString(), updatedByName: request.adminName || 'Administrador' })
  const uniqueName = (store, name, id) => { if (emailTemplates(store).some((item) => item.id !== id && plain(item.name) === plain(name))) fail('Já existe um modelo com este nome.', 409) }

  router.get('/email-templates', handle(async (_request, response) => {
    response.set('Cache-Control', 'no-store').json({ items: emailTemplates(await readStore()), fields: emailTemplateFields })
  }))
  router.post('/email-templates', handle(async (request, response) => {
    const fields = templateFields(request.body)
    const item = await mutateStore((store) => {
      uniqueName(store, fields.name)
      const created = { id: randomUUID(), ...fields, createdAt: new Date().toISOString(), createdByName: request.adminName || 'Administrador', ...author(request) }
      store.emailTemplates = [...(store.emailTemplates || []), created]
      return created
    })
    response.status(201).json({ item })
  }))
  router.put('/email-templates/:id', handle(async (request, response) => {
    const fields = templateFields(request.body)
    const item = await mutateStore((store) => {
      const builtin = builtinEmailTemplates.find((template) => template.id === request.params.id)
      const saved = (store.emailTemplates || []).find((entry) => entry.id === request.params.id)
      if (!builtin && !saved) fail('Modelo de e-mail não encontrado.', 404)
      uniqueName(store, fields.name, request.params.id)
      const next = { ...saved, id: request.params.id, ...fields, ...author(request) }
      store.emailTemplates = saved ? store.emailTemplates.map((entry) => entry === saved ? next : entry) : [...(store.emailTemplates || []), next]
      return emailTemplates(store).find((entry) => entry.id === request.params.id)
    })
    response.json({ item })
  }))
  // A template of the portal goes back to its original text; the others are deleted.
  router.delete('/email-templates/:id', handle(async (request, response) => {
    const builtin = builtinEmailTemplates.some((template) => template.id === request.params.id)
    const found = await mutateStore((store) => {
      const before = (store.emailTemplates || []).length
      store.emailTemplates = (store.emailTemplates || []).filter((entry) => entry.id !== request.params.id)
      return builtin || store.emailTemplates.length !== before
    })
    if (!found) fail('Modelo de e-mail não encontrado.', 404)
    response.json({ ok: true, restored: builtin })
  }))

  router.get('/account/email-signature', handle(async (request, response) => {
    response.set('Cache-Control', 'no-store').json({ jobTitle: accountJobTitle(await readStore(), request.adminId) })
  }))
  router.patch('/account/email-signature', handle(async (request, response) => {
    const jobTitle = clean(request.body?.jobTitle, 80).replace(/\s+/g, ' ')
    await mutateStore((store) => {
      store.accountProfiles ||= {}
      store.accountProfiles[String(request.adminId)] = { ...store.accountProfiles[String(request.adminId)], jobTitle, updatedAt: new Date().toISOString() }
    })
    response.json({ jobTitle })
  }))
  return router
}
