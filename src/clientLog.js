import { releaseNotes } from './releaseNotes.js'

// Erros do navegador para os logs do sistema (tela Desenvolvedor, origem "Navegador"): telas que quebram, promessas
// rejeitadas sem tratamento e arquivos do portal que não carregam. Vão para POST /api/client-logs com a sessão aberta
// (administrador, administrativo ou tablet do operador); sem sessão esperam na fila até o login. O mesmo erro repetido em
// menos de um minuto vai uma vez só. Nunca envia o que está digitado nas telas.
const MAX_QUEUE = 20, REPEAT_MS = 60000, SEND_MS = 1500, RETRY_MS = 30000
const queue = [], lastSent = new Map()
let timer = null, installed = false

const sessionToken = () => window.sessionStorage.getItem('gmac-admin-token') || window.sessionStorage.getItem('gmac-operator-token')
function currentScreen() {
  if (window.sessionStorage.getItem('gmac-operator-token') && !window.sessionStorage.getItem('gmac-admin-token')) return 'Painel do operador'
  try { return JSON.parse(window.sessionStorage.getItem('gmac-admin-workspace') || 'null')?.activeNav || '' } catch { return '' }
}
// Noise that says nothing about the portal: browser extensions, the resize loop warning, errors of other sites' scripts.
const ignored = (message, stack) => /ResizeObserver loop|^Script error\.?$/i.test(message) || /(chrome|moz|safari(-web)?)-extension:\/\//.test(stack || '')

export function reportClientError({ message, stack = '', kind = 'erro', level = 'error', extra }) {
  try {
    const text = String(message || 'Erro sem mensagem').slice(0, 900)
    if (ignored(text, stack)) return
    const key = `${kind}|${text}`, at = Date.now()
    if (at - (lastSent.get(key) || 0) < REPEAT_MS) return
    lastSent.set(key, at)
    if (lastSent.size > 200) lastSent.clear()
    queue.push({ level, kind, message: text, stack: String(stack || '').slice(0, 6000), screen: currentScreen(), page: `${window.location.pathname}${window.location.hash}`, version: releaseNotes[0]?.version || '', viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}`, language: navigator.language, online: navigator.onLine, at, ...(extra ? { extra } : {}) })
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
    schedule(SEND_MS)
  } catch { /* reporting never breaks the screen */ }
}

function schedule(ms) { if (!timer) timer = window.setTimeout(send, ms) }
async function send() {
  timer = null
  if (!queue.length) return
  const token = sessionToken()
  if (!token) return schedule(RETRY_MS)
  const entries = queue.splice(0, 10)
  try {
    const response = await fetch('/api/client-logs', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ entries }), keepalive: true })
    // The server unreachable or failing: try again later. A refused session (401) drops them.
    if (response.status >= 500) throw new Error('server')
  } catch {
    queue.unshift(...entries.slice(0, Math.max(0, MAX_QUEUE - queue.length)))
    return schedule(RETRY_MS)
  }
  if (queue.length) schedule(SEND_MS)
}

export function installClientLog() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (event) => {
    // A script or stylesheet of the portal that did not load (an old tab after an update, a dropped connection).
    if (!(event instanceof ErrorEvent)) {
      const element = event.target
      if (element?.tagName === 'SCRIPT' || element?.tagName === 'LINK') reportClientError({ level: 'warn', kind: 'arquivo', message: `Falha ao carregar ${element.tagName === 'SCRIPT' ? 'o script' : 'o estilo'} ${element.src || element.href || ''}` })
      return
    }
    reportClientError({ kind: 'erro', message: event.message, stack: event.error?.stack || `${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}` })
  }, true)
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    if (reason?.name === 'AbortError') return
    reportClientError({ kind: 'promessa', message: reason?.message || String(reason), stack: reason?.stack || '' })
  })
}
