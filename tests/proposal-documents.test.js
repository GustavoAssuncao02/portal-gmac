import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { moneyInWords } from '../server/moneyWords.js'
import { matchRow } from '../server/proposalDocuments.js'
import { etiquetaLabor, etiquetaMaterials, nestleLabor, nestleMaterials } from '../server/proposalDefaults.js'
import { syncFiscalCatalog, searchFiscal, nextWeeklyRun, normalizeNbs, readFiscalCatalog, fiscalSources } from '../server/fiscalCatalog.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }

test('values in words match the commercial proposals', () => {
  assert.equal(moneyInWords(22698.31), 'vinte e dois mil seiscentos e noventa e oito reais e trinta e um centavos')
  assert.equal(moneyInWords(199453), 'cento e noventa e nove mil quatrocentos e cinquenta e três reais')
  assert.equal(moneyInWords(1100), 'mil e cem reais')
  assert.equal(moneyInWords(2000000), 'dois milhões de reais')
  assert.equal(moneyInWords(0.01), 'um centavo')
})

test('system machines, services and materials are matched to the price list lines', () => {
  assert.equal(matchRow('Torno CNC 01 · Tornearia', etiquetaLabor), 'et-l4')
  assert.equal(matchRow('Fresadora', etiquetaLabor), 'et-l2')
  assert.equal(matchRow('Solda TIG', etiquetaLabor), 'et-l9')
  assert.equal(matchRow('Aço SAE 1020 redondo 2"', etiquetaMaterials), 'et-m4')
  assert.equal(matchRow('Aço inox 304', etiquetaMaterials), 'et-m1')
  assert.equal(matchRow('Aço SAE 1050', etiquetaMaterials), null, 'A grade not in the list is never guessed')
  assert.equal(matchRow('Centro de usinagem 5 eixos', nestleLabor), 'fs-l11')
  assert.equal(matchRow('Nylon tarugo', nestleMaterials), 'fs-m21')
  assert.equal(matchRow('Prensa hidráulica', etiquetaLabor, { 'prensa hidraulica': 'et-l11' }), 'et-l11', 'Assignments made by the user are remembered')
})

test('weekly fiscal catalog: Sunday midnight in Bahia, failures keep the previous lists', async () => {
  assert.equal(new Date(nextWeeklyRun(Date.parse('2026-10-08T22:00:00Z'))).toISOString(), '2026-10-11T03:00:00.000Z')
  assert.equal(new Date(nextWeeklyRun(Date.parse('2026-10-11T03:00:00Z'))).toISOString(), '2026-10-18T03:00:00.000Z')
  const nbs = normalizeNbs(Buffer.from(['NBS 2.0;DESCRIÇÃO', '1.20;Serviços de manutenção', '1.2001;Serviços de manutenção e reparação de produtos metálicos', ...Array.from({ length: 600 }, (_, index) => `1.2001.${String(index).padStart(4, '0').slice(0, 2)}.${String(index % 100).padStart(2, '0')};Serviço ${index}`)].join('\r\n'), 'latin1'))
  assert.equal(nbs.length, 600)
  assert.equal(nbs[0].group, 'Serviços de manutenção e reparação de produtos metálicos')
})

