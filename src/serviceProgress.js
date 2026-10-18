import { stageGroupLabel } from '../server/serviceStages.js'

export function groupProjectStages(stages = []) {
  const groups = []
  stages.forEach((stage, index) => {
    const name = stageGroupLabel(stage) || 'Outras etapas'
    // Keep consecutive groups so legacy/custom sequences retain their execution order.
    if (groups.at(-1)?.name !== name) groups.push({ name, stages: [] })
    groups.at(-1).stages.push({ stage, index })
  })
  return groups
}

// An emergency OS (proposal type "Emergencial") is marked in the lists and comes first in the panels of work in progress.
export const isEmergency = (order) => order?.resources?.urgency === 'emergency'
export const emergenciesFirst = (orders) => [...orders].sort((left, right) => Number(isEmergency(right)) - Number(isEmergency(left)))

export function currentPieceProgress(operation, quantity) {
  const total = Math.max(0, Math.floor(Number(quantity) || 0))
  const stages = operation?.stages || []
  const counts = stages.map((stage) => Math.min(total, Math.max(0, Math.floor(Number(operation.stageCounts?.[stage.key]) || 0))))
  const completedPieces = stages.length ? Math.min(...counts) : 0
  const pieceNumber = total && stages.length ? Math.min(total, completedPieces + 1) : null
  return {
    pieceNumber,
    completedPieces,
    stages: stages.map((stage, index) => ({ ...stage, count: counts[index], filled: pieceNumber !== null && counts[index] >= pieceNumber })),
  }
}

// Each production group has its own identity on screen (color, icon), so Usinagem, Caldeiraria and Pintura are told apart at a glance.
export const stageGroupTone = (name) => ({ Usinagem: 'machining', Caldeiraria: 'boilermaking', Pintura: 'painting' })[name] || 'other'

// Passages registered in a group, out of the ones it needs, and where it stands: not started, in progress or done.
export function stageGroupProgress(group, stageCounts = {}, quantity = 0) {
  const pieces = Math.max(0, Math.floor(Number(quantity) || 0))
  const done = group.stages.reduce((sum, { stage }) => sum + Math.min(pieces, Math.max(0, Math.floor(Number(stageCounts[stage.key]) || 0))), 0)
  const total = group.stages.length * pieces
  return { done, total, percent: total ? Math.round(done / total * 100) : 0, state: total > 0 && done >= total ? 'done' : done > 0 ? 'active' : 'waiting' }
}