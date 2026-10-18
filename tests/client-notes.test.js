import test from 'node:test'
import assert from 'node:assert/strict'
import { createAccountService } from '../server/accounts.js'

// On shared hosting the database user may not be allowed to change tables: the clients keep working without the note.
test('clients keep working when the note column cannot be created', async () => {
  const executed = []
  const pool = { async execute(sql, params) {
    executed.push(sql)
    if (sql.includes('information_schema')) return [[]]
    if (sql.startsWith('ALTER TABLE clients')) throw Object.assign(new Error('ALTER command denied'), { code: 'ER_TABLEACCESS_DENIED_ERROR' })
    if (sql.startsWith('SELECT id, name, document_type')) return [[{ id: 1, name: 'Nestlé', documentType: 'cnpj', document: '11111111000191', email: 'a@b.com', notes: '' }]]
    if (sql.startsWith('INSERT INTO clients')) return [{ insertId: 2 }]
    return [[]]
  } }
  const errors = []
  const original = console.error
  console.error = (message) => errors.push(String(message))
  try {
    const service = createAccountService(pool, {})
    const rows = await service.clients()
    assert.equal(rows[0].name, 'Nestlé')
    assert.ok(!executed.find((sql) => sql.startsWith('SELECT id, name, document_type')).includes('COALESCE(notes'), 'the list does not read the missing column')
    const saved = await service.save('clients', null, { name: 'Vipal', email: 'v@p.com', documentType: 'cnpj', document: '22222222000191', notes: 'Cliente novo' })
    assert.equal(saved.name, 'Vipal')
    assert.ok(!executed.find((sql) => sql.startsWith('INSERT INTO clients')).includes('notes'), 'saving does not write the missing column')
    assert.equal(executed.filter((sql) => sql.startsWith('ALTER TABLE clients')).length, 1, 'the column is tried only once')
    assert.match(errors[0], /ALTER TABLE clients ADD COLUMN notes/)
  } finally { console.error = original }
})

// The customer list has no e-mails: the column becomes nullable once and a client is saved without one (NULL, so several
// blanks do not collide in the unique index). Administrators still need an e-mail.
test('a client may be registered without e-mail', async () => {
  const executed = []
  const pool = { async execute(sql, params) {
    executed.push([sql, params])
    if (sql.includes("COLUMN_NAME = 'email'")) return [[{ nullable: 'NO' }]]
    if (sql.includes("COLUMN_NAME = 'notes'")) return [[{ name: 'notes' }]]
    if (sql.startsWith('INSERT INTO clients')) return [{ insertId: 7 }]
    return [[]]
  } }
  const service = createAccountService(pool, {})
  const saved = await service.save('clients', null, { name: 'Cliente sem e-mail', email: '  ', documentType: 'cnpj', document: '33333333000191' })
  assert.equal(saved.email, null)
  assert.equal(executed.find(([sql]) => sql.startsWith('INSERT INTO clients'))[1][1], null)
  assert.equal(executed.filter(([sql]) => sql === 'ALTER TABLE clients MODIFY email VARCHAR(160) NULL').length, 1)
  await assert.rejects(service.save('clients', null, { name: 'Cliente', email: 'sem-arroba', documentType: 'cnpj', document: '44444444000191' }), /e-mail válidos/)
  await assert.rejects(service.save('admins', null, { name: 'Admin', email: '', birthDate: '1990-01-01', cpf: '52998224725', password: 'segredo123' }), /e-mail válidos/)
})
