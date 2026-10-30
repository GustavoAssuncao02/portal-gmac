// The stages of the services come from the "Etapas" screen (server/stageCatalog.js): each one has a fixed code (what
// offers and OS keep), a name that can change (the former names stay as `aliases`, so OS that kept a name still find
// their stage), the sector it belongs to (the group: Usinagem, Pintura, Caldeiraria\u2026), whether it is still offered and
// the machines and services it is made on (the first is the default). The server and the screens load the catalog with
// setStageCatalog; until then, and as the first catalog of a new portal, these are the stages of the company.
export const seedStageGroups = [
  ['Usinagem', [['turning', 'Tornearia'], ['milling', 'Freza'], ['planing', 'Plaina'], ['cnc-turning', 'Torno CMC'], ['machining-center', 'C.usinagem'], ['assembly', 'Montagem'], ['disassembly', 'Desmontagem']]],
  ['Pintura', [['painting', 'Pintura']]],
  ['Caldeiraria', [['cut-bend', 'Corte e dobra'], ['torch-cut', 'Corte com Ma\u00e7arico'], ['plasma-cut', 'Corte a plasma'], ['grinding', 'Esmirilhamento'], ['structural-assembly', 'Montagem Estruturada'], ['mechanical-assembly', 'Montagem mec\u00e2nica'], ['polishing', 'Polimento']]],
]
// Stages of the first registration, kept for the OS that still have them: they come deactivated.
export const legacyStages = [['cutting', 'Corte'], ['machining', 'Usinagem'], ['welding', 'Soldagem'], ['boiler', 'Caldeiraria']]
const legacyGroup = { machining: 'Usinagem' }
export const seedStageCatalog = () => ({
  groups: seedStageGroups.map(([group]) => group),
  stages: [
    ...seedStageGroups.flatMap(([group, stages]) => stages.map(([code, name]) => ({ code, name, group, active: true, resources: [], aliases: [] }))),
    ...legacyStages.map(([code, name]) => ({ code, name, group: legacyGroup[code] || 'Caldeiraria', active: false, resources: [], aliases: [] })),
  ],
})

// Live bindings: every module that imports them sees the catalog loaded last.
export let stageCatalog = []
export let stageGroupOrder = []
// Active stages by group, in the order of the "Etapas" screen: what a new offer offers.
export let serviceStageGroups = []
// Every stage, active or not: [code, name].
export let productionStages = []
const listeners = new Set()
export function setStageCatalog({ stages = [], groups = [] } = {}) {
  stageCatalog = stages.map((row) => ({ code: String(row.code), name: String(row.name), group: String(row.group || ''), active: row.active !== false, resources: Array.isArray(row.resources) ? row.resources : [], aliases: Array.isArray(row.aliases) ? row.aliases : [] }))
  stageGroupOrder = [...new Set([...groups, ...stageCatalog.map((row) => row.group)])].filter(Boolean)
  serviceStageGroups = stageGroupOrder.map((group) => [group, stageCatalog.filter((row) => row.group === group && row.active).map((row) => [row.code, row.name])]).filter(([, stages]) => stages.length)
  productionStages = stageCatalog.map((row) => [row.code, row.name])
  for (const listener of listeners) listener()
}
export const onStageCatalogChange = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
setStageCatalog(seedStageCatalog())

