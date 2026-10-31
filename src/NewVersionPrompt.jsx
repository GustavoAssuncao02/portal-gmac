import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import './payables.css'

// After a deploy, a page opened before it keeps running the old interface until it is reloaded (F5). The build publishes
// its version in /version.json (scripts/interface-version.mjs); the page compares it with its own when it opens, every
// minute and whenever it comes back to the screen, and asks to reload when they differ. "Agora não" (for someone in the
// middle of a form) asks again 5 minutes later. In development (Vite) the page updates by itself: nothing to compare.
const CHECK_MS = 60 * 1000
const SNOOZE_MS = 5 * 60 * 1000

export default function NewVersionPrompt() {
  const [outdated, setOutdated] = useState(false)
  const [snoozed, setSnoozed] = useState(false)

  useEffect(() => {
    if (import.meta.env.DEV || outdated) return
    let active = true
    const check = async () => {
      if (document.hidden) return
      try {
        const response = await fetch('/version.json', { cache: 'no-store' })
        const { version } = response.ok ? await response.json() : {}
        if (active && version && version !== __INTERFACE_VERSION__) setOutdated(true)
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

  useEffect(() => {
    if (!snoozed) return
    const timer = setTimeout(() => setSnoozed(false), SNOOZE_MS)
    return () => clearTimeout(timer)
  }, [snoozed])

  if (!outdated || snoozed) return null
  return <PayableModal title="Nova versão disponível" className="new-version-modal" onClose={() => setSnoozed(true)} footer={<>
    <button className="admin-tool-button" type="button" onClick={() => setSnoozed(true)}>Agora não</button>
    <button className="admin-tool-button admin-tool-button--primary" type="button" onClick={() => window.location.reload()}><RefreshCw size={17} aria-hidden="true" />Recarregar página</button>
  </>}>
    <p>O portal foi atualizado. Recarregue a página (F5) para usar a nova versão.</p>
    <p>Se estiver preenchendo algo, salve antes de recarregar.</p>
  </PayableModal>
}
