import { useEffect, useState } from 'react'
import { pollWhileVisible } from './polling.js'
import { todayBahia } from '../server/payableRules.js'

// The data the widgets of the Início read besides the offers and OS (which the portal already keeps): each source is
// read only while a widget on the screen (or in the layout being edited) needs it, and refreshed like the other screens.
async function getJson(url, signal) {
  const response = await fetch(url, { signal, cache: 'no-store', headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}` } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Não foi possível carregar os dados.')
  return data
}
const numbers = (items) => (items || []).map((item) => ({ ...item, quantity: Number(item.quantity), minimum: Number(item.minimum), unitPrice: Number(item.unitPrice) || 0 }))

export function sourceLoaders({ loadPayables, loadInventory }) {
  return {
    payables: { every: 30000, topics: ['finance'], load: async (signal) => (await (loadPayables ? loadPayables(signal) : { items: [] })).items || [] },
    receivables: { every: 30000, topics: ['finance'], load: async (signal) => { const data = await getJson('/api/receivables', signal); return { items: data.items || [], classifications: data.classifications || [] } } },
    inventory: { every: 60000, load: async (signal) => (await loadInventory(signal)).items },
    adminInventory: { every: 60000, load: async (signal) => numbers((await getJson('/api/admin-inventory', signal)).items).map((item) => ({ ...item, history: (item.history || []).map((entry) => ({ ...entry, quantity: Number(entry.quantity) })) })) },
    machines: { every: 30000, load: async (signal) => (await getJson('/api/machines', signal)).items || [] },
    idleEmployees: { every: 30000, load: async (signal) => getJson('/api/operations/idle-employees', signal) },
    machineUsageMonth: { every: 300000, load: async (signal) => { const today = todayBahia(); return getJson(`/api/machines/usage?start=${today.slice(0, 8)}01&end=${today}`, signal) } },
    employees: { every: 300000, load: async (signal) => (await getJson('/api/employees', signal)).items || [] },
    admins: { every: 300000, load: async (signal) => (await getJson('/api/admins', signal)).items || [] },
    tickets: { every: 60000, topics: ['data', 'notifications'], load: async (signal) => (await getJson('/api/support-tickets', signal)).items || [] },
  }
}
export const sourceNames = ['payables', 'receivables', 'inventory', 'adminInventory', 'machines', 'idleEmployees', 'machineUsageMonth', 'employees', 'admins', 'tickets']

// { data, loading, error } of one source; `data` keeps the last good answer when a later read fails.
function useSource(source, enabled, retry) {
  const [state, setState] = useState({ data: null, loading: enabled, error: '' })
  useEffect(() => {
    if (!enabled) return undefined
    const controller = new AbortController()
    let fetching = false
    setState((current) => current.data === null ? { ...current, loading: true } : current)
    async function load() {
      if (fetching) return
      fetching = true
      try {
        const data = await source.load(controller.signal)
        if (!controller.signal.aborted) setState({ data, loading: false, error: '' })
      } catch {
        if (!controller.signal.aborted) setState((current) => ({ data: current.data, loading: false, error: 'Dados não atualizados' }))
      } finally { fetching = false }
    }
    load()
    const stop = pollWhileVisible(load, source.every, source.topics || ['data'])
    return () => { controller.abort(); stop() }
  }, [enabled, retry, source])
  return state
}

// Always the same hooks in the same order (one per source); `needed` turns each on or off.
export function useHomeSources(loaders, needed, retry) {
  const result = {}
  for (const name of sourceNames) result[name] = useSource(loaders[name], needed.has(name), retry) // eslint-disable-line react-hooks/rules-of-hooks
  return result
}
