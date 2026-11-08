import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import { createWorkflowFixture } from './workflowFixture.js'
import { invoicePdf, sampleNfse, sampleNfe } from './invoiceSample.js'

// Contas a Receber from the PDF of the invoices: the NFS-e and the DANFE are read (several per file, a DANFE over two
// sheets), nothing is posted until the user saves, each account gets the PDF of its own invoice, and an invoice already
// posted for the same client is pointed out.
test('reads NFS-e and NF-e from a PDF and posts each one with its own PDF attached', async (t) => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env, fillClassifications: false })
  t.after(() => f.close())
  await (await f.serverModule('accountPlan.js')).ensureAccountPlan()
  const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const headers = { Authorization: `Bearer ${token}` }
  const request = (route, method, body) => f.request(route, method, body, headers)
  const upload = async (name, body) => { const response = await fetch(`${f.url}/api/receivables/invoice-import?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body }); return { status: response.status, data: await response.json() } }
  // The NFS-e 2026000000451 was already typed by hand as "2026451" for the same client.
  await f.mutateStore((store) => { store.receivables = [{ id: 'REC-000001', origin: 'manual', kind: 'single', customerName: 'Cliente Exemplo Serviços Ltda', customerDocument: '11222333000181', description: '', documentNumber: 'NFS 2026451', issueDate: '2026-10-20', dueDate: '2026-12-04', valueCents: 165440, issCents: 8272, receipt: null, inactive: false, attachments: [], createdAt: '2026-10-20T12:00:00.000Z' }]; store.receivableSequence = 1 })

  assert.equal((await upload('planilha.pdf', Buffer.from('não é um pdf'))).status, 400)
  const pdf = await invoicePdf([sampleNfse, { kind: 'other' }, sampleNfe, { ...sampleNfe, sheet: '2/2', dues: [], products: [['000977', 'SEGUNDO PRODUTO EXEMPLO']] }])
  const read = await upload('notas de outubro.pdf', pdf)
  assert.equal(read.status, 200)
  assert.deepEqual(read.data.problems, [{ page: 2, message: 'A página não é uma NFS-e nem uma DANFE de NF-e.' }])
  const [service, product] = read.data.items
  assert.deepEqual([service.label, service.documentNumber, service.issueDate, service.customerName, service.customerDocument, service.valueCents, service.issCents, service.installments, service.duplicateOf], ['NFS-e', '2026000000451', '2026-10-20', 'CLIENTE EXEMPLO SERVIÇOS LTDA', '11222333000181', 165440, 8272, [{ dueDate: '2026-12-04', valueCents: 165440 }], 'REC-000001'])
  assert.equal(service.description, '1 - SERVICO DE USINAGEM EM 10 PEÇAS DE EXEMPLO - R$ 1.654,40')
  assert.deepEqual([product.label, product.documentNumber, product.issueDate, product.customerName, product.customerDocument, product.valueCents, product.issCents, product.pages, product.duplicateOf], ['NF-e', '000.000.915', '2026-10-08', 'INDÚSTRIA EXEMPLO S.A', '44555666000177', 14700000, 0, [3, 4], null])
  assert.deepEqual(product.installments, [{ dueDate: '2026-11-05', valueCents: 10000000 }, { dueDate: '2026-12-05', valueCents: 4700000 }])
  assert.equal(product.description, 'CARRO DE LONA EXEMPLO 018702\nSEGUNDO PRODUTO EXEMPLO')
  assert.equal((await f.mutateStore((store) => store.receivables.length)), 1, 'reading posts nothing')

  // Saved as the user checked it: the NF-e in its two duplicates, with only its two pages attached.
  const classifications = (await request('/receivables')).data.classifications
  const code = (value) => classifications.find((item) => item.code === value).id
  const client = (await request('/clients', 'POST', { name: 'Indústria Exemplo S.A', document: product.customerDocument, documentType: 'cnpj' })).data.item
  const posted = await request('/receivables', 'POST', { clientId: client.id, description: product.description, documentNumber: product.documentNumber, issueDate: product.issueDate, value: '147000.00', iss: '', classificationId: code('7.04'), dueDate: '2026-11-05', kind: 'installment', count: 2, installments: [{ value: '100000.00', dueDate: '2026-11-05' }, { value: '47000.00', dueDate: '2026-12-05' }], fileIds: [product.file.id] })
  assert.equal(posted.status, 201)
  assert.deepEqual(posted.data.items.map((row) => [row.valueCents, row.dueDate, row.documentNumber, row.attachments[0]?.name]), [[10000000, '2026-11-05', '000.000.915', 'NF-e 000.000.915.pdf'], [4700000, '2026-12-05', '000.000.915', 'NF-e 000.000.915.pdf']])
  const file = await fetch(`${f.url}/api/receivables/${posted.data.items[0].id}/files/${product.file.id}`, { headers })
  assert.equal((await PDFDocument.load(new Uint8Array(await file.arrayBuffer()))).getPageCount(), 2, 'the attachment holds only the pages of that invoice')

  // The NFS-e left unchecked is let go, and only by the user who read it.
  const discarded = await request('/receivables/uploads/discard', 'POST', { ids: [service.file.id, product.file.id] })
  assert.equal(discarded.data.removed, 1)
  assert.equal((await f.mutateStore((store) => store.receivableUploads.length)), 0)
  // Read again after posting, the NF-e is pointed out as posted; a file with a single invoice is attached as it came.
  const again = await upload('NF 915.pdf', await invoicePdf([sampleNfe]))
  assert.deepEqual([again.data.items[0].duplicateOf, again.data.items[0].file.name], [posted.data.items[0].id, 'NF 915.pdf'])
})
