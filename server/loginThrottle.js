// Limita as tentativas de login que erram a senha: até `limit` erros por `windowMs` (uma hora), por IP e CPF juntos.
// Acertar zera a contagem daquele par. Um acerto nunca é barrado; só os erros contam, então ninguém trava a conta de
// outra pessoa de um IP diferente. É em memória, como o resto das sessões (um processo da API).
const WINDOW_MS = 60 * 60 * 1000
const LIMIT = 5

export function createLoginThrottle({ limit = LIMIT, windowMs = WINDOW_MS, now = Date.now } = {}) {
  const failures = new Map()
  const recent = (key) => {
    const since = now() - windowMs
    const times = (failures.get(key) || []).filter((at) => at > since)
    if (times.length) failures.set(key, times); else failures.delete(key)
    return times
  }
  const state = (times) => {
    const blocked = times.length >= limit
    return {
      blocked,
      remaining: Math.max(0, limit - times.length),
      retryAfterMs: blocked ? Math.max(0, times[0] + windowMs - now()) : 0,
    }
  }
  return {
    // Antes de conferir a senha: diz se o par já está bloqueado.
    check: (key) => state(recent(key)),
    // Registra um erro de senha e devolve quantas tentativas ainda restam (ou se bloqueou agora).
    fail: (key) => { const times = recent(key); times.push(now()); failures.set(key, times); return state(times) },
    // Acerto: zera a contagem daquele par.
    succeed: (key) => failures.delete(key),
    get size() { return failures.size },
  }
}
