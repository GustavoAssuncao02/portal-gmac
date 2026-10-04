import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { payableRequest } from './payablesApi.js'

export const ThemeContext = createContext(null)
export const useAccountAppearance = () => useContext(ThemeContext)
const key = (id) => `gmac-theme-${id}`
const cached = (id) => {
  try { return localStorage.getItem(key(id)) === 'dark' ? 'dark' : 'light' } catch { return 'light' }
}
const remember = (id, theme) => { try { localStorage.setItem(key(id), theme) } catch { /* The server preference still works when browser storage is disabled. */ } }

export function useAccountTheme(user, restoring) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const identity = useRef(user?.id)
  identity.current = user?.id
  useLayoutEffect(() => {
    if (!restoring) setTheme(user?.id == null ? 'light' : cached(user.id))
  }, [user?.id, restoring])
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d1c2e' : '#ffffff')
  }, [theme])
  useEffect(() => {
    if (restoring) return undefined
    setError(''); setMessage(''); setBusy(false)
    if (user?.id == null) { setTheme('light'); setLoading(false); return undefined }
    const id = user.id
    const controller = new AbortController()
    setLoading(true)
    setTheme(cached(id))
    async function load() {
      try {
        const response = await fetch('/api/account/appearance', { headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}` }, signal: controller.signal, cache: 'no-store' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Não foi possível carregar a aparência da conta.')
        if (!controller.signal.aborted) { setTheme(data.settings.theme); remember(id, data.settings.theme) }
      } catch (caught) { if (!controller.signal.aborted) setError(caught.message) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    load()
    return () => controller.abort()
  }, [user?.id, restoring, retry])
  async function changeTheme(next) {
    if (busy || loading || !['light', 'dark'].includes(next) || next === theme) return
    const id = user?.id
    const previous = theme
    setTheme(next); setBusy(true); setError(''); setMessage('')
    try {
      const data = await payableRequest('/account/appearance', 'PATCH', { theme: next })
      if (identity.current === id) { setTheme(data.settings.theme); remember(id, data.settings.theme); setMessage('Aparência salva.') }
    } catch (caught) { if (identity.current === id) { setTheme(previous); setError(caught.message) } }
    finally { if (identity.current === id) setBusy(false) }
  }
  return { theme, changeTheme, busy, loading, error, message, retry: () => setRetry((value) => value + 1) }
}
