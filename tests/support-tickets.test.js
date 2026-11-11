import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { developerCpfs, isDeveloper } from '../server/supportTickets.js'
import { monthRange } from '../server/ticketRules.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Administradora' }
const person = (index, fields = {}) => ({ name: `Funcionário ${index}`, birthDate: '1990-01-01', cpf: `0000000000${index}`, email: `funcionario${index}@example.invalid`, identification: '', type: 'administrative', password: 'senha123', ...fields })
const ticket = (fields = {}) => ({ urgency: 'high', module: 'finance', title: 'Erro ao salvar a baixa', description: 'Cliquei em salvar e apareceu uma mensagem de erro.', ...fields })

test('the developers are the accounts of the two CPFs, written with or without punctuation', () => {
  assert.deepEqual(developerCpfs, ['02427847550', '14303355640'])
  assert.equal(isDeveloper({ cpf: '024.278.475-50' }), true)
  assert.equal(isDeveloper({ cpf: '14303355640' }), true)
  assert.equal(isDeveloper({ cpf: '12345678901' }), false)
  assert.equal(isDeveloper({}), false)
  assert.deepEqual(monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02'])
})

test('everybody sees every ticket; attachments open for administrators and the author; only developers close and reopen', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env, ticketDevelopers: ['00000000004'] })
  try {
    const login = async (index) => {
      assert.equal((await fixture.adminRequest('/employees', 'POST', person(index))).status, 201)
      const result = await fixture.request('/auth/login', 'POST', { cpf: `0000000000${index}`, password: 'senha123' })
      return { Authorization: `Bearer ${result.data.token}` }
    }
    const developer = await login(4), author = await login(5)
    const as = (headers) => (route, method = 'GET', body) => fixture.request(route, method, body, headers)
    const dev = as(developer), mine = as(author), admin = as(fixture.admin)
    const upload = (headers, name, body) => fetch(`${fixture.url}/api/support-tickets/uploads?name=${encodeURIComponent(name)}&type=image/png`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body })
    const download = (headers, id, fileId) => fetch(`${fixture.url}/api/support-tickets/${id}/files/${fileId}`, { headers })

    // Sessions: the operator account and visitors stay out.
    assert.equal((await fixture.request('/support-tickets')).status, 401)
    assert.equal((await fixture.request('/support-tickets', 'GET', undefined, { Authorization: `Bearer ${fixture.operatorToken}` })).status, 401)

    // The form is checked.
    assert.equal((await mine('/support-tickets', 'POST', ticket({ urgency: '' }))).status, 400)
    assert.equal((await mine('/support-tickets', 'POST', ticket({ module: 'nada' }))).status, 400)
    assert.equal((await mine('/support-tickets', 'POST', ticket({ title: '   ' }))).status, 400)
    assert.equal((await mine('/support-tickets', 'POST', ticket({ description: '' }))).status, 400)
    const othersFile = (await (await upload(developer, 'outro.png', 'x')).json()).item.id
    assert.equal((await mine('/support-tickets', 'POST', ticket({ fileIds: [othersFile] }))).status, 400, 'a file sent by someone else is not claimed')

    const sent = await upload(author, 'print da tela.png', 'png-bytes')
    assert.equal(sent.status, 201)
    const fileId = (await sent.json()).item.id
    const created = await mine('/support-tickets', 'POST', ticket({ title: '  Erro   ao salvar a baixa ', fileIds: [fileId] }))
    assert.equal(created.status, 201)
    const first = created.data.item
    assert.equal(first.id, 'TCK-0001')
    assert.equal(first.status, 'open')
    assert.equal(first.title, 'Erro ao salvar a baixa')
    assert.equal(first.createdByName, 'Funcionário 5')
    assert.ok(first.createdAt)
    assert.equal(first.attachments[0].name, 'print da tela.png')
    assert.equal((await mine('/support-tickets', 'POST', ticket({ fileIds: [fileId] }))).status, 400, 'a file is claimed once')

    // Everybody lists it; an administrative employee who did not open it sees only how many files it has.
    const byDeveloper = (await dev('/support-tickets')).data
    assert.equal(byDeveloper.viewer.developer, true)
    const seenByOther = byDeveloper.items.find((item) => item.id === first.id)
    assert.deepEqual([seenByOther.attachments, seenByOther.attachmentCount, seenByOther.attachmentsLocked], [[], 1, true])
    assert.equal((await download(developer, first.id, fileId)).status, 403)
    assert.equal((await (await download(author, first.id, fileId)).text()), 'png-bytes', 'the author opens their own files')
    const byAdmin = (await admin('/support-tickets')).data
    assert.equal(byAdmin.viewer.developer, false)
    assert.equal(byAdmin.items[0].attachments.length, 1)
    assert.equal(byAdmin.items[0].email, undefined, 'only developers see how the e-mail went')
    assert.equal((await (await download(fixture.admin, first.id, fileId)).text()), 'png-bytes', 'administrators open every file')

    // The e-mail to the developers goes after the ticket is saved and its outcome is recorded.
    for (let tries = 0; tries < 50 && !fixture.ticketMail.length; tries += 1) await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(fixture.ticketMail.length, 1)
    assert.equal(fixture.ticketMail[0].to, 'by.cmlla0107@gmail.com, Gustavo_Assuncao02@outlook.com')
    assert.match(fixture.ticketMail[0].subject, /TCK-0001 \(urgência: Alto\)/)
    assert.match(fixture.ticketMail[0].text, /Funcionário 5/)
    let email = null
    for (let tries = 0; tries < 50 && !email?.sentAt; tries += 1) { email = (await dev('/support-tickets')).data.items[0].email; if (!email?.sentAt) await new Promise((resolve) => setTimeout(resolve, 40)) }
    assert.ok(email?.sentAt)

    // The bell: the new ticket goes to the developers only; status changes go to whoever opened it.
    const notices = async (call) => (await call('/notifications')).data.items.filter((item) => item.type?.startsWith('ticket-'))
    assert.deepEqual((await notices(dev)).map((item) => [item.type, item.ticketId]), [['ticket-opened', 'TCK-0001']])
    assert.deepEqual(await notices(admin), [])
    assert.deepEqual(await notices(mine), [])

    // Status: only developers change it, closing needs the answer, and a closed ticket can be reopened.
    assert.equal((await admin(`/support-tickets/${first.id}/status`, 'POST', { status: 'closed', note: 'Resolvido' })).status, 403)
    assert.equal((await mine(`/support-tickets/${first.id}/status`, 'POST', { status: 'closed', note: 'Resolvido' })).status, 403)
    assert.equal((await dev(`/support-tickets/${first.id}/status`, 'POST', { status: 'closed', note: '  ' })).status, 400)
    const closed = await dev(`/support-tickets/${first.id}/status`, 'POST', { status: 'closed', note: 'Corrigido na versão 1.0.14.' })
    assert.equal(closed.status, 200)
    assert.deepEqual([closed.data.item.status, closed.data.item.resolution, closed.data.item.closedByName], ['closed', 'Corrigido na versão 1.0.14.', 'Funcionário 4'])
    assert.equal((await dev(`/support-tickets/${first.id}/status`, 'POST', { status: 'closed', note: 'De novo' })).status, 409)
    const reopened = await dev(`/support-tickets/${first.id}/status`, 'POST', { status: 'open', note: 'Voltou a acontecer.' })
    assert.equal(reopened.data.item.status, 'open')
    assert.equal(reopened.data.item.resolution, undefined)
    assert.deepEqual(reopened.data.item.history.map((entry) => entry.type), ['opened', 'closed', 'reopened'])
    assert.deepEqual((await notices(mine)).map((item) => item.title).sort(), ['Ticket TCK-0001 fechado', 'Ticket TCK-0001 reaberto'])
    assert.deepEqual((await notices(dev)).map((item) => item.type), ['ticket-opened'], 'the developer is not told of their own change')

    // The next ticket gets the next number and is listed first.
    const second = await admin('/support-tickets', 'POST', ticket({ urgency: 'low', module: 'other', title: 'Sugestão' }))
    assert.equal(second.data.item.id, 'TCK-0002')
    assert.deepEqual((await mine('/support-tickets')).data.items.map((item) => [item.id, item.own]), [['TCK-0002', false], ['TCK-0001', true]])
    assert.equal((await mine('/support-tickets/TCK-0009/files/x')).status, 404)
  } finally {
    await fixture.close()
  }
})
