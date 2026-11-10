import { useEffect, useRef, useState } from 'react'
import './newYear.css'

// New Year look of the login screen (December 27th to January 5th, see calendar.js).

// The year that arrives: in December the next one, in January the one that just started.
// So "Feliz 2027" from 27/12/2026 to 05/01/2027, "Feliz 2028" from 27/12/2027 to 05/01/2028, and so on.
export const arrivingYear = (date = new Date()) => date.getMonth() >= 6 ? date.getFullYear() + 1 : date.getFullYear()

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const starPath = 'M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z'

// Gold sparkles around the logo and the party hat, drawn inside the logo SVG so they scale with it.
// The hat falls right after the symbol turns; the sparkles start when the intro ends.
export function NewYearHat() {
  return <>
    <defs>
      <linearGradient id="ny-hat-body" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#1f5ea8" /><stop offset=".55" stopColor="#0d4380" /><stop offset="1" stopColor="#082a52" />
      </linearGradient>
      <linearGradient id="ny-gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fbe6a8" /><stop offset=".45" stopColor="#e8b44c" /><stop offset="1" stopColor="#b9822a" />
      </linearGradient>
      <clipPath id="ny-hat-clip"><path d="M70,255 L290,255 L215,30 Z" /></clipPath>
    </defs>
    <g fill="#f7d98b">
      <path className="ny-spark" d="M330,330 l10,-30 l10,30 l30,10 l-30,10 l-10,30 l-10,-30 l-30,-10 Z" />
      <path className="ny-spark" d="M1000,160 l8,-24 l8,24 l24,8 l-24,8 l-8,24 l-8,-24 l-24,-8 Z" />
      <path className="ny-spark" d="M960,520 l12,-36 l12,36 l36,12 l-36,12 l-12,36 l-12,-36 l-36,-12 Z" />
      <path className="ny-spark" d="M260,90 l7,-20 l7,20 l20,7 l-20,7 l-7,20 l-7,-20 l-20,-7 Z" />
    </g>
    <g transform="translate(300 -150) scale(1.22) rotate(-22 230 260)">
      <g className="ny-hat">
        <path d="M70,255 L290,255 L215,30 Z" fill="url(#ny-gold)" />
        <g clipPath="url(#ny-hat-clip)" fill="#ffffff" opacity=".9">
          <path d="M40,200 L320,120 L320,150 L40,230 Z" />
          <path d="M40,120 L320,40 L320,66 L40,146 Z" />
        </g>
        <g>
          <circle cx="150" cy="215" r="8" fill="#0d4380" />
          <circle cx="235" cy="170" r="7" fill="#f47c20" />
          <circle cx="200" cy="110" r="6" fill="#0d4380" />
          <circle cx="175" cy="165" r="5" fill="#0d4380" />
        </g>
        <path d="M140,80 L190,60" stroke="rgba(255,255,255,.25)" strokeWidth="10" strokeLinecap="round" />
        <rect x="50" y="240" width="260" height="34" rx="17" fill="url(#ny-hat-body)" />
        <rect x="62" y="246" width="236" height="8" rx="4" fill="rgba(255,255,255,.25)" />
        {/* Tassel on the tip of the cone: the position stays in the outer group, so the swinging animation does not undo it. */}
        <g transform="translate(215 32)">
          <g className="ny-tassel">
            <g stroke="#ffffff" strokeWidth="9" strokeLinecap="round">
              <path d="M0,0 L-30,-30" /><path d="M0,0 L-10,-42" /><path d="M0,0 L12,-42" />
              <path d="M0,0 L32,-28" /><path d="M0,0 L40,-6" /><path d="M0,0 L-38,-8" />
            </g>
            <circle r="14" fill="#f47c20" />
          </g>
        </g>
      </g>
    </g>
  </>
}

export function NewYearBadge() {
  return <div className="ny-badge">
    <svg className="ny-star" viewBox="0 0 24 24" aria-hidden="true"><path d={starPath} /></svg>
    Feliz <b>{arrivingYear()}</b>
    <svg className="ny-star" viewBox="0 0 24 24" aria-hidden="true"><path d={starPath} /></svg>
  </div>
}

const bokeh = [['8%', 22, '11s', '0s'], ['22%', 12, '9s', '2s'], ['37%', 30, '13s', '4s'], ['55%', 16, '10s', '1s'], ['70%', 26, '12s', '6s'], ['84%', 14, '9.5s', '3s'], ['93%', 20, '12.5s', '7s']]
const fireworkColors = ['#f7d98b', '#e8b44c', '#ffffff', '#f47c20', '#9cc8ff']

