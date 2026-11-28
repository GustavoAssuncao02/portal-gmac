import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { requestDay } from '../server/retroactiveEntry.js'
import { belgoDocuments, contractMaterialUnit, contractModelFor, nestleDocuments } from '../server/contractTables.js'

// Ofertas com a planilha do cliente (2026-11-27): Nestlé sempre na FS-3055; Belgo com Número da etiqueta na planilha da
// Etiqueta; Belgo sem etiqueta e os demais clientes no fluxo normal. As etapas são as linhas de serviço da planilha (com a
// máquina do portal que executa) e os materiais, as linhas de material: o PDF é preenchido pela linha escolhida.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Lola Marilia' }
const nestle = '60.409.075/0120-88', belgo = '61.074.506/0026-98'

async function signedIn(fixture) {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  return (route, method = 'GET', body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
}

test('the sheet of an offer comes from the full CNPJ (digits only) and, for the Belgo, from the label number', () => {
  for (const document of nestleDocuments) assert.equal(contractModelFor({ cnpj: document, labelNumber: '' }), 'nestle')
  for (const document of belgoDocuments) {
    assert.equal(contractModelFor({ cnpj: document, labelNumber: '5319' }), 'etiqueta')
    assert.equal(contractModelFor({ cnpj: document, labelNumber: '  ' }), null, 'Belgo without label: normal flow')
  }
  assert.equal(contractModelFor({ cnpj: nestle, labelNumber: '5319' }), 'nestle', 'Nestlé is always its sheet')
  assert.equal(contractModelFor({ cnpj: '61.074.506/0099-00', labelNumber: '5319' }), null, 'another branch is not on the list')
  assert.equal(contractModelFor({ cnpj: '12345678000190', labelNumber: '5319' }), null)
  assert.deepEqual(['KG', 'Kg', 'Un.', 'M', 'Cj'].map(contractMaterialUnit), ['kg', 'kg', 'un', 'm', 'cj'])
})

test('Nestlé and etiqueta offers choose stages and materials from the sheet, and the PDF is filled by the chosen line', async (t) => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  const request = await signedIn(fixture)
  await (await fixture.serverModule('stageCatalog.js')).ensureStageCatalog()

  // Every service line of both sheets is a stage of its own group, with a unique name.
  const catalog = (await request('/stages')).data
  const sheetStages = (model) => catalog.stages.filter((row) => row.contract === model)
  assert.equal(sheetStages('nestle').length, 16)
  assert.equal(sheetStages('etiqueta').length, 18)
  assert.ok(catalog.groups.slice(-2).join() === 'Nestlé · FS-3055,Etiqueta Belgo', catalog.groups.join())
  assert.equal(new Set(catalog.stages.map((row) => row.name.toLowerCase())).size, catalog.stages.length, 'names are unique')
  const cnc = catalog.stages.find((row) => row.code === 'ct-etiqueta-et-l4')
  assert.deepEqual([cnc.name, cnc.group], ['Serv Usinagem em Torno CNC (Etiqueta)', 'Etiqueta Belgo'])
  // Only the machines of a sheet line change on the Etapas screen.
  assert.equal((await request('/stages/ct-etiqueta-et-l4', 'DELETE')).status, 409)
  const machine = (await request('/machines', 'POST', { name: 'Torno CNC 02', type: 'Torno', sector: 'Usinagem', hourlyRate: 100 })).data.item
  const kept = await request('/stages/ct-etiqueta-et-l4', 'PUT', { name: 'Outro nome', sectorId: 'x', resources: [{ type: 'machine', id: machine.id }] })
  assert.equal(kept.status, 200, JSON.stringify(kept.data))
  const edited = kept.data.stages.find((row) => row.code === 'ct-etiqueta-et-l4')
  assert.deepEqual([edited.name, edited.resources.map((choice) => String(choice.id))], ['Serv Usinagem em Torno CNC (Etiqueta)', [String(machine.id)]])

  const create = async (fields) => (await request('/offers', 'POST', { ...offerDraft, quantity: 1, ...fields })).data.item
  const label = await create({ cnpj: belgo, labelNumber: '5319' })
  const belgoNormal = await create({ cnpj: belgo, labelNumber: '' })
  const nestleOffer = await create({ cnpj: nestle })
  const normal = await create({})
  assert.deepEqual([label.contract, belgoNormal.contract, nestleOffer.contract, normal.contract], ['etiqueta', null, 'nestle', null])

  const plan = (stage) => ({ stages: [stage], stageTimes: { [stage]: 90 }, stageResources: { [stage]: { type: 'machine', id: machine.id } } })
  const resources = (offer, body) => request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', description: offer.description, ...body })
  // A sheet line never goes to another offer, and a sheet offer takes only its own lines.
  assert.equal((await resources(normal, plan('ct-etiqueta-et-l4'))).status, 400)
  assert.equal((await resources(belgoNormal, plan('ct-etiqueta-et-l4'))).status, 400)
  assert.equal((await resources(label, plan('turning'))).status, 400)
  assert.equal((await resources(label, plan('ct-nestle-fs-l9'))).status, 400)
  assert.equal((await resources(normal, plan('turning'))).status, 200, 'the normal flow is unchanged')
  // Materials of a sheet offer come from the sheet.
  const typed = { id: 'm1', name: 'Tubo a/c 1.1/2"', unit: 'un', quantity: 2, unitPrice: 310 }
  assert.equal((await resources(label, { ...plan('ct-etiqueta-et-l4'), materials: [typed] })).status, 400)
  const sheetMaterial = { id: 'm1', name: 'Barra Metalica Aco Inox Aisi304 1M', contractRow: 'et-m1', unit: 'kg', quantity: 3, unitPrice: 36.52 }
  const saved = await resources(label, { ...plan('ct-etiqueta-et-l4'), materials: [sheetMaterial] })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))
  assert.deepEqual(saved.data.item.resources.stageLayout.map((entry) => entry.group), ['Etiqueta Belgo'], 'the screen shows only the lines of the sheet')
  assert.equal(saved.data.item.resources.laborEntries[0].resource, 'Torno CNC 02')
  // The hour is charged at the normal rate of the sheet line (R$ 206,80), not at the R$ 100 of the machine.
  assert.equal(saved.data.item.resources.laborEntries[0].hourlyRate, 206.8)
  assert.equal((await resources(normal, plan('turning'))).data.item.resources.laborEntries[0].hourlyRate, 100, 'a normal offer keeps the rate of the machine')

  // Nestlé: the FS-3055 comes with the chosen line, SAP code included, without depending on the name.
  const nestlePlan = { ...plan('ct-nestle-fs-l9'), stageTimes: { 'ct-nestle-fs-l9': 120 }, materials: [{ id: 'n1', name: 'Barra Metalica Aco Sae1020 1M', contractRow: 'fs-m4', unit: 'kg', quantity: 5, unitPrice: 19.97 }] }
  assert.equal((await resources(nestleOffer, nestlePlan)).status, 200)
  const nestleDraft = (await request(`/offers/${nestleOffer.id}/proposal-draft?model=nestle&value=0`)).data.draft
  assert.deepEqual(nestleDraft.labor.filter((row) => row.quantity).map((row) => [row.id, row.quantity]), [['fs-l9', 2]])
  assert.deepEqual(nestleDraft.materials.filter((row) => row.quantity).map((row) => [row.id, row.quantity]), [['fs-m4', 5]])
  assert.ok(nestleDraft.usage.every((item) => item.rowId === item.contractRow), JSON.stringify(nestleDraft.usage))

  // Etiqueta: the OS opens without proposal and keeps the sheet; the quote is the hours really worked on each line.
  const accepted = await request(`/offers/${label.id}/accept`, 'POST')
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data))
  const order = accepted.data.item
  assert.deepEqual([order.contract, order.labelQuote.pending], ['etiqueta', true])
  assert.deepEqual(order.operation?.stages?.map((stage) => stage.name) ?? order.proposal.stages, order.operation ? ['Serv Usinagem em Torno CNC (Etiqueta)'] : ['ct-etiqueta-et-l4'])
  const operation = (await request('/operations/orders')).data.items.find((item) => item.code === order.code).operation
  assert.deepEqual(operation.stages.map((stage) => stage.name), ['Serv Usinagem em Torno CNC (Etiqueta)'])
  await fixture.mutateStore((store) => { store.orders.find((item) => item.code === order.code).operation = { ...operation, status: 'completed', startedAt: '2026-11-10T10:00:00Z', completedAt: '2026-11-10T12:00:00Z', stageTimeMs: { [operation.stages[0].key]: 105 * 60000 } } })
  const { draft } = (await request(`/orders/${order.code}/label-quote-draft?model=etiqueta`)).data
  assert.deepEqual(draft.labor.filter((row) => row.quantity).map((row) => [row.id, row.quantity]), [['et-l4', 1.75]])
  assert.deepEqual(draft.materials.filter((row) => row.quantity).map((row) => [row.id, row.quantity]), [['et-m1', 3]])
  // Dividir horas: 1 h normal + 0,75 h noturna of the same line; the PDF prints the line once per situation.
  const divided = { ...draft, labor: draft.labor.map((row) => row.id === 'et-l4' ? { ...row, parts: [{ situation: 'night', quantity: 0.75 }, { situation: 'normal', quantity: 1 }, { situation: 'holiday', quantity: 0 }] } : row) }
  const generated = await request(`/orders/${order.code}/label-quote-document`, 'POST', { model: 'etiqueta', document: divided })
  assert.equal(generated.status, 200, JSON.stringify(generated.data))
  assert.equal(generated.data.quote.total, Math.round((206.8 + 0.75 * 372.24 + 3 * 36.52) * 100) / 100)
  let printed
  await fixture.mutateStore((store) => { printed = structuredClone(store.orders.find((item) => item.code === order.code).proposal.document) })
  assert.deepEqual(printed.labor.filter((row) => row.id === 'et-l4').map((row) => [row.situation, row.quantity]), [['normal', 1], ['night', 0.75]])
  assert.equal(printed.labor.length, draft.labor.length + 1)
  // Reopened, the line comes back divided.
  const reopened = (await request(`/orders/${order.code}/label-quote-draft?model=etiqueta`)).data.draft.labor.find((row) => row.id === 'et-l4')
  assert.deepEqual([reopened.quantity, reopened.parts], [1.75, [{ situation: 'normal', quantity: 1 }, { situation: 'night', quantity: 0.75 }]])

  // History: a new etiqueta of the same piece comes with the stage, machine and material of the sheet, the time being the
  // average of the estimate (90 min) and the OS (105 min); a normal offer of the same piece never gets sheet lines.
  const again = await create({ cnpj: belgo, labelNumber: '6001' })
  const suggestion = (offer) => request(`/pieces/suggestion?${new URLSearchParams({ name: offer.service, quantity: '1', offerId: offer.id })}`)
  const suggested = (await suggestion(again)).data.item
  assert.deepEqual([suggested.resources.stages, suggested.resources.stageTimes, String(suggested.resources.stageResources['ct-etiqueta-et-l4'].id)], [['ct-etiqueta-et-l4'], { 'ct-etiqueta-et-l4': 98 }, String(machine.id)])
  assert.deepEqual(suggested.resources.materials.map((row) => [row.name, row.contractRow, row.unit, row.quantity, row.unitPrice]), [['Barra Metalica Aco Inox Aisi304 1M', 'et-m1', 'kg', 3, 36.52]])
  const filled = await resources(again, { ...suggested.resources, description: again.description })
  assert.equal(filled.status, 200, JSON.stringify(filled.data))
  assert.equal(filled.data.item.resources.laborEntries[0].hourlyRate, 206.8)
  const plain = (await suggestion(await create({}))).data.item
  assert.ok(!plain.resources.stages.some((code) => code.startsWith('ct-')) && !plain.resources.materials.some((row) => row.contractRow), JSON.stringify(plain.resources))
})

