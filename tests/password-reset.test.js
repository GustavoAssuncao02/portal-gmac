import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const GENERIC = 'Se o CPF estiver cadastrado, enviamos um código para o e-mail dele.'
const codeOf = (message) => message.text.match(/é: (\d{6})/)[1]

test('esqueci minha senha: code by e-mail, new password, the same answers for unknown CPFs and the history', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const login = (cpf, password) => f.request('/auth/login', 'POST', { cpf, password })
    const admin = { Authorization: `Bearer ${(await login(env.DEMO_ADMIN_CPF, env.DEMO_ADMIN_PASSWORD)).data.token}` }
    await f.request('/admins', 'POST', { name: 'Jéssica', email: 'jessica@email.com', birthDate: '1990-01-01', cpf: '98765432100', password: 'antiga1' }, admin)
    const jessica = { Authorization: `Bearer ${(await login('98765432100', 'antiga1')).data.token}` }

    assert.equal((await f.request('/auth/password-reset/request', 'POST', { cpf: '123' })).status, 400)
    const asked = await f.request('/auth/password-reset/request', 'POST', { cpf: '98765432100' })
    assert.equal(asked.status, 200)
    assert.equal(asked.data.message, GENERIC)
    assert.equal(f.sentMail.length, 1)
    assert.equal(f.sentMail[0].to, 'jessica@email.com')
    const code = codeOf(f.sentMail[0])
    assert.match(code, /^\d{6}$/)
    assert.equal((await f.request('/auth/password-reset/request', 'POST', { cpf: '98765432100' })).status, 429, 'one code a minute')

    // An unknown CPF gets the same answer and the same attempts, but no e-mail.
    const unknown = await f.request('/auth/password-reset/request', 'POST', { cpf: '11122233344' })
    assert.deepEqual([unknown.status, unknown.data.message, f.sentMail.length], [200, GENERIC, 1])
    const wrong = code === '000000' ? '111111' : '000000'
    const known = await f.request('/auth/password-reset/verify', 'POST', { cpf: '98765432100', code: wrong })
    const stranger = await f.request('/auth/password-reset/verify', 'POST', { cpf: '11122233344', code: wrong })
    assert.deepEqual([known.status, known.data.message], [400, 'Código incorreto. 4 tentativas restantes.'])
    assert.deepEqual([stranger.status, stranger.data.message], [known.status, known.data.message])
    for (let attempt = 2; attempt < 5; attempt += 1) await f.request('/auth/password-reset/verify', 'POST', { cpf: '11122233344', code: wrong })
    assert.match((await f.request('/auth/password-reset/verify', 'POST', { cpf: '11122233344', code: wrong })).data.message, /Código bloqueado após 5 tentativas/)
    assert.match((await f.request('/auth/password-reset/verify', 'POST', { cpf: '11122233344', code: wrong })).data.message, /inválido ou expirado/)

    const verified = await f.request('/auth/password-reset/verify', 'POST', { cpf: '98765432100', code })
    assert.equal(verified.status, 200)
    assert.equal((await f.request('/auth/password-reset/verify', 'POST', { cpf: '98765432100', code })).status, 400, 'the code is used once')
    assert.equal((await f.request('/auth/password-reset/complete', 'POST', { resetToken: verified.data.resetToken, password: '123' })).status, 400)
    assert.equal((await f.request('/auth/password-reset/complete', 'POST', { resetToken: verified.data.resetToken, password: 'nova123' })).status, 200)
    assert.equal((await f.request('/auth/password-reset/complete', 'POST', { resetToken: verified.data.resetToken, password: 'outra123' })).status, 400, 'the token sets one password')

    assert.equal((await login('98765432100', 'antiga1')).status, 401)
    assert.equal((await login('98765432100', 'nova123')).status, 200)
    assert.equal((await f.request('/auth/session', 'GET', undefined, jessica)).status, 401, 'the open sessions end')
    assert.equal(f.sentMail.length, 2)
    assert.match(f.sentMail[1].subject, /sua senha foi alterada/)

    // An administrator changing a password in the registration is in the history too.
    const jessicaId = (await f.request('/admins', 'GET', undefined, admin)).data.items.find((row) => row.cpf === '98765432100').id
    await f.request(`/admins/${jessicaId}`, 'PUT', { name: 'Jéssica', email: 'jessica@email.com', birthDate: '1990-01-01', cpf: '98765432100', password: 'pelo-ti1' }, admin)
    const history = (await f.request('/password-resets', 'GET', undefined, admin)).data.items
    assert.equal(history[0].status, 'Senha alterada por Gustavo')
    assert.deepEqual(history.filter((row) => row.done).map((row) => row.kind), ['admin', 'email'])
    assert.ok(history.some((row) => row.cpf === '11122233344' && row.status === 'CPF não cadastrado'))

    // The administrative employee needs an e-mail and does not see the history.
    assert.equal((await f.request('/employees', 'POST', { name: 'Ana', cpf: '55566677788', type: 'administrative', password: 'senha12' }, admin)).status, 400)
    assert.equal((await f.request('/employees', 'POST', { name: 'Ana', cpf: '55566677788', email: 'ana@email.com', type: 'administrative', password: 'senha12' }, admin)).status, 201)
    const staff = { Authorization: `Bearer ${(await login('55566677788', 'senha12')).data.token}` }
    assert.equal((await f.request('/password-resets', 'GET', undefined, staff)).status, 403)
  } finally { await f.close() }
})
