import { useEffect, useRef, useState } from 'react'

const PHOTO_MS = 7000, VIDEO_MAX_MS = 12000, CALM_MS = 11000
const origins = ['50% 50%', '35% 40%', '65% 40%', '40% 65%', '60% 60%']
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Random order without repeating an item until all were shown, and never the same item twice in a row.
function nextIndex(bag, total, last) {
  if (!bag.length) {
    bag.push(...Array.from({ length: total }, (_, index) => index).sort(() => Math.random() - 0.5))
    if (total > 1 && bag[0] === last) bag.push(bag.shift())
  }
  return bag.shift()
}

function Slide({ item, leaving, origin, onDone }) {
  const video = useRef(null), finished = useRef(false)
  const finish = () => { if (!finished.current && !leaving) { finished.current = true; onDone() } }
  useEffect(() => {
    if (item.type !== 'video' || leaving) return undefined
    video.current.play().catch(finish)
    const limit = window.setTimeout(finish, VIDEO_MAX_MS)
    return () => window.clearTimeout(limit)
  }, [item, leaving])
  return <div className={`brand-media__slide${leaving ? ' brand-media__slide--leaving' : ''}`} style={{ '--zoom-origin': origin }}>
    {item.type === 'video' ? <video ref={video} src={item.src} muted playsInline preload="auto" onEnded={finish} /> : <img src={item.src} alt="" decoding="async" />}
  </div>
}

export default function LoginBrandPanel() {
  const [items, setItems] = useState([]), [slides, setSlides] = useState({ current: null, previous: null })
  const bag = useRef([]), counter = useRef(0)
  useEffect(() => {
    let active = true
    fetch('/login-media/manifest.json').then((response) => response.ok ? response.json() : { items: [] }).then((data) => { if (active) setItems((Array.isArray(data.items) ? data.items : []).filter((item) => item.type === 'image' || !reducedMotion())) }).catch(() => {})
    return () => { active = false }
  }, [])
  function advance() {
    if (!items.length) return
    setSlides((state) => {
      const index = nextIndex(bag.current, items.length, state.current?.index)
      counter.current += 1
      return { previous: state.current, current: { index, item: items[index], key: counter.current, origin: origins[counter.current % origins.length] } }
    })
  }
  useEffect(() => { if (items.length) advance() }, [items])
  const current = slides.current
  useEffect(() => {
    if (!current || current.item.type === 'video' || items.length < 2) return undefined
    const timer = window.setTimeout(advance, reducedMotion() ? CALM_MS : PHOTO_MS)
    return () => window.clearTimeout(timer)
  }, [current?.key])
  useEffect(() => {
    // Drop the finished slide so only the visible media keeps decoding.
    if (!slides.previous) return undefined
    const timer = window.setTimeout(() => setSlides((state) => state.previous === slides.previous ? { ...state, previous: null } : state), 1800)
    return () => window.clearTimeout(timer)
  }, [slides.previous])
  useEffect(() => {
    const preload = items.find((item, index) => index === bag.current[0] && item.type === 'image')
    if (preload) new Image().src = preload.src
  }, [current?.key])
  return <section className={`brand-panel${current ? ' brand-panel--media' : ''}`} aria-label="GMAC Metalúrgica">
    <div className="brand-media" aria-hidden="true">
      {slides.previous && <Slide key={slides.previous.key} item={slides.previous.item} origin={slides.previous.origin} leaving onDone={() => {}} />}
      {current && <Slide key={current.key} item={current.item} origin={current.origin} onDone={() => { if (items.length > 1) advance() }} />}
    </div>
    <div className="brand-panel__veil" />
    <div className="brand-panel__content">
      <div className="brand-panel__mark"><img className="brand-panel__logo" src="/images/gmac-logo-light.png" alt="GMAC Metalúrgica" /></div>
      <span className="brand-panel__rule" aria-hidden="true" />
      <p className="brand-panel__title">Sistema de Gestão</p>
      <p className="brand-panel__subtitle">Acesse para acompanhar produção, serviços e orçamentos.</p>
    </div>
  </section>
}