test('proposal models: drafts from the system, fiscal codes, Nestlé and etiqueta sheets and the receivable value', async () => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const headers = { Authorization: `Bearer ${token}` }
    const request = (route, method, body) => f.request(route, method, body, headers)

    // Fiscal catalog synchronized from (simulated) official sources; a failing source keeps the previous data.
    const catalogPath = path.join(f.directory, 'data', 'fiscal-catalog.json')
    await mkdir(path.dirname(catalogPath), { recursive: true })
    const { syncFiscalCatalog: sync, readFiscalCatalog: read } = await import(new URL(`file:///${path.join(f.directory, 'fiscalCatalog.js').replace(/\\/g, '/')}`))
    const cnaeList = Array.from({ length: 1100 }, (_, index) => ({ id: String(1000000 + index), descricao: `ATIVIDADE ${index}`, classe: { descricao: 'CLASSE' } }))
    cnaeList.push({ id: '2539001', descricao: 'SERVIÇOS DE USINAGEM, TORNEARIA E SOLDA', classe: { descricao: 'SERVIÇOS DE USINAGEM, SOLDA, TRATAMENTO E REVESTIMENTO EM METAIS' } }, { id: '3321000', descricao: 'INSTALAÇÃO DE MÁQUINAS E EQUIPAMENTOS INDUSTRIAIS', classe: {} })
    const ncmList = Array.from({ length: 6000 }, (_, index) => ({ codigo: `${String(7000 + Math.floor(index / 10)).padStart(4, '0')}.${String(index % 10).padStart(2, '0')}.00`, descricao: `- Item ${index}` }))
    const nbsCsv = Buffer.from(['NBS 2.0;DESCRIÇÃO', '1.2001;Serviços de manutenção e reparação de produtos metálicos, maquinários e equipamentos', '1.2001.50.00;Serviços de manutenção e reparação de maquinários e equipamentos de uso industrial', ...Array.from({ length: 600 }, (_, index) => `1.30${String(index).padStart(2, '0').slice(0, 2)}.${String(index % 100).padStart(2, '0')}.00;Serviço ${index}`)].join('\r\n'), 'latin1')
    const company = (cnpj) => ({ razao_social: 'GMAC', estabelecimento: { nome_fantasia: 'GMAC', atividade_principal: { subclasse: '2512-8/00', descricao: 'Fabricação de esquadrias de metal' }, atividades_secundarias: [{ subclasse: '2539-0/01', descricao: 'Serviços de usinagem, torneiria e solda' }, { subclasse: '3321-0/00', descricao: 'Instalação de máquinas e equipamentos industriais' }] }, cnpj })
    const fetcher = async (url) => {
      if (url === fiscalSources.cnae) return { status: 200, body: Buffer.from(JSON.stringify(cnaeList)) }
      if (url === fiscalSources.ncm) return { status: 200, body: Buffer.from(JSON.stringify(ncmList)) }
      if (url === fiscalSources.nbs) return { status: 200, body: nbsCsv }
      if (url.includes('brasilapi.com.br/api/cnpj')) return { status: 500, body: Buffer.from('{}') }
      if (url.includes('publica.cnpj.ws')) return { status: 200, body: Buffer.from(JSON.stringify(company(url.slice(-14)))) }
      return { status: 404, body: Buffer.from('') }
    }
    const status = await sync({ fetcher })
    assert.deepEqual([status.counts.cnae, status.counts.nbs], [1102, 601])
    assert.ok(status.counts.ncm > 0)
    assert.ok(status.sources.every((source) => !source.error), 'The CNPJ lookup falls back to the second source')
    const failing = await sync({ fetcher: async (url) => url === fiscalSources.nbs ? { status: 503, body: Buffer.from('') } : fetcher(url) })
    assert.equal(failing.counts.nbs, 601, 'NBS kept after a failed download')
    assert.match(failing.sources.find((source) => source.key === 'nbs').error, /503/)
    const search = (await request('/fiscal/search?kind=cnae&q=&cnpj=33963385000141')).data.items
    assert.deepEqual(search.map((row) => row.code), ['2512-8/00', '2539-0/01', '3321-0/00'], 'Without a search, the issuer activities are offered')
    assert.equal((await request('/fiscal/search?kind=nbs&q=manutencao industrial')).data.items[0].code, '1.2001.50.00')
    assert.equal((await f.request('/fiscal/sync', 'POST', {})).status, 401, 'Manual sync is reserved to administrators')

    // An offer with planned resources.
    const offer = (await f.adminRequest('/offers', 'POST', { ...offerDraft, company: 'Nestlé Brasil Ltda', service: 'Tampa graxadeira', description: 'Fabricação de 20 unidades, conforme amostra', quantity: 20, labelNumber: '5319' })).data.item
    await f.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'm1', name: 'Aço SAE 1020', detail: 'redondo 2"', quantity: 4, unitPrice: 10 }], laborEntries: [{ id: 'l1', type: 'machine', resource: 'Torno CNC 01', hours: 25, hourlyRate: 120 }, { id: 'l2', type: 'labor', resource: 'Ajustagem', hours: 2, hourlyRate: 50 }], stages: ['machining'] })

    // Etiqueta: every line of the price list, quantities from the system, unmatched resources left for the user.
    const etiqueta = (await request(`/offers/${offer.id}/proposal-draft?model=etiqueta`)).data.draft
    assert.equal(etiqueta.labor.length, 18); assert.equal(etiqueta.materials.length, 28)
    assert.equal(etiqueta.labor.find((row) => row.id === 'et-l4').quantity, 25)
    assert.equal(etiqueta.materials.find((row) => row.id === 'et-m4').quantity, 4)
    assert.deepEqual(etiqueta.usage.map((item) => [item.name, item.rowId]), [['Torno CNC 01', 'et-l4'], ['Ajustagem', null], ['Aço SAE 1020 redondo 2"', 'et-m4']])
    assert.deepEqual([etiqueta.labelNumber, etiqueta.componentName, etiqueta.issuerId], ['5319', 'Tampa graxadeira', 'usinagem'])
    const labor = etiqueta.labor.map((row) => row.id === 'et-l11' ? { ...row, quantity: 2 } : row)
    const saved = await f.adminRequest(`/offers/${offer.id}/proposal-document`, 'POST', { model: 'etiqueta', document: { ...etiqueta, labor, requester: 'Joaci', freight: { place: 'BBA FAI', charge: true } }, assignments: [{ name: 'Ajustagem', rowId: 'et-l11' }], option: { key: 'B', deadline: '10 dias' } })
    assert.equal(saved.status, 200, JSON.stringify(saved.data))
    const document = saved.data.item.proposal.document
    assert.equal(document.total, 25 * 206.8 + 2 * 90 + 4 * 22.97 + 200)
    // The OS value is the total of the document; the service value is the cost of the planned resources (R$ 40 of material
    // and R$ 3.100 of labor), and the hours of the machine and of the labor are kept apart.
    const proposal = saved.data.item.proposal
    assert.deepEqual([saved.data.item.status, proposal.layout, proposal.osValue, proposal.serviceValue, proposal.materials, proposal.labor], ['proposed', 'etiqueta', document.total, 3140, 40, 3100])
    assert.deepEqual([proposal.machine, proposal.serviceTime, proposal.totalTime, proposal.profit], ['25 horas', '2 horas', '27 horas', Math.round((document.total - 3140) * 100) / 100])
    const pdf = await fetch(`${f.url}/api/offers/${offer.id}/proposal.pdf`, { headers: f.admin })
    assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-disposition'), /Etiqueta-5319\.pdf/)
    assert.equal((await pdf.arrayBuffer()).byteLength > 5000, true)
    assert.equal((await request(`/offers/${offer.id}/proposal-draft?model=etiqueta&fresh=1`)).data.draft.usage.find((item) => item.name === 'Ajustagem').rowId, 'et-l11', 'The assignment was learned')
    const reopened = (await request(`/offers/${offer.id}/proposal-draft?model=etiqueta`)).data.draft
    assert.equal(reopened.labor.find((row) => row.id === 'et-l11').quantity, 2, 'Reopening shows the saved document')
    assert.equal((await f.adminRequest(`/offers/${offer.id}/proposal-document`, 'POST', { model: 'etiqueta', document: { ...etiqueta, labor: etiqueta.labor.map((row) => ({ ...row, quantity: 0 })), materials: [] } })).status, 400, 'An empty sheet is refused')
    assert.equal((await f.adminRequest(`/offers/${offer.id}/proposal-document`, 'POST', { model: 'etiqueta', document: { ...etiqueta, labor: [{ id: 'invented', quantity: 1 }] } })).status, 409)

    // Model A: fiscal codes are mandatory; the quotation number follows the last one.
    const letter = (await request(`/offers/${offer.id}/proposal-draft?model=model-a&value=5170&deadline=15 dias`)).data.draft
    assert.deepEqual([letter.quoteNumber, letter.customer, letter.items[0].unitPrice * letter.items[0].quantity, letter.deliveryTerm, letter.fiscal.cnae[0].code], ['13483', 'Nestlé Brasil Ltda', 5170, '15 dias', '2539-0/01'])
    const withoutCodes = await f.adminRequest(`/offers/${offer.id}/proposal-document`, 'POST', { model: 'model-a', document: { ...letter, fiscal: { cnae: letter.fiscal.cnae } } })
    assert.equal(withoutCodes.status, 400); assert.match(withoutCodes.data.message, /NBS/)
    assert.equal((await f.adminRequest(`/offers/${offer.id}/proposal-document`, 'POST', { model: 'model-a', document: { ...letter, items: [{ ...letter.items[0], unit: 'H/h' }], fiscal: { ...letter.fiscal, nbs: { code: '1.2001.50.00' } } } })).status, 400, 'Units are unit or kg')
    assert.equal((await f.adminRequest(`/offers/${offer.id}/proposal-document`, 'POST', { model: 'model-a', document: { ...letter, items: [...letter.items, letter.items[0]], fiscal: { ...letter.fiscal, nbs: { code: '1.2001.50.00' } } } })).status, 400, 'Model A has a single composition line')
    const proposalA = await f.adminRequest(`/offers/${offer.id}/proposal-document`, 'POST', { model: 'model-a', document: { ...letter, requester: 'Karoline', fiscal: { ...letter.fiscal, nbs: { code: '1.2001.50.00' } } } })
    assert.equal(proposalA.status, 200, JSON.stringify(proposalA.data))
    assert.deepEqual([proposalA.data.item.proposal.document.fiscal.nbs[0].description, proposalA.data.item.proposal.document.fiscal.cnae[0].registered], ['Serviços de manutenção e reparação de maquinários e equipamentos de uso industrial', true])
    // A contract may have several CNAE codes: the order is kept (the first is the main one) and repeated codes are dropped.
    const several = await f.adminRequest(`/offers/${offer.id}/proposal-document`, 'POST', { model: 'model-a', document: { ...letter, requester: 'Karoline', fiscal: { cnae: [{ code: '3314-7/10' }, letter.fiscal.cnae[0], { code: '3314-7/10' }], nbs: [{ code: '1.2001.50.00' }], ncm: [] } } })
    assert.equal(several.status, 200, JSON.stringify(several.data))
    assert.deepEqual(several.data.item.proposal.document.fiscal.cnae.map((entry) => entry.code), ['3314-7/10', letter.fiscal.cnae[0].code])
    const severalPdf = await fetch(`${f.url}/api/offers/${offer.id}/proposal.pdf`, { headers: f.admin })
    assert.equal(severalPdf.status, 200)
    assert.equal(Buffer.from(await severalPdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF')
    const modelB = (await request(`/offers/${offer.id}/proposal-draft?model=model-b`)).data.draft
    assert.deepEqual([modelB.quoteNumber, modelB.customerDocument], ['13484', '12.345.678/0001-90'])
    // Model B: items grouped for subtotals.
    const grouped = await request(`/offers/${offer.id}/proposal-document`, 'POST', { model: 'model-b', document: { ...modelB, fiscal: { ...modelB.fiscal, nbs: { code: '1.2001.50.00' } }, items: [{ description: 'Fundação', quantity: 1, unit: 'Un', unitPrice: 1000, group: 'Obra civil' }, { description: 'Parede', quantity: 1, unit: 'Un', unitPrice: 500, group: 'Obra civil' }, { description: 'Cobertura', quantity: 1, unit: 'Un', unitPrice: 800, group: 'Estrutura metálica' }] } })
    assert.equal(grouped.status, 200, JSON.stringify(grouped.data))
    assert.deepEqual([grouped.data.item.proposal.document.items.map((item) => item.group), grouped.data.item.proposal.document.total, grouped.data.item.proposal.document.customerDocument], [['Obra civil', 'Obra civil', 'Estrutura metálica'], 2300, '12.345.678/0001-90'])
    assert.equal((await fetch(`${f.url}/api/offers/${offer.id}/proposal.pdf`, { headers: f.admin })).status, 200)
    // Technician: the company's by default, changeable in each proposal.
    assert.deepEqual(letter.technician, { name: 'José Jossenilson F. Gomes', registry: 'CREA – 53865', phone: '(75) 99933-5645' })
    const restored = await request(`/offers/${offer.id}/proposal-document`, 'POST', { model: 'model-a', document: { ...letter, requester: 'Karoline', technician: { name: 'Maria Souza', registry: 'CREA – 99999', phone: '(75) 98888-7777' }, fiscal: { ...letter.fiscal, nbs: { code: '1.2001.50.00' } } } })
    assert.equal(restored.status, 200)
    assert.deepEqual(restored.data.item.proposal.document.technician, { name: 'Maria Souza', registry: 'CREA – 99999', phone: '(75) 98888-7777' })
    assert.equal((await request(`/offers/${offer.id}/proposal-draft?model=model-a`)).data.draft.technician.name, 'Maria Souza', 'Reopening keeps the chosen technician')
    assert.equal((await request(`/offers/${offer.id}/proposal-draft?model=model-a&fresh=1`)).data.draft.technician.name, 'José Jossenilson F. Gomes')
    const letterPdf = await fetch(`${f.url}/api/offers/${offer.id}/proposal.pdf`, { headers: f.admin })
    assert.match(letterPdf.headers.get('content-disposition'), /Proposta-13483\.pdf/)
    assert.ok(Buffer.from(await letterPdf.arrayBuffer()).toString('latin1').includes('https://wa.me/557536166626?text=Ol%C3%A1%2C%20GMAC!%20Gostaria%20de%20falar%20sobre%20a%20cota%C3%A7%C3%A3o%20n%C2%BA%2013483'), 'Footer WhatsApp link with the quotation')

    // Settings: price lists are edited by administrators only and drive the next documents.
    const settings = (await request('/proposal-settings')).data.settings
    assert.equal(settings.tables.nestle.labor[0].sap, '104200387')
    const changed = structuredClone(settings.tables)
    changed.etiqueta.labor[3].normal = 210
    assert.equal((await f.request('/proposal-settings', 'PUT', { tables: changed })).status, 401)
    assert.equal((await request('/proposal-settings', 'PUT', { tables: { ...changed, nestle: { ...changed.nestle, labor: [{ id: 'x', description: '', unit: 'H', normal: 1 }] } } })).status, 400)
    assert.equal((await request('/proposal-settings', 'PUT', { tables: changed })).status, 200)

    // Nestlé FS-3055 from the planned resources; once accepted, the receivable of the OS suggests the sheet total.
    const talisca = (await f.adminRequest('/offers', 'POST', { ...offerDraft, company: 'Nestlé Brasil Ltda', service: 'Talisca', description: 'Fabricação de talisca lado direito e lado esquerdo, conforme desenho', quantity: 1, labelNumber: '2022906' })).data.item
    await f.adminRequest(`/offers/${talisca.id}/resources`, 'PUT', { materials: [{ id: 'm', name: 'Aço Inox 316L', quantity: 4, unitPrice: 30 }], laborEntries: [{ id: 'a', type: 'machine', resource: 'Centro de usinagem 5 eixos', hours: 5, hourlyRate: 100 }, { id: 'b', type: 'labor', resource: 'Caldeiraria', hours: 3, hourlyRate: 50 }], stages: ['machining'] })
    const nestle = (await request(`/offers/${talisca.id}/proposal-draft?model=nestle`)).data.draft
    assert.deepEqual([nestle.issuerId, nestle.number, nestle.labor.find((row) => row.id === 'fs-l11').quantity, nestle.labor.find((row) => row.id === 'fs-l14').quantity, nestle.materials.find((row) => row.id === 'fs-m2').quantity], ['metalurgica', '2022906', 5, 3, 4])
    const sheet = await request(`/offers/${talisca.id}/proposal-document`, 'POST', { model: 'nestle', document: { ...nestle, requester: 'Ionei' } })
    assert.equal(sheet.status, 200, JSON.stringify(sheet.data))
    assert.equal(sheet.data.item.proposal.document.total, 1373.95, 'Same total as FS-3055 n. 2022906 (R$ 1.374)')
    const nestlePdf = await fetch(`${f.url}/api/offers/${talisca.id}/proposal.pdf`, { headers: f.admin })
    assert.equal(nestlePdf.status, 200); assert.match(nestlePdf.headers.get('content-disposition'), /FS-3055-2022906\.pdf/)
    const order = (await f.adminRequest(`/offers/${talisca.id}/accept`, 'POST')).data.item
    assert.equal((await request(`/receivables/order/${order.code}`)).data.order.valueCents, 137395)
  } finally { await f.close() }
})
