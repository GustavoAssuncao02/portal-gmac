import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia } from '../server/payableRules.js'
import { notificationDefaults, notificationSoundDefault, notificationSounds } from '../server/notificationRules.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const dateAfter = (days) => new Date(Date.parse(`${todayBahia()}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)

test('payable reminder preferences are authenticated, strict, persistent per admin and do not change account/security fields', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const route = '/account/notifications'
    assert.equal((await fixture.request(route)).status, 401)
    assert.equal((await fixture.request(route, 'PATCH', { payableReminderDays: 5 })).status, 401)
    const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const auth = { Authorization: `Bearer ${token}` }
    const request = (path, method, body) => fixture.request(path, method, body, auth)
    const before = (await request('/auth/session')).data.user
    assert.deepEqual((await request(route)).data.settings, { payableReminderDays: 3, receivableReminderDays: 3, sound: notificationSoundDefault, ...notificationDefaults })
    for (const value of [null, undefined, 0, 1, 4, 6, 8, '5', false, {}, [], 'invalid']) {
      assert.equal((await request(route, 'PATCH', { payableReminderDays: value })).status, 400, JSON.stringify(value))
    }
    const second = (await request('/admins', 'POST', { name: 'Segundo Admin', birthDate: '1990-01-01', cpf: '00000000002', email: 'segundo@example.invalid', password: 'teste123' })).data.item
    const secondAuth = { Authorization: `Bearer ${(await fixture.request('/auth/login', 'POST', { cpf: second.cpf, password: 'teste123' })).data.token}` }
    for (const value of [5, 7, 'never', 3]) {
      const saved = await request(route, 'PATCH', { payableReminderDays: value, userId: second.id, name: 'Do not change', password: 'Do not change' })
      assert.equal(saved.status, 200)
      assert.equal((await request(route)).data.settings.payableReminderDays, value)
      assert.equal((await fixture.request(route, 'GET', undefined, secondAuth)).data.settings.payableReminderDays, 3)
    }
    await request(route, 'PATCH', { payableReminderDays: 7 })
    assert.deepEqual((await request('/auth/session')).data.user, before)
    const again = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    assert.equal((await fixture.request(route, 'GET', undefined, { Authorization: `Bearer ${again}` })).data.settings.payableReminderDays, 7)
    await fixture.request(route, 'PATCH', { payableReminderDays: 'never' }, secondAuth)
    assert.equal((await request(`/admins/${second.id}`, 'DELETE')).status, 200)
    const recreated = (await request('/admins', 'POST', { name: 'Novo Admin', birthDate: '1990-01-01', cpf: second.cpf, email: second.email, password: 'teste123' })).data.item
    const recreatedAuth = { Authorization: `Bearer ${(await fixture.request('/auth/login', 'POST', { cpf: recreated.cpf, password: 'teste123' })).data.token}` }
    assert.equal((await fixture.request(route, 'GET', undefined, recreatedAuth)).data.settings.payableReminderDays, 3, 'A recreated admin does not inherit the deleted account preference')
  } finally { await fixture.close() }
})

