import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { payableRequest } from './payablesApi.js'

export const ThemeContext = createContext(null)
export const useAccountAppearance = () => useContext(ThemeContext)
const key = (id) => `gmac-theme-${id}`
const fontKey = (id) => `gmac-font-size-${id}`
const familyKey = (id) => `gmac-font-family-${id}`
const normalizeFont = (value) => ['small', 'large'].includes(value) ? value : 'default'
const normalizeFamily = (value) => ['system', 'verdana', 'tahoma', 'inter', 'roboto', 'open-sans', 'montserrat', 'source-sans-3'].includes(value) ? value : 'default'
const cached = (id) => {
  try { return { theme: localStorage.getItem(key(id)) === 'dark' ? 'dark' : 'light', fontSize: normalizeFont(localStorage.getItem(fontKey(id))), fontFamily: normalizeFamily(localStorage.getItem(familyKey(id))) } } catch { return { theme: 'light', fontSize: 'default', fontFamily: 'default' } }
}
const remember = (id, settings) => {
  try { localStorage.setItem(key(id), settings.theme); localStorage.setItem(fontKey(id), settings.fontSize); localStorage.setItem(familyKey(id), normalizeFamily(settings.fontFamily)) } catch { /* The server preference still works when browser storage is disabled. */ }
}

export function useAccountTheme(user, restoring) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  const [fontSize, setFontSize] = useState(() => normalizeFont(document.documentElement.dataset.fontSize))
  const [fontFamily, setFontFamily] = useState(() => normalizeFamily(document.documentElement.dataset.fontFamily))
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const identity = useRef(user?.id)
  identity.current = user?.id
  function apply(settings) { setTheme(settings.theme); setFontSize(normalizeFont(settings.fontSize)); setFontFamily(normalizeFamily(settings.fontFamily)) }
  useLayoutEffect(() => {
    if (!restoring) apply(user?.id == null ? { theme: 'light', fontSize: 'default' } : cached(user.id))
  }, [user?.id, restoring])
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d1c2e' : '#ffffff')
  }, [theme])
  useLayoutEffect(() => { document.documentElement.dataset.fontSize = fontSize }, [fontSize])
  useLayoutEffect(() => { document.documentElement.dataset.fontFamily = fontFamily }, [fontFamily])
  useEffect(() => {
    if (restoring) return undefined
    setError(''); setMessage(''); setBusy(false)
    if (user?.id == null) { apply({ theme: 'light', fontSize: 'default' }); setLoading(false); return undefined }
    const id = user.id
    const controller = new AbortController()
    setLoading(true)
    apply(cached(id))
    async function load() {
      try {
        const response = await fetch('/api/account/appearance', { headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}` }, signal: controller.signal, cache: 'no-store' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Não foi possível carregar a aparência da conta.')
        if (!controller.signal.aborted) { apply(data.settings); remember(id, data.settings) }
      } catch (caught) { if (!controller.signal.aborted) setError(caught.message) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    load()
    return () => controller.abort()
  }, [user?.id, restoring, retry])
  async function changeAppearance(changes) {
    if (busy || loading || user?.id == null) return
    const id = user?.id
    const previous = { theme, fontSize, fontFamily }
    apply({ ...previous, ...changes }); setBusy(true); setError(''); setMessage('')
    try {
      const data = await payableRequest('/account/appearance', 'PATCH', changes)
      if (identity.current === id) { apply(data.settings); remember(id, data.settings); setMessage('Aparência salva.') }
    } catch (caught) { if (identity.current === id) { apply(previous); setError(caught.message) } }
    finally { if (identity.current === id) setBusy(false) }
  }
  const changeTheme = (next) => { if (['light', 'dark'].includes(next) && next !== theme) return changeAppearance({ theme: next }) }
  const changeFontSize = (next) => { if (['small', 'default', 'large'].includes(next) && next !== fontSize) return changeAppearance({ fontSize: next }) }
  const changeFontFamily = (next) => { if (next === normalizeFamily(next) && next !== fontFamily) return changeAppearance({ fontFamily: next }) }
  return { theme, fontSize, fontFamily, changeTheme, changeFontSize, changeFontFamily, busy, loading, error, message, retry: () => setRetry((value) => value + 1) }
}
