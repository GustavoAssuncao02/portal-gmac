import { useEffect, useSyncExternalStore } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import './payables.css'

// After a deploy, a page opened before it keeps running the old interface until it is reloaded (F5). The build publishes
// its version in /version.json (scripts/interface-version.mjs); the page compares it with its own when it opens, every
// minute and whenever it comes back to the screen. In development (Vite) the page updates by itself: nothing to compare.
// Found a new version, the "Atualizar o portal" window opens once. "Agora não" closes it: in the administrative portal
// the "Versão desatualizada" button beside the bell stays and opens it again (2026-11-27); on the login and on the
// operator's tablet, which have no bell, the window comes back 5 minutes later, as before.
const CHECK_MS = 60 * 1000
const SNOOZE_MS = 5 * 60 * 1000

let state = { outdated: false, open: false }
const listeners = new Set()
const update = (next) => { state = { ...state, ...next }; for (const listener of listeners) listener() }
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
const useVersionState = () => useSyncExternalStore(subscribe, () => state)
// How many "Versão desatualizada" buttons are on screen (the header of the administrative portal).
let buttons = 0

// Beside the bell, while the page runs an old version. The countdown of a scheduled update, when there is one, takes
// its place (notifications.css).
export function OutdatedVersionButton() {
  const { outdated } = useVersionState()
  useEffect(() => { buttons += 1; return () => { buttons -= 1 } }, [])
  if (!outdated) return null
  const title = 'Há uma versão nova do portal. Clique para atualizar.'
  return <button type="button" className="version-outdated" title={title} aria-label={`Versão desatualizada. ${title}`} onClick={() => update({ open: true })}>
    <TriangleAlert size={13} aria-hidden="true" /><span className="version-outdated-label">Versão desatualizada</span>
  </button>
}

export default function NewVersionPrompt() {
  const { outdated, open } = useVersionState()

  useEffect(() => {
    if (import.meta.env.DEV || outdated) return
    let active = true
    const check = async () => {
      if (document.hidden) return
      try {
        const response = await fetch('/version.json', { cache: 'no-store' })
        const { version } = response.ok ? await response.json() : {}
        if (active && version && version !== __INTERFACE_VERSION__) update({ outdated: true, open: true })
      } catch { /* Offline or the server restarting: the next check tries again. */ }
    }
    const back = () => { if (!document.hidden) check() }
    check()
    const timer = setInterval(check, CHECK_MS)
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    return () => {
      active = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
    }
  }, [outdated])

  // Closed without updating: only a screen without the button beside the bell asks again, 5 minutes later.
  useEffect(() => {
    if (!outdated || open) return undefined
    const timer = setTimeout(() => { if (!buttons) update({ open: true }) }, SNOOZE_MS)
    return () => clearTimeout(timer)
  }, [outdated, open])

  if (!outdated || !open) return null
  const later = () => update({ open: false })
  return <PayableModal title="Atualizar o portal" className="new-version-modal" onClose={later} footer={<>
    <button className="admin-tool-button" type="button" onClick={later}>Agora não</button>
    <button className="admin-tool-button admin-tool-button--primary" type="button" onClick={() => window.location.reload()}><RefreshCw size={17} aria-hidden="true" />Atualizar agora</button>
  </>}>
    <p>Há uma versão nova. Salve o que estiver fazendo antes de atualizar.</p>
  </PayableModal>
}
