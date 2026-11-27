import { useEffect, useRef, useState } from 'react'
import { defaultHomeLayout, normalizeHomeLayout } from '../server/homeWidgets.js'

// Início personalizado: the layout of the signed-in account. This device's last copy draws the screen at once; the
// server's copy (the one that counts, the same on every computer) replaces it as soon as it arrives.
const key = (id) => `gmac-home-layout-${id}`
function cached(user) {
  try {
    const saved = JSON.parse(localStorage.getItem(key(user.id)) || 'null')
    return saved ? normalizeHomeLayout(saved, user.role) : null
  } catch { return null }
}
function remember(id, layout) {
  try { localStorage.setItem(key(id), JSON.stringify(layout)) } catch { /* The server copy still works without browser storage. */ }
}
async function request(method, body) {
  const response = await fetch('/api/account/home-layout', { method, cache: 'no-store', headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Não foi possível salvar o Início.')
  return data
}

export function useHomeLayout(user) {
  const role = user?.role
  const [layout, setLayout] = useState(() => user?.id == null ? defaultHomeLayout(role) : cached(user) || defaultHomeLayout(role))
  const [customized, setCustomized] = useState(false)
  const [loading, setLoading] = useState(true)
  const identity = useRef(user?.id)
  identity.current = user?.id
  useEffect(() => {
    if (user?.id == null) { setLoading(false); return undefined }
    const id = user.id, controller = new AbortController()
    setLayout(cached(user) || defaultHomeLayout(role))
    fetch('/api/account/home-layout', { signal: controller.signal, cache: 'no-store', headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}` } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error()))
      .then((data) => { if (!controller.signal.aborted && Array.isArray(data.layout)) { setLayout(data.layout); setCustomized(Boolean(data.customized)); remember(id, data.layout) } })
      // Offline or an older API: the screen keeps this device's copy (or the default) and the next save tries again.
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [user?.id, role])
  // `next` null restores the default home screen. `optimistic`: the screen changes at once (a setting chosen inside a
  // widget) and goes back when the server refuses it.
  async function save(next, { optimistic = false } = {}) {
    const id = user?.id, previous = layout
    if (optimistic) setLayout(next ?? defaultHomeLayout(role))
    try {
      const data = await request('PUT', { layout: next })
      if (identity.current === id) { setLayout(data.layout); setCustomized(Boolean(data.customized)); remember(id, data.layout) }
      return data.layout
    } catch (error) {
      if (optimistic && identity.current === id) setLayout(previous)
      throw error
    }
  }
  return { layout, customized, loading, save }
}
