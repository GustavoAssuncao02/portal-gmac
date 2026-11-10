import { useEffect, useRef, useState } from 'react'
import './birthday.css'
import { balloons, cake, texts } from './birthday.markup.js'
import { previewName } from './calendar.js'

// Birthday screen: right after a successful login, the person whose birthday is today (day and month of the birth
// date in the registry) sees it before the portal opens; "Acessar o sistema" (or Esc) goes on to the portal.
// "?tema=aniversario" in the address shows it after any login, to check it beforehand.

export function isBirthday(birthDate, date = new Date()) {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(String(birthDate || ''))
  if (!match) return false
  const month = Number(match[1])
  let day = Number(match[2])
  // Born on February 29th: the 28th in the years without it.
  if (month === 2 && day === 29 && new Date(date.getFullYear(), 1, 29).getMonth() !== 1) day = 28
  return month === date.getMonth() + 1 && day === date.getDate()
}

export const birthdayPreview = () => previewName() === 'aniversario'

// "MARIA DA SILVA" or "maria" → "Maria", as in the mockup.
export const firstName = (name) => {
  const first = String(name || '').trim().split(/\s+/)[0] || ''
  return first ? first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1).toLocaleLowerCase('pt-BR') : ''
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const confettiColors = ['#f47c20', '#ffd27a', '#ffffff', '#7fb0ff', '#ff7a8a', '#2f6fd6']
const FADE_MS = 450

// Burst of confetti from the middle, then pieces keep falling while the screen is open.
function useConfetti(canvasRef, running) {
  useEffect(() => {
    const canvas = canvasRef.current, context = canvas?.getContext('2d')
    if (!running || !context || reducedMotion()) return undefined
    let width = 0, height = 0, frame = 0, pieces = []
    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth; height = window.innerHeight
      canvas.width = width * ratio; canvas.height = height * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    const piece = (x, y, burst) => {
      const angle = burst ? -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1 : 0, speed = burst ? 6 + Math.random() * 9 : 0
      return { x, y, vx: burst ? Math.cos(angle) * speed : (Math.random() - 0.5) * 0.6, vy: burst ? Math.sin(angle) * speed : 1 + Math.random() * 1.4,
        w: 5 + Math.random() * 5, h: 3 + Math.random() * 3, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.25,
        flip: Math.random() * 6.28, vf: 0.05 + Math.random() * 0.08, color: confettiColors[Math.floor(Math.random() * confettiColors.length)], round: Math.random() < 0.3 }
    }
    function draw() {
      context.clearRect(0, 0, width, height)
      if (pieces.length < 90 && Math.random() < 0.5) pieces.push(piece(Math.random() * width, -10, false))
      for (let index = pieces.length - 1; index >= 0; index -= 1) {
        const item = pieces[index]
        item.vx *= 0.985; item.vy = item.vy * 0.985 + 0.12; if (item.vy > 2.6) item.vy = 2.6
        item.x += item.vx + Math.sin(item.flip) * 0.4; item.y += item.vy; item.rot += item.vr; item.flip += item.vf
        if (item.y > height + 20) { pieces.splice(index, 1); continue }
        context.save(); context.translate(item.x, item.y); context.rotate(item.rot); context.scale(1, Math.cos(item.flip))
        context.fillStyle = item.color
        if (item.round) { context.beginPath(); context.arc(0, 0, item.h, 0, 6.283); context.fill() } else context.fillRect(-item.w / 2, -item.h / 2, item.w, item.h)
        context.restore()
      }
      frame = window.requestAnimationFrame(draw)
    }
    window.addEventListener('resize', resize)
    resize()
    const burst = window.setTimeout(() => { for (let count = 0; count < 180; count += 1) pieces.push(piece(width / 2 + (Math.random() - 0.5) * 120, height * 0.42, true)) }, 350)
    frame = window.requestAnimationFrame(draw)
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(burst); window.removeEventListener('resize', resize); pieces = []; context.clearRect(0, 0, width, height) }
  }, [running])
}

// onContinue opens the portal right away (behind the screen, which fades out); onClosed comes when the fade ends.
export function BirthdayGreeting({ name, onContinue, onClosed }) {
  const [open, setOpen] = useState(false)
  const canvas = useRef(null), button = useRef(null), closing = useRef(false)
  useConfetti(canvas, open)
  useEffect(() => {
    // Opens on the next frame, so the fade and the card entrance play.
    const frame = window.requestAnimationFrame(() => setOpen(true))
    const focus = window.setTimeout(() => button.current?.focus({ preventScroll: true }), 1300)
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(focus) }
  }, [])
  function close() {
    if (closing.current) return
    closing.current = true
    setOpen(false)
    onContinue()
    window.setTimeout(onClosed, FADE_MS)
  }
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && open) close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return <div className={`bd-overlay${open ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-labelledby="bd-title" aria-hidden={!open}>
    <canvas ref={canvas} className="bd-confetti" aria-hidden="true" />
    <div className="bd-balloons" aria-hidden="true" dangerouslySetInnerHTML={{ __html: balloons }} />
    <div className="bd-card">
      <svg className="bd-cake" viewBox="0 0 140 130" aria-hidden="true" dangerouslySetInnerHTML={{ __html: cake }} />
      <p className="bd-kicker">{texts.kicker}</p>
      <h2 className="bd-title" id="bd-title">Feliz aniversário,<br /><span className="bd-name">{name}</span>!</h2>
      <p className="bd-msg">{texts.message}</p>
      <button ref={button} className="bd-btn" type="button" onClick={close}>{texts.button}</button>
    </div>
  </div>
}
