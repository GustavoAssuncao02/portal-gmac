import { notificationSounds } from '../server/notificationRules.js'

// Notification sounds played with the Web Audio API. Most are synthesized: each note is an oscillator with a fast attack
// and an exponential decay. A few come from audio files in public/sounds. A compressor keeps them all at the same loudness.
let context = null
let output = null
function audio() {
  const Context = window.AudioContext || window.webkitAudioContext
  if (!Context) return null
  if (!context) {
    context = new Context()
    const compressor = context.createDynamicsCompressor()
    output = context.createGain()
    output.gain.value = 0.9
    output.connect(compressor).connect(context.destination)
  }
  return context
}

// Browsers only start audio after the person touches the page. The first click or key press unlocks it, so a
// notification that arrives later still plays, also after a reload that restored the session.
let unlocking = false
export function unlockNotificationSound() {
  if (unlocking || typeof window === 'undefined') return
  unlocking = true
  const unlock = () => {
    const ctx = audio()
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {})
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('keydown', unlock, true)
  }
  window.addEventListener('pointerdown', unlock, true)
  window.addEventListener('keydown', unlock, true)
}

function note(ctx, { at = 0, frequency, slideTo, type = 'sine', duration, volume = 0.2, attack = 0.006 }) {
  const start = ctx.currentTime + 0.02 + at
  const oscillator = ctx.createOscillator(), gain = ctx.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, start)
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration * 0.6)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(gain).connect(output)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.05)
}

// Sounds that come from an audio file in public/sounds: fetched and decoded once, then kept in memory.
const soundFiles = { morgan: '/sounds/morgan.mp3', coleta: '/sounds/coleta.mp3' }
const decoded = new Map()
async function playFile(ctx, key) {
  if (!decoded.has(key)) {
    decoded.set(key, fetch(soundFiles[key]).then((response) => {
      if (!response.ok) throw new Error('Arquivo de som indisponível.')
      return response.arrayBuffer()
    }).then((data) => ctx.decodeAudioData(data)).catch((error) => { decoded.delete(key); throw error }))
  }
  const source = ctx.createBufferSource()
  source.buffer = await decoded.get(key)
  source.connect(output)
  source.start(ctx.currentTime + 0.02)
}

// Partials of a struck metal bar (inharmonic ratios), for the "Toque metálico".
const metalStrike = (at, base, strength) => [[1, 1.8, 0.22], [2.756, 1.1, 0.12], [5.404, 0.7, 0.07], [8.933, 0.4, 0.04]]
  .map(([ratio, duration, volume]) => ({ at, frequency: base * ratio, duration, volume: volume * strength, attack: 0.002 }))

const patterns = {
  sino: [{ frequency: 880, duration: 1.6, volume: 0.24 }, { frequency: 1760, duration: 1.0, volume: 0.08 }, { frequency: 2112, duration: 0.8, volume: 0.06 }, { frequency: 2640, duration: 0.55, volume: 0.04 }],
  gota: [{ frequency: 520, slideTo: 1560, duration: 0.2, volume: 0.42 }, { at: 0.13, frequency: 700, slideTo: 1900, duration: 0.16, volume: 0.16 }],
  'dois-tons': [{ frequency: 1318.5, duration: 0.55, volume: 0.22 }, { frequency: 2637, duration: 0.3, volume: 0.04 }, { at: 0.22, frequency: 1046.5, duration: 0.9, volume: 0.22 }, { at: 0.22, frequency: 2093, duration: 0.4, volume: 0.04 }],
  acorde: [{ frequency: 1046.5, duration: 0.95, volume: 0.15 }, { at: 0.09, frequency: 1318.5, duration: 0.9, volume: 0.14 }, { at: 0.18, frequency: 1568, duration: 0.85, volume: 0.13 }, { at: 0.27, frequency: 2093, duration: 0.8, volume: 0.09 }],
  bolha: [{ frequency: 300, slideTo: 900, duration: 0.09, volume: 0.34, attack: 0.003 }, { at: 0.11, frequency: 450, slideTo: 1300, duration: 0.08, volume: 0.24, attack: 0.003 }],
  xilofone: [784, 1046.5, 1318.5].flatMap((frequency, index) => [{ at: index * 0.11, frequency, type: 'triangle', duration: 0.38, volume: 0.3, attack: 0.002 }, { at: index * 0.11, frequency: frequency * 4, duration: 0.07, volume: 0.05, attack: 0.002 }]),
  metal: [...metalStrike(0, 523, 1), ...metalStrike(0.24, 523, 0.55)],
  alerta: [{ frequency: 988, duration: 0.14, volume: 0.22, type: 'triangle' }, { at: 0.19, frequency: 988, duration: 0.14, volume: 0.22, type: 'triangle' }, { at: 0.38, frequency: 1318.5, duration: 0.26, volume: 0.22, type: 'triangle' }],
  // Sounds that are not built from notes are functions that schedule themselves.
  morgan: (ctx) => playFile(ctx, 'morgan'),
  coleta: (ctx) => playFile(ctx, 'coleta'),
}
if (notificationSounds.some(([key]) => !patterns[key])) throw new Error('Som de notificação sem padrão definido.')

// Plays the chosen sound; 'off' or an unknown key stay silent. Returns false when the browser has not allowed audio yet.
export async function playNotificationSound(key) {
  const pattern = patterns[key]
  const ctx = pattern && audio()
  if (!ctx) return false
  if (ctx.state !== 'running') await Promise.race([ctx.resume().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 300))])
  // A suspended context would keep the notes and play them late, at the next click: better to skip this one.
  if (ctx.state !== 'running') return false
  if (typeof pattern !== 'function') { for (const step of pattern) note(ctx, step); return true }
  try { await pattern(ctx); return true } catch { return false }
}

// With the portal open in several tabs, each one polls on its own: the first to see a notification plays it.
const PLAYED_KEY = 'gmac-notification-sound-played'
export function claimNotificationSound(ids) {
  try {
    const played = JSON.parse(localStorage.getItem(PLAYED_KEY) || '[]')
    const fresh = ids.filter((id) => !played.includes(id))
    if (!fresh.length) return false
    localStorage.setItem(PLAYED_KEY, JSON.stringify([...played, ...fresh].slice(-200)))
    return true
  } catch { return true }
}
