import { existsSync } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import compression from 'compression'
import express from 'express'

const DAY = 86400

// Behind the hosting balancer the client address arrives in X-Forwarded-For. Only the configured hops are trusted,
// otherwise every visitor would share the balancer's address (and its request limit) or could forge their own.
export function trustProxySetting(value) {
  const text = String(value ?? '').trim()
  if (!text) return 'loopback'
  if (/^\d+$/.test(text)) return Number(text)
  if (text === 'true' || text === 'false') return text === 'true'
  return text
}

// The interface only loads files from its own address, so these restrictions do not change how the portal works.
// Resource directives (script-src, object-src...) are left out on purpose: blob previews and the sandboxed
// AI report inherit this policy and must keep running.
function securityHeaders(request, response, next) {
  response.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  })
  if (request.secure) response.set('Strict-Transport-Security', 'max-age=15552000')
  next()
}

// API data belongs to the signed-in user and changes all the time: the browser may keep a copy, but always
// confirms it with the server (ETag, answered with 304 when nothing changed), and no shared cache stores it.
// Routes that already forbid any copy ("no-store") keep their own header.
function privateApiCache(_request, response, next) {
  response.set('Cache-Control', 'private, no-cache')
  next()
}

export function configureWeb(app) {
  app.disable('x-powered-by')
  app.use(securityHeaders)
  // JSON, JavaScript and CSS travel compressed (Brotli or gzip); images, videos, PDFs and spreadsheets are left as they are.
  // Brotli level 5 beats gzip on this portal's files (the library default, 4, does not) at a similar cost.
  app.use(compression({ brotli: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } } }))
  app.use('/api', privateApiCache)
}

function cachePolicy(file) {
  // Vite names these files after their content: a new build changes the name, so the old copy never goes stale.
  if (file.startsWith('assets/')) return `public, max-age=${365 * DAY}, immutable`
  // Entry points must be confirmed on every visit, so a new build or new login media shows up at once.
  if (file === 'index.html' || file === 'login-media/manifest.json') return 'no-cache'
  if (file.startsWith('fonts/')) return `public, max-age=${30 * DAY}`
  // Logos and login media keep their names when replaced: one day fresh, then shown while a new copy is fetched.
  return `public, max-age=${DAY}, stale-while-revalidate=${7 * DAY}`
}

// Publishes the built interface (npm run build) from the same address as the API. Returns false when there is no build.
export function serveInterface(app, directory) {
  if (!existsSync(path.join(directory, 'index.html'))) return false
  app.use(express.static(directory, {
    setHeaders(response, file) {
      response.set('Cache-Control', cachePolicy(path.relative(directory, file).split(path.sep).join('/')))
    },
  }))
  return true
}
