import { useEffect } from 'react'

// "Criando oferta" in real time (server/offerPresence.js): while the person creating the offer is on its details, a beat
// every 30 s; leaving the details (another screen, closing the tab) or 10 minutes without touching the page tells the
// server they stopped, and the list shows "Em aberto · editado há ...". Touching the page again comes back at once.
const BEAT_MS = 30000
const IDLE_MS = 10 * 60000
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']

const authHeaders = () => { const token = window.sessionStorage.getItem('gmac-admin-token'); return token ? { Authorization: `Bearer ${token}` } : {} }
// keepalive lets the last message leave even while the tab is being closed.
const send = (offerId, leaving) => fetch(`/api/presence/offers/${encodeURIComponent(offerId)}`, { method: 'POST', keepalive: leaving, headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(leaving ? { leaving: true } : {}) }).catch(() => {})

// Leaving the details waits a moment: the same details mounted again right away (React's development double run, a
// re-render that recreates the screen) cancel it instead of flashing "Em aberto".
const pendingLeaves = new Map()

export function useOfferPresence(offerId, enabled) {
  useEffect(() => {
    if (!enabled || !offerId) return undefined
    clearTimeout(pendingLeaves.get(offerId))
    pendingLeaves.delete(offerId)
    let lastInput = Date.now(), away = false
    const beat = () => {
      if (Date.now() - lastInput < IDLE_MS) { away = false; send(offerId, false); return }
      if (!away) { away = true; send(offerId, true) }
    }
    const touched = () => { lastInput = Date.now(); if (away) { away = false; send(offerId, false) } }
    const leave = () => send(offerId, true)
    for (const name of INPUT_EVENTS) window.addEventListener(name, touched, { passive: true })
    window.addEventListener('pagehide', leave)
    send(offerId, false)
    const timer = setInterval(beat, BEAT_MS)
    return () => {
      clearInterval(timer)
      for (const name of INPUT_EVENTS) window.removeEventListener(name, touched)
      window.removeEventListener('pagehide', leave)
      pendingLeaves.set(offerId, setTimeout(() => { pendingLeaves.delete(offerId); leave() }, 400))
    }
  }, [offerId, enabled])
}
