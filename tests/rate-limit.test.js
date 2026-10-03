import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { createServer } from 'vite'
import viteConfig from '../vite.config.js'
import { createApiRateLimiter } from '../server/rateLimit.js'

async function fixture(t, options) {
  const app = express()
  app.set('trust proxy', 'loopback')
  app.use('/api', createApiRateLimiter(options))
  app.get('/api/health', (request, response) => response.json({ ip: request.ip }))
  app.post('/api/auth/login', (_request, response) => response.status(401).json({ message: 'Invalid login' }))
  app.get('/', (_request, response) => response.send('Interface'))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}`
  return { url, request: (route, ip = '192.168.1.10', method = 'GET') => fetch(`${url}${route}`, { method, headers: { 'X-Forwarded-For': ip } }) }
}

test('API allows exactly 200 requests per minute per IP, shares counts across routes and counts failed logins', async (t) => {
  const server = await fixture(t)
  for (let index = 0; index < 200; index++) {
    const login = index % 2 === 0
    const response = await server.request(login ? '/api/auth/login' : '/api/health', undefined, login ? 'POST' : 'GET')
    assert.equal(response.status, login ? 401 : 200)
    assert.ok(response.headers.get('ratelimit-policy').includes('q=200; w=60'))
    await response.arrayBuffer()
  }
  const blocked = await server.request('/api/health')
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers.get('retry-after')) > 0)
  assert.match((await blocked.json()).message, /200/)
  assert.equal((await server.request('/api/health', '192.168.1.11')).status, 200)
  assert.equal((await server.request('/api/health', '198.51.100.5, 192.168.1.10')).status, 429)
  const page = await server.request('/')
  assert.equal(page.status, 200)
  assert.equal(page.headers.get('ratelimit'), null)
})

test('rate limit expires automatically and the next window accepts requests again', async (t) => {
  const server = await fixture(t, { windowMs: 100, limit: 1 })
  assert.equal((await server.request('/api/health')).status, 200)
  assert.equal((await server.request('/api/health')).status, 429)
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal((await server.request('/api/health')).status, 200)
})

test('Vite LAN proxy overwrites spoofed forwarding headers so clients cannot evade IP limits', async (t) => {
  const backend = await fixture(t, { limit: 2 })
  const proxy = viteConfig.server.proxy['/api']
  const vite = await createServer({ configFile: false, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: { '/api': { ...proxy, target: backend.url } } } })
  await vite.listen()
  t.after(() => vite.close())
  const url = `http://127.0.0.1:${vite.httpServer.address().port}`
  for (const fakeIp of ['192.168.1.10', '192.168.1.11']) {
    const response = await fetch(`${url}/api/health`, { headers: { 'X-Forwarded-For': fakeIp } })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).ip, '127.0.0.1')
  }
  assert.equal((await fetch(`${url}/api/health`, { headers: { 'X-Forwarded-For': '192.168.1.12' } })).status, 429)
})
