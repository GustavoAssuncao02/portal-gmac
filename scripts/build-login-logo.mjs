// Splits the light login logo (public/images/gmac-logo-light.png) into the layers of the login entrance animation:
// white symbol, orange stroke of the symbol, "GMAC" and "METALÚRGICA". Layers keep the original size, so they stack
// in the same viewBox with no extra coordinates. It also measures the axis of the orange stroke, which the mask in
// LoginBrandPanel.jsx follows to draw it.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'public', 'images', 'gmac-logo-light.png')
const target = path.join(root, 'public', 'images', 'login-logo')
// Horizontal bands of the original: symbol, "GMAC" and "METALÚRGICA" (cut in the empty rows between them).
const SYMBOL_END = 607, NAME_END = 904

const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width, height } = info
const layers = Object.fromEntries(['simbolo-branco', 'simbolo-laranja', 'nome-gmac', 'nome-metalurgica'].map((name) => [name, Buffer.alloc(width * height * 4)]))
let sum = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0
const orangePixels = []
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4
    const [red, green, blue, alpha] = data.subarray(index, index + 4)
    if (!alpha) continue
    const put = (name, share) => {
      if (share <= 0) return
      const layer = layers[name]
      layer[index] = red; layer[index + 1] = green; layer[index + 2] = blue; layer[index + 3] = Math.round(alpha * share)
    }
    if (y >= NAME_END) { put('nome-metalurgica', 1); continue }
    if (y >= SYMBOL_END) { put('nome-gmac', 1); continue }
    // Orange or white by the red-blue difference; antialiased edges split their opacity between both layers.
    const orange = Math.min(1, Math.max(0, (red - blue - 60) / 80))
    put('simbolo-laranja', orange)
    put('simbolo-branco', 1 - orange)
    if (orange > 0.5 && alpha > 128) {
      const weight = alpha / 255
      sum += weight; sx += weight * x; sy += weight * y; sxx += weight * x * x; syy += weight * y * y; sxy += weight * x * y
      orangePixels.push([x, y])
    }
  }
}
await mkdir(target, { recursive: true })
for (const [name, buffer] of Object.entries(layers)) {
  await sharp(buffer, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(target, `${name}.png`))
}

// Principal axis of the orange stroke, from its lowest end (where the drawing starts) to the highest.
const mx = sx / sum, my = sy / sum
const cxx = sxx / sum - mx * mx, cyy = syy / sum - my * my, cxy = sxy / sum - mx * my
const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy)
const ux = Math.cos(angle), uy = Math.sin(angle)
let low = Infinity, high = -Infinity, spread = 0
for (const [x, y] of orangePixels) {
  const along = (x - mx) * ux + (y - my) * uy
  low = Math.min(low, along); high = Math.max(high, along)
  spread = Math.max(spread, Math.abs(-(x - mx) * uy + (y - my) * ux))
}
let start = [mx + ux * low, my + uy * low], end = [mx + ux * high, my + uy * high]
if (start[1] < end[1]) [start, end] = [end, start]
console.log(`Camadas em ${path.relative(root, target)} (${width}×${height}).`)
console.log(`Traço laranja: de (${start.map(Math.round).join(', ')}) a (${end.map(Math.round).join(', ')}), meia largura ${Math.round(spread)} px.`)
