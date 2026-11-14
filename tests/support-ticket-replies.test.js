import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'

// A ticket is a conversation: the developer explains, whoever opened it answers back ("deu certo, obrigado") while it is
// open, and the developers close it. Nobody else answers, and a closed ticket takes no reply.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Administradora' }
const person = (index) => ({ name: `Funcionário ${index}`, birthDate: '1990-01-01', cpf: `0000000000${index}`, email: `funcionario${index}@example.invalid`, identification: '', type: 'administrative', password: 'senha123' })

test('whoever opened a ticket replies while it is open and the developers are told; only developers close it', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env, ticketDevelopers: ['00000000004'] })
  try {
    const login = async (index) => {
      assert.equal((await fixture.adminRequest('/employees', 'POST', person(index))).status, 201)
      const result = await fixture.request('/auth/login', 'POST', { cpf: `0000000000${index}`, password: 'senha123' })
      return { Authorization: `Bearer ${result.data.token}` }
    }
    const developer = await login(4), author = await login(5), other = await login(6)
    const as = (headers) => (route, method = 'GET', body) => fixture.request(route, method, body, headers)
    const dev = as(developer), mine = as(author), someone = as(other)
    const notices = async (request) => (await request('/notifications')).data.items

    const ticket = (await mine('/support-tickets', 'POST', { urgency: 'low', module: 'finance', submodule: 'payables', title: 'Não exclui o título', description: 'Estornei a baixa e não consigo excluir.' })).data.item
    const explained = await dev(`/support-tickets/${ticket.id}/comments`, 'POST', { text: 'Corrigido na versão 1.0.16. Pode testar?' })
    assert.equal(explained.status, 201)
    assert.equal(explained.data.item.comments[0].byDeveloper, true)

    // Whoever opened it answers; the developers get the bell, whoever answered does not.
    assert.equal((await mine(`/support-tickets/${ticket.id}/comments`, 'POST', { text: '   ' })).status, 400)
    const replied = await mine(`/support-tickets/${ticket.id}/comments`, 'POST', { text: 'Deu certo, muito obrigada!' })
    assert.equal(replied.status, 201)
    const reply = replied.data.item.comments[1]
    assert.deepEqual([reply.text, reply.byDeveloper, reply.userName, replied.data.item.status], ['Deu certo, muito obrigada!', false, 'Funcionário 5', 'open'])
    const told = (await notices(dev)).find((item) => item.type === 'ticket-comment' && item.commentId === reply.id)
    assert.equal(told?.title, `Nova resposta no ticket ${ticket.id}`)
    assert.ok(!(await notices(mine)).some((item) => item.commentId === reply.id), 'whoever answered is not told of their own reply')
    // The developers see how the e-mail of the reply went (no SMTP in the tests).
    let delivered = null
    for (let tries = 0; tries < 50 && !delivered; tries += 1) { delivered = (await dev('/support-tickets')).data.items.find((item) => item.id === ticket.id).comments[1].email; if (!delivered) await new Promise((resolve) => setTimeout(resolve, 40)) }
    assert.ok(delivered?.skippedAt || delivered?.sentAt || delivered?.failedAt)

    // Nobody else answers, and only the developers close it.
    assert.equal((await someone(`/support-tickets/${ticket.id}/comments`, 'POST', { text: 'Comigo também.' })).status, 403)
    assert.equal((await mine(`/support-tickets/${ticket.id}/status`, 'POST', { status: 'closed', note: 'Resolvido' })).status, 403)
    assert.equal((await dev(`/support-tickets/${ticket.id}/status`, 'POST', { status: 'closed', note: 'Exclusão liberada para conta com baixa estornada.' })).status, 200)
    const closed = await mine(`/support-tickets/${ticket.id}/comments`, 'POST', { text: 'Mais uma coisa.' })
    assert.deepEqual([closed.status, closed.data.message], [409, 'Este ticket está fechado. Se o problema continuar, abra um novo ticket.'])
    assert.equal((await dev(`/support-tickets/${ticket.id}/comments`, 'POST', { text: 'Registro depois de fechado.' })).status, 201, 'developers still comment on a closed ticket')
  } finally {
    await fixture.close()
  }
})
