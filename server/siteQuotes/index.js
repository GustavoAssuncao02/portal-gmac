import { createSmtpTransport, describeSmtpError } from './smtp.js'
import { createQuotesApp } from './app.js'

// O formulário de orçamento do site principal (gmacmetalurgica.com.br), que antes rodava num programa separado (GMAC BACKEND)
// e agora roda dentro do portal. Sem banco e sem arquivos: cada orçamento vira um e-mail para o comercial.
// Variáveis: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM e QUOTES_ALLOWED_ORIGINS (os sites que podem
// enviar). Sem SMTP configurado o portal sobe normalmente e os orçamentos respondem 503 ("indisponível").
// O SMTP é verificado na partida e, enquanto falhar, de novo a cada 60 segundos; os envios só abrem depois da verificação.
const defaultOrigins = 'https://gmacmetalurgica.com.br,https://www.gmacmetalurgica.com.br'
const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']

export function quoteOrigins(value = defaultOrigins) {
  const origins = String(value || defaultOrigins).split(',').map((item) => item.trim()).filter(Boolean)
  for (const origin of origins) {
    let parsed
    try { parsed = new URL(origin).origin } catch { parsed = null }
    if (parsed !== origin) throw new Error(`QUOTES_ALLOWED_ORIGINS deve ter origens sem caminho e sem barra final (recebido: ${origin}).`)
  }
  return origins
}

export function createSiteQuotes(env = process.env, { log = console } = {}) {
  const origins = quoteOrigins(env.QUOTES_ALLOWED_ORIGINS)
  const missing = required.filter((key) => !env[key]?.trim())
  let ready = false, verifying = false, closed = false
  let smtpError = missing.length ? 'SMTP_CONFIG_MISSING' : null
  const transport = missing.length ? null : createSmtpTransport(env)
  async function verify() {
    if (!transport || verifying || ready || closed) return
    verifying = true
    try {
      await transport.verify()
      if (!closed) { ready = true; smtpError = null; log.log('Orçamentos do site: SMTP verificado, envio habilitado.') }
    } catch (error) {
      ready = false
      const diagnostic = describeSmtpError(error)
      smtpError = diagnostic.code
      log.error(`Orçamentos do site: ${diagnostic.code}: ${diagnostic.message} Nova tentativa em 60 segundos.`)
    } finally { verifying = false }
  }
  const app = createQuotesApp({
    sendMail: async (message) => {
      try { return await transport.sendMail(message) } catch (error) { ready = false; smtpError = describeSmtpError(error).code; throw error }
    },
    from: env.MAIL_FROM,
    origins, isReady: () => ready, getSmtpError: () => smtpError,
  })
  let retry = null
  return {
    app,
    start() {
      if (missing.length) { log.warn(`Orçamentos do site desligados: preencha ${missing.join(', ')} nas variáveis do portal e reinicie.`); return }
      void verify()
      retry = setInterval(() => void verify(), 60000)
      retry.unref()
    },
    close() { closed = true; ready = false; clearInterval(retry); transport?.close() },
  }
}
