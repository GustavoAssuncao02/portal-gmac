import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase, createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { legacyPaymentDays, paymentDaysText, paymentDaysValue } from '../server/clientPaymentTerm.js'

// The payment term of a client (Cadastros › Clientes), in days: it fills "Pagamento" of the letter proposals (models A/B),
// the PDF writes "45 dias", and a term typed in a proposal goes to a client that has none yet.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }

test('the payment term is a whole number of days and is written with "dias"', () => {
  assert.deepEqual([paymentDaysValue(''), paymentDaysValue(null), paymentDaysValue('45'), paymentDaysValue(30)], [null, null, 45, 30])
  for (const wrong of ['4.5', '0', '-3', '366', 'abc', '45 DDL']) assert.throws(() => paymentDaysValue(wrong), { status: 400 }, wrong)
  assert.deepEqual([paymentDaysText(45), paymentDaysText(1), paymentDaysText(null)], ['45 dias', '1 dia', ''])
  assert.deepEqual([legacyPaymentDays('45 DDL'), legacyPaymentDays('28 dias'), legacyPaymentDays('À vista'), legacyPaymentDays('')], [45, 28, null, null])
})

test('the client keeps its term, fills the proposal and learns it from the first proposal', async (t) => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => f.close())
  const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const request = (route, method = 'GET', body) => f.request(route, method, body, { Authorization: `Bearer ${token}` })
  const clientOf = async (id) => (await request('/clients')).data.items.find((item) => String(item.id) === String(id))

  // Cadastros › Clientes: only the number is stored; a save without the field keeps it, blank removes it.
  const created = await request('/clients', 'POST', { name: 'Belgo Bekaert', documentType: 'cnpj', document: '11222333000181', email: '', notes: '', paymentDays: '45' })
  assert.equal(created.status, 200, JSON.stringify(created.data))
  const belgo = created.data.item
  assert.equal((await clientOf(belgo.id)).paymentDays, 45)
  assert.equal((await request(`/clients/${belgo.id}`, 'PUT', { name: 'Belgo Bekaert', documentType: 'cnpj', document: '11222333000181', paymentDays: '4,5' })).status, 400)
  await request(`/clients/${belgo.id}`, 'PUT', { name: 'Belgo Bekaert', documentType: 'cnpj', document: '11222333000181', notes: 'Sem o campo' })
  assert.equal((await clientOf(belgo.id)).paymentDays, 45, 'a save without the term keeps it')

  // The letter model comes with the client's term.
  const offer = (await request('/offers', 'POST', { ...offerDraft, cnpj: '11.222.333/0001-81', company: 'Belgo Bekaert' })).data.item
  const draft = (await request(`/offers/${offer.id}/proposal-draft?model=model-a&value=1000&deadline=15 dias`)).data
  assert.equal(draft.draft.paymentDays, 45)
  assert.equal(draft.draft.subject, offerDraft.service, 'the object of the proposal is the service alone, without "serviço de"')
  assert.deepEqual(draft.paymentClient, { name: 'Belgo Bekaert', paymentDays: 45 })

  // A client without a term learns the one typed in its first proposal; a registered term is never replaced.
  const plain = (await request('/clients', 'POST', { name: 'Cliente sem prazo', documentType: 'cnpj', document: '44555666000172' })).data.item
  assert.equal((await clientOf(plain.id)).paymentDays, null)
  const second = (await request('/offers', 'POST', { ...offerDraft, cnpj: '44555666000172', company: 'Cliente sem prazo' })).data.item
  await request(`/offers/${second.id}/resources`, 'PUT', { stages: ['painting'], materials: [], laborEntries: [], kind: 'service' })
  const letter = (await request(`/offers/${second.id}/proposal-draft?model=model-a&value=1000&deadline=15 dias`)).data
  assert.equal(letter.draft.paymentDays, null)
  assert.deepEqual(letter.paymentClient, { name: 'Cliente sem prazo', paymentDays: null })
  const fiscal = { ...letter.draft.fiscal, cnae: [{ code: '2539-0/01' }], nbs: [{ code: '1.2001.50.00' }] }
  const refused = await request(`/offers/${second.id}/proposal-document`, 'POST', { model: 'model-a', document: { ...letter.draft, fiscal, paymentDays: '30 DDL' } })
  assert.equal(refused.status, 400)
  assert.match(refused.data.message, /prazo de pagamento em dias/)
  const generated = await request(`/offers/${second.id}/proposal-document`, 'POST', { model: 'model-a', document: { ...letter.draft, fiscal, paymentDays: '30' } })
  assert.equal(generated.status, 200, JSON.stringify(generated.data))
  assert.equal(generated.data.item.proposal.document.paymentDays, 30)
  assert.equal(generated.data.item.proposal.document.payment, undefined, 'only the number is kept')
  assert.deepEqual(generated.data.paymentRegistered, { name: 'Cliente sem prazo', paymentDays: 30 })
  assert.equal((await clientOf(plain.id)).paymentDays, 30)
  // The "i" of Cadastros tells who set it and where it came from.
  const learned = (await request(`/registry-history/clients/${plain.id}`)).data.items[0]
  assert.equal(learned.type, 'edited')
  assert.match(JSON.stringify(learned), /paymentDays[\s\S]*30/)
  assert.match(learned.note, /Prazo de pagamento informado na proposta/)
  const pdf = await fetch(`${f.url}/api/offers/${second.id}/proposal.pdf`, { headers: { Authorization: `Bearer ${token}` } })
  assert.equal(pdf.status, 200)

  // Reopened, it shows the number; a different number afterwards does not touch the client.
  assert.equal((await request(`/offers/${second.id}/proposal-draft?model=model-a`)).data.draft.paymentDays, 30)
  const again = await request(`/offers/${second.id}/proposal-document`, 'POST', { model: 'model-a', document: { ...letter.draft, fiscal, paymentDays: '60' } })
  assert.equal(again.status, 200, JSON.stringify(again.data))
  assert.equal(again.data.paymentRegistered, null)
  assert.equal((await clientOf(plain.id)).paymentDays, 30)

  // Proposals saved before kept free text: the number in it fills the field when reopened.
  await f.mutateStore((store) => { const item = store.offers.find((entry) => entry.id === second.id); delete item.proposal.document.paymentDays; item.proposal.document.payment = '28 DDL' })
  const legacy = (await request(`/offers/${second.id}/proposal-draft?model=model-a`)).data.draft
  assert.deepEqual([legacy.paymentDays, legacy.payment], [28, undefined])
})