test('moving an offer to another sheet clears its stages and materials; older offers keep the normal flow', async (t) => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  const request = await signedIn(fixture)
  await (await fixture.serverModule('stageCatalog.js')).ensureStageCatalog()
  const machine = (await request('/machines', 'POST', { name: 'Torno CNC 02', type: 'Torno', sector: 'Usinagem', hourlyRate: 100 })).data.item
  const label = (await request('/offers', 'POST', { ...offerDraft, quantity: 1, cnpj: belgo, labelNumber: '5319' })).data.item
  const stage = 'ct-etiqueta-et-l4'
  await request(`/offers/${label.id}/resources`, 'PUT', { materials: [{ id: 'm1', name: 'Barra', contractRow: 'et-m1', unit: 'kg', quantity: 3, unitPrice: 36.52 }], laborEntries: [], kind: 'service', description: label.description, stages: [stage], stageTimes: { [stage]: 60 }, stageResources: { [stage]: { type: 'machine', id: machine.id } } })
  const info = (offer, changes) => request(`/offers/${offer.id}`, 'PUT', { cnpj: offer.cnpj, company: offer.company, service: offer.service, labelNumber: offer.labelNumber, deadline: offer.deadline, quantity: offer.quantity, requestedAt: requestDay(offer.requestedAt), requesters: [], ...changes })

  // Without the label number the Belgo offer goes to the normal flow: what was chosen for the sheet is cleared.
  const cleared = await info(label, { labelNumber: '' })
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data))
  assert.equal(cleared.data.contractCleared, true)
  assert.deepEqual([cleared.data.item.contract, cleared.data.item.resources.stages, cleared.data.item.resources.materials], [null, [], []])
  // Editing anything else keeps the sheet and what was chosen.
  const back = await info(cleared.data.item, { labelNumber: '5319' })
  assert.equal(back.data.item.contract, 'etiqueta')
  await request(`/offers/${label.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', description: label.description, stages: [stage], stageTimes: { [stage]: 60 }, stageResources: { [stage]: { type: 'machine', id: machine.id } } })
  const same = await info(back.data.item, { service: 'Outra peça' })
  assert.deepEqual([same.data.contractCleared, same.data.item.resources.stages], [false, [stage]])

  // An offer from before the sheets (no field) keeps its stages and the normal flow, even of the Nestlé.
  const old = (await request('/offers', 'POST', { ...offerDraft, quantity: 1 })).data.item
  await request(`/offers/${old.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', description: old.description, stages: ['turning'], stageTimes: { turning: 60 }, stageResources: { turning: { type: 'machine', id: machine.id } } })
  await fixture.mutateStore((store) => { delete store.offers.find((item) => item.id === old.id).contract })
  const oldEdited = await info({ ...old, cnpj: nestle }, {})
  assert.equal(oldEdited.status, 200, JSON.stringify(oldEdited.data))
  assert.deepEqual([oldEdited.data.contractCleared, oldEdited.data.item.contract, oldEdited.data.item.resources.stages], [false, undefined, ['turning']])
})

test('the stages follow the sheet edited in Modelos de proposta', async (t) => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  const request = await signedIn(fixture)
  await (await fixture.serverModule('stageCatalog.js')).ensureStageCatalog()
  const { settings } = (await request('/proposal-settings')).data
  const table = settings.tables.etiqueta
  const labor = table.labor.filter((row) => row.id !== 'et-l11').map((row) => row.id === 'et-l4' ? { ...row, description: 'Serv Usinagem Torno CNC' } : row)
  const saved = await request('/proposal-settings', 'PUT', { ...settings, tables: { ...settings.tables, etiqueta: { ...table, labor } } })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))
  const stages = (await request('/stages')).data.stages
  const cnc = stages.find((row) => row.code === 'ct-etiqueta-et-l4')
  assert.deepEqual([cnc.name, cnc.aliases], ['Serv Usinagem Torno CNC (Etiqueta)', ['Serv Usinagem em Torno CNC (Etiqueta)']], 'renamed: the OS that kept the old name still find it')
  assert.equal(stages.find((row) => row.code === 'ct-etiqueta-et-l11').active, false, 'a line taken out of the sheet is deactivated')
})
