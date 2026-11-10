import { useEffect, useRef, useState } from 'react'
import './fx.css'
import carnaval from './carnaval.js'
import pascoa from './pascoa.js'
import diaDaMulher from './dia-da-mulher.js'
import diaDoTrabalhador from './dia-do-trabalhador.js'
import diaDasMaes from './dia-das-maes.js'
import saoJoao from './sao-joao.js'
import prevencaoAcidentes from './prevencao-acidentes.js'
import diaDosPais from './dia-dos-pais.js'
import independencia from './independencia.js'
import { pageParticles, panelEffects } from './effects.js'

// Commemorative looks built on the same base (accessory on the logo, badge under the subtitle, stripe on the card,
// glow on the white side, particles over the screen). Their drawings come as markup, exactly as in the mockups, and
// are only shown: they ignore the mouse and the touch, so everything under them works as usual.
export const fxThemes = Object.fromEntries([carnaval, pascoa, diaDaMulher, diaDoTrabalhador, diaDasMaes, saoJoao, prevencaoAcidentes, diaDosPais, independencia].map((theme) => [theme.id, theme]))

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const html = (markup) => ({ __html: markup })

// Inside the logo SVG, so the drawings scale with the logo: behind the symbol (Easter ears) or in front of it.
export function FxLogoBehind({ theme }) {
  return theme.logoBehind ? <g dangerouslySetInnerHTML={html(theme.logoBehind)} /> : null
}

export function FxLogoFront({ theme }) {
  return theme.logoFront ? <g dangerouslySetInnerHTML={html(theme.logoFront)} /> : null
}

// Layers of the blue panel behind the logo. The São João embers and the Labor Day sparks start here, once the intro ends.
export function FxPanelBack({ theme, introDone }) {
  const host = useRef(null), done = useRef(introDone)
  done.current = introDone
  useEffect(() => {
    const effect = panelEffects[theme.id], panel = host.current?.closest('.brand-panel')
    if (!effect || !panel || reducedMotion()) return undefined
    return effect(panel, () => done.current)
  }, [theme])
  return <div ref={host} className="fx-layers" aria-hidden="true" dangerouslySetInnerHTML={html(theme.panelBack)} />
}

export function FxPanelFront({ theme }) {
  return theme.panelFront ? <div className="fx-layers" aria-hidden="true" dangerouslySetInnerHTML={html(theme.panelFront)} /> : null
}

export function FxBadge({ theme }) {
  return <div className="fx-badge" dangerouslySetInnerHTML={html(theme.badge)} />
}

export function FxAura() {
  return <div className="fx-aura" aria-hidden="true" />
}

// Stripe (or the São João flags) on top of the card. The frame follows the card corners, so the card itself is untouched.
export function FxCardDecor({ theme }) {
  return <span className="fx-card-frame" aria-hidden="true">
    {theme.card ? <span className="fx-layers" dangerouslySetInnerHTML={html(theme.card)} /> : <span className="fx-card-bar" />}
  </span>
}

// Particles over the whole screen, lighter over the blue panel.
export function FxPageParticles({ theme, visible, panelRef }) {
  const canvasRef = useRef(null)
  const [calm] = useState(reducedMotion)
  const config = theme.pageCanvas ? pageParticles[theme.id] : null
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!config || !context) return undefined
    const items = []
    let width = 0, height = 0, frame = 0, panel = { left: 0, right: 0, top: 0, bottom: 0 }
    const measure = () => { if (panelRef.current) panel = panelRef.current.getBoundingClientRect() }
    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth; height = window.innerHeight
      canvas.width = width * ratio; canvas.height = height * ratio
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      measure()
      const total = Math.round(Math.min(config.max, width * height / config.area))
      while (items.length < total) items.push(config.make(width, height, true))
      items.length = total
    }
    function draw(time) {
      context.clearRect(0, 0, width, height)
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        config.step(item, time)
        if (item.y > height + 20 || item.x < -40 || item.x > width + 40) { items[index] = config.make(width, height, false); continue }
        config.draw(context, item, item.x >= panel.left && item.x <= panel.right && item.y >= panel.top && item.y <= panel.bottom)
      }
      frame = window.requestAnimationFrame(draw)
    }
    window.addEventListener('resize', resize)
    window.addEventListener('scroll', measure, { passive: true })
    resize()
    frame = window.requestAnimationFrame(draw)
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', resize); window.removeEventListener('scroll', measure) }
  }, [config])
  if (calm || !config) return null
  return <canvas ref={canvasRef} className={`fx-page${visible ? ' fx-page--on' : ''}`} aria-hidden="true" />
}
