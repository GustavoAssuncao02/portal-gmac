import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { defaultStageLayout, productionStages } from '../server/serviceStages.js'
import { operationVersion } from '../server/orderEditing.js'

// The body of the OS edit, as the edit window sends it (copied from order-editing.test.js).
function draftFor(order) {
  const stages = order.operation.stages.map((stage) => productionStages.find(([, name]) => name === stage.name)?.[0] || stage.name)
  return { order: { ...structuredClone(order), attachmentIds: (order.attachments || []).map((item) => item.id), resources: { ...order.resources, stages, stageLayout: order.resources?.stageLayout || defaultStageLayout(), kind: 'service', manufacturedFrom: null, tempering: null, paintColor: '', serviceDescription: '', strictProcess: true }, proposal: { materials: 0, labor: 0, discount: 0, margin: 0, ...order.proposal } }, expectedUpdatedAt: order.updatedAt || order.createdAt, expectedOperation: operationVersion(order.operation), stageCounts: Object.fromEntries(stages.map((code, index) => [code, order.operation.stageCounts[order.operation.stages[index].key] || 0])) }
}

// The planned time and the machine or service of every stage are mandatory: the planning of the machines is made from
// the time, and the operator's tablet takes the machine or service from the stage.
test('the proposal, the acceptance and the stage changes of an OS ask for the time and the machine or service of every stage', async (t) => {
  const fixture = await createWorkflowFixture({ fillStageTimes: false })
  t.after(() => fixture.close())
  await fixture.mutateStore((store) => { store.machines = [{ id: 'torno', name: 'Torno 01' }] })
  const service = (await fixture.adminRequest('/labor-services')).data.items[0]
  const plans = { turning: { type: 'machine', id: 'torno' }, painting: { type: 'labor-service', id: service.id } }
  const times = { turning: 120, painting: 45 }
  const resources = { materials: [], laborEntries: [], kind: 'service', stages: ['turning', 'painting'] }
  const proposal = { layout: 'classic', proposal: { key: 'A', serviceValue: 100, deadline: offerDraft.deadline } }
  const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  const save = (fields) => fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { ...resources, ...fields })
  const generate = () => fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', proposal)
  assert.equal((await save({})).status, 200, 'the details are saved while they are filled')

  let generated = await generate()
  assert.equal(generated.status, 400)
  assert.match(generated.data.message, /Informe o tempo previsto de cada etapa: Tornearia, Pintura\./)
  await save({ stageTimes: { turning: 120 } })
  generated = await generate()
  assert.equal(generated.status, 400)
  assert.match(generated.data.message, /Informe o tempo previsto de a etapa: Pintura\./)
  await save({ stageTimes: times })
  generated = await generate()
  assert.equal(generated.status, 400, 'the times alone are not enough')
  assert.match(generated.data.message, /Escolha a máquina ou o serviço de cada etapa: Tornearia, Pintura\. O tempo e a máquina ou o serviço ficam nos detalhes da oferta/)
  const document = await fixture.adminRequest(`/offers/${offer.id}/proposal-document`, 'POST', { model: 'A' })
  assert.equal(document.status, 400, 'the commercial models ask for the same')
  assert.match(document.data.message, /Escolha a máquina ou o serviço de cada etapa: Tornearia, Pintura\./)
  await save({ stageTimes: times, stageResources: { turning: plans.turning } })
  generated = await generate()
  assert.equal(generated.status, 400)
  assert.match(generated.data.message, /Escolha a máquina ou o serviço da etapa: Pintura\./)
  await save({ stageTimes: times, stageResources: plans })
  assert.equal((await generate()).status, 200)

  // A proposal generated before the rule (or a time or a machine removed afterwards) still needs them to become an OS.
  await save({ stageTimes: { turning: 120 }, stageResources: plans })
  let refused = await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(refused.status, 400)
  assert.match(refused.data.message, /Pintura.*Preencha nos detalhes da oferta antes de aceitar/)
  await save({ stageTimes: times, stageResources: { turning: plans.turning } })
  refused = await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')
  assert.equal(refused.status, 400)
  assert.match(refused.data.message, /Escolha a máquina ou o serviço da etapa: Pintura\. Preencha nos detalhes da oferta antes de aceitar/)
  await save({ stageTimes: times, stageResources: plans })
  const accepted = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
  assert.deepEqual(accepted.resources.stageTimes, times)
  assert.deepEqual(Object.keys(accepted.resources.stageResources), ['turning', 'painting'])

  // Editing the OS: a new stage needs its time and its machine or service; an OS from before the rule can still change
  // its other fields.
  const load = async () => (await fixture.adminRequest('/operations/orders')).data.items.find((item) => item.code === accepted.code)
  const url = `/operations/orders/${accepted.code}`
  let draft = draftFor(await load())
  draft.order.resources.stages = ['turning', 'painting', 'cut-bend']
  draft.stageCounts['cut-bend'] = 0
  const added = await fixture.adminRequest(url, 'PUT', draft)
  assert.equal(added.status, 400, added.data?.message)
  assert.match(added.data.message, /Informe o tempo previsto de a etapa: Corte e dobra\./)
  draft.order.resources.stageTimes = { ...draft.order.resources.stageTimes, 'cut-bend': 30 }
  const unplanned = await fixture.adminRequest(url, 'PUT', draft)
  assert.equal(unplanned.status, 400, unplanned.data?.message)
  assert.match(unplanned.data.message, /Escolha a máquina ou o serviço da etapa: Corte e dobra\./)
  draft.order.resources.stageResources = { ...draft.order.resources.stageResources, 'cut-bend': { type: 'machine', id: 'fresa-que-nao-existe' } }
  assert.equal((await fixture.adminRequest(url, 'PUT', draft)).status, 400, 'only a registered machine or service')
  draft.order.resources.stageResources['cut-bend'] = plans.painting
  const saved = await fixture.adminRequest(url, 'PUT', draft)
  assert.equal(saved.status, 200, saved.data?.message)
  assert.deepEqual(Object.keys((await load()).resources.stageResources), ['turning', 'painting', 'cut-bend'])
  await fixture.mutateStore((store) => { Object.assign(store.orders.find((item) => item.code === accepted.code).resources, { stageTimes: {}, stageResources: {} }) })
  draft = draftFor(await load())
  draft.order.description = 'Descrição revisada depois da regra'
  const legacy = await fixture.adminRequest(url, 'PUT', draft)
  assert.equal(legacy.status, 200, `an old OS without times and machines keeps being editable: ${legacy.data?.message}`)
  // The administrator completes the old OS: every stage gets its time and its machine or service at once.
  draft = draftFor(await load())
  draft.order.resources.stageResources = plans
  const halfway = await fixture.adminRequest(url, 'PUT', draft)
  assert.equal(halfway.status, 400, 'choosing machines asks for the times as well')
  draft.order.resources.stageTimes = { ...times, 'cut-bend': 30 }
  draft.order.resources.stageResources = { ...plans, 'cut-bend': plans.painting }
  assert.equal((await fixture.adminRequest(url, 'PUT', draft)).status, 200)
})
