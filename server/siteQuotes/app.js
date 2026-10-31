import express from 'express'
import multer from 'multer'
import { rateLimit } from 'express-rate-limit'
import { extname } from 'node:path'
import { buildQuoteEmail } from './email.js'

// Orçamentos do site gmacmetalurgica.com.br: POST /api/quotes (multipart) vira um e-mail para o comercial, com os anexos.
// Publicado pelo portal em /gmac (server/index.js), o mesmo caminho que o site já usava no servidor anterior.
const recipient = 'comercial@gmacmetalurgica.com.br'
const fields = {
  companyName: 'Empresa', cnpj: 'CNPJ', contactName: 'Contato', email: 'E-mail',
  phone: 'Telefone', role: 'Cargo / função', serviceType: 'Serviço', material: 'Material',
  quantity: 'Quantidade', dimensions: 'Dimensões', description: 'Descrição',
  deadline: 'Prazo desejado', notes: 'Observações',
}
const fail = (message, status = 400) => Object.assign(new Error(message), { status })

// Sem `trustProxy`, a aplicação montada no portal herda o TRUST_PROXY dele (o IP real do visitante no limite de tentativas).
export function createQuotesApp({ sendMail, from, origins, trustProxy, rateLimitMax = 5, isReady = () => true, getSmtpError = () => null }) {
  const app = express()
  app.disable('x-powered-by')
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy)
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    res.set('X-Content-Type-Options', 'nosniff')
    next()
  })
  app.get('/api/health', (_req, res) => {
    const ready = isReady()
    const smtpError = ready ? null : getSmtpError()
    res.status(ready ? 200 : 503).json({ ok: ready, service: 'gmac-backend', smtpReady: ready, ...(smtpError ? { smtpError } : {}) })
  })
  app.use('/api/quotes', (req, res, next) => {
    if (!origins.includes(req.get('origin'))) return res.status(403).json({ error: 'Origem não autorizada.' })
    res.set('Access-Control-Allow-Origin', req.get('origin'))
    res.vary('Origin')
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.set('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    if (!isReady()) return res.status(503).json({ error: 'O envio de orçamentos está temporariamente indisponível. Entre em contato pelo WhatsApp.' })
    next()
  })
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: rateLimitMax,
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.' },
  })
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 10, fields: 13, fieldSize: 8000, parts: 23 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['.pdf', '.dwg', '.dxf', '.jpg', '.jpeg', '.png']
      cb(allowed.includes(extname(file.originalname).toLowerCase()) ? null : fail('Formato de arquivo não permitido.'), true)
    },
  }).array('files', 10)
  // Limita uploads simultaneos para conter o uso de memoria nesta instancia.
  let active = 0
  app.post('/api/quotes', limiter, (req, res, next) => {
    if (active >= 2) return res.status(503).json({ error: 'Serviço ocupado. Tente novamente em instantes.' })
    if (!req.is('multipart/form-data')) return res.status(415).json({ error: 'Envie o formulário com multipart/form-data.' })
    // The files are kept in memory: a form announced over 25 MB of files plus the fields, which would be refused after
    // the upload anyway, is refused before it takes up memory.
    if (Number(req.get('content-length')) > 26 * 1024 * 1024) return res.status(413).json({ error: 'Verifique os limites: 10 arquivos, 10 MB por arquivo e 25 MB no total, e o tamanho dos campos.' })
    active++
    let released = false
    const release = () => { if (!released) { released = true; active-- } }
    res.once('finish', release)
    res.once('close', release)
    next()
  }, upload, async (req, res, next) => {
    try {
      const values = {}
      for (const key of Object.keys(req.body || {})) {
        if (!Object.hasOwn(fields, key)) throw fail('Campo desconhecido no formulário.')
      }
      for (const key of Object.keys(fields)) {
        const value = req.body?.[key] ?? ''
        const max = key === 'description' ? 1000 : key === 'notes' ? 500 : 254
        if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw fail(`Campo inválido: ${fields[key]}.`)
        values[key] = value.trim()
      }
      for (const key of ['companyName', 'cnpj', 'contactName', 'email', 'phone', 'serviceType', 'description']) {
        if (!values[key]) throw fail(`Preencha: ${fields[key]}.`)
      }
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(values.email)) throw fail('E-mail inválido.')
      if (values.cnpj.replace(/\D/g, '').length !== 14) throw fail('CNPJ inválido.')
      if (!/^\d{10,11}$/.test(values.phone.replace(/\D/g, ''))) throw fail('Telefone inválido.')
      const files = req.files || []
      if (files.reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024) throw fail('Os anexos devem somar até 25 MB.', 413)
      const attachments = files.map((file) => ({
        filename: file.originalname.replace(/[/\\\r\n\x00-\x1f]/g, '_'),
        content: file.buffer,
        contentType: 'application/octet-stream',
      }))
      const { html, text } = buildQuoteEmail(values, attachments.map((file, index) => ({ name: file.filename, size: files[index].size })))
      const result = await sendMail({
        from, to: recipient, replyTo: values.email,
        subject: `Orçamento GMAC - ${values.companyName.replace(/[\r\n]/g, ' ')}`,
        text, html, attachments,
      })
      if (!result.accepted?.some((address) => String(address).toLowerCase() === recipient)) throw new Error('SMTP recipient rejected')
      res.json({ ok: true })
    } catch (error) { next(error) }
  })
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) return res.status(413).json({ error: 'Verifique os limites: 10 arquivos, 10 MB por arquivo e 25 MB no total, e o tamanho dos campos.' })
    if (error.status) return res.status(error.status).json({ error: error.message })
    console.error('Falha no envio de orçamento:', error.code || error.name)
    res.status(502).json({ error: 'Não foi possível confirmar o envio. Seus dados foram mantidos; tente novamente mais tarde.' })
  })
  return app
}
