import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { receiveFile } from '../server/uploads.js'
import { bodyProgressGuard } from '../server/webServer.js'
import { createQuotesApp } from '../server/siteQuotes/app.js'

const results = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function listen(t, app) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() }))
  return server.address().port
}

test('attachments over the size limit, or that would eat the disk reserve, are refused and leave no file behind', async (t) => {
  await mkdir(results, { recursive: true })
  const directory = await mkdtemp(path.join(results, 'uploads-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let limits = { maxBytes: 1024, reserveBytes: 0 }
  const app = express()
  app.post('/upload', async (request, response) => {
    try { response.json({ size: (await receiveFile(request, directory, randomUUID(), limits))?.size ?? null }) } catch (error) { response.status(error.status || 500).json({ message: error.message }) }
  })
  const url = `http://127.0.0.1:${await listen(t, app)}/upload`
  const send = (body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...headers }, body, duplex: 'half' })

  assert.deepEqual(await (await send(Buffer.alloc(1024, 1))).json(), { size: 1024 }, 'a file at the limit is kept')
  const announced = await send(Buffer.alloc(2048, 1))
  assert.equal(announced.status, 413, 'the size the browser announces is checked before the file travels')
  assert.match((await announced.json()).message, /^O arquivo passa de \d+ MB, o limite por anexo\.$/)
  // Without an announced size (chunked), the bytes are counted as they arrive.
  const chunks = new ReadableStream({ start(controller) { for (let i = 0; i < 4; i += 1) controller.enqueue(new Uint8Array(512)); controller.close() } })
  assert.equal((await send(chunks)).status, 413)
  limits = { maxBytes: 1024, reserveBytes: Number.MAX_SAFE_INTEGER }
  const full = await send(Buffer.alloc(10, 1))
  assert.equal(full.status, 507)
  assert.match((await full.json()).message, /sem espaço em disco/)
  await wait(50)
  assert.equal((await readdir(directory)).length, 1, 'only the accepted file stays on the disk')
})

test('a body that stalls is dropped, while slow but steady uploads and slow answers go on', async (t) => {
  const app = express()
  app.use(bodyProgressGuard({ windowMs: 200, minBytes: 1024 }))
  app.use(express.json())
  app.post('/slow-answer', async (request, response) => { await wait(700); response.json({ received: request.body }) })
  app.get('/slow-answer', async (_request, response) => { await wait(700); response.json({ ok: true }) })
  app.post('/raw', express.raw({ type: 'application/octet-stream', limit: '1mb' }), (request, response) => response.json({ size: request.body.length }))
  const port = await listen(t, app)

  // A body sent a byte at a time: the connection is closed without an answer.
  const dripped = await new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write('POST /slow-answer HTTP/1.1\r\nHost: portal\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{'))
    const started = Date.now()
    let answer = ''
    socket.on('data', (chunk) => { answer += chunk })
    socket.on('close', () => resolve({ answer, ms: Date.now() - started }))
    setTimeout(() => socket.destroy(), 3000)
  })
  assert.equal(dripped.answer, '', 'nothing is answered')
  assert.ok(dripped.ms < 1500, `closed after ${dripped.ms} ms`)

  // The time the portal takes to answer is not counted, with or without a body.
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/slow-answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 1 }) })).json(), { received: { a: 1 } })
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/slow-answer`)).json(), { ok: true })

  // A slow line that keeps sending (2 KB every 100 ms, longer than several windows) gets through.
  const steady = new ReadableStream({ async start(controller) { for (let i = 0; i < 10; i += 1) { controller.enqueue(new Uint8Array(2048)); await wait(100) } controller.close() } })
  const upload = await fetch(`http://127.0.0.1:${port}/raw`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: steady, duplex: 'half' })
  assert.deepEqual(await upload.json(), { size: 20480 })
})

test('the public quote form refuses a form announced over its 25 MB before keeping anything in memory', async (t) => {
  const origin = 'https://gmacmetalurgica.com.br'
  const app = createQuotesApp({ from: 'site@example.com', origins: [origin], sendMail: () => assert.fail('Não deveria enviar') })
  const port = await listen(t, app)
  const answer = await new Promise((resolve, reject) => {
    // The headers announce 30 MB; not a byte of the body is sent.
    const request = http.request({ host: '127.0.0.1', port, path: '/api/quotes', method: 'POST', headers: { Origin: origin, 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': 30 * 1024 * 1024 } }, (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => { request.destroy(); resolve({ status: response.statusCode, body: JSON.parse(body) }) })
    })
    request.on('error', reject)
    request.flushHeaders()
  })
  assert.equal(answer.status, 413)
  assert.match(answer.body.error, /25 MB no total/)
})
