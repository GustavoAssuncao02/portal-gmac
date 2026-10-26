// npm run check:smtp: tests the connection, TLS and login of the e-mail account used by the quotes of the main site
// (server/siteQuotes), with the SMTP_* variables of the portal's .env. No e-mail is sent.
import 'dotenv/config'
import { createSmtpTransport, describeSmtpError } from '../server/siteQuotes/smtp.js'

let transport
try {
  transport = createSmtpTransport()
  await transport.verify()
  console.log('SMTP verificado: conexão, TLS e autenticação aprovados. Nenhum e-mail foi enviado.')
} catch (error) {
  const diagnostic = describeSmtpError(error)
  console.error(`${diagnostic.code}: ${diagnostic.message}`)
  if (error.responseCode) console.error(`Código retornado pelo servidor SMTP: ${error.responseCode}`)
  process.exitCode = 1
} finally { transport?.close() }
