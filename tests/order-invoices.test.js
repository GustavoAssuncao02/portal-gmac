import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { invoicePdf, sampleNfse } from './invoiceSample.js'

// NF-e da OS (server/orderInvoices.js): the PDF of the invoice is imported only once every piece is done; each note read
// becomes the account receivable of the OS with the PDF attached — also when an administrative employee, without the
// finance screens, imports it. A possible duplicate is the user's call; the NF-e and its account are removed apart.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const client = { cnpj: sampleNfse.document, company: 'Cliente Exemplo Serviços Ltda' }

async function setup(t) {
  const f = await createWorkflowFixture({ accountsEnv: env, fillClassifications: false })
  t.after(() => f.close())
  await (await f.serverModule('accountPlan.js')).ensureAccountPlan()
  const login = async (cpf, password) => (await f.request('/auth/login', 'POST', { cpf, password })).data.token
  const admin = { Authorization: `Bearer ${await login(env.DEMO_ADMIN_CPF, env.DEMO_ADMIN_PASSWORD)}` }
  await f.request('/employees', 'POST', { name: 'Funcionária Escritório', birthDate: '1990-01-01', cpf: '00000000004', email: 'escritorio@example.invalid', identification: '', type: 'administrative', password: 'senha123' }, admin)
  const staff = { Authorization: `Bearer ${await login('00000000004', 'senha123')}` }
  const operator = { Authorization: `Bearer ${f.operatorToken}` }
  const worker = (await f.request('/employees', 'POST', { name: 'Operador Ficticio', birthDate: '1990-01-01', cpf: '00000000001', email: 'operador@example.invalid', identification: '001' }, admin)).data.item
  // An OS of the client of the sample NFS-e, with the production finished (or not, `finish: false`).
  async function order({ finish = true } = {}) {
    const offer = (await f.request('/offers', 'POST', { ...offerDraft, ...client }, admin)).data.item
    await f.request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cut-bend'], kind: 'service' }, admin)
    await f.request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Teste', deadline: offerDraft.deadline, serviceValue: 100 } }, admin)
    const item = (await f.request(`/offers/${offer.id}/accept`, 'POST', undefined, admin)).data.item
    if (finish) {
      const route = `/operations/orders/${item.code}`
      const started = await f.request(`${route}/start`, 'POST', { employeeId: worker.id }, operator)
      const session = { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken }
      await f.request(`${route}/stages/${started.data.operation.stages[0].key}`, 'POST', { ...session, quantity: item.quantity }, operator)
      assert.equal((await f.request(`${route}/complete`, 'POST', session, operator)).data.operation.status, 'completed')
    }
    return item
  }
  const read = async (code, name, body, headers = staff) => { const response = await fetch(`${f.url}/api/orders/${encodeURIComponent(code)}/invoices/read?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body }); return { status: response.status, data: await response.json() } }
  return { f, admin, staff, operator, order, read }
}
const store = (f) => f.mutateStore((data) => structuredClone(data))
// What the browser sends for a note read, as the user checked it.
const noteOf = (item, clientId, classificationId, extra = {}) => ({ fileId: item.file.id, clientId, documentNumber: item.documentNumber, issueDate: item.issueDate, description: item.description, value: (item.valueCents / 100).toFixed(2), iss: (item.issCents / 100).toFixed(2), classificationId, installments: item.installments.map((part) => ({ dueDate: part.dueDate, value: (part.valueCents / 100).toFixed(2) })), mode: 'post', ...extra })

test('the NF-e of an OS: only after the production, read, checked and posted as the account receivable of the OS', async (t) => {
  const { f, admin, staff, operator, order, read } = await setup(t)
  const pending = await order({ finish: false })
  const blocked = await read(pending.code, 'nota.pdf', await invoicePdf([sampleNfse]))
  assert.deepEqual([blocked.status, blocked.data.message], [409, 'A OS não está concluída, não é possível importar a NF-e.'])
  assert.equal((await f.request(`/orders/${pending.code}/invoices`, 'GET', undefined, operator)).status, 401, 'operators never see the NF-e')

  const os = await order()
  const base = `/orders/${os.code}/invoices`
  assert.equal((await read(os.code, 'planilha.pdf', Buffer.from('não é um pdf'))).status, 400)
  const unknown = await read(os.code, 'outro.pdf', await invoicePdf([{ kind: 'other' }]))
  assert.equal(unknown.status, 400)
  assert.match(unknown.data.message, /^Não foi possível ler uma nota fiscal neste PDF/)
  assert.equal((await store(f)).orderInvoiceUploads?.length || 0, 0, 'a refused PDF is not kept')

  // The administrative employee reads it: the client is not registered yet, nothing is posted by reading.
  const first = await read(os.code, 'NFS 451.pdf', await invoicePdf([sampleNfse]))
  assert.equal(first.status, 200)
  const [note] = first.data.items
  assert.deepEqual([note.label, note.documentNumber, note.valueCents, note.client, note.duplicates, note.file.name], ['NFS-e', '2026000000451', 165440, null, [], 'NFS 451.pdf'])
  const info = (await f.request(base, 'GET', undefined, staff)).data
  assert.deepEqual([info.order.completed, info.order.concluded, info.invoices], [true, false, []])
  const classificationId = info.classifications.find((item) => item.code === '7.02').id
  const registered = (await f.request('/clients', 'POST', { name: 'Cliente Exemplo Serviços Ltda', document: sampleNfse.document, documentType: 'cnpj' }, staff)).data.item
  assert.ok(registered?.id, 'the client is registered on the spot')

  const posted = await f.request(base, 'POST', { notes: [noteOf(note, registered.id, classificationId)] }, staff)
  assert.equal(posted.status, 201)
  const [invoice] = posted.data.items
  assert.deepEqual([invoice.label, invoice.number, invoice.valueCents, invoice.uploadedBy, invoice.accounts.length, invoice.deleteBlock], ['NFS-e', '2026000000451', 165440, 'Funcionária Escritório', 1, null])
  let data = await store(f)
  const account = data.receivables.find((row) => row.id === invoice.receivableIds[0])
  assert.deepEqual([account.origin, account.orderCode, account.offerId, account.valueCents, account.issCents, account.dueDate, account.documentNumber, account.attachments.length], ['invoice', os.code, os.offerId, 165440, 8272, '2026-12-04', '2026000000451', 1])
  assert.equal(data.orderInvoiceUploads.length, 0)
  const file = await fetch(`${f.url}/api${base}/${invoice.id}`, { headers: staff })
  assert.equal(file.status, 200)
  assert.equal((await PDFDocument.load(new Uint8Array(await file.arrayBuffer()))).getPageCount(), 1)
  assert.equal((await fetch(`${f.url}/api/receivables/${account.id}/files/${account.attachments[0].id}`, { headers: admin })).status, 200, 'the account has its own copy of the PDF')
  // The browser concludes the OS right after.
  assert.equal((await f.request(`/operations/orders/${os.code}/acknowledge-completion`, 'POST', {}, staff)).status, 200)
  assert.equal((await f.request(base, 'GET', undefined, staff)).data.order.concluded, true)

  // The same note again: a possible duplicate, refused until the user chooses.
  const again = await read(os.code, 'NFS 451.pdf', await invoicePdf([sampleNfse]))
  assert.deepEqual(again.data.items[0].duplicates.map((row) => row.id), [account.id])
  const refused = await f.request(base, 'POST', { notes: [noteOf(again.data.items[0], registered.id, classificationId)] }, staff)
  assert.deepEqual([refused.status, refused.data.duplicate, refused.data.fileId, refused.data.matches.map((row) => row.id)], [409, true, again.data.items[0].file.id, [account.id]])
  assert.match(refused.data.message, /^Possível lançamento duplicado: a NFS-e 2026000000451 pode já estar em REC-/)
  // "Só anexar na OS": the PDF stays on the OS, no account.
  const attached = await f.request(base, 'POST', { notes: [noteOf(again.data.items[0], registered.id, classificationId, { mode: 'attach' })] }, staff)
  assert.equal(attached.status, 201)
  assert.deepEqual([attached.data.items[0].receivableIds, attached.data.items[0].existing.map((row) => row.id), attached.data.invoices.length], [[], [account.id], 2])
  data = await store(f)
  assert.equal(data.receivables.length, 1)
  // "Lançar mesmo assim" posts a second account.
  const third = await read(os.code, 'NFS 451.pdf', await invoicePdf([sampleNfse]))
  const forced = await f.request(base, 'POST', { notes: [noteOf(third.data.items[0], registered.id, classificationId, { allowDuplicate: true })] }, staff)
  assert.equal(forced.status, 201)
  assert.equal((await store(f)).receivables.length, 2)

  // Taking an NF-e out: two answers. Only the account, then only the file; an account received stays.
  const removeRoute = (id) => `${base}/${id}/remove`
  assert.equal((await f.request(removeRoute(forced.data.items[0].id), 'POST', {}, staff)).status, 400)
  const onlyAccount = await f.request(removeRoute(forced.data.items[0].id), 'POST', { receivables: true }, staff)
  assert.deepEqual([onlyAccount.status, onlyAccount.data.deleted, onlyAccount.data.invoices.length], [200, forced.data.items[0].receivableIds, 3])
  assert.equal((await store(f)).receivables.length, 1)
  assert.equal((await f.request(removeRoute(attached.data.items[0].id), 'POST', { file: true }, staff)).data.invoices.length, 2)
  assert.equal((await fetch(`${f.url}/api${base}/${attached.data.items[0].id}`, { headers: staff })).status, 404)
  await f.mutateStore((current) => { current.receivables.find((row) => row.id === account.id).receipt = { date: '2026-12-04', finalCents: 157168 } })
  const view = (await f.request(base, 'GET', undefined, staff)).data.invoices.find((row) => row.id === invoice.id)
  assert.match(view.deleteBlock, /Conta com recebimento/)
  assert.equal((await f.request(removeRoute(invoice.id), 'POST', { file: true, receivables: true }, staff)).status, 409, 'an account received is protected')
  assert.equal((await store(f)).orders.find((row) => row.code === os.code).invoices.length, 2, 'a refused removal changes nothing')
})

test('concluding without NF-e generates nothing and marks the OS; reopening takes the NF-e and the account as marked', async (t) => {
  const { f, admin, staff, order, read } = await setup(t)
  const os = await order()
  const skipped = await f.request(`/operations/orders/${os.code}/acknowledge-completion`, 'POST', { withoutInvoice: true }, staff)
  assert.equal(skipped.status, 200)
  assert.match(skipped.data.event.details, /sem NF-e/)
  let saved = (await store(f)).orders.find((row) => row.code === os.code)
  assert.equal(saved.invoiceSkipped.by, 'Funcionária Escritório')
  assert.equal((await store(f)).receivables?.length || 0, 0)

  // Imported later, from Ver OS: the account is generated and the mark leaves.
  const registered = (await f.request('/clients', 'POST', { name: 'Cliente Exemplo Serviços Ltda', document: sampleNfse.document, documentType: 'cnpj' }, admin)).data.item
  const classificationId = (await f.request(`/orders/${os.code}/invoices`, 'GET', undefined, staff)).data.classifications.find((item) => item.code === '7.02').id
  const [note] = (await read(os.code, 'NFS 451.pdf', await invoicePdf([sampleNfse]))).data.items
  assert.equal((await f.request(`/orders/${os.code}/invoices`, 'POST', { notes: [noteOf(note, registered.id, classificationId)] }, staff)).status, 201)
  saved = (await store(f)).orders.find((row) => row.code === os.code)
  assert.equal(saved.invoiceSkipped, undefined)
  assert.equal((await store(f)).receivables.length, 1)

  // Reopened keeping both, then concluded again and reopened taking both.
  assert.equal((await f.request(`/operations/orders/${os.code}/reopen`, 'POST', { invoices: 'nada' }, admin)).status, 400)
  assert.equal((await f.request(`/operations/orders/${os.code}/reopen`, 'POST', { receivables: 'keep', invoices: 'keep' }, admin)).status, 200)
  assert.deepEqual([(await store(f)).orders.find((row) => row.code === os.code).invoices.length, (await store(f)).receivables.length], [1, 1])
  const blocked = await read(os.code, 'NFS 451.pdf', await invoicePdf([sampleNfse]))
  assert.equal(blocked.status, 409, 'a reopened OS is not completed')
  await f.request(`/operations/orders/${os.code}/admin-complete`, 'POST', {}, admin)
  const reopened = await f.request(`/operations/orders/${os.code}/reopen`, 'POST', { receivables: 'delete', invoices: 'remove' }, admin)
  assert.equal(reopened.status, 200)
  assert.match(reopened.data.event.details, /NF-e removida: NFS-e 2026000000451/)
  assert.deepEqual([(await store(f)).orders.find((row) => row.code === os.code).invoices.length, (await store(f)).receivables.length], [0, 0])
})
