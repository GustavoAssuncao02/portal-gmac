import express from 'express'
import { issueAdminToken } from './accounts.js'
import { enabled, isProduction } from './envFlags.js'
import { issueOperatorToken } from './operatorAuth.js'
import { operatorAccountConfigured, operatorLoginMatches } from './operatorAccount.js'
import { createLoginThrottle } from './loginThrottle.js'

export function testLoginEnabled(env = process.env) {
  return enabled(env.TEST_LOGIN_ENABLED) && !isProduction(env)
}

const blockedMessage = (retryAfterMs) => {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60000))
  return `Muitas tentativas de senha. Aguarde ${minutes === 1 ? 'um minuto' : `${minutes} minutos`} e tente novamente.`
}

export default function createLoginRouter(accounts, env = process.env, throttle = createLoginThrottle()) {
  const router = express.Router()
  router.get('/auth/config', (_request, response) => {
    response.set('Cache-Control', 'no-store').json({ testLoginEnabled: testLoginEnabled(env) })
  })
  router.post('/auth/operator-login', async (request, response, next) => {
    try {
      if (!testLoginEnabled(env)) {
        if (typeof request.body?.username !== 'string' || !/^\d{11}$/.test(request.body.username)) return response.status(400).json({ message: 'Informe os 11 dígitos do usuário, sem pontos ou traços.' })
        if (!await operatorAccountConfigured()) return response.status(503).json({ message: 'A conta compartilhada do operador ainda não foi configurada. Um administrador define o acesso em Configurações.' })
        if (!await operatorLoginMatches(request.body?.username, request.body?.password)) return response.status(401).json({ message: 'Usuário ou senha do operador inválidos.' })
      }
      return response.json({ token: issueOperatorToken(), role: 'operator' })
    } catch (error) { next(error) }
  })
  router.post('/auth/login', async (request, response) => {
    const { cpf, password } = request.body ?? {}
    const testing = testLoginEnabled(env)
    if (!testing) {
      if (!cpf || !password) return response.status(400).json({ message: 'Informe seu CPF e sua senha.' })
      if (typeof cpf !== 'string' || !/^\d{11}$/.test(cpf)) return response.status(400).json({ message: 'Informe os 11 dígitos do CPF, sem pontos ou traços.' })
    }
    // Brute-force guard (real credential path only): up to 5 wrong passwords per hour, per IP and CPF. A correct login
    // clears the count. The test access has no password, so it is not throttled.
    const throttleKey = testing ? null : `${request.ip}|${cpf}`
    if (throttleKey) {
      const blocked = throttle.check(throttleKey)
      if (blocked.blocked) return response.status(429).json({ message: blockedMessage(blocked.retryAfterMs), attemptsRemaining: 0 })
    }
    try {
      let user
      if (testing) {
        const typedCpf = String(cpf ?? '').replace(/\D/g, '')
        if (typedCpf) {
          // Without password, the CPF chooses the profile: 00000000000 is the administrator, 11111111111 the administrative
          // employee of tests; any other registered CPF enters its own account.
          user = await accounts.accountByCpf(typedCpf)
          if (!user) return response.status(401).json({ message: 'Nenhum administrador ou funcionário administrativo com este CPF.' })
        } else {
          const admins = await accounts.admins()
          const preferredCpf = String(env.DEMO_ADMIN_CPF || '').replace(/\D/g, '')
          user = admins.find((item) => item.cpf === preferredCpf) || admins[0]
          if (!user) return response.status(503).json({ message: 'Cadastre um administrador antes de usar o acesso de teste.' })
        }
      } else {
        user = await accounts.authenticate(cpf, password)
      }
      if (!user) {
        if (!throttleKey) return response.status(401).json({ message: 'CPF ou senha inválidos.' })
        // This wrong password still answers 401 (with how many tries are left); the next request, if the limit is
        // reached, is stopped by the check above with 429.
        const result = throttle.fail(throttleKey)
        return response.status(401).json({ message: 'CPF ou senha inválidos.', attemptsRemaining: result.remaining })
      }
      if (throttleKey) throttle.succeed(throttleKey)
      return response.json({ user, token: await issueAdminToken(user) })
    } catch (error) {
      console.error('Falha no login:', error)
      return response.status(500).json({ message: 'Não foi possível acessar o sistema agora.' })
    }
  })
  return router
}
