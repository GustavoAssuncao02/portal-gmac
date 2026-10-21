import { useEffect, useRef, useState } from 'react'

const PHOTO_MS = 7000, VIDEO_MAX_MS = 12000, CALM_MS = 11000
const origins = ['50% 50%', '35% 40%', '65% 40%', '40% 65%', '60% 60%']
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
// Layers of gmac-logo-light.png made by scripts/build-login-logo.mjs, all with the original size (1329×1018).
const logoLayer = (name) => `/images/login-logo/${name}.png`
const logoLayers = ['simbolo-branco', 'simbolo-laranja', 'nome-gmac', 'nome-metalurgica'].map(logoLayer)
// Axis of the orange stroke measured by the same script, extended past both rounded ends: the mask draws along it.
const LOGO_PEN = 'M 603 370 L 915 109'
// If a layer is slow to arrive, the entrance starts anyway instead of keeping the panel empty.
const INTRO_WAIT_MS = 2500

// The logo enters in steps: the white symbol, the orange stroke drawn as a line, then "GMAC" and "METALÚRGICA".
function BrandLogo() {
  return <svg className="brand-panel__logo brand-logo" viewBox="0 0 1329 1018" role="img" aria-label="GMAC Metalúrgica">
    <defs>
      <mask id="gmac-logo-pen" maskUnits="userSpaceOnUse" x="0" y="0" width="1329" height="1018">
        <path className="brand-logo__pen" d={LOGO_PEN} pathLength="1" fill="none" stroke="#fff" strokeWidth="140" strokeLinecap="round" />
      </mask>
    </defs>
    <image className="brand-logo__symbol" href={logoLayers[0]} width="1329" height="1018" />
    <image className="brand-logo__stroke" href={logoLayers[1]} width="1329" height="1018" mask="url(#gmac-logo-pen)" />
    <image className="brand-logo__name" href={logoLayers[2]} width="1329" height="1018" />
    <image className="brand-logo__tagline" href={logoLayers[3]} width="1329" height="1018" />
  </svg>
}

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
  const [introReady, setIntroReady] = useState(false)
  const bag = useRef([]), counter = useRef(0)
  useEffect(() => {
    let active = true
    const start = () => { if (active) setIntroReady(true) }
    const timer = window.setTimeout(start, INTRO_WAIT_MS)
    Promise.all(logoLayers.map((src) => { const image = new Image(); image.src = src; return image.decode().catch(() => {}) })).then(start)
    return () => { active = false; window.clearTimeout(timer) }
  }, [])
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
    <div className={`brand-panel__content brand-intro${introReady ? ' brand-intro--play' : ''}`}>
      <div className="brand-panel__mark"><BrandLogo /></div>
      <span className="brand-panel__rule" aria-hidden="true" />
      <p className="brand-panel__title">Sistema de Gestão</p>
      <p className="brand-panel__subtitle">Acesse para acompanhar produção, serviços e orçamentos.</p>
    </div>
  </section>
}
