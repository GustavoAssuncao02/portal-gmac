import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { followerMail } from '../server/supportTickets.js'
import { storedFileInventory } from '../server/storedFiles.js'

// 2026-11-23: anyone may follow a ticket (the bell) and is then told of what happens in it, like whoever opened it: each
// message in the bell and by e-mail, closing and reopening in the bell. The messages of the conversation may bring new
// files, which open by the same rule of the files of the ticket.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Administradora' }
const person = (index) => ({ name: `Funcionário ${index}`, birthDate: '1990-01-01', cpf: `0000000000${index}`, email: `funcionario${index}@example.invalid`, identification: '', type: 'administrative', password: 'senha123' })
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('the bell of a ticket: whoever follows it is told of each message and of closing; files go in the conversation', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env, ticketDevelopers: ['00000000004'] })
  try {
    const login = async (index) => {
      assert.equal((await fixture.adminRequest('/employees', 'POST', person(index))).status, 201)
      const result = await fixture.request('/auth/login', 'POST', { cpf: `0000000000${index}`, password: 'senha123' })
      return { Authorization: `Bearer ${result.data.token}` }
    }
    const developer = await login(4), author = await login(5), follower = await login(6)
    const as = (headers) => (route, method = 'GET', body) => fixture.request(route, method, body, headers)
    const dev = as(developer), mine = as(author), watcher = as(follower), admin = as(fixture.admin)
    const upload = async (headers, name) => (await (await fetch(`${fixture.url}/api/support-tickets/uploads?name=${encodeURIComponent(name)}&type=image/png`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: `bytes of ${name}` })).json()).item.id
    const download = (headers, id, fileId) => fetch(`${fixture.url}/api/support-tickets/${id}/files/${fileId}`, { headers })
    const notices = async (call) => (await call('/notifications')).data.items.filter((item) => item.type?.startsWith('ticket-'))
    const mailTo = async (address, count) => { for (let tries = 0; tries < 50 && fixture.ticketMail.filter((mail) => mail.to === address).length < count; tries += 1) await wait(40); return fixture.ticketMail.filter((mail) => mail.to === address) }

    const ticket = (await mine('/support-tickets', 'POST', { urgency: 'high', module: 'other', title: 'Proposta sem logo', description: 'O PDF saiu sem o logo.' })).data.item
    const seen = async (call) => (await call('/support-tickets')).data.items.find((item) => item.id === ticket.id)
    assert.equal((await seen(watcher)).following, false)

    // Marking the bell; marking it again keeps one entry. Whoever opened it is always told, so has no bell.
    assert.equal((await watcher(`/support-tickets/${ticket.id}/follow`, 'POST', { following: 'sim' })).status, 400)
    const followed = await watcher(`/support-tickets/${ticket.id}/follow`, 'POST', { following: true })
    assert.deepEqual([followed.status, followed.data.item.following], [200, true])
    await watcher(`/support-tickets/${ticket.id}/follow`, 'POST', { following: true })
    assert.deepEqual((await seen(mine)).followers.map((entry) => entry.userName), ['Funcionário 6'])
    assert.equal((await seen(mine)).following, false)
    const own = await mine(`/support-tickets/${ticket.id}/follow`, 'POST', { following: true })
    assert.deepEqual([own.status, own.data.message], [409, 'Você abriu este ticket e já recebe os avisos dele.'])
    assert.equal((await watcher('/support-tickets/TCK-0099/follow', 'POST', { following: true })).status, 404)

    // A developer's comment: whoever opened it and whoever follows it are told in the bell and by e-mail.
    const comment = (await dev(`/support-tickets/${ticket.id}/comments`, 'POST', { text: 'Vou verificar o logo.' })).data.item.comments.at(-1)
    assert.ok((await notices(watcher)).some((item) => item.type === 'ticket-comment' && item.commentId === comment.id), 'the follower is told in the bell')
    assert.ok((await notices(mine)).some((item) => item.commentId === comment.id))
    const [followMail] = await mailTo('funcionario6@example.invalid', 1)
    assert.match(followMail.subject, /^Resposta do suporte · 🔴 Urgência alta · TCK-0001 · Proposta sem logo$/)
    assert.equal(followMail.text.split('\n')[0], 'Proposta sem logo · Funcionário 4 comentou no ticket que você acompanha: “Vou verificar o logo.”')
    assert.match(followMail.text, /Olá, Funcionário 6\./)
    let delivered = []
    for (let tries = 0; tries < 50 && !delivered[0]?.sentAt; tries += 1) { delivered = (await seen(dev)).comments.at(-1).personEmails; if (!delivered[0]?.sentAt) await wait(40) }
    assert.deepEqual(delivered.map((entry) => [entry.userName, Boolean(entry.sentAt)]), [['Funcionário 6', true]], 'the developers see how the e-mail to whoever follows went')
    assert.equal('personEmails' in (await seen(watcher)).comments.at(-1), false, 'only developers see it')

    // Whoever opened it sends only a file (a new print): a message without text is accepted when it brings files.
    assert.equal((await mine(`/support-tickets/${ticket.id}/comments`, 'POST', { text: '  ', fileIds: [] })).status, 400)
    const print = await upload(author, 'novo print.png')
    assert.equal((await mine(`/support-tickets/${ticket.id}/comments`, 'POST', { text: '', fileIds: [await upload(developer, 'de outro.png')] })).status, 400, 'a file sent by someone else is not claimed')
    const sent = await mine(`/support-tickets/${ticket.id}/comments`, 'POST', { text: '', fileIds: [print] })
    assert.equal(sent.status, 201)
    const reply = sent.data.item.comments.at(-1)
    assert.deepEqual([reply.byDeveloper, reply.text, reply.attachments.map((file) => file.name)], [false, '', ['novo print.png']])
    assert.equal(sent.data.item.attachmentCount, 1, 'the files of the conversation count in the ticket')
    assert.equal((await mine(`/support-tickets/${ticket.id}/comments`, 'POST', { text: 'De novo', fileIds: [print] })).status, 400, 'a file is claimed once')
    assert.ok((await notices(watcher)).some((item) => item.commentId === reply.id && item.title === 'Nova resposta no ticket TCK-0001' && item.description === 'Proposta sem logo · Enviou 1 anexo.'))
    assert.ok((await notices(dev)).some((item) => item.commentId === reply.id))
    const [, replyMail] = await mailTo('funcionario6@example.invalid', 2)
    assert.match(replyMail.subject, /^Resposta · /)
    assert.match(replyMail.text, /Funcionário 5 respondeu no ticket que você acompanha: enviou 1 anexo/)
    assert.match(replyMail.text, /Anexos: 1 anexo: novo print\.png/)

    // The files of the conversation open like those of the ticket: for administrators and whoever opened it; an
    // administrative employee who did not open it sees how many there are.
    const locked = (await seen(watcher)).comments.at(-1)
    assert.deepEqual([locked.attachments, locked.attachmentCount, locked.attachmentsLocked], [[], 1, true])
    assert.equal((await seen(watcher)).lockedCount, 1)
    assert.equal((await download(follower, ticket.id, print)).status, 403)
    assert.equal(await (await download(author, ticket.id, print)).text(), 'bytes of novo print.png')
    assert.equal(await (await download(fixture.admin, ticket.id, print)).text(), 'bytes of novo print.png')
    assert.equal((await seen(admin)).comments.at(-1).attachments.length, 1)
    // Whoever sent a file always opens it, even without access to the other files of the ticket.
    const devFile = await upload(developer, 'correção.png')
    const devMessage = (await dev(`/support-tickets/${ticket.id}/comments`, 'POST', { text: 'Veja como ficou.', fileIds: [devFile] })).data.item.comments.at(-1)
    assert.equal(devMessage.attachments.length, 1)
    assert.equal(await (await download(developer, ticket.id, devFile)).text(), 'bytes of correção.png')
    assert.equal((await download(developer, ticket.id, print)).status, 403)
    // The start-up check of the data folder knows the files of the conversation.
    const tickets = await fixture.mutateStore((store) => JSON.parse(JSON.stringify(store.supportTickets)))
    const area = storedFileInventory({ supportTickets: tickets }, '/data').find((item) => item.label === 'Tickets de suporte')
    assert.deepEqual(area.files.map((file) => [file.name, file.where]), [['novo print.png', 'TCK-0001 (conversa)'], ['correção.png', 'TCK-0001 (conversa)']])

    // Closing: whoever follows (and whoever opened it) is told in the bell and by e-mail. Unmarking the bell stops it.
    assert.equal((await dev(`/support-tickets/${ticket.id}/status`, 'POST', { status: 'closed', note: 'Logo corrigido.' })).status, 200)
    assert.ok((await notices(watcher)).some((item) => item.type === 'ticket-status' && item.title === 'Ticket TCK-0001 fechado'))
    const closedMail = (await mailTo('funcionario6@example.invalid', 3)).find((mail) => mail.subject.startsWith('Ticket fechado'))
    assert.match(closedMail.subject, /^Ticket fechado · 🔴 Urgência alta · TCK-0001 · Proposta sem logo$/)
    assert.equal(closedMail.text.split('\n')[0], 'Proposta sem logo · Funcionário 4 fechou o ticket que você acompanha: “Logo corrigido.”')
    assert.match(closedMail.text, /porque acompanha este ticket/)
    let told = []
    for (let tries = 0; tries < 50 && told.filter((entry) => entry.sentAt).length < 2; tries += 1) { told = (await seen(dev)).history.at(-1).emails; if (told.filter((entry) => entry.sentAt).length < 2) await wait(40) }
    assert.deepEqual(told.map((entry) => [entry.userName, Boolean(entry.sentAt)]), [['Funcionário 5', true], ['Funcionário 6', true]], 'whoever opened it and whoever follows it get the e-mail; the developers see how it went')
    assert.ok(fixture.ticketMail.some((mail) => mail.to === 'funcionario5@example.invalid' && mail.subject.startsWith('Ticket fechado')))
    assert.equal('emails' in (await seen(watcher)).history.at(-1), false, 'only developers see it')
    const unfollowed = await watcher(`/support-tickets/${ticket.id}/follow`, 'POST', { following: false })
    assert.deepEqual([unfollowed.data.item.following, unfollowed.data.item.followers], [false, []])
    const after = (await dev(`/support-tickets/${ticket.id}/comments`, 'POST', { text: 'Registro final.' })).data.item.comments.at(-1)
    assert.ok(!(await notices(watcher)).some((item) => item.commentId === after.id), 'no more notices after unmarking the bell')
    assert.deepEqual(after.personEmails, [], 'nobody else to e-mail')
  } finally {
    await fixture.close()
  }
})

test('the e-mail to whoever follows says why it came and how to stop it', () => {
  const ticket = { id: 'TCK-0007', urgency: 'low', module: 'other', title: 'Título <b>', createdByName: 'MARIA' }
  const mail = followerMail(ticket, { userName: 'GUSTAVO', at: '2026-11-23T14:00:00Z', text: 'Corrigido.', byDeveloper: true }, { name: 'JOÃO', email: 'joao@example.invalid' })
  assert.equal(mail.to, 'joao@example.invalid')
  assert.equal(mail.subject, 'Resposta do suporte · 🔵 Urgência baixa · TCK-0007 · Título <b>')
  assert.match(mail.text, /porque acompanha este ticket/)
  assert.ok(!mail.html.includes('<b>') && mail.html.includes('&lt;b&gt;'))
})
