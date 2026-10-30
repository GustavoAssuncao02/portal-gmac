import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture } from './workflowFixture.js'
import { releaseNotes } from '../src/releaseNotes.js'

test('a new version of the portal is announced once in the bell of everybody and opens the release notes', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const { announceRelease } = await fixture.serverModule('notificationEvents.js')
  const release = { version: '9.9.99', date: '2026-10-30', notes: ['Etapas: nova tela', 'Propostas: Enviar E-mail', 'Cadastros: Compradores'] }
  assert.equal(await fixture.mutateStore((store) => announceRelease(store, release)), true)
  assert.equal(await fixture.mutateStore((store) => announceRelease(store, release)), false, 'once per version')
  const notices = (await fixture.adminRequest('/notifications')).data.items.filter((item) => item.type === 'release')
  assert.deepEqual(notices.map((item) => [item.title, item.description, item.readAt]), [['Portal atualizado: versão 9.9.99', 'Etapas: nova tela · Propostas: Enviar E-mail e mais 1', null]])
  const read = (await fixture.adminRequest('/notifications/read-all', 'POST')).data.items.find((item) => item.type === 'release')
  assert.ok(read.readAt)
  // The real list of versions has the current one first, the one the server announces at startup.
  assert.match(releaseNotes[0].version, /^\d+\.\d+\.\d+$/)
})
