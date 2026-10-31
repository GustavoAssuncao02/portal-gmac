import express from 'express'
import { issueAdminToken } from './accounts.js'
import { enabled, isProduction } from './envFlags.js'
import { issueOperatorToken } from './operatorAuth.js'
import { operatorAccountConfigured, operatorLoginMatches } from './operatorAccount.js'
import { blockedMessage, createLoginThrottle } from './loginThrottle.js'

// This computer: 127.x.x.x, ::1 or localhost.
const loopback = (value) => /^(localhost|127(\.\d{1,3}){3}|::1|\[::1\])$/i.test(String(value ?? '').trim())

// The passwordless test access is only for a portal that stays on this computer: TEST_LOGIN_ENABLED=true, never with
// NODE_ENV=production, and only while the API listens on this computer alone (API_HOST, 127.0.0.1 by default, as in
// index.js) and reads a database on this computer (DB_HOST). A published portal listens on the network and reads the
// hosting database, so it always asks for the password, even with NODE_ENV missing or mistyped; anything missing or
// unexpected keeps the access off. On this computer the Vite proxy still opens the test portal to the local network.
export function testLoginEnabled(env = process.env) {
  return enabled(env.TEST_LOGIN_ENABLED) && !isProduction(env) && loopback(env.API_HOST || '127.0.0.1') && loopback(env.DB_HOST)
}

// Brute-force guards (real credential paths only; the test access has no password, so it is not throttled):
// - `throttle`: 5 wrong passwords per hour for each IP and CPF; a correct login clears that pair.
// - `origins`: 30 wrong passwords per hour from one IP, whatever the CPFs, so one address cannot try 5 passwords on each
//   of many CPFs. A correct login does not clear it (an attacker with an account of their own would reset it). It blocks
//   that address only: from anywhere else the account keeps working, so nobody locks somebody else's account.
// - `operators`: the shared operator account (one user for all the tablets) had no limit: 10 wrong passwords in 15
//   minutes from one IP, cleared by a correct login. The window is short because the tablets share the factory's address.
// Each block lasts until the oldest error leaves the window; while blocked, even the right password waits.
export default function createLoginRouter(accounts, env = process.env, throttle = createLoginThrottle(), { origins = createLoginThrottle({ limit: 30 }), operators = createLoginThrottle({ limit: 10, windowMs: 15 * 60000 }) } = {}) {
  const router = express.Router()
  router.get('/auth/config', (_request, response) => {
    response.set('Cache-Control', 'no-store').json({ testLoginEnabled: testLoginEnabled(env) })
  })
  router.post('/auth/operator-login', async (request, response, next) => {
    try {
      if (!testLoginEnabled(env)) {
        if (typeof request.body?.username !== 'string' || !/^\d{11}$/.test(request.body.username)) return response.status(400).json({ message: 'Informe os 11 dígitos do usuário, sem pontos ou traços.' })
        if (!await operatorAccountConfigured()) return response.status(503).json({ message: 'A conta compartilhada do operador ainda não foi configurada. Um administrador define o acesso em Configurações.' })
        const blocked = operators.check(request.ip)
        if (blocked.blocked) return response.status(429).json({ message: blockedMessage(blocked.retryAfterMs) })
        if (!await operatorLoginMatches(request.body?.username, request.body?.password)) {
          operators.fail(request.ip)
          return response.status(401).json({ message: 'Usuário ou senha do operador inválidos.' })
        }
        operators.succeed(request.ip)
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
    const throttleKey = testing ? null : `${request.ip}|${cpf}`
    if (throttleKey) {
      const blocked = [throttle.check(throttleKey), origins.check(request.ip)].find((item) => item.blocked)
      if (blocked) return response.status(429).json({ message: blockedMessage(blocked.retryAfterMs), attemptsRemaining: 0 })
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
        const remaining = Math.min(throttle.fail(throttleKey).remaining, origins.fail(request.ip).remaining)
        return response.status(401).json({ message: 'CPF ou senha inválidos.', attemptsRemaining: remaining })
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
