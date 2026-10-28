import express from 'express'
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'

// "Esqueci minha senha": the CPF receives, at the e-mail of its registration, a 6-digit code valid for 15 minutes. The
// right code gives a short-lived token that sets the new password. Every request is a row of `passwordResets` (in MySQL
// like the rest of the store, so codes survive a restart and the history stays): the same row holds the code (only its
// hash), the attempts and how it ended. The answer is the same whether the CPF exists or not: an unknown CPF also gets a
// row, with a code nobody receives, so asking for codes or trying them tells nothing about who has an account.
// Password changes made by an administrator or by the user in Configurações are written to the same history.
export const CODE_MINUTES = 15
const CODE_MS = CODE_MINUTES * 60000
const TOKEN_MS = 15 * 60000
const MAX_ATTEMPTS = 5
const RESEND_MS = 60000
const HOUR_MS = 3600000
const PER_CPF_HOUR = 5
const PER_IP_HOUR = 10
// Requests that never became a new password are kept 90 days; completed resets and the other changes stay.
const KEEP_OPEN_MS = 90 * 24 * HOUR_MS
const HISTORY_LIMIT = 300
const GENERIC = 'Se o CPF estiver cadastrado, enviamos um código para o e-mail dele.'
const INVALID = 'Código inválido ou expirado. Peça um novo código.'
const digits = (value) => String(value ?? '').replace(/\D/g, '')
const hash = (salt, value) => createHash('sha256').update(`${salt}:${value}`).digest()
const sameHash = (stored, salt, value) => Boolean(stored) && timingSafeEqual(Buffer.from(stored, 'hex'), hash(salt, value))
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const bahiaTime = (at) => new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })
const open = (row, now) => row.kind === 'email' && row.open && row.expiresAt > now && row.attempts < MAX_ATTEMPTS

// The SMTP of the portal (the same account that sends the site quotes). Without it the request answers that the
// recovery is unavailable, the same way for every CPF. The SMTP module is loaded on the first e-mail only.
export function createMailer(env = process.env) {
  let transport = null
  const configured = () => ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'].every((key) => env[key]?.trim())
  return {
    configured,
    send: async (message) => {
      transport ||= (await import('./siteQuotes/smtp.js')).createSmtpTransport(env)
      return transport.sendMail({ from: env.MAIL_FROM, ...message })
    },
  }
}

const mail = {
  code: (account, code) => ({
    to: account.email,
    subject: 'Portal GMAC: código para redefinir sua senha',
    text: `Olá, ${account.name}.\n\nSeu código para redefinir a senha do Portal GMAC é: ${code}\n\nEle vale por ${CODE_MINUTES} minutos e só pode ser usado uma vez.\n\nSe você não pediu este código, ignore este e-mail: sua senha continua a mesma. Se receber códigos que não pediu, avise o TI.`,
    html: `<p>Olá, ${escapeHtml(account.name)}.</p><p>Seu código para redefinir a senha do Portal GMAC é:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>Ele vale por ${CODE_MINUTES} minutos e só pode ser usado uma vez.</p><p>Se você não pediu este código, ignore este e-mail: sua senha continua a mesma. Se receber códigos que não pediu, avise o TI.</p>`,
  }),
  changed: (account, at) => ({
    to: account.email,
    subject: 'Portal GMAC: sua senha foi alterada',
    text: `Olá, ${account.name}.\n\nA senha do Portal GMAC da sua conta foi redefinida em ${bahiaTime(at)} (horário da Bahia), com o código enviado para este e-mail.\n\nSe foi você, não precisa fazer nada. Se não foi você, avise o TI imediatamente.`,
    html: `<p>Olá, ${escapeHtml(account.name)}.</p><p>A senha do Portal GMAC da sua conta foi redefinida em <strong>${bahiaTime(at)}</strong> (horário da Bahia), com o código enviado para este e-mail.</p><p>Se foi você, não precisa fazer nada. <strong>Se não foi você, avise o TI imediatamente.</strong></p>`,
  }),
}

