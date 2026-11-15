import assert from 'node:assert/strict'
import test from 'node:test'
import { createTestDatabase, createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'
import { defaultStageLayout, productionStages } from '../server/serviceStages.js'
import { operationVersion } from '../server/orderEditing.js'

// Editar OS as the screen sends it (same as order-editing.test.js).
function draftFor(order) {
  const stages = order.operation.stages.map((stage) => productionStages.find(([, name]) => name === stage.name)?.[0] || stage.name)
  return { order: { ...structuredClone(order), attachmentIds: (order.attachments || []).map((item) => item.id), resources: { ...order.resources, stages, stageLayout: order.resources?.stageLayout || defaultStageLayout(), kind: 'service', manufacturedFrom: null, tempering: null, paintColor: '', serviceDescription: '', strictProcess: true }, proposal: { materials: 0, labor: 0, discount: 0, margin: 0, ...order.proposal } }, expectedUpdatedAt: order.updatedAt || order.createdAt, expectedOperation: operationVersion(order.operation), stageCounts: Object.fromEntries(stages.map((code, index) => [code, order.operation.stageCounts[order.operation.stages[index].key] || 0])) }
}

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Lola Marilia' }

async function signedIn(fixture) {
  const token = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  return (route, method = 'GET', body) => fixture.request(route, method, body, { Authorization: `Bearer ${token}` })
}

test('an etiqueta opens its OS without proposal and is quoted at the end with the hours and material really used', async (t) => {
  const stock = await createTestDatabase('gmac_test_label')
  const fixture = await createWorkflowFixture({ accountsEnv: env, inventoryPool: stock.pool })
  t.after(async () => { await fixture.close(); await stock.drop() })
  const request = await signedIn(fixture)
  const balance = async (id) => Number((await request('/inventory')).data.items.find((item) => item.id === id).quantity)

  const steel = (await request('/inventory', 'POST', { name: 'Aço SAE 1045', unit: 'kg', quantity: 10, unitPrice: 20 })).data
  const offer = (await request('/offers', 'POST', { ...offerDraft, labelNumber: '4521', quantity: 1 })).data.item
  await request(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'aco', name: 'Aço SAE 1045', unit: 'kg', quantity: 3, unitPrice: 20, inventoryId: steel.id, stockAvailable: 10, stockStatus: 'available', purchaseQuantity: 0 }], laborEntries: [], kind: 'service', stages: ['turning'] })

  // In analysis (the fixture finishes the creation) it opens without any proposal.
  await request(`/offers/${offer.id}/finish`, 'POST', {})
  const accepted = await request(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data))
  const order = accepted.data.item
  assert.equal(order.labelQuote.pending, true)
  assert.equal(order.proposal.osValue, 0)
  assert.deepEqual(order.labelQuote.estimate.materials, { aco: 3 })
  assert.equal(await balance(steel.id), 7, 'the estimate leaves the stock as in any OS')
  const listed = (await request('/offers')).data.items.find((item) => item.id === offer.id)
  assert.deepEqual([listed.status, listed.proposal, listed.labelQuote], ['accepted', null, { pending: true }])

  // Nothing changes before the operators finish every piece.
  assert.equal((await request(`/orders/${order.code}/label-quote/materials`, 'PUT', { materials: [{ id: 'aco', quantity: 2 }] })).status, 409)
  const operation = (await request('/operations/orders')).data.items.find((item) => item.code === order.code).operation
  await fixture.mutateStore((store) => { store.orders.find((item) => item.code === order.code).operation = { ...operation, status: 'completed', startedAt: '2026-11-10T10:00:00Z', completedAt: '2026-11-10T12:00:00Z', stageTimeMs: { [operation.stages[0].key]: 90 * 60000 } } })

  // Waiting for the quote: neither the receivable nor the conclusion.
  const dueDate = shiftMonth(todayBahia(), 1)
  assert.equal((await request('/receivables', 'POST', { orderCode: order.code, value: '1000', dueDate })).data.message, 'Gere o orçamento da etiqueta antes de concluir a OS.')
  assert.equal((await request(`/operations/orders/${order.code}/acknowledge-completion`, 'POST')).status, 409)
  assert.equal((await request(`/receivables/order/${order.code}`)).data.order.labelQuotePending, true)
  const view = (await request(`/orders/${order.code}/label-quote`)).data
  assert.equal(view.completed, true)
  assert.deepEqual(view.hours.map((row) => [row.code, row.estimatedHours, row.realHours]), [['turning', 1, 1.5]])
  assert.deepEqual(view.materials.map((row) => [row.name, row.estimated, row.quantity, row.fromStock]), [['Aço SAE 1045', 3, 3, 3]])

  // The material really used: less goes back to the stock, more leaves it.
  const less = (await request(`/orders/${order.code}/label-quote/materials`, 'PUT', { materials: [{ id: 'aco', quantity: 2 }] })).data
  assert.deepEqual([less.changed, less.materials[0].quantity, less.materials[0].fromStock], [true, 2, 2])
  assert.equal(await balance(steel.id), 8)
  const history = (await request(`/inventory/${steel.id}/history`)).data.history
  assert.ok(history.some((row) => row.destination === 'Devolução da OS'), JSON.stringify(history))
  const more = (await request(`/orders/${order.code}/label-quote/materials`, 'PUT', { materials: [{ id: 'aco', quantity: 5 }] })).data
  assert.deepEqual([more.materials[0].quantity, more.materials[0].fromStock, more.materials[0].pending], [5, 5, 0])
  assert.equal(await balance(steel.id), 5)
  assert.equal((await request(`/orders/${order.code}/label-quote/materials`, 'PUT', { materials: [{ id: 'aco', quantity: -1 }] })).status, 400)

  // The quote form brings the real hours and the material used.
  const { draft } = (await request(`/orders/${order.code}/label-quote-draft?model=etiqueta`)).data
  assert.deepEqual(draft.usage.map((item) => [item.kind, item.quantity, item.source]), [['labor', 1.5, 'Horas reais da OS'], ['material', 5, 'Consumido na OS']])
  assert.equal(draft.labelNumber, '4521')
  const document = { ...draft, labor: draft.labor.map((row, index) => index === 0 ? { ...row, quantity: 1.5 } : row) }
  const generated = await request(`/orders/${order.code}/label-quote-document`, 'POST', { model: 'etiqueta', document })
  assert.equal(generated.status, 200, JSON.stringify(generated.data))
  assert.equal(generated.data.quote.pending, false)
  assert.ok(generated.data.quote.total > 0)
  const total = generated.data.quote.total
  assert.equal((await request(`/receivables/order/${order.code}`)).data.order.valueCents, Math.round(total * 100))

  // The e-mail opens with the measurement template, filled with the label.
  const email = (await request(`/offers/${offer.id}/proposal-email`)).data.draft
  assert.equal(email.templateId, 'label')
  assert.equal(email.subject, 'MEDIÇÃO ETIQUETA Nº 4521')
  assert.match(email.message, /^Prezados,[\s\S]*Etiqueta Nº: 4521/)
  assert.match(email.signature, /Lola Marilia/)

  // Changing the material afterwards discards the quote; it is generated again.
  const changed = (await request(`/orders/${order.code}/label-quote/materials`, 'PUT', { materials: [{ id: 'aco', quantity: 4 }] })).data
  assert.deepEqual([changed.discarded, changed.quote.pending], [true, true])
  assert.equal((await request(`/operations/orders/${order.code}/acknowledge-completion`, 'POST')).status, 409)
  const again = await request(`/orders/${order.code}/label-quote-document`, 'POST', { model: 'etiqueta', document: { ...document, materials: document.materials } })
  assert.equal(again.status, 200, JSON.stringify(again.data))
  assert.equal(again.data.quote.versions.length, 2)

  // With the quote the OS is concluded and receives as any other; the etiqueta stays out of the proposal margins.
  assert.equal((await request('/receivables', 'POST', { orderCode: order.code, value: String(again.data.quote.total), dueDate })).status, 201)
  assert.equal((await request(`/operations/orders/${order.code}/acknowledge-completion`, 'POST')).status, 200)
  assert.equal((await request(`/orders/${order.code}/label-quote/materials`, 'PUT', { materials: [{ id: 'aco', quantity: 1 }] })).status, 409)
  assert.equal((await request('/proposal-margins')).data.items.find((item) => item.key === 'A').won, 0)
})

