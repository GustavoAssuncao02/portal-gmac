import nodemailer from 'nodemailer'

export function createSmtpTransport(env = process.env) {
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'].filter(key => !env[key]?.trim())
  if (missing.length) throw Object.assign(new Error(`Configure ${missing.join(', ')} nas variáveis do portal (.env).`), { code: 'SMTP_CONFIG_MISSING' })
  const port = Number(env.SMTP_PORT || 587)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT inválida.')
  return nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: env.SMTP_SECURE === 'true',
    requireTLS: env.SMTP_SECURE !== 'true',
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 60000,
    disableFileAccess: true, disableUrlAccess: true,
  })
}

export function describeSmtpError(error) {
  const response = String(error.response || '')
  if (/SmtpClientAuthentication is disabled/i.test(response)) return {
    code: 'SMTP_AUTH_DISABLED',
    message: 'Microsoft 365 bloqueou SMTP AUTH. O administrador precisa habilitar o protocolo para a conta e conferir a política da organização.',
  }
  if (error.code === 'EAUTH') return {
    code: 'SMTP_AUTH_FAILED',
    message: 'Falha de autenticação SMTP. Confira a credencial e o método de autenticação autorizado no Microsoft 365.',
  }
  if (['ETIMEDOUT', 'ECONNECTION', 'ECONNREFUSED', 'EDNS', 'ESOCKET'].includes(error.code)) return {
    code: 'SMTP_CONNECTION_FAILED',
    message: 'Falha na conexão SMTP. Confira DNS, saída TCP 587 e firewall da hospedagem.',
  }
  return { code: error.code || 'SMTP_ERROR', message: error.code === 'SMTP_CONFIG_MISSING' ? error.message : 'Não foi possível verificar o servidor SMTP.' }
}
