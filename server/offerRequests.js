import express from 'express'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { rateLimit } from 'express-rate-limit'
import { dataDirectory } from './dataDirectory.js'
import { readStore, mutateStore, nextCode } from './offers.js'
import { receiveFile } from './uploads.js'
import { documentDigits, maskClientDocument } from './clientDocument.js'
import { addNotification } from './notificationEvents.js'
import { recordRegistryChange } from './registryHistory.js'
import { SITE_ACTOR } from './sitePreRegistration.js'

// Formulário público "Ofertar Serviço" do site gmacmetalurgica.com.br: três etapas (dados + captcha, anexos um a um,
// concluir) que terminam numa oferta "Criando oferta" com origem Site na tela Ofertas de serviços. As rotas ficam no
// mesmo app /gmac dos orçamentos da home (server/index.js), antes do CORS e do limite gerais da API, e só respondem
// às origens de QUOTES_ALLOWED_ORIGINS. O contrato (rotas, códigos e campos) está no README.
// O estado de cada envio fica em DATA_DIR/offer-requests/<ticket>/ (request.json + os arquivos já recebidos), para
// sobreviver a um reinício; envios não concluídos expiram em 6 horas e são apagados.
// Nenhuma resposta, nem de erro, revela se o CNPJ/CPF já é cliente da GMAC: a BrasilAPI é consultada para todo CNPJ
// (cadastrado ou não) e a etapa 3 responde sempre o mesmo { ok: true }.

const EXPIRY_MS = 6 * 3600000
const MAX_FILES = 10
const MAX_TOTAL_BYTES = 400 * 1024 * 1024
const RECIPIENT = 'comercial@gmacmetalurgica.com.br'
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA'
const unavailable = 'O envio de solicitações está indisponível no momento. Fale com a GMAC pelo WhatsApp.'
const defaultOrigins = 'https://gmacmetalurgica.com.br,https://www.gmacmetalurgica.com.br'
// Executáveis barrados pela última extensão do nome declarado, então desenho.pdf.exe também cai.
const blockedExtensions = new Set(['.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif', '.js', '.vbs', '.wsf', '.hta', '.jar', '.ps1', '.reg', '.lnk', '.cpl'])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const controlChars = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const requestsDirectory = path.join(dataDirectory, 'offer-requests')
const filesDirectory = path.join(dataDirectory, 'files')

const fail = (status, message, field, extra) => { throw Object.assign(new Error(message), { status, field, extra }) }
const upper = (value) => String(value ?? '').toLocaleUpperCase('pt-BR')
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

// Dígitos verificadores de CPF e CNPJ, só para a rota pública (o formulário interno continua com isClientDocument).
// Números com todos os dígitos iguais passam no cálculo do CPF, então são recusados à parte.
function checkDigit(digits, weights) {
  const sum = weights.reduce((total, weight, index) => total + weight * Number(digits[index]), 0)
  const rest = sum % 11
  return rest < 2 ? 0 : 11 - rest
}
export function validPublicDocument(value) {
  const digits = documentDigits(value)
  if (/^(\d)\1*$/.test(digits)) return false
  if (digits.length === 11) {
    const first = checkDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2])
    return first === Number(digits[9]) && checkDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(digits[10])
  }
  if (digits.length === 14) {
    const first = checkDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return first === Number(digits[12]) && checkDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(digits[13])
  }
  return false
}

// Hoje no fuso da empresa: o prazo solicitado não pode ser uma data passada.
const todayInBahia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

function textField(body, field, label, { limit, required = false }) {
  const value = body[field] ?? ''
  if (typeof value !== 'string' || controlChars.test(value)) fail(400, `Campo inválido: ${label}.`, field)
  const trimmed = value.trim()
  if (required && !trimmed) fail(400, `Preencha: ${label}.`, field)
  if (trimmed.length > limit) fail(400, `${label} passa de ${limit} caracteres.`, field)
  return trimmed
}

