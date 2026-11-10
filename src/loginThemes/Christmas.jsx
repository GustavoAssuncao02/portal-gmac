import { useEffect, useRef, useState } from 'react'
import './christmas.css'

// Christmas look of the login screen (December 1st to 26th, see calendar.js).

// Santa hat drawn inside the logo SVG, so it scales with the logo. It falls right after the symbol turns.
export function ChristmasHat() {
  return <>
    <defs>
      <linearGradient id="xmas-hat-red" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ff4d5e" /><stop offset=".6" stopColor="#d62839" /><stop offset="1" stopColor="#9e1426" />
      </linearGradient>
      <radialGradient id="xmas-fluff" cx=".4" cy=".35" r=".8">
        <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#dde8f4" />
      </radialGradient>
    </defs>
    <g transform="translate(300 -150) scale(1.22) rotate(-22 230 260)">
      <g className="xmas-hat">
        <path d="M40,250 C55,160 110,70 215,40 C270,25 325,55 345,105 C300,85 265,100 258,145 C252,190 285,225 315,250 Z" fill="url(#xmas-hat-red)" />
        <path d="M120,95 C160,65 210,55 255,62" stroke="rgba(255,255,255,.28)" strokeWidth="14" fill="none" strokeLinecap="round" />
        <circle cx="345" cy="112" r="34" fill="url(#xmas-fluff)" />
        <rect x="10" y="232" width="340" height="70" rx="35" fill="url(#xmas-fluff)" />
        <g fill="#fff">
          <circle cx="35" cy="250" r="17" /><circle cx="85" cy="240" r="18" /><circle cx="140" cy="237" r="18" />
          <circle cx="195" cy="237" r="18" /><circle cx="250" cy="240" r="18" /><circle cx="305" cy="247" r="17" />
        </g>
      </g>
    </g>
  </>
}

const windGusts = [
  { style: { left: '-4%', top: '5%', width: '90%' }, viewBox: '0 0 400 80', paths: [
    { len: 520, dur: '7s', delay: '0s', stroke: 'rgba(255,255,255,.55)', width: 2, d: 'M0,50 C80,30 160,70 250,45 C300,30 330,10 310,2 C292,-4 280,18 300,24' },
    { len: 360, dur: '7s', delay: '.25s', stroke: 'rgba(255,255,255,.3)', width: 1.5, d: 'M30,66 C110,52 190,78 290,60 C330,52 360,58 380,50' },
  ] },
  { style: { left: '20%', top: '60%', width: '85%' }, viewBox: '0 0 400 80', paths: [
    { len: 540, dur: '8.5s', delay: '2.6s', stroke: 'rgba(255,255,255,.5)', width: 2, d: 'M0,40 C90,20 170,60 260,38 C320,24 350,40 345,58 C340,72 318,68 322,54' },
    { len: 340, dur: '8.5s', delay: '2.9s', stroke: 'rgba(255,255,255,.28)', width: 1.5, d: 'M40,58 C120,46 200,70 300,52 C340,46 370,50 400,44' },
  ] },
  { style: { left: '-10%', top: '84%', width: '70%' }, viewBox: '0 0 400 60', paths: [
    { len: 420, dur: '9s', delay: '5s', stroke: 'rgba(255,255,255,.4)', width: 1.8, d: 'M0,30 C80,12 160,46 240,26 C290,14 330,20 330,34 C330,46 312,44 314,34' },
  ] },
]

const bulbColors = [['#ffb35c', '#ff9a2e'], ['#ffffff', '#cfe6ff'], ['#ff5a6a', '#ff3b4f']]
const bulbs = [[36, 26], [84, 32], [128, 22], [178, 9], [226, 7], [268, 13], [318, 23], [366, 22], [412, 15], [462, 9], [510, 12], [552, 11]]

