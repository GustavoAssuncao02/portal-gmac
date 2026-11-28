import { useEffect } from 'react'

const SAMPLE_MS = 30000
const IDLE_MS = 60000
const interactions = ['pointerdown', 'keydown', 'wheel', 'touchstart']

export function useUserActivity(enabled) {
  useEffect(() => {
    if (!enabled) return
    let start = null, lastInput = null
    const inUse = () => document.visibilityState === 'visible' && document.hasFocus()

    function report(at) {
      if (start === null) return
      const end = Math.min(at, lastInput + IDLE_MS)
      const durationMs = Math.min(SAMPLE_MS, Math.round(end - start))
      const ageMs = Math.round(at - end)
      start = at >= lastInput + IDLE_MS ? null : end
      if (durationMs < 1 || ageMs > SAMPLE_MS) return
      const token = sessionStorage.getItem('gmac-admin-token') || sessionStorage.getItem('gmac-operator-token')
      if (!token) return
      fetch('/api/auth/activity', {
        method: 'POST', keepalive: true,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationMs, ageMs }),
      }).catch(() => {})
    }

    function interact(event) {
      if (!event.isTrusted || !inUse()) return
      const at = performance.now()
      if (start === null || at >= lastInput + IDLE_MS) {
        report(at)
        start = at
      }
      lastInput = at
    }
    function stop() {
      report(performance.now())
      start = null
    }
    function visibilityChanged() { if (!inUse()) stop() }

    const timer = window.setInterval(visibilityChangedOrReport, SAMPLE_MS)
    function visibilityChangedOrReport() {
      if (inUse()) report(performance.now())
      else stop()
    }
    for (const type of interactions) window.addEventListener(type, interact, { capture: true, passive: true })
    window.addEventListener('blur', stop)
    window.addEventListener('pagehide', stop)
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      window.clearInterval(timer)
      for (const type of interactions) window.removeEventListener(type, interact, true)
      window.removeEventListener('blur', stop)
      window.removeEventListener('pagehide', stop)
      document.removeEventListener('visibilitychange', visibilityChanged)
      stop()
    }
  }, [enabled])
}