test('in MySQL an older clients table gets the payment_days column and keeps only the number', async (t) => {
  const db = await createTestDatabase('gmac_test_payment')
  const f = await createWorkflowFixture({ accountsEnv: env })
  t.after(async () => { await f.close(); await db.drop() })
  // The clients table as production had it before the term.
  await db.pool.query("CREATE TABLE clients (id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, document_type ENUM('cpf', 'cnpj') NOT NULL, document VARCHAR(14) NOT NULL UNIQUE, email VARCHAR(160) NULL UNIQUE, notes VARCHAR(1000) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)")
  await db.pool.query("INSERT INTO clients (name, document_type, document) VALUES ('Cliente antigo', 'cnpj', '11222333000181')")
  const { createAccountService } = await f.serverModule('accounts.js')
  const accounts = createAccountService(db.pool, env)
  const [old] = await accounts.clients()
  assert.equal(old.paymentDays, null)
  const [[column]] = await db.pool.query("SELECT DATA_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'payment_days'")
  assert.equal(column.type, 'smallint')
  await accounts.save('clients', old.id, { ...old, paymentDays: '45' })
  const [[row]] = await db.pool.query('SELECT payment_days AS days FROM clients WHERE id = ?', [old.id])
  assert.equal(row.days, 45)
  await accounts.save('clients', old.id, { name: old.name, documentType: 'cnpj', document: old.document, notes: 'Outra observação' })
  assert.equal((await accounts.clients())[0].paymentDays, 45, 'a save without the term keeps it')
  await accounts.save('clients', old.id, { name: old.name, documentType: 'cnpj', document: old.document, paymentDays: '' })
  assert.equal((await accounts.clients())[0].paymentDays, null, 'blank removes it')
})
