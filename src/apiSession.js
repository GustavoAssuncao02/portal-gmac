import { releaseNotes } from './releaseNotes.js'

// Every request of this browser to the API of the portal says which version of the interface made it: the build
// (__INTERFACE_VERSION__, the same one the "Nova versão" notice compares with /version.json) and the "1.0.NN" of the
// release notes. The Desenvolvedor screen shows the version of each person and the logs keep it with each request.
// A session the API refused (401: it ended or expired) is told to the screen once, so the portal goes back to the login
// instead of asking again and again. The login itself (/api/auth/...) answers 401 for a wrong password: not a session.
export const SESSION_EXPIRED_EVENT = 'gmac-session-expired'
export const interfaceBuild = typeof __INTERFACE_VERSION__ === 'string' ? __INTERFACE_VERSION__ : ''
export const interfaceRelease = releaseNotes[0]?.version || ''
let installed = false

function apiRoute(input) {
  try {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input?.url, window.location.href)
    return url.origin === window.location.origin && url.pathname.startsWith('/api/') ? url.pathname : null
  } catch { return null }
}

export function installApiSession() {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return
  installed = true
  const original = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const route = apiRoute(input)
    if (!route || input instanceof Request) return original(input, init)
    const headers = new Headers(init?.headers)
    if (interfaceBuild) headers.set('X-Portal-Version', interfaceBuild)
    if (interfaceRelease) headers.set('X-Portal-Release', interfaceRelease)
    const response = await original(input, { ...init, headers })
    const token = String(headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (response.status === 401 && token && !route.startsWith('/api/auth/')) {
      try { window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { token } })) } catch { /* never breaks the request */ }
    }
    return response
  }
}