const sameText = (left, right) => String(left ?? '').trim().localeCompare(String(right ?? '').trim(), 'pt-BR', { sensitivity: 'base' }) === 0
const catalogRow = (code) => stageCatalog.find((row) => row.code === code)
export const stageLabel = (key) => catalogRow(key)?.name || key
export const stageActive = (key) => catalogRow(key)?.active === true
// The code of a stage kept by name in an OS (operation.stages, events): the current name or one it had before.
export function stageCodeOf(stage) {
  const name = typeof stage === 'string' ? stage : stage?.name
  if (!name) return null
  return (stageCatalog.find((row) => sameText(row.name, name)) ?? stageCatalog.find((row) => row.aliases.some((alias) => sameText(alias, name))))?.code ?? null
}
// The machines and services configured for a stage ({ type, id }, the default first); empty means any of them.
export const stageResourceChoices = (key) => catalogRow(key)?.resources || []
// The default of a stage among the registered machines and services ({ type, id, name }), or null.
export function defaultStageResource(key, { machines = [], laborServices = [] } = {}) {
  for (const choice of stageResourceChoices(key)) {
    const item = (choice.type === 'machine' ? machines : choice.type === 'labor-service' ? laborServices : []).find((entry) => String(entry.id) === String(choice.id))
    if (item) return { type: choice.type, id: item.id, name: item.name }
  }
  return null
}
// Every stage needs its planned time: the planning of the machines is made from it. Without it the proposal is not
// generated, the offer does not become an OS and an OS cannot be left with a stage without time.
export const missingStageTimes = (stages = [], stageTimes = {}) => stages.filter((code) => !(Number(stageTimes?.[code]) > 0))
export const missingStageTimesMessage = (codes) => `Informe o tempo previsto de ${codes.length === 1 ? 'a etapa' : 'cada etapa'}: ${codes.map(stageLabel).join(', ')}.`
// Every stage also needs the machine or the labor service it is made on: the operator's tablet takes it from the stage
// and never asks for it. Without it the proposal is not generated and the offer does not become an OS.
export const missingStageResources = (stages = [], stageResources = {}) => stages.filter((code) => !stageResources?.[code])
export const missingStageResourcesMessage = (codes) => `Escolha a máquina ou o serviço ${codes.length === 1 ? 'da etapa' : 'de cada etapa'}: ${codes.map(stageLabel).join(', ')}.`
// What still holds the offer back: the time first, then the machine or service. Empty when every stage is planned.
export function stagePlanProblem(stages, resources) {
  const times = missingStageTimes(stages, resources?.stageTimes)
  if (times.length) return missingStageTimesMessage(times)
  const unplanned = missingStageResources(stages, resources?.stageResources)
  return unplanned.length ? missingStageResourcesMessage(unplanned) : ''
}
export const stagePlanPlace = 'O tempo e a máquina ou o serviço ficam nos detalhes da oferta, ao lado de cada etapa.'
// The group (sector) of a stage given by its code, its name or an OS stage ({ key: 'stage-1', name }).
export function stageGroupLabel(stage) {
  const key = typeof stage === 'string' ? stage : stage?.key
  return (catalogRow(key) ?? catalogRow(stageCodeOf(stage)))?.group ?? null
}
// The order of an offer: the groups and, inside each, the stages (every stage of the catalog, active or not: the screens
// show the inactive ones only where they are checked). New stages and groups come at the end, in the catalog order.
export const defaultStageLayout = () => stageGroupOrder.map((group) => ({ group, stages: stageCatalog.filter((row) => row.group === group).map((row) => row.code) })).filter((entry) => entry.stages.length)
// A layout sent by a screen: named groups and stage codes, each once. readStageLayout then fits it to the catalog.
export function validStageLayout(layout) {
  if (!Array.isArray(layout) || !layout.length || layout.length > 100) return false
  if (new Set(layout.map((entry) => entry?.group)).size !== layout.length) return false
  const codes = layout.flatMap((entry) => Array.isArray(entry?.stages) ? entry.stages : [null])
  return layout.every((entry) => typeof entry?.group === 'string' && Array.isArray(entry.stages)) && codes.length <= 500 && new Set(codes).size === codes.length && codes.every((code) => typeof code === 'string' && code.length <= 80)
}
// The saved order of an offer over the current catalog: a stage moved to another sector goes with it, removed groups go
// away, and what the order does not have yet comes at the end. Stages that are no longer registered keep their place.
export function readStageLayout(resources) {
  const saved = Array.isArray(resources?.stageLayout) ? resources.stageLayout.filter((entry) => typeof entry?.group === 'string' && Array.isArray(entry.stages)) : []
  const savedOrder = saved.flatMap((entry) => entry.stages)
  const rank = (code) => { const index = savedOrder.indexOf(code); return index === -1 ? Infinity : index }
  const groups = [...new Set([...saved.map((entry) => entry.group).filter((group) => stageGroupOrder.includes(group)), ...stageGroupOrder])]
  const layout = groups.map((group) => {
    const rows = stageCatalog.filter((row) => row.group === group).map((row, index) => ({ code: row.code, index }))
    return { group, stages: rows.sort((left, right) => rank(left.code) - rank(right.code) || left.index - right.index).map((row) => row.code) }
  }).filter((entry) => entry.stages.length)
  const unknown = (resources?.stages || []).filter((code) => !catalogRow(code))
  return unknown.length ? [...layout, { group: 'Outras etapas', stages: unknown }] : layout
}
export function orderedStageSelection(layout, selected) {
  const keys = layout.flatMap((entry) => entry.stages)
  return [...keys.filter((key) => selected.includes(key)), ...selected.filter((key) => !keys.includes(key))]
}
export const serviceDetails = (resources = {}) => ({ manufacturedFrom: resources.manufacturedFrom ?? null, tempering: resources.tempering ?? null, urgency: resources.urgency === 'emergency' ? 'emergency' : 'normal', serviceLocation: resources.serviceLocation === 'external' ? 'external' : 'internal', paintColor: resources.paintColor || '', serviceDescription: resources.serviceDescription || '', strictProcess: resources.strictProcess !== false })
// The service description of an offer is a single text: the one typed when it was created. Older offers kept a second
// text in resources.serviceDescription; it is read at the end of the description, so nothing typed there is lost.
export function serviceDescriptionText(description, details) {
  const main = String(description ?? '').trim(), extra = String(details ?? '').trim()
  if (!extra || main.includes(extra)) return main
  return main ? `${main}\n\n${extra}` : extra
}
