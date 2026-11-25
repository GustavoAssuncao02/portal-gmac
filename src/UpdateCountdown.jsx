import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { payableRequest } from './payablesApi.js'
import { pollWhileVisible } from './polling.js'

// Desenvolvedor › Programar atualização: a small countdown next to the bell in the last 2 minutes before a scheduled
// update, and "Atualizando..." while it happens (until the new version asks to reload). The clock of the server is the
// reference, so a computer with the wrong time still counts right. The operators' tablets do not show it.
const COUNTDOWN_MS = 2 * 60000
const hour = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' })

export default function UpdateCountdown() {
  const [state, setState] = useState(null), [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let active = true
    const load = () => payableRequest('/update-schedule').then((data) => { if (active) setState(data.item ? { item: data.item, offset: Number(data.now) - Date.now() || 0 } : null) }).catch(() => {})
    load()
    // Scheduling, rescheduling, canceling and the 5-minute notice all reach the bell, so its changes are enough.
    const stop = pollWhileVisible(load, 60000, ['notifications'])
    return () => { active = false; stop() }
  }, [])
  useEffect(() => {
    if (!state) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [state])
  if (!state) return null
  const at = Date.parse(state.item.at), left = at - (now + state.offset)
  const updating = state.item.status === 'started' || left <= 0
  if (!updating && left > COUNTDOWN_MS) return null
  const seconds = Math.max(0, Math.ceil(left / 1000))
  const title = updating ? 'O portal está sendo atualizado e pode ficar fora do ar por alguns minutos.' : `O portal será atualizado às ${hour(at)} e pode ficar fora do ar por alguns minutos. Salve o que estiver fazendo.`
  // A timer is not read aloud at every second; its label tells the whole notice.
  return <span className={`update-countdown${updating ? ' update-countdown--running' : ''}`} role="timer" aria-label={title} title={title}>
    <RefreshCw size={13} aria-hidden="true" /><span className="update-countdown-label">{updating ? 'Atualizando o portal...' : 'Atualização em'}</span>
    {!updating && <strong>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</strong>}
  </span>
}
