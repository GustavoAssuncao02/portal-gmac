// Keeps the device screen on while the page is open and visible (Screen Wake Lock), for the factory tablet whose settings
// have no "never turn off". The browser drops the lock whenever the page is hidden (another app, the power button), so it
// is asked again when the page comes back and on the next touch: some browsers refuse it without an interaction or in
// battery saver. Needs HTTPS (or localhost); where the browser has no wake lock, nothing changes.
// `env` exists for the tests; returns the function that lets the screen turn off again.
export function keepScreenOn(env = globalThis) {
  const { navigator, document, window } = env
  const wakeLock = navigator?.wakeLock
  if (!wakeLock?.request || !document) return () => {}
  let lock = null, asking = false, stopped = false
  const ask = async () => {
    if (stopped || asking || (lock && !lock.released) || document.visibilityState !== 'visible') return
    asking = true
    try {
      const sentinel = await wakeLock.request('screen')
      if (stopped) { sentinel.release().catch(() => {}); return }
      lock = sentinel
      sentinel.addEventListener?.('release', () => { if (lock === sentinel) lock = null })
    } catch { /* Recusado agora (economia de bateria, página sem foco): tenta de novo no próximo toque ou ao voltar. */ }
    finally { asking = false }
  }
  const kinds = ['pointerdown', 'keydown', 'focus']
  document.addEventListener('visibilitychange', ask)
  for (const kind of kinds) window?.addEventListener(kind, ask, { capture: true, passive: true })
  ask()
  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', ask)
    for (const kind of kinds) window?.removeEventListener(kind, ask, { capture: true })
    lock?.release().catch(() => {})
    lock = null
  }
}
