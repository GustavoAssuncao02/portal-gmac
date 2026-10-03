export const serviceStageGroups = [
  ['Usinagem', [['turning', 'Tornearia'], ['milling', 'Freza'], ['planing', 'Plaina'], ['cnc-turning', 'Torno CMC'], ['machining-center', 'C.usinagem'], ['assembly', 'Montagem'], ['disassembly', 'Desmontagem']]],
  ['Pintura', [['painting', 'Pintura']]],
  ['Caldeiraria', [['cut-bend', 'Corte e dobra'], ['torch-cut', 'Corte com Ma\u00e7arico'], ['plasma-cut', 'Corte a plasma'], ['grinding', 'Esmirilhamento'], ['structural-assembly', 'Montagem Estruturada'], ['mechanical-assembly', 'Montagem mec\u00e2nica'], ['polishing', 'Polimento']]],
]
export const legacyStages = [['cutting', 'Corte'], ['machining', 'Usinagem'], ['welding', 'Soldagem'], ['boiler', 'Caldeiraria']]
export const productionStages = [...legacyStages.slice(0, 3), ...serviceStageGroups.flatMap(([, stages]) => stages), legacyStages[3]]
export const stageLabel = (key) => productionStages.find(([code]) => code === key)?.[1] || key
export const serviceDetails = (resources = {}) => ({ manufacturedFrom: resources.manufacturedFrom ?? null, tempering: resources.tempering ?? null, paintColor: resources.paintColor || '', serviceDescription: resources.serviceDescription || '' })