test('an offer with a proposal keeps the normal flow, and the etiqueta of an OS cannot be left blank', async (t) => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  const request = await signedIn(fixture)
  const offer = (await request('/offers', 'POST', { ...offerDraft, labelNumber: '77' })).data.item
  await request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
  await request(`/offers/${offer.id}/finish`, 'POST', {})
  await request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 500 } })
  const order = (await request(`/offers/${offer.id}/accept`, 'POST')).data.item
  assert.equal(order.labelQuote, undefined)
  assert.equal((await request(`/orders/${order.code}/label-quote`)).status, 404)

  // Undoing the acceptance of an etiqueta takes it back to analysis, where it can open again.
  const label = (await request('/offers', 'POST', { ...offerDraft, labelNumber: '78' })).data.item
  await request(`/offers/${label.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
  await request(`/offers/${label.id}/finish`, 'POST', {})
  const opened = (await request(`/offers/${label.id}/accept`, 'POST')).data.item
  const draft = draftFor((await request('/operations/orders')).data.items.find((item) => item.code === opened.code))
  draft.order.labelNumber = ' '
  const blank = await request(`/operations/orders/${opened.code}`, 'PUT', draft)
  assert.equal(blank.status, 400, JSON.stringify(blank.data))
  assert.match(blank.data.message, /número da etiqueta/)
  assert.equal((await request(`/offers/${label.id}/unaccept`, 'POST', {})).status, 200)
  const back = (await request('/offers')).data.items.find((item) => item.id === label.id)
  assert.deepEqual([back.status, back.labelQuote, back.orderCode], ['review', undefined, null])
})

test('e-mail templates: the two of the portal, others created by anyone of the portal, and the role in the signature', async (t) => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  const request = await signedIn(fixture)
  const list = async () => (await request('/email-templates')).data.items

  assert.deepEqual((await list()).map((item) => [item.id, item.name, item.builtin]), [['proposal', 'Proposta comercial', true], ['label', 'Medição de etiqueta', true]])
  const created = await request('/email-templates', 'POST', { name: 'Medição Belgo FAI', subject: 'MEDIÇÃO ETIQUETA Nº {etiqueta}', message: 'Prezados,\n\nEtiqueta {etiqueta}.', to: 'compras@belgo.com.br', cc: ['qualidade@belgo.com.br'] })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  assert.equal((await request('/email-templates', 'POST', { name: 'medicao belgo fai', subject: 'x', message: 'y' })).status, 409, 'names do not repeat')
  assert.equal((await request('/email-templates', 'POST', { name: 'Sem texto', subject: 'x', message: ' ' })).status, 400)
  assert.equal((await request('/email-templates', 'POST', { name: 'E-mail errado', subject: 'x', message: 'y', to: 'compras@' })).status, 400)

  // The ones of the portal are edited and, when deleted, go back to the original text.
  assert.equal((await request('/email-templates/label', 'PUT', { name: 'Medição de etiqueta', subject: 'Medição {etiqueta}', message: 'Texto novo' })).status, 200)
  assert.equal((await list()).find((item) => item.id === 'label').subject, 'Medição {etiqueta}')
  assert.equal((await request('/email-templates/label', 'DELETE')).data.restored, true)
  assert.equal((await list()).find((item) => item.id === 'label').subject, 'MEDIÇÃO ETIQUETA Nº {etiqueta}')
  assert.equal((await request(`/email-templates/${created.data.item.id}`, 'DELETE')).status, 200)
  assert.equal((await list()).length, 2)

  // The role goes under the name in the signature; without it the signature has none.
  assert.equal((await request('/account/email-signature')).data.jobTitle, '')
  assert.equal((await request('/account/email-signature', 'PATCH', { jobTitle: '  Assistente   Comercial ' })).data.jobTitle, 'Assistente Comercial')
  const offer = (await request('/offers', 'POST', offerDraft)).data.item
  await request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['turning'] })
  await request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', deadline: offerDraft.deadline, serviceValue: 100 } })
  const draft = (await request(`/offers/${offer.id}/proposal-email`)).data.draft
  assert.match(draft.signature, /Lola Marilia\nAssistente Comercial\n/)
  assert.match(draft.signatureHtml, /Assistente Comercial/)
  assert.equal((await request(`/offers/${offer.id}/proposal-email?template=label`)).data.draft.subject, `MEDIÇÃO ETIQUETA Nº ${offerDraft.labelNumber}`)
})
