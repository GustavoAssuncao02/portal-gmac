import assert from 'node:assert/strict'
import test from 'node:test'
import { currentPieceProgress } from '../src/serviceProgress.js'

const operation = (counts) => ({ stages: counts.map((_, index) => ({ key: `stage-${index}`, name: `Etapa ${index + 1}` })), stageCounts: Object.fromEntries(counts.map((count, index) => [`stage-${index}`, count])), activeSession: { id: 'active' } })

test('stage blocks show the next unfinished piece instead of accumulated batch activity', () => {
  for (const [counts, pieceNumber, filled] of [
    [[8, 7], 8, [true, false]],
    [[8, 8], 9, [false, false]],
    [[7, 7], 8, [false, false]],
    [[10, 9], 10, [true, false]],
    [[10, 10], 10, [true, true]],
    [[0, 0], 1, [false, false]],
    [[8, 7, 5], 6, [true, true, false]],
    [[8, 8, 8], 9, [false, false, false]],
  ]) {
    const progress = currentPieceProgress(operation(counts), 10)
    assert.equal(progress.pieceNumber, pieceNumber)
    assert.deepEqual(progress.stages.map((stage) => stage.filled), filled, `counts: ${counts}`)
    assert.equal(progress.completedPieces, Math.min(...counts))
    assert.deepEqual(progress.stages.map((stage) => stage.count), counts)
  }
})

test('all stage blocks are filled only when every piece has completed every stage', () => {
  for (let first = 0; first <= 10; first++) {
    for (let last = 0; last <= first; last++) {
      const progress = currentPieceProgress(operation([first, last]), 10)
      assert.equal(progress.stages.every((stage) => stage.filled), first === 10 && last === 10)
    }
  }
  assert.equal(currentPieceProgress(operation([8]), 10).stages[0].filled, false)
  assert.equal(currentPieceProgress(operation([10]), 10).stages[0].filled, true)
})

test('missing counts and empty/invalid targets do not falsely indicate completion', () => {
  const missing = { stages: [{ key: 'welding', name: 'Soldagem' }, { key: 'painting', name: 'Pintura' }], stageCounts: { welding: 8 } }
  assert.deepEqual(currentPieceProgress(missing, 10).stages.map((stage) => stage.filled), [true, false])
  assert.equal(currentPieceProgress(operation([]), 10).pieceNumber, null)
  assert.equal(currentPieceProgress(operation([0, 0]), 0).pieceNumber, null)
  assert.deepEqual(currentPieceProgress(operation([0, 0]), 0).stages.map((stage) => stage.filled), [false, false])
})
