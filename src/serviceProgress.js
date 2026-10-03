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
