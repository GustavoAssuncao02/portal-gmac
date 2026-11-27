import test from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import { createWorkflowFixture } from './workflowFixture.js'
import { crc32, zipFiles } from '../server/zipFile.js'

// Ticket › Exportar (2026-11-27): the developers take a ticket out of the portal in a light file. Without attachments a
// .json; with them a .zip with ticket.json and the files in anexos/. Everything the ticket keeps goes in it. Only the
// developers export. Fictitious data only.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Administradora' }
const person = (index) => ({ name: `Funcionário ${index}`, birthDate: '1990-01-01', cpf: `0000000000${index}`, email: `funcionario${index}@example.invalid`, identification: '', type: 'administrative', password: 'senha123' })

// The entries of a .zip: name, contents and whether the CRC matches.
function unzip(buffer) {
  const entries = []
  let offset = 0
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8), crc = buffer.readUInt32LE(offset + 14), size = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28)
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const start = offset + 30 + nameLength + extra
    const data = method === 8 ? inflateRawSync(buffer.subarray(start, start + size)) : buffer.subarray(start, start + size)
    entries.push({ name, data, crcOk: crc32(data) === crc })
    offset = start + size
  }
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50, 'end of the central directory')
  assert.equal(buffer.readUInt16LE(buffer.length - 12), entries.length)
  return entries
}

test('the zip writer: names in UTF-8, contents and CRC', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
  const entries = unzip(zipFiles([{ name: 'ticket.json', data: '{"a":1}' }, { name: 'anexos/01 - ação.png', data: Buffer.from([0, 1, 2, 255]) }]))
  assert.deepEqual(entries.map((entry) => [entry.name, entry.crcOk]), [['ticket.json', true], ['anexos/01 - ação.png', true]])
  assert.equal(entries[0].data.toString(), '{"a":1}')
  assert.deepEqual([...entries[1].data], [0, 1, 2, 255])
})

test('the developers export a ticket: .json without attachments, .zip with them; nobody else', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env, ticketDevelopers: ['00000000004'] })
  try {
    const login = async (index) => {
      assert.equal((await fixture.adminRequest('/employees', 'POST', person(index))).status, 201)
      const result = await fixture.request('/auth/login', 'POST', { cpf: `0000000000${index}`, password: 'senha123' })
      return { Authorization: `Bearer ${result.data.token}` }
    }
    const developer = await login(4), author = await login(5)
    const as = (headers) => (route, method = 'GET', body) => fixture.request(route, method, body, headers)
    const dev = as(developer), mine = as(author)
    const exported = (headers, id, query = '') => fetch(`${fixture.url}/api/support-tickets/${id}/export${query}`, { headers })
    const upload = async (headers, name, body) => (await (await fetch(`${fixture.url}/api/support-tickets/uploads?name=${encodeURIComponent(name)}&type=image/png`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body })).json()).item.id

    // Without attachments: the .json, with the conversation, the history and the people.
    const plain = (await mine('/support-tickets', 'POST', { urgency: 'medium', module: 'operation', submodule: 'offers', title: 'Prazo da cotação', description: 'Precisamos de um prazo limite.' })).data.item
    await dev(`/support-tickets/${plain.id}/comments`, 'POST', { text: 'Entra na próxima versão.' })
    await dev(`/support-tickets/${plain.id}/status`, 'POST', { status: 'closed', note: 'Publicado.' })
    assert.equal((await exported(author, plain.id)).status, 403, 'only the developers')
    assert.equal((await exported(fixture.admin, plain.id)).status, 403)
    assert.equal((await exported(developer, 'TCK-9999')).status, 404)
    const json = await exported(developer, plain.id)
    assert.equal(json.status, 200)
    assert.match(json.headers.get('content-type'), /^application\/json/)
    assert.equal(json.headers.get('content-disposition'), `attachment; filename="${plain.id}.json"`)
    const data = await json.json()
    assert.equal(data.exportedBy, 'Funcionário 4')
    assert.ok(Date.parse(data.exportedAt))
    assert.deepEqual([data.ticket.id, data.ticket.title, data.ticket.description, data.ticket.status, data.ticket.statusLabel, data.ticket.urgencyLabel, data.ticket.moduleTitle], [plain.id, 'Prazo da cotação', 'Precisamos de um prazo limite.', 'closed', 'Fechado', 'Médio', 'Operação › Ofertas e serviços'])
    assert.equal(data.ticket.comments[0].text, 'Entra na próxima versão.')
    assert.ok(data.ticket.history.some((entry) => entry.note === 'Publicado.'), JSON.stringify(data.ticket.history))
    assert.deepEqual(data.attachments, [])
    assert.deepEqual(data.people.map((item) => [item.name, item.email, item.developer]).sort(), [['Funcionário 4', 'funcionario4@example.invalid', true], ['Funcionário 5', 'funcionario5@example.invalid', false]])
    assert.ok(!JSON.stringify(data.people).includes('00000000005'), 'no CPF of the people')

    // With attachments (of the opening and of the conversation): the .zip; "Copiar JSON" (format=json) still the .json.
    const opening = await upload(author, 'tela.png', Buffer.from('imagem da abertura'))
    const withFiles = (await mine('/support-tickets', 'POST', { urgency: 'high', module: 'finance', submodule: 'payables', title: 'Erro ao baixar', description: 'Veja a tela.', fileIds: [opening] })).data.item
    const later = await upload(author, 'erro.png', Buffer.from('imagem da conversa'))
    assert.equal((await mine(`/support-tickets/${withFiles.id}/comments`, 'POST', { text: 'Mais uma.', fileIds: [later] })).status, 201)
    const zip = await exported(developer, withFiles.id)
    assert.equal(zip.status, 200)
    assert.equal(zip.headers.get('content-type'), 'application/zip')
    assert.equal(zip.headers.get('content-disposition'), `attachment; filename="${withFiles.id}.zip"`)
    const entries = unzip(Buffer.from(await zip.arrayBuffer()))
    assert.deepEqual(entries.map((entry) => entry.name), ['ticket.json', 'anexos/01 - tela.png', 'anexos/02 - erro.png'])
    assert.ok(entries.every((entry) => entry.crcOk))
    assert.deepEqual(entries.slice(1).map((entry) => entry.data.toString()), ['imagem da abertura', 'imagem da conversa'])
    const inside = JSON.parse(entries[0].data.toString('utf8'))
    assert.deepEqual(inside.attachments.map((file) => [file.name, file.sentIn, file.sentBy, file.fileInZip]), [['tela.png', 'abertura', 'Funcionário 5', 'anexos/01 - tela.png'], ['erro.png', 'conversa', 'Funcionário 5', 'anexos/02 - erro.png']])
    const copied = await (await exported(developer, withFiles.id, '?format=json')).json()
    assert.deepEqual(copied.attachments.map((file) => [file.name, file.fileInZip]), [['tela.png', undefined], ['erro.png', undefined]])
  } finally { await fixture.close() }
})
