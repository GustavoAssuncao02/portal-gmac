import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const signingKey = process.env.SESSION_SECRET || randomBytes(32).toString('hex')

function sameText(left, right) {
  const leftHash = createHash('sha256').update(String(left)).digest()
  const rightHash = createHash('sha256').update(String(right)).digest()
  return timingSafeEqual(leftHash, rightHash)
}

export function operatorConfigured() {
  return /^\d{11}$/.test(String(process.env.OPERATOR_USERNAME || '').replace(/\D/g, '')) && Boolean(process.env.OPERATOR_PASSWORD)
}

export function operatorCredentialsMatch(username, password) {
  const configuredUsername = String(process.env.OPERATOR_USERNAME || '').replace(/\D/g, '')
  return operatorConfigured() && typeof username === 'string' && /^\d{11}$/.test(username) && sameText(username, configuredUsername) && sameText(password, process.env.OPERATOR_PASSWORD)
}

export function issueOperatorToken() {
  const payload = Buffer.from(JSON.stringify({ role: 'operator', exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url')
  const signature = createHmac('sha256', signingKey).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function requireOperator(request, response, next) {
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return response.status(401).json({ message: 'Entre novamente na conta do operador.' })
  const expected = createHmac('sha256', signingKey).update(payload).digest('base64url')
  if (!sameText(signature, expected)) return response.status(401).json({ message: 'Sessão do operador inválida.' })
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (data.role !== 'operator' || data.exp < Date.now()) return response.status(401).json({ message: 'Sessão do operador expirada.' })
    next()
  } catch {
    return response.status(401).json({ message: 'Sessão do operador inválida.' })
  }
}