// A password set by an administrator (`by`) or by the user in Configurações, for the history of passwords.
export async function recordPasswordChange(kind, account, by = null) {
  const at = new Date().toISOString()
  await mutateStore((store) => {
    store.passwordResets ||= []
    store.passwordResets.push({ id: randomUUID(), kind, userKey: String(account.id), userName: account.name || '', cpf: digits(account.cpf), email: account.email || '', requestedAt: at, completedAt: at, byId: by ? String(by.id) : null, byName: by?.name || null, status: 'completed' })
  })
}

const statusLabels = { sent: 'Código enviado', verified: 'Código confirmado', completed: 'Senha redefinida', blocked: `Bloqueado após ${MAX_ATTEMPTS} tentativas erradas`, superseded: 'Substituído por um novo código', unknown: 'CPF não cadastrado', no_email: 'Conta sem e-mail cadastrado', send_failed: 'Falha ao enviar o e-mail', expired: 'Código expirado' }
export function historyRow(row, now = Date.now()) {
  const expired = row.kind === 'email' && ['sent', 'verified'].includes(row.status) && (row.status === 'sent' ? row.expiresAt : row.tokenExpiresAt) <= now
  const status = row.kind === 'admin' ? `Senha alterada por ${row.byName || 'um administrador'}` : row.kind === 'self' ? 'Senha alterada pelo próprio usuário em Configurações' : statusLabels[expired ? 'expired' : row.status] || row.status
  return { id: row.id, kind: row.kind, at: row.requestedAt, completedAt: row.completedAt || null, name: row.userName || null, cpf: row.cpf, email: row.email || null, ip: row.ip || null, status, done: row.status === 'completed' }
}

