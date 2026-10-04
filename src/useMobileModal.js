import { useEffect, useRef } from 'react'

export function useMobileModal(open, selector, onClose) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open || !window.matchMedia('(max-width: 760px)').matches) return
    const modal = document.querySelector(selector)
    if (!modal) return
    const main = document.querySelector('.dashboard-shell > main')
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    const previousInert = main?.inert
    document.body.style.overflow = 'hidden'
    if (main) main.inert = true
    const controls = () => [...modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')].filter((element) => element.getClientRects().length && !element.disabled && element.tabIndex >= 0)
    controls()[0]?.focus({ preventScroll: true })
    function keyDown(event) {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current() }
      if (event.key !== 'Tab') return
      const elements = controls(), first = elements[0], last = elements.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    modal.addEventListener('keydown', keyDown)
    return () => {
      modal.removeEventListener('keydown', keyDown)
      document.body.style.overflow = previousOverflow
      if (main) main.inert = previousInert
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [open, selector])
}
