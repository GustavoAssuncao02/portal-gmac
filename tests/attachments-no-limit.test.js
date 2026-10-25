import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex')

// Attachments have no size limit: a file well above the old 20 MB goes to the disk and comes back whole, in the offers,
// the OS purchase orders and the finance; an empty one is still refused.
test('attachments of any size are stored and downloaded whole', async (t) => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  const { token } = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data
  const auth = { Authorization: `Bearer ${token}` }
  const big = Buffer.alloc(45 * 1024 * 1024, 7)
  big.write('GMAC-INICIO', 0)
  big.write('GMAC-FIM', big.length - 8)
  const send = (route, body = big) => fetch(`${fixture.url}/api${route}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body })
  const download = async (route) => Buffer.from(await (await fetch(`${fixture.url}/api${route}`, { headers: auth })).arrayBuffer())

  const offer = (await fixture.request('/offers', 'POST', offerDraft, auth)).data.item
  const attached = await send(`/offers/${offer.id}/attachments?name=desenho-grande.pdf&type=application/pdf`)
  assert.equal(attached.status, 201)
  const attachment = (await attached.json()).item.attachments[0]
  assert.equal(attachment.size, big.length)
  assert.equal(digest(await download(`/offers/${offer.id}/attachments/${attachment.id}`)), digest(big), 'the download is the same file')
  assert.equal((await send(`/offers/${offer.id}/attachments?name=vazio.pdf`, Buffer.alloc(0))).status, 400, 'an empty file is refused')

  const upload = await send('/payables/uploads?name=nota-grande.pdf&type=application/pdf')
  assert.equal(upload.status, 201)
  const stored = path.join(fixture.directory, 'data', 'payable-files', (await upload.json()).item.id)
  assert.equal((await stat(stored)).size, big.length)
  assert.equal((await send('/receivables/uploads?name=comprovante-grande.pdf')).status, 201)
})