export default function createPasswordResetRouter(accounts, requireAdmin, { mailer = createMailer(), throttle = null, now = Date.now } = {}) {
  const router = express.Router()
  const handle = (fn) => async (request, response) => {
    try { await fn(request, response) } catch (error) {
      if (!error.status) console.error('Falha na recuperação de senha:', error)
      response.status(error.status || 500).json({ message: error.status ? error.message : 'Não foi possível concluir agora. Tente novamente ou fale com o TI.' })
    }
  }
  const sendLater = (id, message) => mailer.send(message).catch(async (error) => {
    console.error('Falha ao enviar o e-mail de recuperação de senha:', error.code || error.message)
    if (id) await mutateStore((store) => { const row = store.passwordResets?.find((item) => item.id === id); if (row?.status === 'sent') row.status = 'send_failed' }).catch(() => {})
  })

  router.post('/auth/password-reset/request', handle(async (request, response) => {
    const cpf = digits(request.body?.cpf)
    if (!/^\d{11}$/.test(cpf) || typeof request.body?.cpf !== 'string') fail(400, 'Informe os 11 dígitos do CPF, sem pontos ou traços.')
    if (!mailer.configured()) fail(503, 'A recuperação de senha por e-mail ainda não está disponível. Fale com o TI para redefinir sua senha.')
    const account = await accounts.accountByCpf(cpf)
    const reachable = account && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email || '')
    const code = String(randomInt(1000000)).padStart(6, '0'), id = randomUUID(), salt = randomBytes(16).toString('hex'), at = now()
    await mutateStore((store) => {
      store.passwordResets ||= []
      store.passwordResets = store.passwordResets.filter((row) => row.kind !== 'email' || row.status === 'completed' || at - Date.parse(row.requestedAt) < KEEP_OPEN_MS)
      const recent = store.passwordResets.filter((row) => row.kind === 'email' && at - Date.parse(row.requestedAt) < HOUR_MS)
      const mine = recent.filter((row) => row.cpf === cpf)
      if (mine.some((row) => at - Date.parse(row.requestedAt) < RESEND_MS)) fail(429, 'Aguarde um minuto para pedir outro código.')
      if (mine.length >= PER_CPF_HOUR || recent.filter((row) => row.ip === request.ip).length >= PER_IP_HOUR) fail(429, 'Muitos pedidos de código. Tente novamente mais tarde ou fale com o TI.')
      // Only the newest code of a CPF works.
      for (const row of mine) if (row.open) { row.open = false; if (row.status === 'sent') row.status = 'superseded' }
      store.passwordResets.push({
        id, kind: 'email', userKey: account ? String(account.id) : null, userName: account?.name || null, cpf, email: reachable ? account.email : null, ip: request.ip,
        requestedAt: new Date(at).toISOString(), expiresAt: at + CODE_MS, salt,
        // Without an account (or an e-mail) the hash is of random bytes: no 6-digit code ever matches it.
        codeHash: hash(salt, reachable ? code : randomBytes(16).toString('hex')).toString('hex'),
        attempts: 0, open: true, status: !account ? 'unknown' : reachable ? 'sent' : 'no_email',
      })
    })
    // Sent after answering, so the time of the answer does not tell whether the CPF has an account.
    if (reachable) sendLater(id, mail.code(account, code))
    response.json({ message: GENERIC, expiresInMinutes: CODE_MINUTES })
  }))

  router.post('/auth/password-reset/verify', handle(async (request, response) => {
    const cpf = digits(request.body?.cpf), code = String(request.body?.code ?? '').trim(), at = now()
    if (!/^\d{11}$/.test(cpf)) fail(400, 'Informe os 11 dígitos do CPF, sem pontos ou traços.')
    if (!/^\d{6}$/.test(code)) fail(400, 'Informe os 6 dígitos do código.')
    const token = randomBytes(32).toString('hex')
    const result = await mutateStore((store) => {
      const row = [...(store.passwordResets || [])].reverse().find((item) => item.cpf === cpf && item.kind === 'email' && item.open)
      if (!row || !open(row, at)) return { error: INVALID }
      if (!sameHash(row.codeHash, row.salt, code)) {
        row.attempts += 1
        if (row.attempts < MAX_ATTEMPTS) { const left = MAX_ATTEMPTS - row.attempts; return { error: `Código incorreto. ${left} ${left === 1 ? 'tentativa restante' : 'tentativas restantes'}.` } }
        row.open = false
        if (['sent', 'send_failed'].includes(row.status)) row.status = 'blocked'
        return { error: `Código bloqueado após ${MAX_ATTEMPTS} tentativas erradas. Peça um novo código.` }
      }
      Object.assign(row, { open: false, codeHash: null, status: 'verified', verifiedAt: new Date(at).toISOString(), tokenHash: hash(row.salt, token).toString('hex'), tokenExpiresAt: at + TOKEN_MS })
      return { id: row.id }
    })
    if (result.error) fail(400, result.error)
    response.json({ resetToken: `${result.id}.${token}` })
  }))

  router.post('/auth/password-reset/complete', handle(async (request, response) => {
    const [id, token] = String(request.body?.resetToken ?? '').split('.'), password = request.body?.password, at = now()
    if (typeof password !== 'string' || password.length < 6 || password.length > 72) fail(400, 'A nova senha deve ter entre 6 e 72 caracteres.')
    const expired = 'O tempo para redefinir a senha acabou. Peça um novo código.'
    // The token is claimed inside the write, so it sets one password only.
    const row = await mutateStore((store) => {
      const item = store.passwordResets?.find((entry) => entry.id === id && entry.kind === 'email')
      if (!item || item.status !== 'verified' || item.tokenExpiresAt <= at || !token || !sameHash(item.tokenHash, item.salt, token)) fail(400, expired)
      item.status = 'completing'
      return { ...item }
    })
    try {
      const account = await accounts.setPassword(row.userKey, password)
      const finished = new Date(now()).toISOString()
      await mutateStore((store) => { const item = store.passwordResets.find((entry) => entry.id === id); Object.assign(item, { status: 'completed', tokenHash: null, completedAt: finished, completedIp: request.ip }) })
      throttle?.clearCpf(row.cpf)
      sendLater(null, mail.changed(account, finished))
    } catch (error) {
      await mutateStore((store) => { const item = store.passwordResets.find((entry) => entry.id === id); if (item?.status === 'completing') item.status = 'verified' }).catch(() => {})
      throw error
    }
    response.json({ message: 'Senha redefinida. Entre com o seu CPF e a nova senha.' })
  }))

  // The history of passwords, for administrators only (not the administrative employees).
  router.get('/password-resets', requireAdmin, handle(async (request, response) => {
    if (request.adminRole === 'staff') fail(403, 'Somente administradores veem o histórico de senhas.')
    const rows = [...((await readStore()).passwordResets || [])].reverse().slice(0, HISTORY_LIMIT)
    response.set('Cache-Control', 'no-store').json({ items: rows.map((row) => historyRow(row, now())) })
  }))
  return router
}
