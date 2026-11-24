import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { emailNotificationsOff } from '../server/notificationRules.js'

// 2026-11-24: "Notificações do sistema por e-mail" in Configurações. Whoever turns it off gets no e-mail of the tickets
// (only the bell), the developers see why, and a developer who turns it off leaves the developers' e-mail list.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Administradora' }
const person = (index) => ({ name: `Funcionário ${index}`, birthDate: '1990-01-01', cpf: `0000000000${index}`, email: `funcionario${index}@example.invalid`, identification: '', type: 'administrative', password: 'senha123' })
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('an account that turns off the e-mail notifications gets the tickets only in the bell', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env, ticketDevelopers: ['00000000004'], ticketEmails: ['funcionario4@example.invalid', 'suporte@example.invalid'] })
  try {
    const login = async (index) => {
      assert.equal((await fixture.adminRequest('/employees', 'POST', person(index))).status, 201)
      const result = await fixture.request('/auth/login', 'POST', { cpf: `0000000000${index}`, password: 'senha123' })
      return { Authorization: `Bearer ${result.data.token}` }
    }
    const as = (headers) => (route, method = 'GET', body) => fixture.request(route, method, body, headers)
    const dev = as(await login(4)), mine = as(await login(5)), watcher = as(await login(6))
    const mailsTo = (address) => fixture.ticketMail.filter((mail) => mail.to === address)
    const until = async (check) => { for (let tries = 0; tries < 50 && !await check(); tries += 1) await wait(40); return check() }

    // The preference: on by default, saved per account, true or false only.
    assert.equal((await mine('/account/notifications')).data.settings.emailNotifications, true)
    assert.equal((await mine('/account/notifications', 'PATCH', { emailNotifications: 'não' })).status, 400)
    const saved = await mine('/account/notifications', 'PATCH', { emailNotifications: false })
    assert.deepEqual([saved.status, saved.data.settings.emailNotifications, saved.data.settings.supportTickets], [200, false, true], 'the bell options stay as they were')
    assert.equal((await watcher('/account/notifications')).data.settings.emailNotifications, true, 'one account does not change another')

    const ticket = (await mine('/support-tickets', 'POST', { urgency: 'low', module: 'other', title: 'Conta igual', description: 'Permitir contas iguais.' })).data.item
    assert.ok(await until(() => fixture.ticketMail.some((mail) => mail.to === 'funcionario4@example.invalid, suporte@example.invalid')), 'the developers get the new ticket')
    assert.equal((await watcher(`/support-tickets/${ticket.id}/follow`, 'POST', { following: true })).status, 200)
    const seen = async () => (await dev('/support-tickets')).data.items.find((item) => item.id === ticket.id)

    // A developer's comment: whoever follows gets the e-mail; whoever opened it (e-mails off) only the bell.
    const comment = (await dev(`/support-tickets/${ticket.id}/comments`, 'POST', { text: 'Vamos corrigir.' })).data.item.comments.at(-1)
    assert.ok(await until(() => mailsTo('funcionario6@example.invalid').length === 1))
    assert.ok(await until(async () => (await seen()).comments.at(-1).email?.skippedAt))
    assert.equal((await seen()).comments.at(-1).email.reason, emailNotificationsOff, 'the developers see why it was not sent')
    assert.ok((await mine('/notifications')).data.items.some((item) => item.commentId === comment.id), 'the bell still tells')

    // Closing: the same, entry by entry.
    assert.equal((await dev(`/support-tickets/${ticket.id}/status`, 'POST', { status: 'closed', note: 'Corrigido na versão 1.0.21.' })).status, 200)
    assert.ok(await until(async () => (await seen()).history.at(-1).emails?.every((entry) => entry.sentAt || entry.skippedAt)))
    assert.deepEqual((await seen()).history.at(-1).emails.map((entry) => [entry.userName, Boolean(entry.sentAt), entry.reason || '']), [['Funcionário 5', false, emailNotificationsOff], ['Funcionário 6', true, '']])
    assert.equal(mailsTo('funcionario5@example.invalid').length, 0, 'whoever turned it off never got an e-mail')

    // A developer who turns it off leaves the developers' list; turning it back on, the e-mails come again.
    await dev('/account/notifications', 'PATCH', { emailNotifications: false })
    await watcher(`/support-tickets/${ticket.id}/comments`, 'POST', { text: 'Comigo também.' })
    assert.ok(await until(() => mailsTo('suporte@example.invalid').length === 1), 'the rest of the list still gets it')
    assert.equal(fixture.ticketMail.filter((mail) => mail.to.includes('funcionario4@')).length, 1, 'only the first e-mail, before turning it off')
    await mine('/account/notifications', 'PATCH', { emailNotifications: true })
    await watcher(`/support-tickets/${ticket.id}/comments`, 'POST', { text: 'Ainda acontece.' })
    assert.ok(await until(() => mailsTo('funcionario5@example.invalid').length === 1), 'whoever opened it is e-mailed again')
  } finally { await fixture.close() }
})
