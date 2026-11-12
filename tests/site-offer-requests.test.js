import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { createWorkflowFixture } from './workflowFixture.js'

// Formulário público Ofertar Serviço do site (server/offerRequests.js), montado no fixture como no portal
// (/gmac/api/offer-requests), com captcha, Receita e e-mail simulados: nenhum teste acessa a rede.
const origin = 'https://gmacmetalurgica.com.br'

// CPFs e CNPJs com dígitos verificadores corretos, gerados como a Receita calcula.
const checkDigit = (digits, weights) => { const sum = weights.reduce((total, weight, index) => total + weight * Number(digits[index]), 0); const rest = sum % 11; return rest < 2 ? 0 : 11 - rest }
const cnpjOf = (root, branch = '0001') => { let digits = root + branch; digits += checkDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return digits + checkDigit(digits + '', [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) }
const cpfOf = (nine) => { let digits = nine; digits += checkDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]); return digits + checkDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) }

const futureDay = () => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
const draft = (overrides = {}) => ({
  requestId: randomUUID(),
  turnstileToken: 'token-de-teste',
  document: cnpjOf('12345678'),
  company: 'Metalúrgica Exemplo',
  service: 'Peça de teste',
  deadline: futureDay(),
  quantity: 3,
  description: 'Peça conforme desenho',
  email: 'cliente@example.com',
  consent: { accepted: true, policyVersion: '2026-11-11' },
  files: [],
  ...overrides,
})