// As mesmas validações do site (contrato no README): quem chega aqui fora do site recebe os mesmos erros.
export function validateSubmission(body) {
  const digits = documentDigits(body.document)
  if (![11, 14].includes(digits.length) || !validPublicDocument(digits)) fail(400, 'Informe um CNPJ ou CPF válido.', 'document')
  const documentType = digits.length === 11 ? 'cpf' : 'cnpj'
  const company = textField(body, 'company', documentType === 'cpf' ? 'Nome completo' : 'Empresa', { limit: 160, required: true })
  const service = textField(body, 'service', 'Peça/Serviço', { limit: 160, required: true })
  const description = textField(body, 'description', 'Descrição do serviço', { limit: 5000, required: true })
  const requester = textField(body, 'requester', 'Solicitante', { limit: 120 })
  const buyer = textField(body, 'buyer', 'Comprador', { limit: 120 })
  const labelNumber = textField(body, 'labelNumber', 'Número da etiqueta', { limit: 80 })
  const deadline = String(body.deadline || '')
  if (!isDay(deadline)) fail(400, 'Informe um prazo solicitado válido.', 'deadline')
  if (deadline < todayInBahia()) fail(400, 'O prazo solicitado não pode ser uma data passada.', 'deadline')
  const quantity = Number(body.quantity)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000000) fail(400, 'Informe uma quantidade inteira a partir de 1.', 'quantity')
  const email = textField(body, 'email', 'E-mail', { limit: 160 })
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) fail(400, 'Informe um e-mail válido.', 'email')
  const whatsapp = textField(body, 'whatsapp', 'WhatsApp', { limit: 20 })
  if (whatsapp && !/^\d{10,11}$/.test(documentDigits(whatsapp))) fail(400, 'Informe o WhatsApp com DDD (10 ou 11 dígitos).', 'whatsapp')
  if (!email && !whatsapp) fail(400, 'Preencha pelo menos um contato: e-mail ou WhatsApp.', 'email')
  if (body.consent?.accepted !== true) fail(400, 'É preciso aceitar a Política de Privacidade e as Regras da solicitação.', 'consent')
  const policyVersion = String(body.consent?.policyVersion || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(policyVersion)) fail(400, 'Versão da política de privacidade inválida. Recarregue a página e tente de novo.', 'consent')
  const list = body.files ?? []
  if (!Array.isArray(list) || list.length > MAX_FILES) fail(400, `São no máximo ${MAX_FILES} arquivos.`, 'files')
  let total = 0
  const files = list.map((file) => {
    const name = path.basename(String(file?.name ?? '').replace(controlChars, '').trim()).slice(0, 180)
    if (!name || name === '.' || name === '..') fail(400, 'Um dos arquivos tem um nome inválido.', 'files')
    if (blockedExtensions.has(path.extname(name).toLowerCase())) fail(400, `O arquivo ${name} não é aceito: executáveis não podem ser enviados.`, 'files')
    const size = Number(file?.size)
    if (!Number.isInteger(size) || size <= 0) fail(400, `O arquivo ${name} está vazio ou com tamanho inválido.`, 'files')
    total += size
    return { name, size }
  })
  if (total > MAX_TOTAL_BYTES) fail(413, 'Os anexos devem somar até 400 MB.', 'files')
  return {
    fields: { document: digits, documentType, company, requester, buyer, service, deadline, quantity, labelNumber, description, email, whatsapp, policyVersion },
    files,
  }
}

// Confere o token do Turnstile na Cloudflare, com o IP do cliente. A chave secreta de teste (1x000...AA) sempre aprova
// e devolve um hostname próprio, então nela a checagem de hostname não se aplica (testes locais).
function defaultVerifyTurnstile(env) {
  return async (token, ip) => {
    const secret = String(env.TURNSTILE_SECRET_KEY || '').trim()
    const body = new URLSearchParams({ secret, response: token })
    if (ip) body.set('remoteip', ip)
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(10000) })
      const data = await response.json()
      if (!data?.success) return { ok: false }
      if (secret === TURNSTILE_TEST_SECRET) return { ok: true }
      const hostnames = String(env.TURNSTILE_HOSTNAMES || 'gmacmetalurgica.com.br,www.gmacmetalurgica.com.br').split(',').map((item) => item.trim()).filter(Boolean)
      return { ok: hostnames.includes(String(data.hostname || '')) }
    } catch { return { ok: false } }
  }
}