// Fireworks on the sides and top of the blue panel (never over the logo in the middle).
function Fireworks({ visible }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!visible || !context) return undefined
    const rockets = [], sparks = []
    let width = 0, height = 0, nextLaunch = 0, frame = 0
    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2), box = canvas.getBoundingClientRect()
      width = box.width; height = box.height
      canvas.width = width * ratio; canvas.height = height * ratio
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    function launch() {
      const side = Math.random() < 0.5 ? 0.08 + Math.random() * 0.27 : 0.65 + Math.random() * 0.27
      rockets.push({ x: width * side, y: height + 10, top: height * (0.08 + Math.random() * 0.3), vy: -(height * 0.012 + 4), color: fireworkColors[Math.floor(Math.random() * fireworkColors.length)] })
    }
    function explode(rocket) {
      const total = 50 + Math.floor(Math.random() * 40), speed = 1.6 + Math.random() * 1.8, ring = Math.random() < 0.35
      for (let index = 0; index < total; index += 1) {
        const angle = index / total * Math.PI * 2, velocity = ring ? speed : speed * (0.4 + Math.random() * 0.6)
        sparks.push({ x: rocket.x, y: rocket.y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, life: 1, decay: 0.01 + Math.random() * 0.012, color: Math.random() < 0.75 ? rocket.color : '#ffffff' })
      }
    }
    function draw(time) {
      // Trails: the previous frame fades a little instead of being erased.
      context.globalCompositeOperation = 'destination-out'
      context.fillStyle = 'rgba(0,0,0,.22)'
      context.fillRect(0, 0, width, height)
      context.globalCompositeOperation = 'lighter'
      if (time > nextLaunch) { launch(); if (Math.random() < 0.35) launch(); nextLaunch = time + 900 + Math.random() * 1300 }
      for (let index = rockets.length - 1; index >= 0; index -= 1) {
        const rocket = rockets[index]
        rocket.y += rocket.vy; rocket.vy *= 0.985
        context.fillStyle = 'rgba(255,230,170,.9)'
        context.beginPath(); context.arc(rocket.x, rocket.y, 1.6, 0, 6.283); context.fill()
        if (rocket.y <= rocket.top || rocket.vy > -1) { explode(rocket); rockets.splice(index, 1) }
      }
      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const spark = sparks[index]
        spark.vx *= 0.985; spark.vy = spark.vy * 0.985 + 0.035
        spark.x += spark.vx; spark.y += spark.vy; spark.life -= spark.decay
        if (spark.life <= 0) { sparks.splice(index, 1); continue }
        context.globalAlpha = Math.max(spark.life, 0)
        context.fillStyle = spark.color
        context.beginPath(); context.arc(spark.x, spark.y, 1.7, 0, 6.283); context.fill()
      }
      context.globalAlpha = 1
      frame = window.requestAnimationFrame(draw)
    }
    window.addEventListener('resize', resize)
    resize()
    frame = window.requestAnimationFrame(draw)
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', resize) }
  }, [visible])
  return <canvas ref={canvasRef} className="ny-fireworks ny-late" aria-hidden="true" />
}

// Gold glow at the bottom, lights rising and fireworks over the blue panel; they fade in when the logo intro ends.
export function NewYearSky({ visible }) {
  const [calm] = useState(reducedMotion)
  return <>
    <div className="ny-glow ny-late" aria-hidden="true" />
    {!calm && <div className="ny-bokeh ny-late" aria-hidden="true">
      {bokeh.map(([left, size, duration, delay]) => <i key={left} style={{ left, width: size, height: size, animationDuration: duration, animationDelay: delay }} />)}
    </div>}
    {!calm && <Fireworks visible={visible} />}
  </>
}

export function NewYearAura() {
  return <div className="ny-aura" aria-hidden="true" />
}

// Shining gold stripe on top of the login card. The frame follows the card corners, so the card itself is untouched.
export function NewYearCardBar() {
  return <span className="ny-card-frame" aria-hidden="true"><span className="ny-card-bar" /></span>
}

const confettiOverPanel = ['#f7d98b', '#e8b44c', '#ffffff', '#f47c20']
const confettiOverWhite = ['#e8b44c', '#d39a33', '#f47c20', '#0d4380', '#7fb0e6']

// Gold confetti falling over the whole screen. It ignores the mouse and the touch, so every button and field below it works as usual.
export function NewYearConfetti({ visible, panelRef }) {
  const canvasRef = useRef(null)
  const [calm] = useState(reducedMotion)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!context) return undefined
    const pieces = []
    let width = 0, height = 0, frame = 0, panel = { left: 0, right: 0, top: 0, bottom: 0 }
    const piece = (anywhere) => ({
      x: Math.random() * width, y: anywhere ? Math.random() * height : -12, w: 4 + Math.random() * 5, h: 2 + Math.random() * 3,
      vy: 0.5 + Math.random() * 0.9, vx: (Math.random() - 0.5) * 0.3, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.08,
      flip: Math.random() * 6.28, vf: 0.03 + Math.random() * 0.05, sway: Math.random() * 6.28, k: Math.random(),
    })
    const measure = () => { if (panelRef.current) panel = panelRef.current.getBoundingClientRect() }
    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth; height = window.innerHeight
      canvas.width = width * ratio; canvas.height = height * ratio
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      measure()
      const total = Math.round(Math.min(110, width * height / 12000))
      while (pieces.length < total) pieces.push(piece(true))
      pieces.length = total
    }
    function draw() {
      context.clearRect(0, 0, width, height)
      for (const item of pieces) {
        item.sway += 0.02; item.flip += item.vf; item.rot += item.vr
        item.x += item.vx + Math.sin(item.sway) * 0.35; item.y += item.vy
        if (item.y > height + 12) Object.assign(item, piece(false))
        const overPanel = item.x >= panel.left && item.x <= panel.right && item.y >= panel.top && item.y <= panel.bottom
        const palette = overPanel ? confettiOverPanel : confettiOverWhite
        context.save()
        context.translate(item.x, item.y); context.rotate(item.rot); context.scale(1, Math.cos(item.flip))
        context.globalAlpha = overPanel ? 0.9 : 0.6
        context.fillStyle = palette[Math.floor(item.k * palette.length)]
        context.fillRect(-item.w / 2, -item.h / 2, item.w, item.h)
        context.restore()
      }
      frame = window.requestAnimationFrame(draw)
    }
    window.addEventListener('resize', resize)
    window.addEventListener('scroll', measure, { passive: true })
    resize()
    frame = window.requestAnimationFrame(draw)
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', resize); window.removeEventListener('scroll', measure) }
  }, [])
  if (calm) return null
  return <canvas ref={canvasRef} className={`ny-confetti${visible ? ' ny-confetti--on' : ''}`} aria-hidden="true" />
}
