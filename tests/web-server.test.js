import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { configureWeb, serveInterface, trustProxySetting } from '../server/webServer.js'

const results = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results')
const script = `console.log(${JSON.stringify('portal '.repeat(600))})`
const video = randomBytes(4096)
const rows = Array.from({ length: 200 }, (_, index) => ({ id: index, name: `Material ${index}`, quantity: index * 2 }))
// What a browser sends when it confirms its copy. Without it, Node's fetch adds "no-cache" and forces a full answer.
const confirming = (response) => ({ 'If-None-Match': response.headers.get('etag'), 'Cache-Control': 'max-age=0' })

async function fixture(t) {
  await mkdir(results, { recursive: true })
  const directory = await mkdtemp(path.join(results, 'web-server-'))
  for (const folder of ['assets', 'fonts', 'images', 'login-media']) await mkdir(path.join(directory, folder))
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><title>GMAC</title>')
  await writeFile(path.join(directory, 'assets', 'index-abc123.js'), script)
  await writeFile(path.join(directory, 'fonts', 'inter.woff2'), randomBytes(512))
  await writeFile(path.join(directory, 'images', 'gmac-logo.png'), randomBytes(512))
  await writeFile(path.join(directory, 'login-media', 'manifest.json'), '{"items":[]}')
  await writeFile(path.join(directory, 'login-media', 'video-01.mp4'), video)
  const app = express()
  app.set('trust proxy', 'loopback')
  configureWeb(app)
  app.get('/api/items', (_request, response) => response.json({ items: rows }))
  app.get('/api/live', (_request, response) => response.set('Cache-Control', 'no-store').json({ items: rows }))
  assert.equal(serveInterface(app, directory), true)
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)) })
  t.after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections() }); await rm(directory, { recursive: true, force: true }) })
  return (route, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}${route}`, { headers })
}

test('trusted proxies come from TRUST_PROXY and default to the local machine only', () => {
  assert.equal(trustProxySetting(undefined), 'loopback')
  assert.equal(trustProxySetting('  '), 'loopback')
  assert.equal(trustProxySetting('1'), 1)
  assert.equal(trustProxySetting('false'), false)
  assert.equal(trustProxySetting('true'), true)
  assert.equal(trustProxySetting('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8')
})

test('the built interface is cached by how each file changes', async (t) => {
  const request = await fixture(t)
  const policy = async (route) => { const response = await request(route); assert.equal(response.status, 200, route); await response.arrayBuffer(); return response.headers.get('cache-control') }
  assert.equal(await policy('/assets/index-abc123.js'), 'public, max-age=31536000, immutable')
  assert.equal(await policy('/'), 'no-cache')
  assert.equal(await policy('/index.html'), 'no-cache')
  assert.equal(await policy('/login-media/manifest.json'), 'no-cache')
  assert.equal(await policy('/fonts/inter.woff2'), 'public, max-age=2592000')
  assert.equal(await policy('/images/gmac-logo.png'), 'public, max-age=86400, stale-while-revalidate=604800')
  assert.equal(await policy('/login-media/video-01.mp4'), 'public, max-age=86400, stale-while-revalidate=604800')
  const page = await request('/')
  const again = await request('/', confirming(page))
  assert.equal(again.status, 304, 'An unchanged page is confirmed without being sent again')
  assert.equal((await request('/assets/missing.js')).status, 404)
})

test('API answers stay private, are confirmed with the server and keep stricter route rules', async (t) => {
  const request = await fixture(t)
  const first = await request('/api/items')
  assert.equal(first.headers.get('cache-control'), 'private, no-cache')
  assert.deepEqual((await first.json()).items, rows)
  const unchanged = await request('/api/items', confirming(first))
  assert.equal(unchanged.status, 304)
  assert.equal(unchanged.headers.get('cache-control'), 'private, no-cache')
  assert.equal((await request('/api/live')).headers.get('cache-control'), 'no-store')
})

test('text travels compressed while media is sent untouched and can be requested in ranges', async (t) => {
  const request = await fixture(t)
  for (const encoding of ['br', 'gzip']) {
    const data = await request('/api/items', { 'Accept-Encoding': encoding })
    assert.equal(data.headers.get('content-encoding'), encoding)
    assert.match(data.headers.get('vary'), /Accept-Encoding/i)
    assert.deepEqual((await data.json()).items, rows)
    const asset = await request('/assets/index-abc123.js', { 'Accept-Encoding': encoding })
    assert.equal(asset.headers.get('content-encoding'), encoding)
    assert.equal(await asset.text(), script)
  }
  const plain = await request('/api/items', { 'Accept-Encoding': 'identity' })
  assert.equal(plain.headers.get('content-encoding'), null)
  assert.deepEqual((await plain.json()).items, rows)
  const media = await request('/login-media/video-01.mp4', { 'Accept-Encoding': 'br, gzip' })
  assert.equal(media.headers.get('content-encoding'), null)
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), video)
  const range = await request('/login-media/video-01.mp4', { Range: 'bytes=100-199' })
  assert.equal(range.status, 206)
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), video.subarray(100, 200))
})

test('every answer carries the protection headers and HTTPS is enforced only behind a trusted proxy', async (t) => {
  const request = await fixture(t)
  for (const route of ['/', '/assets/index-abc123.js', '/api/items']) {
    const response = await request(route)
    await response.arrayBuffer()
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', route)
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN', route)
    assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'self'; base-uri 'self'; form-action 'self'", route)
    assert.equal(response.headers.get('referrer-policy'), 'same-origin', route)
    assert.ok(response.headers.get('permissions-policy').includes('camera=()'), route)
    assert.equal(response.headers.get('x-powered-by'), null, route)
    assert.equal(response.headers.get('strict-transport-security'), null, route)
  }
  const missing = await request('/api/unknown')
  assert.equal(missing.status, 404)
  assert.equal(missing.headers.get('x-frame-options'), 'SAMEORIGIN')
  assert.equal(missing.headers.get('x-content-type-options'), 'nosniff')
  const secure = await request('/', { 'X-Forwarded-Proto': 'https' })
  assert.equal(secure.headers.get('strict-transport-security'), 'max-age=15552000')
})

test('without a build the API keeps working and no interface is published', () => {
  assert.equal(serveInterface(express(), path.join(results, 'no-build-here')), false)
})