// Wind strokes and the string of lights over the blue panel; they fade in when the logo intro ends.
export function ChristmasSky() {
  return <>
    <div className="xmas-wind xmas-late" aria-hidden="true">
      {windGusts.map((gust, index) => <svg key={index} style={gust.style} viewBox={gust.viewBox}>
        {gust.paths.map((path) => <path key={path.d} style={{ '--len': String(path.len), '--dur': path.dur, '--delay': path.delay }} stroke={path.stroke} strokeWidth={path.width} d={path.d} />)}
      </svg>)}
    </div>
    <svg className="xmas-lights xmas-late" viewBox="0 0 570 64" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0,8 Q71,46 142,14 T285,14 T428,14 T570,10" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.2" />
      <g>
        {bulbs.map(([cx, cy], index) => {
          const [fill, glow] = bulbColors[index % bulbColors.length]
          return <circle key={cx} className="xmas-bulb" cx={cx} cy={cy} r="4" fill={fill} style={{ filter: `drop-shadow(0 0 6px ${glow})` }} />
        })}
      </g>
    </svg>
  </>
}

export function ChristmasSnowbank() {
  return <svg className="xmas-snowbank xmas-late" viewBox="0 0 570 46" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0,24 C60,10 110,20 170,14 C240,6 290,26 360,18 C430,10 490,22 570,12 L570,46 L0,46 Z" fill="rgba(255,255,255,.85)" />
    <path d="M0,34 C80,26 150,36 230,30 C320,24 400,38 480,32 C520,29 550,32 570,30 L570,46 L0,46 Z" fill="#fff" />
  </svg>
}

export function ChristmasFrost() {
  return <div className="xmas-frost" aria-hidden="true" />
}

// Snow piled on top of the login card.
export function ChristmasCardSnow() {
  return <svg className="xmas-snowcap" viewBox="0 0 416 28" preserveAspectRatio="none" aria-hidden="true">
    <path fill="#fff" d="M6,28 C6,19 14,13 26,13 C40,5 60,7 70,14 C88,5 112,7 124,15 C140,8 160,9 170,16 C188,7 214,8 226,16 C244,9 262,11 272,17 C290,7 316,8 330,15 C346,8 368,9 380,16 C394,11 410,17 410,28 Z" />
  </svg>
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Falling snow over the whole screen, with a gust of wind every 7 seconds. It ignores the mouse and the touch,
// so every button and field below it works as usual. Flakes are white over the blue panel and light blue over the white side.
export function ChristmasSnow({ visible, panelRef }) {
  const canvasRef = useRef(null)
  const [calm] = useState(reducedMotion)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!context) return undefined
    const flakes = [], start = performance.now()
    let width = 0, height = 0, wind = 0, frame = 0, panel = { left: 0, right: 0, top: 0, bottom: 0 }
    const flake = (anywhere) => {
      const depth = Math.random()
      return { x: Math.random() * width, y: anywhere ? Math.random() * height : -10, r: 0.8 + depth * 2.6, vy: 0.35 + depth * 1.05, s: Math.random() * 6.28, ss: 0.005 + Math.random() * 0.015, a: 0.45 + depth * 0.55 }
    }
    const measure = () => { if (panelRef.current) panel = panelRef.current.getBoundingClientRect() }
    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth; height = window.innerHeight
      canvas.width = width * ratio; canvas.height = height * ratio
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      measure()
      const total = Math.round(Math.min(200, width * height / 7500))
      while (flakes.length < total) flakes.push(flake(true))
      flakes.length = total
    }
    const gust = (time) => { const cycle = ((time - start) / 1000) % 7; return cycle > 1.5 && cycle < 4.5 ? Math.sin((cycle - 1.5) / 3 * Math.PI) * 2.2 : 0 }
    function draw(time) {
      context.clearRect(0, 0, width, height)
      wind += (gust(time) - wind) * 0.03
      for (const item of flakes) {
        item.s += item.ss
        item.x += Math.sin(item.s) * 0.4 + wind * (0.4 + item.r / 3.6)
        item.y += item.vy
        if (item.y > height + 10 || item.x > width + 20 || item.x < -20) {
          Object.assign(item, flake(false))
          if (wind > 0.5) item.x = Math.random() * width * 0.8 - width * 0.1
        }
        const overPanel = item.x >= panel.left && item.x <= panel.right && item.y >= panel.top && item.y <= panel.bottom
        context.beginPath()
        context.arc(item.x, item.y, item.r, 0, 6.283)
        context.fillStyle = overPanel ? `rgba(255,255,255,${item.a})` : `rgba(120,165,215,${item.a * 0.55})`
        context.fill()
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
  return <canvas ref={canvasRef} className={`xmas-snow${visible ? ' xmas-snow--on' : ''}`} aria-hidden="true" />
}