test('3/5/7-day windows include missed thresholds and due today; never hides alerts without deleting them or marking other preferences read', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const auth = { Authorization: `Bearer ${token}` }
    const request = (path, method, body) => fixture.request(path, method, body, auth)
    const second = (await request('/admins', 'POST', { name: 'Segundo Admin', birthDate: '1990-01-01', cpf: '00000000002', email: 'segundo@example.invalid', password: 'teste123' })).data.item
    const secondAuth = { Authorization: `Bearer ${(await fixture.request('/auth/login', 'POST', { cpf: second.cpf, password: 'teste123' })).data.token}` }
    const supplier = (await request('/suppliers', 'POST', { name: 'Fornecedor teste', document: '12345678000190' })).data.item
    const classification = (await request('/classifications', 'POST', { name: 'Material' })).data.item
    const rows = []
    for (const day of [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const result = await request('/payables', 'POST', { supplierId: supplier.id, classificationId: classification.id, description: `Conta ${day} dias`, issueDate: dateAfter(-2), dueDate: dateAfter(day), value: '10', kind: 'normal' })
      assert.equal(result.status, 201)
      rows.push({ day, id: result.data.items[0].id })
    }
    const select = (days) => request('/account/notifications', 'PATCH', { payableReminderDays: days })
    const alerts = async () => (await request('/payables/notifications')).data.items
    const expected = (lead) => rows.filter((row) => row.day >= 0 && row.day <= lead).map((row) => row.id).sort()
    for (const lead of [3, 5, 7]) {
      await select(lead)
      const notices = await alerts()
      assert.deepEqual(notices.map((notice) => notice.accountId).sort(), expected(lead))
      assert.ok(notices.every((notice) => notice.days === (notice.account.daysUntil === 0 ? 0 : lead)))
      assert.deepEqual((await alerts()).map((notice) => notice.id).sort(), notices.map((notice) => notice.id).sort(), 'Repeated polling does not duplicate alerts')
    }
    await request('/payables/notifications/read-all', 'POST')
    assert.ok((await alerts()).every((notice) => notice.readAt))
    await select(5)
    assert.ok((await alerts()).filter((notice) => notice.days === 5).every((notice) => !notice.readAt), 'Reading 7-day alerts does not mark hidden 5-day alerts read')
    await select('never')
    assert.deepEqual(await alerts(), [])
    assert.deepEqual((await request('/payables/notifications/read-all', 'POST')).data.items, [])
    const other = (await fixture.request('/payables/notifications', 'GET', undefined, secondAuth)).data.items
    assert.deepEqual(other.map((notice) => notice.accountId).sort(), expected(3))
    assert.ok(other.every((notice) => !notice.readAt))
    await select(7)
    assert.ok((await alerts()).every((notice) => notice.readAt), 'Disabling alerts preserves their previous read state')
    await fixture.mutateStore((store) => {
      store.payables.find((row) => row.id === rows.find((row) => row.day === 1).id).payment = { finalCents: 1000 }
      store.payables.find((row) => row.id === rows.find((row) => row.day === 2).id).inactive = true
      store.payables.find((row) => row.id === rows.find((row) => row.day === 3).id).dueDate = dateAfter(9)
    })
    const final = await alerts()
    assert.deepEqual(final.map((notice) => notice.account.daysUntil).sort((a, b) => a - b), [0, 4, 5, 6, 7])
  } finally { await fixture.close() }
})

test('notification sound: at least six sounds, strict choice per account, off switch and the choice sent with every poll', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const route = '/account/notifications'
    assert.ok(notificationSounds.length >= 6)
    assert.equal(new Set(notificationSounds.map(([key]) => key)).size, notificationSounds.length)
    assert.equal((await fixture.request(route, 'PATCH', { sound: 'gota' })).status, 401)
    const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const auth = { Authorization: `Bearer ${token}` }
    const request = (path, method, body) => fixture.request(path, method, body, auth)
    assert.equal((await request(route)).data.settings.sound, notificationSoundDefault)
    assert.equal((await request('/notifications')).data.sound, notificationSoundDefault)
    for (const value of [null, '', 'Sino', 'buzina', 1, true, {}, []]) assert.equal((await request(route, 'PATCH', { sound: value })).status, 400, JSON.stringify(value))
    const second = (await request('/admins', 'POST', { name: 'Segundo Admin', birthDate: '1990-01-01', cpf: '00000000002', email: 'segundo@example.invalid', password: 'teste123' })).data.item
    const secondAuth = { Authorization: `Bearer ${(await fixture.request('/auth/login', 'POST', { cpf: second.cpf, password: 'teste123' })).data.token}` }
    for (const [key] of [...notificationSounds, ['off']]) {
      const saved = await request(route, 'PATCH', { sound: key })
      assert.equal(saved.status, 200)
      assert.equal(saved.data.settings.sound, key)
      assert.equal((await request('/notifications')).data.sound, key)
      assert.equal((await fixture.request('/notifications', 'GET', undefined, secondAuth)).data.sound, notificationSoundDefault, 'Each account keeps its own sound')
    }
    // Changing only the sound keeps the other preferences, and the other way around.
    await request(route, 'PATCH', { payableReminderDays: 5, sound: 'metal' })
    await request(route, 'PATCH', { payableReminderDays: 7 })
    assert.equal((await request(route)).data.settings.sound, 'metal')
    await request(route, 'PATCH', { sound: 'off' })
    assert.equal((await request(route)).data.settings.payableReminderDays, 7)
  } finally { await fixture.close() }
})
