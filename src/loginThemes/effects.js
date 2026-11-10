// Animations of the commemorative looks drawn with JavaScript, ported from their mockups with the same numbers.

// Particles falling over the whole screen (the mockups' fxPageCanvas): make a particle, move it a frame, draw it.
// "overPanel" is true over the blue panel, where the colors are lighter.
export const pageParticles = {
  carnaval: {
    max: 140, area: 9000,
    make: (width, height, anywhere) => ({ x: Math.random() * width, y: anywhere ? Math.random() * height : -12, r: 2 + Math.random() * 2.6,
      round: Math.random() < 0.6, vy: 0.6 + Math.random() * 1.1, s: Math.random() * 6.28, rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.1, flip: Math.random() * 6.28, vf: 0.04 + Math.random() * 0.06, k: Math.random() }),
    step: (item) => { item.s += 0.03; item.flip += item.vf; item.rot += item.vr; item.x += Math.sin(item.s) * 0.5; item.y += item.vy },
    draw: (context, item, overPanel) => {
      const palette = overPanel ? ['#ff4fa3', '#ffd23f', '#3ee6b0', '#5ec8ff', '#b07bff', '#ffffff'] : ['#e5317f', '#f5b400', '#19b88a', '#1e9be0', '#7b3fe4', '#ff7a3d']
      context.save(); context.translate(item.x, item.y); context.rotate(item.rot); context.scale(1, Math.cos(item.flip))
      context.globalAlpha = overPanel ? 0.95 : 0.7; context.fillStyle = palette[Math.floor(item.k * palette.length)]
      if (item.round) { context.beginPath(); context.arc(0, 0, item.r, 0, 6.283); context.fill() }
      else context.fillRect(-item.r * 1.4, -item.r * 0.6, item.r * 2.8, item.r * 1.2)
      context.restore()
    },
  },
  pascoa: {
    max: 70, area: 16000,
    make: (width, height, anywhere) => ({ x: Math.random() * width, y: anywhere ? Math.random() * height : -12, w: 4 + Math.random() * 3,
      vy: 0.4 + Math.random() * 0.55, s: Math.random() * 6.28, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.04,
      flip: Math.random() * 6.28, vf: 0.02 + Math.random() * 0.03, k: Math.random() }),
    step: (item) => { item.s += 0.015; item.flip += item.vf; item.rot += item.vr; item.x += Math.sin(item.s) * 0.7 + 0.15; item.y += item.vy },
    draw: (context, item, overPanel) => {
      const palette = overPanel ? ['#ffd6e7', '#fff1b8', '#d9c8ff', '#c8f1e1', '#ffffff'] : ['#f4a6c6', '#f2c94c', '#b49ae6', '#7fd3b5', '#ffb98a']
      context.save(); context.translate(item.x, item.y); context.rotate(item.rot); context.scale(1, Math.abs(Math.cos(item.flip)) * 0.8 + 0.2)
      context.globalAlpha = overPanel ? 0.9 : 0.75; context.fillStyle = palette[Math.floor(item.k * palette.length)]
      context.beginPath(); context.ellipse(0, 0, item.w, item.w * 0.55, 0, 0, 6.283); context.fill()
      context.restore()
    },
  },
  independencia: {
    max: 100, area: 12000,
    make: (width, height, anywhere) => ({ x: Math.random() * width, y: anywhere ? Math.random() * height : -12, r: 2 + Math.random() * 2.6,
      vy: 0.6 + Math.random() * 0.6, s: Math.random() * 6.28, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.08,
      flip: Math.random() * 6.28, vf: 0.03 + Math.random() * 0.05, k: Math.random() }),
    step: (item) => { item.s += 0.025; item.flip += item.vf; item.rot += item.vr; item.x += Math.sin(item.s) * 0.5; item.y += item.vy },
    draw: (context, item, overPanel) => {
      const palette = overPanel ? ['#00c853', '#ffdf00', '#4f8cff', '#ffffff'] : ['#009c3b', '#f5c400', '#1f5ec8', '#00b04a']
      context.save(); context.translate(item.x, item.y); context.rotate(item.rot); context.scale(1, Math.cos(item.flip))
      context.globalAlpha = overPanel ? 0.9 : 0.7; context.fillStyle = palette[Math.floor(item.k * palette.length)]
      context.fillRect(-item.r * 1.4, -item.r * 0.6, item.r * 2.8, item.r * 1.2)
      context.restore()
    },
  },
  'dia-da-mulher': {
    max: 70, area: 15000,
    make: (width, height, anywhere) => ({ x: Math.random() * width, y: anywhere ? Math.random() * height : -12, r: 2 + Math.random() * 2.6,
      vy: 0.4 + Math.random() * 0.55, s: Math.random() * 6.28, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.08,
      flip: Math.random() * 6.28, vf: 0.03 + Math.random() * 0.05, k: Math.random() }),
    step: (item) => { item.s += 0.025; item.flip += item.vf; item.rot += item.vr; item.x += Math.sin(item.s) * 0.5; item.y += item.vy },
    draw: (context, item, overPanel) => {
      const palette = overPanel ? ['#e0aaff', '#ffb3d9', '#ffffff', '#c77dff'] : ['#c77dff', '#ff7ab6', '#b388eb', '#f4a6c6']
      context.save(); context.translate(item.x, item.y); context.rotate(item.rot); context.scale(1, Math.cos(item.flip))
      context.globalAlpha = overPanel ? 0.9 : 0.7; context.fillStyle = palette[Math.floor(item.k * palette.length)]
      context.beginPath(); context.ellipse(0, 0, item.r * 1.6, item.r * 0.9, 0, 0, 6.283); context.fill()
      context.restore()
    },
  },
}

