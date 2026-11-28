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

test('developers can correct any published note without issuing another notification', async (t) => {
  const env = { DEMO_ADMIN_CPF: '02427847550', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Dev' }
  const fixture = await createWorkflowFixture({ accountsEnv: env, developerRoutes: true })
  t.after(() => fixture.close())
  const { announceRelease } = await fixture.serverModule('notificationEvents.js')
  const [latest, older] = releaseNotes
  await fixture.mutateStore((store) => { announceRelease(store, latest); announceRelease(store, older) })
  const { data: { token } } = await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })
  const authorization = { Authorization: `Bearer ${token}` }
  const edit = (release, notes, previousNotes = release.notes) => fixture.request(`/developer/release-notes/${release.version}`, 'PUT', { notes, previousNotes }, authorization)
  const route = `/developer/release-notes/${older.version}`
  const requestBody = { notes: 'Correção no histórico', previousNotes: older.notes }
  assert.equal((await fixture.request(route, 'PUT', requestBody)).status, 401)
  assert.equal((await fixture.request(route, 'PUT', requestBody, { Authorization: `Bearer ${fixture.operatorToken}` })).status, 401)
  assert.deepEqual((await fixture.adminRequest('/release-notes')).data.items, releaseNotes)
  const created = await fixture.adminRequest('/admins', 'POST', { cpf: '52998224725', name: 'Financeiro', password: 'teste123', email: 'financeiro@example.invalid', birthDate: '1990-01-01' })
  assert.equal(created.status, 200, JSON.stringify(created.data))
  const ordinaryLogin = await fixture.request('/auth/login', 'POST', { cpf: '52998224725', password: 'teste123' })
  assert.equal(ordinaryLogin.status, 200)
  assert.equal((await fixture.request(route, 'PUT', requestBody, { Authorization: `Bearer ${ordinaryLogin.data.token}` })).status, 403)
  assert.equal((await edit({ version: '999.0.0', notes: [] }, 'Versão inexistente')).status, 404)
  assert.equal((await edit(latest, ' \n ')).status, 400)
  assert.equal((await edit(latest, 'A'.repeat(20001))).status, 400)

  const before = (await fixture.adminRequest('/notifications/read-all', 'POST')).data.items.filter((item) => item.type === 'release')
  assert.equal(before.length, 2)
  assert.ok(before.every((item) => item.readAt))
  const corrected = { ...older, notes: ['Correção no histórico', 'Com acentos e dois itens'] }
  assert.deepEqual((await edit(older, '  Correção no histórico\r\n\r\nCom acentos e dois itens  ')).data, { item: corrected })
  const after = (await fixture.adminRequest('/notifications')).data.items.filter((item) => item.type === 'release')
  assert.deepEqual(after, before.map((item) => item.version === older.version ? { ...item, description: 'Correção no histórico · Com acentos e dois itens' } : item))
  assert.deepEqual((await fixture.adminRequest('/release-notes')).data.items, [latest, corrected, ...releaseNotes.slice(2)])

  const competing = await Promise.all([edit(latest, 'Primeira edição'), edit(latest, 'Segunda edição')])
  assert.deepEqual(competing.map((result) => result.status).sort(), [200, 409])
  const saved = competing.find((result) => result.status === 200).data.item
  assert.deepEqual((await edit(latest, saved.notes.join('\n'))).data, { item: saved }, 'retrying an already saved edit is safe')
  assert.deepEqual((await edit(older, older.notes.join('\n'), corrected.notes)).data, { item: older })
  assert.deepEqual((await fixture.adminRequest('/release-notes')).data.items, [saved, ...releaseNotes.slice(1)])
})

test('a notice already sent follows the corrected notes of its version, without notifying again', async () => {
  const { announceRelease, syncReleaseNotice } = await import('../server/notificationEvents.js')
  const store = {}
  announceRelease(store, { version: '9.9.98', notes: ['Na tela Desenvolvedor, uma novidade interna'] })
  store.operationalNotifications[0].readAt = '2026-11-28T12:00:00.000Z'
  assert.equal(syncReleaseNotice(store, { version: '9.9.98', notes: ['Melhorias gerais: correções de problemas e maior estabilidade do sistema'] }), true)
  assert.deepEqual(store.operationalNotifications.map((item) => [item.description, item.readAt]), [['Melhorias gerais: correções de problemas e maior estabilidade do sistema', '2026-11-28T12:00:00.000Z']])
  assert.equal(syncReleaseNotice(store, { version: '9.9.98', notes: ['Melhorias gerais: correções de problemas e maior estabilidade do sistema'] }), false, 'nothing to change')
  assert.equal(syncReleaseNotice(store, { version: '9.9.97', notes: ['Outra'] }), false, 'a version never announced is left to announceRelease')
})
