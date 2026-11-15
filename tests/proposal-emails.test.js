import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

async function offerWithProposal(fixture, fields = {}) {
  const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, ...fields })).data.item
  await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
  return offer
}
async function send(fixture, offerId, email, files = []) {
  const body = new FormData()
  body.append('email', JSON.stringify({ ...email, fileNames: files.map((file) => file.name) }))
  for (const file of files) body.append('files', new Blob([file.content], { type: file.type || 'text/plain' }), 'arquivo')
  const response = await fetch(`${fixture.url}/api/offers/${offerId}/proposal-email`, { method: 'POST', headers: fixture.admin, body })
  return { status: response.status, data: await response.json() }
}

test('the proposal e-mail goes, once the PDF exists, to the client and the buyer, editable, and stays on the offer', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const client = (await fixture.adminRequest('/clients', 'POST', { name: 'Nestlé', documentType: 'cnpj', document: '60.409.075/0001-52', email: 'Compras@Nestle.com' })).data.item
  await fixture.adminRequest('/buyers', 'POST', { name: 'Carla Souza', clientId: client.id, email: 'carla@nestle.com' })
  const offer = await offerWithProposal(fixture, { cnpj: '60.409.075/0001-52', company: 'Nestlé', buyer: 'Carla Souza' })

  // Before the PDF there is nothing to send.
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/proposal-email`)).status, 409)
  assert.equal((await send(fixture, offer.id, { to: ['carla@nestle.com'], subject: 'x', message: 'y' })).status, 409)
  assert.equal((await fixture.request(`/offers/${offer.id}/proposal-email`)).status, 401, 'administrators only')
  assert.equal((await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })).status, 200)

  // The draft: client and buyer e-mails, a subject with the proposal, a friendly message for the buyer and the signature.
  const { draft, proposal, configured } = (await fixture.adminRequest(`/offers/${offer.id}/proposal-email`)).data
  assert.equal(configured, true)
  assert.equal(draft.from, 'comercial@gmacmetalurgica.com.br')
  assert.deepEqual(draft.to, ['compras@nestle.com', 'carla@nestle.com'])
  assert.match(draft.subject, new RegExp(`Proposta comercial nº ${offer.code}`))
  assert.match(draft.message, /^Olá, Carla!/)
  // The signature: who sends (no role filled in yet), the issuer and the company's contacts; the HTML one carries the logo.
  assert.match(draft.signature, /^Atenciosamente,[\s\S]*GMAC Usinagem[\s\S]*anos de experiência$/)
  assert.match(draft.signatureHtml, /data:image\/jpeg;base64,[\s\S]*comercial@gmacmetalurgica\.com\.br/)
  // The e-mail of a normal proposal opens with its template; the etiqueta one is there to be picked.
  assert.equal(draft.templateId, 'proposal')
  assert.deepEqual(draft.templates.slice(0, 2).map((item) => item.name), ['Proposta comercial', 'Medição de etiqueta'])
  assert.match(proposal.name, /\.pdf$/)

  // Wrong or missing recipients, subject and message are refused before anything is sent.
  assert.match((await send(fixture, offer.id, { ...draft, to: ['carla@'] })).data.message, /E-mail inválido em Para: carla@/)
  assert.equal((await send(fixture, offer.id, { ...draft, to: [] })).status, 400)
  assert.equal((await send(fixture, offer.id, { ...draft, subject: ' ' })).status, 400)
  assert.equal((await send(fixture, offer.id, { ...draft, includeProposal: false })).data.message, 'Anexe a proposta ou outro arquivo antes de enviar.')
  assert.equal(fixture.proposalMail.length, 0)

  // A failure of the SMTP records nothing.
  fixture.failNextMail()
  assert.equal((await send(fixture, offer.id, draft)).status, 502)
  assert.equal((await fixture.adminRequest('/offers')).data.items.find((item) => item.id === offer.id).proposalEmails, undefined)

  // Edited and with an extra file: the PDF and the file go, the commercial account gets the blind copy.
  const sent = await send(fixture, offer.id, { ...draft, to: ['carla@nestle.com'], cc: 'gerente@nestle.com; compras@nestle.com', subject: 'Proposta revisada', message: 'Segue a proposta.' }, [{ name: 'Desenho técnico.txt', content: 'cotas' }])
  assert.equal(sent.status, 201)
  const [mail] = fixture.proposalMail
  assert.deepEqual([mail.from, mail.to, mail.cc, mail.bcc], ['comercial@gmacmetalurgica.com.br', ['carla@nestle.com'], ['gerente@nestle.com', 'compras@nestle.com'], 'comercial@gmacmetalurgica.com.br'])
  assert.equal(mail.subject, 'Proposta revisada')
  assert.match(mail.text, /^Segue a proposta\.\n\nAtenciosamente,/)
  assert.deepEqual(mail.attachments.filter((file) => !file.cid).map((file) => file.filename), [proposal.name, 'Desenho técnico.txt'])
  // The signature's logo and icons go inside the e-mail (cid), the Usinagem logo for a proposal it issued.
  assert.deepEqual(mail.attachments.filter((file) => file.cid).map((file) => file.filename), ['gmac-usinagem-logo.jpg', 'icon-email.png', 'icon-whatsapp-small.png', 'icon-site.png', 'icon-instagram.png', 'icon-maps.png', 'icon-whatsapp.png'])
  assert.match(mail.html, /<p style="margin:0 0 12px">Atenciosamente,<\/p><table[\s\S]*src="cid:logo@assinatura\.gmac"/)

  // The offer keeps the e-mail, with the files exactly as they went.
  const [record] = sent.data.item.proposalEmails
  assert.deepEqual([record.subject, record.to, record.attachments.map((file) => [file.name, file.proposal])], ['Proposta revisada', ['carla@nestle.com'], [[proposal.name, true], ['Desenho técnico.txt', false]]])
  const download = await fetch(`${fixture.url}/api/offers/${offer.id}/proposal-emails/${record.id}/files/${record.attachments[1].id}`, { headers: fixture.admin })
  assert.equal(await download.text(), 'cotas')
  const pdf = await fetch(`${fixture.url}/api/offers/${offer.id}/proposal-emails/${record.id}/files/${record.attachments[0].id}`, { headers: fixture.admin })
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF')
})

test('a client or buyer without e-mail is warned about and gets the address typed for it once the e-mail goes out', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const client = (await fixture.adminRequest('/clients', 'POST', { name: 'Vale', documentType: 'cnpj', document: '33.592.510/0001-54' })).data.item
  const buyer = (await fixture.adminRequest('/buyers', 'POST', { name: 'Paulo Lima', clientId: client.id })).data.item
  const offer = await offerWithProposal(fixture, { cnpj: '33.592.510/0001-54', company: 'Vale', buyer: 'Paulo Lima' })
  await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })

  const opened = (await fixture.adminRequest(`/offers/${offer.id}/proposal-email`)).data
  assert.deepEqual(opened.draft.to, [])
  assert.deepEqual(opened.contacts, { client: { id: client.id, name: 'Vale', email: '' }, buyer: { id: buyer.id, name: 'Paulo Lima', email: '' } })

  // An address that is not among the recipients is not registered; a failed e-mail registers nothing.
  fixture.failNextMail()
  assert.equal((await send(fixture, offer.id, { ...opened.draft, to: ['Compras@Vale.com', 'paulo@vale.com'], register: { client: 'compras@vale.com', buyer: 'paulo@vale.com' } })).status, 502)
  const sent = await send(fixture, offer.id, { ...opened.draft, to: ['Compras@Vale.com', 'paulo@vale.com'], register: { client: 'compras@vale.com', buyer: 'paulo@vale.com' } })
  assert.equal(sent.status, 201)
  assert.deepEqual(sent.data.registered, [{ kind: 'client', name: 'Vale', email: 'compras@vale.com' }, { kind: 'buyer', name: 'Paulo Lima', email: 'paulo@vale.com' }])

  // The next e-mail comes filled; a registered address is never replaced.
  const next = (await fixture.adminRequest(`/offers/${offer.id}/proposal-email`)).data
  assert.deepEqual(next.draft.to, ['compras@vale.com', 'paulo@vale.com'])
  const again = await send(fixture, offer.id, { ...next.draft, to: ['outro@vale.com'], register: { client: 'outro@vale.com', buyer: 'outro@vale.com' } })
  assert.deepEqual(again.data.registered, [])
  assert.equal((await fixture.adminRequest('/clients')).data.items.find((item) => item.id === client.id).email, 'compras@vale.com')
})