// Razão social na Receita (BrasilAPI), consultada para todo CNPJ, cadastrado ou não, para o tempo de resposta não
// denunciar quem é cliente. 404 é "não encontrado"; erro ou demora é "indisponível". Nunca recusa o envio.
async function defaultLookupCnpj(digits) {
  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
    if (response.status === 404) return { status: 'not-found' }
    if (!response.ok) return { status: 'unavailable' }
    const name = String((await response.json())?.razao_social || '').trim()
    return name ? { status: 'found', name } : { status: 'unavailable' }
  } catch { return { status: 'unavailable' } }
}

const statePath = (ticket) => path.join(requestsDirectory, ticket, 'request.json')
const expired = (state) => Date.parse(state.expiresAt) <= Date.now()
const ticketResponse = (state) => ({ ticket: state.ticket, files: state.files.map((file, index) => ({ index, fileId: file.fileId })), expiresAt: state.expiresAt })

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

// E-mail ao comercial, sem anexar os arquivos (só nome e tamanho). Uma falha aqui não desfaz a oferta: fica no log.
export function buildOfferEmail(offer, warnings = []) {
  const rows = [
    ['Oferta', offer.code],
    ['Empresa', offer.company],
    [offer.cnpj.replace(/\D/g, '').length === 11 ? 'CPF' : 'CNPJ', offer.cnpj],
    ['Solicitante', offer.requester],
    ['Comprador', offer.buyer],
    ['Peça/Serviço', offer.service],
    ['Quantidade', String(offer.quantity)],
    ['Prazo solicitado', offer.deadline.split('-').reverse().join('/')],
    ['Número da etiqueta', offer.labelNumber],
    ['E-mail informado', offer.siteContact?.email],
    ['WhatsApp informado', offer.siteContact?.whatsapp],
  ].filter(([, value]) => value)
  const files = (offer.attachments || []).map((file) => `${file.name} (${formatSize(file.size)})`)
  const text = [
    'NOVA OFERTA ADICIONADA AO PORTAL PELO SITE',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'DESCRIÇÃO',
    offer.description,
    ...(warnings.length ? ['', 'AVISOS', ...warnings.map((warning) => `- ${warning}`)] : []),
    '',
    `ANEXOS (${files.length})`,
    files.length ? files.map((file) => `- ${file}`).join('\n') : 'Nenhum arquivo anexado.',
    '',
    'A oferta está na tela Ofertas de serviços do portal, com o selo Site, aguardando alguém assumir.',
  ].join('\n')
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2d3d">
    <p><strong>Nova oferta adicionada ao portal pelo site.</strong></p>
    <table cellpadding="0" cellspacing="0">${rows.map(([label, value]) => `<tr><td style="padding:3px 14px 3px 0;color:#4a5d72">${esc(label)}</td><td style="padding:3px 0"><strong>${esc(value)}</strong></td></tr>`).join('')}</table>
    <p style="white-space:pre-wrap"><strong>Descrição:</strong><br>${esc(offer.description)}</p>
    ${warnings.length ? `<p><strong>Avisos:</strong><br>${warnings.map(esc).join('<br>')}</p>` : ''}
    <p><strong>Anexos (${files.length}):</strong><br>${files.length ? files.map(esc).join('<br>') : 'Nenhum arquivo anexado.'}</p>
    <p style="color:#4a5d72">A oferta está na tela Ofertas de serviços do portal, com o selo Site, aguardando alguém assumir.</p>
  </div>`
  return { subject: `Nova oferta adicionada ao portal pelo site - ${offer.code} - ${offer.company}`, text, html }
}

// `pool` é o banco dos clientes (nulo quando os clientes vivem no armazenamento do portal, como nos testes).
// `sendMail`/`from` vêm do SMTP dos orçamentos (server/siteQuotes); `verifyTurnstile` e `lookupCnpj` são trocáveis nos testes.
export default function createOfferRequestsRouter({ pool = null, accounts, sendMail, from, env = process.env, verifyTurnstile, lookupCnpj = defaultLookupCnpj, rateLimitMax = 5, expiryMs = EXPIRY_MS, log = console } = {}) {
  const verify = verifyTurnstile || defaultVerifyTurnstile(env)
  const origins = String(env.QUOTES_ALLOWED_ORIGINS || defaultOrigins).split(',').map((item) => item.trim()).filter(Boolean)
  const router = express.Router()
  // Um processo só, como as sessões: o estado em memória é a cópia do que está no disco.
  const states = new Map()
  const ticketByRequestId = new Map()

  async function saveState(state) {
    await mkdir(path.join(requestsDirectory, state.ticket), { recursive: true })
    await writeFile(statePath(state.ticket), JSON.stringify(state))
    states.set(state.ticket, state)
  }
  async function loadState(ticket) {
    if (!uuidPattern.test(ticket)) return null
    if (states.has(ticket)) return states.get(ticket)
    try {
      const state = JSON.parse(await readFile(statePath(ticket), 'utf8'))
      states.set(ticket, state)
      return state
    } catch { return null }
  }
  // Os envios abertos voltam do disco quando a API reinicia (o índice de requestId junto).
  const indexReady = (async () => {
    let tickets = []
    try { tickets = await readdir(requestsDirectory) } catch { return }
    for (const ticket of tickets) {
      const state = await loadState(ticket)
      if (state && !expired(state)) ticketByRequestId.set(state.requestId, state.ticket)
    }
  })()

  async function dropRequest(ticket) {
    const state = states.get(ticket)
    if (state) ticketByRequestId.delete(state.requestId)
    states.delete(ticket)
    await rm(path.join(requestsDirectory, ticket), { recursive: true, force: true }).catch(() => {})
  }
  // Envios com mais de 6 horas são apagados com os arquivos deles (também os concluídos, que já viraram oferta).
  async function sweep() {
    await indexReady
    let tickets = []
    try { tickets = await readdir(requestsDirectory) } catch { return }
    for (const ticket of tickets) {
      if (!uuidPattern.test(ticket)) continue
      const state = await loadState(ticket)
      if (!state || expired(state)) await dropRequest(ticket)
    }
  }
  const sweeper = setInterval(() => sweep().catch((error) => log.error('Falha ao limpar envios do site:', error.message)), 30 * 60000)
  sweeper.unref()
  router.sweepNow = sweep

  // Só as origens dos sites da GMAC; sem a chave do captcha, as três rotas respondem "indisponível" e o resto do portal
  // continua normal. As respostas nunca entram em cache.
  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store')
    const origin = request.get('origin')
    if (!origins.includes(origin)) return response.status(403).json({ error: 'Origem não permitida.' })
    response.set('Access-Control-Allow-Origin', origin)
    response.vary('Origin')
    response.set('Access-Control-Allow-Methods', 'POST, PUT, OPTIONS')
    response.set('Access-Control-Allow-Headers', 'Content-Type')
    if (request.method === 'OPTIONS') return response.sendStatus(204)
    if (!String(env.TURNSTILE_SECRET_KEY || '').trim()) return response.status(503).json({ error: unavailable })
    next()
  })

  const handle = (task) => async (request, response) => {
    try { await task(request, response) } catch (error) {
      if (!error.status) { log.error('Falha no Ofertar Serviço do site:', error); return response.status(500).json({ error: 'Não foi possível concluir o envio agora. Tente novamente em instantes.' }) }
      response.status(error.status).json({ error: error.message, ...(error.field ? { field: error.field } : {}), ...(error.extra || {}) })
    }
  }

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: rateLimitMax,
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.' },
  })

  // Etapa 1: dados + captcha. O mesmo requestId devolve o mesmo ticket, sem conferir o captcha de novo (o token só vale uma vez).
  router.post('/', limiter, express.json({ limit: '64kb' }), handle(async (request, response) => {
    const body = request.body ?? {}
    const requestId = String(body.requestId || '')
    if (!uuidPattern.test(requestId)) fail(400, 'Identificação do envio inválida. Recarregue a página e tente de novo.', 'requestId')
    await indexReady
    const known = ticketByRequestId.get(requestId)
    if (known) {
      const existing = await loadState(known)
      if (existing && !expired(existing)) return response.status(201).json(ticketResponse(existing))
    }
    const { fields, files } = validateSubmission(body)
    const token = String(body.turnstileToken || '')
    if (!token) fail(400, 'Confirme o captcha antes de enviar.', 'turnstileToken')
    if (!(await verify(token, request.ip)).ok) fail(400, 'Não foi possível confirmar o captcha. Recarregue a página e tente de novo.', 'turnstileToken')
    // A Receita é consultada já aqui e o resultado fica no envio; a etapa 3 não espera a BrasilAPI.
    const receita = fields.documentType === 'cnpj' ? await lookupCnpj(fields.document) : { status: 'none' }
    const at = new Date()
    const state = {
      ticket: randomUUID(), requestId, createdAt: at.toISOString(), expiresAt: new Date(at.getTime() + expiryMs).toISOString(),
      fields, receita, files: files.map((file) => ({ fileId: randomUUID(), ...file, received: false })), completed: null,
    }
    await saveState(state)
    ticketByRequestId.set(requestId, state.ticket)
    response.status(201).json(ticketResponse(state))
  }))

  async function openRequest(ticket) {
    const state = await loadState(String(ticket))
    if (!state || expired(state)) fail(404, 'Envio não encontrado ou expirado. Comece o envio de novo.')
    return state
  }

  // Etapa 2: um arquivo por requisição, binário, gravado direto no disco. Reenviar o mesmo fileId substitui o anterior.
  router.put('/:ticket/files/:fileId', handle(async (request, response) => {
    const state = await openRequest(request.params.ticket)
    if (state.completed) fail(409, 'Este envio já foi concluído.')
    const file = state.files.find((entry) => entry.fileId === request.params.fileId)
    if (!file) fail(404, 'Arquivo não esperado neste envio.')
    const declared = Number(request.get('content-length')) || 0
    if (declared && declared !== file.size) fail(400, 'O arquivo chegou com tamanho diferente do declarado. Reenvie o arquivo.')
    const received = await receiveFile(request, path.join(requestsDirectory, state.ticket), file.fileId)
    if (!received) fail(415, 'Envie o arquivo em binário, com Content-Type application/octet-stream.')
    if (received.size !== file.size) {
      await received.discard()
      fail(400, 'O arquivo chegou com tamanho diferente do declarado. Reenvie o arquivo.')
    }
    file.received = true
    await saveState(state)
    response.json({ ok: true })
  }))

  // Etapa 3: cria a oferta (e o pré-cadastro, se o documento for novo) de forma atômica e avisa o comercial.
  // A resposta é sempre igual, para cliente cadastrado ou novo; repetir a etapa 3 não cria outra oferta.
  router.post('/:ticket/complete', express.json({ limit: '4kb' }), handle(async (request, response) => {
    const state = await openRequest(request.params.ticket)
    if (state.completed) return response.json({ ok: true })
    const missing = state.files.filter((file) => !file.received).map((file) => file.fileId)
    if (missing.length) fail(409, 'Ainda faltam arquivos do envio.', undefined, { missing })

    const { fields, receita } = state
    const clients = await accounts.clients()
    const registered = clients.find((client) => documentDigits(client.document) === fields.document) || null
    // Nome do cliente: o do cadastro; senão a razão social da Receita; senão o digitado. Caixa alta, até 120 (clients.name).
    const name = (registered ? registered.name : upper(receita.status === 'found' ? receita.name : fields.company)).slice(0, 120)
    const warnings = []
    if (!registered && fields.documentType === 'cnpj') {
      // Possível filial: a raiz do CNPJ (8 primeiros dígitos) bate com um cliente já cadastrado.
      const root = fields.document.slice(0, 8)
      const relatives = clients.filter((client) => { const digits = documentDigits(client.document); return digits.length === 14 && digits.slice(0, 8) === root })
      for (const relative of relatives.slice(0, 3)) warnings.push(`Possível filial de ${relative.name} (CNPJ ${maskClientDocument(relative.document)}).`)
      if (receita.status === 'not-found') warnings.push('CNPJ não encontrado na Receita; nome informado pelo cliente.')
    }
    if (!registered) warnings.push('Pré-cadastro criado pelo site.')
    const notes = [
      fields.email && `E-mail informado: ${fields.email}`,
      fields.whatsapp && `WhatsApp informado: ${fields.whatsapp}`,
      ...warnings,
    ].filter(Boolean).join('\n')

    // Os arquivos vão para a pasta dos anexos antes do registro; se a oferta não for salva, eles voltam.
    await mkdir(filesDirectory, { recursive: true })
    const moved = []
    const restoreFiles = () => Promise.all(moved.map((fileId) => rename(path.join(filesDirectory, fileId), path.join(requestsDirectory, state.ticket, fileId)).catch(() => {})))
    for (const file of state.files) {
      await rename(path.join(requestsDirectory, state.ticket, file.fileId), path.join(filesDirectory, file.fileId)).catch(async (error) => { await restoreFiles(); throw error })
      moved.push(file.fileId)
    }

    // Pré-cadastro e oferta juntos: o INSERT do cliente só é confirmado com a gravação da oferta (commit/rollback do
    // armazenamento); sem banco de clientes (testes), o cliente entra na mesma transação do armazenamento.
    let connection = null
    let offer
    try {
      let preRegisteredClientId = null
      if (!registered && pool) {
        connection = await pool.getConnection()
        await connection.beginTransaction()
        const [result] = await connection.execute('INSERT INTO clients (name, email, document_type, document) VALUES (?, NULL, ?, ?)', [name, fields.documentType, fields.document])
        preRegisteredClientId = result.insertId
      }
      const at = new Date().toISOString()
      offer = await mutateStore((store) => {
        if (!registered && !pool) {
          preRegisteredClientId = randomUUID()
          store.clients ||= []
          store.clients.push({ id: preRegisteredClientId, name, documentType: fields.documentType, document: fields.document, email: null, notes: '', createdAt: at })
        }
        const code = nextCode('OF', [...store.offers, ...(store.discardedOffers || [])])
        const item = {
          id: randomUUID(), code, createdAt: at, createdBy: null, createdByName: SITE_ACTOR.name,
          cnpj: maskClientDocument(fields.document), company: name,
          requester: fields.requester, requesterId: null, buyer: fields.buyer, buyerId: null,
          deadline: fields.deadline, service: fields.service, quantity: fields.quantity, description: fields.description,
          labelNumber: fields.labelNumber, requestedAt: at, origin: 'Site', status: 'creating',
          attachments: state.files.map((file) => ({ id: file.fileId, name: file.name, size: file.size, contentType: 'application/octet-stream' })),
          resources: { materials: [], laborEntries: [] }, proposal: null, orderCode: null,
          notes,
          siteContact: { email: fields.email, whatsapp: fields.whatsapp },
          consent: { acceptedAt: state.createdAt, policyVersion: fields.policyVersion },
          siteRequest: { requestId: state.requestId, preRegisteredClientId },
        }
        store.offers.unshift(item)
        if (preRegisteredClientId != null) recordRegistryChange(store, {
          registry: 'clients', recordId: preRegisteredClientId, type: 'created', actor: SITE_ACTOR,
          after: { name, documentType: fields.documentType, document: fields.document, email: '', notes: '' },
          note: `Pré-cadastro criado pelo formulário Ofertar Serviço do site (oferta ${code}).`,
        })
        addNotification(store, { type: 'site-offer', offerId: item.id, title: 'Nova oferta pelo site', description: `${code} · ${name}` })
        return item
      }, { commit: () => connection?.commit(), rollback: () => connection?.rollback() })
    } catch (error) {
      await restoreFiles()
      throw error
    } finally { connection?.release() }

    state.completed = { at: new Date().toISOString(), offerId: offer.id, offerCode: offer.code }
    await saveState(state)
    // O e-mail falhando não desfaz nada: a oferta já está no portal e o sino avisou.
    if (sendMail) {
      const { subject, text, html } = buildOfferEmail(offer, warnings)
      sendMail({ from: from || RECIPIENT, to: RECIPIENT, subject, text, html, ...(fields.email ? { replyTo: fields.email } : {}) })
        .catch((error) => log.error(`E-mail da oferta ${offer.code} (site) não enviado: ${error.code || error.message}`))
    }
    response.json({ ok: true })
  }))

  // Erros dos leitores de corpo (JSON inválido, corpo acima de 64 KB) nas respostas do contrato.
  router.use((error, _request, response, _next) => {
    if (error.type === 'entity.too.large') return response.status(413).json({ error: 'O envio passa do tamanho máximo de 64 KB.' })
    if (error.status === 400 || error.statusCode === 400 || error.type === 'entity.parse.failed') return response.status(400).json({ error: 'Dados do envio inválidos.' })
    log.error('Falha no Ofertar Serviço do site:', error.message)
    response.status(error.status || 500).json({ error: error.status ? error.message : 'Não foi possível concluir o envio agora. Tente novamente em instantes.' })
  })
  return router
}