// Canvases inside the blue panel. Each one starts with the panel element and a function that says whether the logo
// intro already ended, and returns how to stop it.
export const panelEffects = {
  // Embers rising from the bonfire.
  'sao-joao': (panel, introDone) => {
    const fire = panel.querySelector('.sj-fire'), canvas = panel.querySelector('.sj-embers'), context = canvas?.getContext('2d')
    if (!fire || !context) return () => {}
    const embers = []
    let width = 0, height = 0, fireX = 0, fireY = 0, fireWidth = 40, frame = 0
    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2), panelBox = panel.getBoundingClientRect(), fireBox = fire.getBoundingClientRect()
      width = panelBox.width; height = panelBox.height; canvas.width = width * ratio; canvas.height = height * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0)
      fireX = fireBox.left - panelBox.left + fireBox.width / 2; fireY = fireBox.top - panelBox.top + fireBox.height * 0.45; fireWidth = fireBox.width
    }
    function draw(time) {
      context.clearRect(0, 0, width, height)
      if (introDone()) {
        for (let count = 0; count < 2 && embers.length < 160; count += 1) {
          embers.push({ x: fireX + (Math.random() - 0.5) * fireWidth * 0.45, y: fireY, vx: (Math.random() - 0.5) * 0.5, vy: -(1 + Math.random() * 1.7),
            life: 1, decay: 0.005 + Math.random() * 0.009, r: 0.7 + Math.random() * 1.6, g: Math.floor(120 + Math.random() * 110), seed: Math.random() * 9 })
        }
      }
      context.globalCompositeOperation = 'lighter'
      for (let index = embers.length - 1; index >= 0; index -= 1) {
        const ember = embers[index]
        ember.vx += Math.sin(time / 350 + ember.seed) * 0.02 - 0.004; ember.x += ember.vx; ember.y += ember.vy; ember.vy *= 0.995; ember.life -= ember.decay
        if (ember.life <= 0 || ember.y < -10) { embers.splice(index, 1); continue }
        context.fillStyle = `rgba(255,${ember.g},50,${ember.life})`
        context.beginPath(); context.arc(ember.x, ember.y, ember.r, 0, 6.283); context.fill()
      }
      context.globalCompositeOperation = 'source-over'
      frame = window.requestAnimationFrame(draw)
    }
    window.addEventListener('resize', resize)
    resize()
    // The bonfire settles after the intro: measure it again.
    const again = window.setTimeout(resize, 4000)
    frame = window.requestAnimationFrame(draw)
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(again); window.removeEventListener('resize', resize) }
  },
  // Welding sparks flying from the sides of the panel.
  'dia-do-trabalhador': (panel, introDone) => {
    const canvas = panel.querySelector('.tr-sparks'), context = canvas?.getContext('2d')
    if (!context) return () => {}
    const sparks = []
    let width = 0, height = 0, source = null, next = 0, frame = 0
    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2), box = panel.getBoundingClientRect()
      width = box.width; height = box.height; canvas.width = width * ratio; canvas.height = height * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    function draw(time) {
      context.clearRect(0, 0, width, height)
      if (introDone()) {
        if (!source && time > next) {
          const left = Math.random() < 0.5
          source = { x: left ? width * 0.03 : width * 0.97, y: height * (0.72 + Math.random() * 0.22), dir: left ? 1 : -1, until: time + 500 + Math.random() * 500 }
        }
        if (source) {
          for (let count = 0; count < 6; count += 1) {
            sparks.push({ x: source.x, y: source.y, vx: source.dir * (2 + Math.random() * 6), vy: -(1 + Math.random() * 5.5), life: 1, decay: 0.014 + Math.random() * 0.02, g: Math.floor(150 + Math.random() * 90) })
          }
          if (time > source.until) { source = null; next = time + 1400 + Math.random() * 2400 }
        }
      }
      context.globalCompositeOperation = 'lighter'; context.lineCap = 'round'; context.lineWidth = 1.5
      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const spark = sparks[index]
        spark.vy += 0.16; spark.vx *= 0.99; spark.x += spark.vx; spark.y += spark.vy; spark.life -= spark.decay
        if (spark.life <= 0 || spark.y > height + 10) { sparks.splice(index, 1); continue }
        context.strokeStyle = `rgba(255,${spark.g},70,${spark.life})`
        context.beginPath(); context.moveTo(spark.x - spark.vx * 2.4, spark.y - spark.vy * 2.4); context.lineTo(spark.x, spark.y); context.stroke()
      }
      context.globalCompositeOperation = 'source-over'
      frame = window.requestAnimationFrame(draw)
    }
    window.addEventListener('resize', resize)
    resize()
    frame = window.requestAnimationFrame(draw)
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', resize) }
  },
}
