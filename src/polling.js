import { isLiveConnected, subscribeLive } from './liveUpdates.js'

// While the live connection is open (liveUpdates.js), a screen updates as soon as the server reports a change of the kind
// it shows (`topics`: "data", "finance" or "notifications"), and its timer becomes a safety net: a short timer (10 s or
// less) waits for a minute without news; longer ones keep their pace. Without the connection, the timer works as before.
// Updates brought by changes come right away for an isolated change; while changes keep coming (several operators at
// once) they are spaced out, never more often than the old 10-second timer over time (6 quick ones in reserve, one more
// every 10 s), so a busy moment never weighs more than the former polling.
const SHORT_MS = 10000
const SAFETY_MS = 60000
const DEBOUNCE_MS = 50
const MIN_GAP_MS = 1000
const BURST = 6
const REFILL_MS = 10000

// Repeats `run` like setInterval, but only while the tab is visible. A hidden tab stops asking the server
// and catches up the moment it is shown again, so the screen is never older than it would be with the tab open.
export function pollWhileVisible(run, intervalMs, topics = ['data']) {
  let missed = false
  // `lastRun` (any update, the screen's first load included) paces the safety net; `lastChangeRun` (updates brought by
  // changes only) keeps a second between them, so the first change after opening a screen is shown at once.
  let lastRun = Date.now(), lastChangeRun = 0
  let tokens = BURST, refilledAt = Date.now()
  let scheduled = null
  const execute = () => { lastRun = Date.now(); run() }
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'hidden') { missed = true; return }
    if (isLiveConnected() && intervalMs <= SHORT_MS && Date.now() - lastRun < SAFETY_MS) return
    execute()
  }, intervalMs)
  const refill = () => {
    const now = Date.now(), gained = Math.floor((now - refilledAt) / REFILL_MS)
    if (gained) { tokens = Math.min(BURST, tokens + gained); refilledAt += gained * REFILL_MS }
    if (tokens >= BURST) refilledAt = now
  }
  const changed = () => {
    if (document.visibilityState === 'hidden') { missed = true; return }
    if (scheduled) return
    refill()
    const wait = tokens >= 1 ? Math.max(DEBOUNCE_MS, lastChangeRun + MIN_GAP_MS - Date.now()) : refilledAt + REFILL_MS - Date.now()
    scheduled = window.setTimeout(() => {
      scheduled = null
      refill()
      if (tokens < 1) { changed(); return }
      tokens -= 1
      lastChangeRun = Date.now()
      execute()
    }, wait)
  }
  const stopListening = subscribeLive(topics, changed)
  const resume = () => {
    if (document.visibilityState === 'hidden' || !missed) return
    missed = false
    execute()
  }
  document.addEventListener('visibilitychange', resume)
  return () => {
    window.clearInterval(timer)
    window.clearTimeout(scheduled)
    stopListening()
    document.removeEventListener('visibilitychange', resume)
  }
}
