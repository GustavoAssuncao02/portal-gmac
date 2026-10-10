import { rateLimit } from 'express-rate-limit'

export function createApiRateLimiter({ windowMs = 60_000, limit = 200 } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: `Limite de ${limit} requisições por minuto atingido. Aguarde e tente novamente.` },
  })
}
