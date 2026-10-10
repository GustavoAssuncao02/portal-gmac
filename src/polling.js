// Repeats `run` like setInterval, but only while the tab is visible. A hidden tab stops asking the server
// and catches up the moment it is shown again, so the screen is never older than it would be with the tab open.
export function pollWhileVisible(run, intervalMs) {
  let missed = false
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'hidden') missed = true
    else run()
  }, intervalMs)
  const resume = () => {
    if (document.visibilityState === 'hidden' || !missed) return
    missed = false
    run()
  }
  document.addEventListener('visibilitychange', resume)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', resume)
  }
}
