// A click on the dark area around a modal <dialog> closes it, as its close button (or Esc) does. It counts only when the
// press also started outside the window: selecting text inside and releasing the mouse outside keeps it open.
const pressedOutside = new WeakSet()

function outside(event) {
  if (event.target !== event.currentTarget) return false
  const box = event.currentTarget.getBoundingClientRect()
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom
}

// Spread on the <dialog>: <dialog {...backdropClose(close)}>. `close` decides what closing means (and whether it is
// allowed now, e.g. not while saving).
export function backdropClose(close) {
  return {
    onMouseDown: (event) => { if (outside(event)) pressedOutside.add(event.currentTarget); else pressedOutside.delete(event.currentTarget) },
    onClick: (event) => {
      const started = pressedOutside.has(event.currentTarget)
      pressedOutside.delete(event.currentTarget)
      if (started && outside(event)) close()
    },
  }
}
