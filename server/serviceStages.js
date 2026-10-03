export const serviceStageGroups = [
  ['Usinagem', [['turning', 'Tornearia'], ['milling', 'Freza'], ['planing', 'Plaina'], ['cnc-turning', 'Torno CMC'], ['machining-center', 'C.usinagem'], ['assembly', 'Montagem'], ['disassembly', 'Desmontagem']]],
  ['Pintura', [['painting', 'Pintura']]],
  ['Caldeiraria', [['cut-bend', 'Corte e dobra'], ['torch-cut', 'Corte com Ma\u00e7arico'], ['plasma-cut', 'Corte a plasma'], ['grinding', 'Esmirilhamento'], ['structural-assembly', 'Montagem Estruturada'], ['mechanical-assembly', 'Montagem mec\u00e2nica'], ['polishing', 'Polimento']]],
]
export const legacyStages = [['cutting', 'Corte'], ['machining', 'Usinagem'], ['welding', 'Soldagem'], ['boiler', 'Caldeiraria']]
export const productionStages = [...legacyStages.slice(0, 3), ...serviceStageGroups.flatMap(([, stages]) => stages), legacyStages[3]]
export const stageLabel = (key) => productionStages.find(([code]) => code === key)?.[1] || key
export function stageGroupLabel(stage) {
  const key = typeof stage === 'string' ? stage : stage?.key
  const name = typeof stage === 'string' ? stage : stage?.name
  const entry = productionStages.find(([code]) => code === key) ?? productionStages.find(([, label]) => label === name)
  if (!entry) return null
  const group = serviceStageGroups.find(([, options]) => options.some(([code]) => code === entry[0]))
  return group?.[0] ?? (entry[0] === 'machining' ? 'Usinagem' : 'Caldeiraria')
}
export const legacyStageGroup = 'Etapas do cadastro anterior'
const layoutGroups = [...serviceStageGroups, [legacyStageGroup, legacyStages]]
export const defaultStageLayout = () => serviceStageGroups.map(([group, stages]) => ({ group, stages: stages.map(([key]) => key) }))
export function validStageLayout(layout) {
  if (!Array.isArray(layout) || ![serviceStageGroups.length, layoutGroups.length].includes(layout.length)) return false
  if (new Set(layout.map((entry) => entry?.group)).size !== layout.length) return false
  if (!serviceStageGroups.every(([group]) => layout.some((entry) => entry?.group === group))) return false
  return layout.every((entry) => {
    const group = layoutGroups.find(([name]) => name === entry?.group)
    return group && Array.isArray(entry.stages) && entry.stages.length === group[1].length && new Set(entry.stages).size === entry.stages.length && entry.stages.every((key) => group[1].some(([code]) => code === key))
  })
}
export function readStageLayout(resources) {
  const layout = validStageLayout(resources?.stageLayout) ? resources.stageLayout : defaultStageLayout()
  if (!resources?.stages?.some((key) => legacyStages.some(([code]) => code === key)) || layout.some(({ group }) => group === legacyStageGroup)) return layout
  return [...layout, { group: legacyStageGroup, stages: legacyStages.map(([key]) => key) }]
}
export function orderedStageSelection(layout, selected) {
  const keys = layout.flatMap((entry) => entry.stages)
  return [...keys.filter((key) => selected.includes(key)), ...selected.filter((key) => !keys.includes(key))]
}
export const serviceDetails = (resources = {}) => ({ manufacturedFrom: resources.manufacturedFrom ?? null, tempering: resources.tempering ?? null, paintColor: resources.paintColor || '', serviceDescription: resources.serviceDescription || '', strictProcess: resources.strictProcess !== false })