function helpers(fixture) {
  const base = `${fixture.url}/gmac/api/offer-requests`
  const parse = async (response) => ({ status: response.status, data: await response.json().catch(() => null), headers: response.headers })
  return {
    base,
    post: (body, headers = {}) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', origin, ...headers }, body: JSON.stringify(body) }).then(parse),
    put: (ticket, fileId, body, contentType = 'application/octet-stream') => fetch(`${base}/${ticket}/files/${fileId}`, { method: 'PUT', headers: { 'Content-Type': contentType, origin }, body }).then(parse),
    complete: (ticket) => fetch(`${base}/${ticket}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin }, body: '{}' }).then(parse),
    // Um envio completo, pronto para as verificações do portal. Devolve a oferta criada.
    async submit(overrides = {}, content = 'arquivo de teste') {
      const body = draft({ files: [{ name: 'desenho.pdf', size: Buffer.byteLength(content) }], ...overrides })
      const created = await this.post(body)
      assert.equal(created.status, 201, created.data?.error)
      for (const file of created.data.files) assert.equal((await this.put(created.data.ticket, file.fileId, content)).status, 200)
      const done = await this.complete(created.data.ticket)
      assert.deepEqual([done.status, done.data], [200, { ok: true }])
      const offer = (await fixture.adminRequest('/offers')).data.items.find((item) => item.siteRequest?.requestId === body.requestId)
      assert.ok(offer, 'oferta criada pelo site')
      return { ticket: created.data.ticket, offer, done }
    },
  }
}

test('Ofertar Serviço do site: origem, captcha, validações e anexos', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const site = helpers(fixture)

  await t.test('só as origens da GMAC, com preflight e contrato de CORS', async () => {
    const preflight = await fetch(site.base, { method: 'OPTIONS', headers: { origin } })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, PUT, OPTIONS')
    assert.equal((await fetch(site.base, { method: 'OPTIONS', headers: { origin: 'https://outro.example' } })).status, 403)
    assert.equal((await site.post(draft(), { origin: 'https://outro.example' })).status, 403)
  })

  await t.test('sem TURNSTILE_SECRET_KEY responde indisponível (503); com captcha inválido, 400', async () => {
    const secret = fixture.siteOffers.env.TURNSTILE_SECRET_KEY
    delete fixture.siteOffers.env.TURNSTILE_SECRET_KEY
    const unavailable = await site.post(draft())
    assert.equal(unavailable.status, 503)
    assert.match(unavailable.data.error, /indisponível/)
    fixture.siteOffers.env.TURNSTILE_SECRET_KEY = secret
    fixture.siteOffers.turnstile = { ok: false }
    const refused = await site.post(draft())
    assert.deepEqual([refused.status, refused.data.field], [400, 'turnstileToken'])
    fixture.siteOffers.turnstile = { ok: true }
  })

  await t.test('validações: documento, contato, prazo e aceite', async () => {
    const bad = async (overrides, field) => {
      const response = await site.post(draft(overrides))
      assert.equal(response.status, 400, JSON.stringify(response.data))
      assert.equal(response.data.field, field)
    }
    await bad({ document: '12.345.678/0001-91' }, 'document') // dígito verificador errado
    await bad({ document: '11.111.111/1111-11' }, 'document') // todos os dígitos iguais
    await bad({ email: '', whatsapp: '' }, 'email') // nenhum contato
    await bad({ deadline: '2020-01-01' }, 'deadline') // prazo no passado
    await bad({ consent: { accepted: false, policyVersion: '2026-11-11' } }, 'consent')
    // Só WhatsApp é contato suficiente; CPF válido é aceito.
    assert.equal((await site.post(draft({ email: '', whatsapp: '(75) 99999-0000' }))).status, 201)
    assert.equal((await site.post(draft({ document: cpfOf('529982247'), company: 'Pessoa Física' }))).status, 201)
  })

  await t.test('anexos: executável, quantidade, soma e tamanho diferente do declarado', async () => {
    const refusedExe = await site.post(draft({ files: [{ name: 'desenho.pdf.exe', size: 10 }] }))
    assert.deepEqual([refusedExe.status, refusedExe.data.field], [400, 'files'])
    const tooMany = await site.post(draft({ files: Array.from({ length: 11 }, (_, index) => ({ name: `arquivo-${index}.pdf`, size: 10 })) }))
    assert.equal(tooMany.status, 400)
    const tooBig = await site.post(draft({ files: [{ name: 'a.step', size: 300 * 1024 * 1024 }, { name: 'b.step', size: 200 * 1024 * 1024 }] }))
    assert.equal(tooBig.status, 413)
    // Tamanho diferente do declarado é recusado; o reenvio com o tamanho certo substitui.
    const created = await site.post(draft({ files: [{ name: 'desenho.pdf', size: 7 }] }))
    assert.equal(created.status, 201)
    const { ticket, files } = created.data
    assert.equal((await site.put(ticket, files[0].fileId, 'conteúdo maior que o declarado')).status, 400)
    assert.equal((await site.put(ticket, files[0].fileId, 'arquivo', 'text/plain')).status, 415)
    const pending = await site.complete(ticket)
    assert.equal(pending.status, 409)
    assert.deepEqual(pending.data.missing, [files[0].fileId])
    assert.equal((await site.put(ticket, files[0].fileId, 'arquivo')).status, 200)
    assert.deepEqual((await site.complete(ticket)).data, { ok: true })
  })

  await t.test('mesmo requestId devolve o mesmo ticket; etapa 3 repetida não duplica a oferta', async () => {
    const requestId = randomUUID()
    const document = cnpjOf('22333444')
    const first = await site.post(draft({ requestId, document }))
    const again = await site.post(draft({ requestId, document }))
    assert.equal(first.data.ticket, again.data.ticket)
    const before = (await fixture.adminRequest('/offers')).data.items.length
    assert.deepEqual((await site.complete(first.data.ticket)).data, { ok: true })
    assert.deepEqual((await site.complete(first.data.ticket)).data, { ok: true })
    const offers = (await fixture.adminRequest('/offers')).data.items
    assert.equal(offers.length, before + 1)
    const offer = offers.find((item) => item.siteRequest?.requestId === requestId)
    assert.equal(offer.origin, 'Site')
    assert.equal(offer.status, 'creating')
    assert.equal(offer.createdByName, 'Site')
    assert.equal(offer.createdBy, null)
    assert.equal(offer.editingBy, undefined)
    assert.match(offer.code, /^OF-\d{4}-\d{4}$/)
    assert.match(offer.notes, /E-mail informado: cliente@example\.com/)
    assert.match(offer.notes, /Pré-cadastro criado pelo site\./)
    assert.deepEqual(offer.siteContact, { email: 'cliente@example.com', whatsapp: '' })
    assert.equal(offer.consent.policyVersion, '2026-11-11')
    // O comercial foi avisado por e-mail (sem anexos) e pelo sino.
    const mail = fixture.siteOffers.mail.find((message) => message.subject.includes(offer.code))
    assert.equal(mail.to, 'comercial@gmacmetalurgica.com.br')
    assert.equal(mail.attachments, undefined)
    const { items } = (await fixture.adminRequest('/notifications')).data
    assert.ok(items.some((item) => item.type === 'site-offer' && item.description.includes(offer.code)))
  })
})

test('Ofertar Serviço do site: cliente, Receita, pré-cadastro e ações no portal', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const site = helpers(fixture)

  await t.test('CNPJ cadastrado usa o nome do portal, não cria pré-cadastro e responde igual', async () => {
    const document = cnpjOf('44555666')
    await fixture.adminRequest('/clients', 'POST', { name: 'Cliente Antigo Ltda', documentType: 'cnpj', document })
    fixture.siteOffers.receita = { status: 'found', name: 'Outro Nome Na Receita' }
    const clientsBefore = (await fixture.adminRequest('/clients')).data.items.length
    const registered = await site.submit({ requestId: randomUUID(), document })
    assert.equal(registered.offer.company, 'Cliente Antigo Ltda')
    assert.equal(registered.offer.siteRequest.preRegisteredClientId, null)
    assert.equal((await fixture.adminRequest('/clients')).data.items.length, clientsBefore)
    // A resposta da etapa 3 é idêntica para cliente cadastrado e novo.
    const fresh = await site.submit({ requestId: randomUUID(), document: cnpjOf('44555777') })
    assert.deepEqual(registered.done.data, fresh.done.data)
  })

  await t.test('CNPJ novo cria pré-cadastro com a razão social e o evento no histórico', async () => {
    const document = cnpjOf('55666777')
    fixture.siteOffers.receita = { status: 'found', name: 'Nova Empresa de Usinagem Ltda' }
    const { offer } = await site.submit({ requestId: randomUUID(), document })
    assert.equal(offer.company, 'NOVA EMPRESA DE USINAGEM LTDA')
    const client = (await fixture.adminRequest('/clients')).data.items.find((item) => item.document === document)
    assert.equal(client.name, 'NOVA EMPRESA DE USINAGEM LTDA')
    assert.equal(client.preRegistered, true)
    assert.equal(client.email ?? null, null)
    const history = (await fixture.adminRequest(`/registry-history/clients/${client.id}`)).data.items
    assert.equal(history.length, 1)
    assert.equal(history[0].type, 'created')
    assert.equal(history[0].userName, 'Site')
    assert.match(history[0].note, new RegExp(`Ofertar Serviço do site \\(oferta ${offer.code}\\)`))
    // Salvar o cadastro tira a etiqueta de pré-cadastro.
    await fixture.adminRequest(`/clients/${client.id}`, 'PUT', { name: 'Nova Empresa de Usinagem Ltda', documentType: 'cnpj', document })
    const saved = (await fixture.adminRequest('/clients')).data.items.find((item) => item.document === document)
    assert.equal(saved.preRegistered, undefined)
  })

  await t.test('Receita 404 usa o nome digitado com aviso; Receita fora do ar usa o digitado', async () => {
    fixture.siteOffers.receita = { status: 'not-found' }
    const notFound = await site.submit({ requestId: randomUUID(), document: cnpjOf('66777888'), company: 'Nome Digitado' })
    assert.equal(notFound.offer.company, 'NOME DIGITADO')
    assert.match(notFound.offer.notes, /CNPJ não encontrado na Receita; nome informado pelo cliente\./)
    fixture.siteOffers.receita = { status: 'unavailable' }
    const offline = await site.submit({ requestId: randomUUID(), document: cnpjOf('66777999'), company: 'Digitado Sem Receita' })
    assert.equal(offline.offer.company, 'DIGITADO SEM RECEITA')
    assert.doesNotMatch(offline.offer.notes, /não encontrado na Receita/)
  })

  await t.test('possível filial: a raiz do CNPJ bate com um cliente cadastrado', async () => {
    const root = '77888999'
    await fixture.adminRequest('/clients', 'POST', { name: 'Matriz Cadastrada SA', documentType: 'cnpj', document: cnpjOf(root, '0001') })
    fixture.siteOffers.receita = { status: 'not-found' }
    const { offer } = await site.submit({ requestId: randomUUID(), document: cnpjOf(root, '0002') })
    assert.match(offer.notes, /Possível filial de Matriz Cadastrada SA \(CNPJ 77\.888\.999\/0001-\d{2}\)\./)
  })

  await t.test('e-mail falhando não impede a oferta', async () => {
    fixture.siteOffers.failNextMail = true
    const mails = fixture.siteOffers.mail.length
    const { offer } = await site.submit({ requestId: randomUUID(), document: cnpjOf('88999000') })
    assert.equal(offer.origin, 'Site')
    assert.equal(fixture.siteOffers.mail.length, mails)
  })

  await t.test('recusar vale para oferta do site em criação; a manual em criação continua bloqueada', async () => {
    const { offer } = await site.submit({ requestId: randomUUID(), document: cnpjOf('90111222') })
    const rejected = await fixture.adminRequest(`/offers/${offer.id}/reject`, 'POST', {})
    assert.equal(rejected.status, 200)
    assert.equal(rejected.data.item.status, 'rejected')
    fixture.finishCreatedOffers = false
    const manual = await fixture.adminRequest('/offers', 'POST', { cnpj: cnpjOf('90111333'), company: 'Manual em criação', deadline: futureDay(), service: 'Peça', quantity: 1, description: 'Teste' })
    fixture.finishCreatedOffers = true
    assert.equal((await fixture.adminRequest(`/offers/${manual.data.item.id}/reject`, 'POST', {})).status, 409)
  })

  await t.test('a Observação é editada com as informações do serviço, sem descartar nada', async () => {
    const { offer } = await site.submit({ requestId: randomUUID(), document: cnpjOf('91222333') })
    const body = { cnpj: offer.cnpj, company: offer.company, requester: '', buyer: '', service: offer.service, labelNumber: '', deadline: offer.deadline, quantity: offer.quantity, requestedAt: offer.requestedAt.slice(0, 10), notes: 'Cliente prefere contato pelo WhatsApp.' }
    const saved = await fixture.adminRequest(`/offers/${offer.id}`, 'PUT', body)
    assert.equal(saved.status, 200)
    assert.equal(saved.data.item.notes, 'Cliente prefere contato pelo WhatsApp.')
    assert.equal(saved.data.proposalDiscarded, false)
  })

  await t.test('descartar apaga o pré-cadastro intocado e registra no histórico', async () => {
    const document = cnpjOf('92333444')
    const { offer } = await site.submit({ requestId: randomUUID(), document })
    const clientId = offer.siteRequest.preRegisteredClientId
    assert.ok(clientId != null)
    assert.equal((await fixture.adminRequest(`/offers/${offer.id}`, 'DELETE')).status, 204)
    assert.equal((await fixture.adminRequest('/clients')).data.items.some((item) => item.document === document), false)
    const history = (await fixture.adminRequest(`/registry-history/clients/${clientId}`)).data.items
    assert.ok(history.some((event) => event.type === 'deleted' && /descartar a oferta/.test(event.note)))
  })

  await t.test('descartar mantém o pré-cadastro editado e o que tem outra oferta', async () => {
    // Editado depois: o cliente fica.
    const edited = cnpjOf('93444555')
    const first = await site.submit({ requestId: randomUUID(), document: edited })
    const clientId = first.offer.siteRequest.preRegisteredClientId
    await fixture.adminRequest(`/clients/${clientId}`, 'PUT', { name: 'Nome Revisado Pela GMAC', documentType: 'cnpj', document: edited })
    assert.equal((await fixture.adminRequest(`/offers/${first.offer.id}`, 'DELETE')).status, 204)
    assert.ok((await fixture.adminRequest('/clients')).data.items.some((item) => item.document === edited))
    // Outra oferta com o mesmo documento: o cliente fica.
    const shared = cnpjOf('94555666')
    const one = await site.submit({ requestId: randomUUID(), document: shared })
    await site.submit({ requestId: randomUUID(), document: shared })
    assert.equal((await fixture.adminRequest(`/offers/${one.offer.id}`, 'DELETE')).status, 204)
    assert.ok((await fixture.adminRequest('/clients')).data.items.some((item) => item.document === shared))
  })

  await t.test('o e-mail do site entra como destinatário sugerido da proposta', async () => {
    const { serverModule } = fixture
    const { proposalEmailDraft } = await serverModule('proposalEmails.js')
    const draftEmail = proposalEmailDraft({ store: { buyers: [] }, offer: { code: 'OF-2026-0001', service: 'Peça', quantity: 1, company: 'X', proposal: {}, siteContact: { email: 'cliente@example.com' } }, client: null, senderName: 'GMAC', from: 'comercial@gmacmetalurgica.com.br' })
    assert.deepEqual(draftEmail.to, ['cliente@example.com'])
  })
})

test('Ofertar Serviço do site: expiração e limite de tentativas por IP', async (t) => {
  const fixture = await createWorkflowFixture({ siteOffers: { rateLimitMax: 3, expiryMs: 80 } })
  t.after(() => fixture.close())
  const site = helpers(fixture)
  const requestId = randomUUID()
  const created = await site.post(draft({ requestId, files: [{ name: 'desenho.pdf', size: 7 }] }))
  assert.equal(created.status, 201)
  await new Promise((resolve) => setTimeout(resolve, 150))
  // Envio expirado: as rotas respondem 404 e a limpeza apaga a pasta com os arquivos.
  assert.equal((await site.put(created.data.ticket, created.data.files[0].fileId, 'arquivo')).status, 404)
  await fixture.siteOffers.router.sweepNow()
  const remaining = await readdir(path.join(fixture.directory, 'data', 'offer-requests')).catch(() => [])
  assert.deepEqual(remaining, [])
  // O mesmo requestId, depois de expirar, começa um envio novo; o limite de tentativas continua valendo.
  const second = await site.post(draft({ requestId }))
  assert.equal(second.status, 201)
  assert.notEqual(second.data.ticket, created.data.ticket)
  assert.equal((await site.post(draft())).status, 201)
  assert.equal((await site.post(draft())).status, 429)
})
