import test from 'node:test'
import assert from 'node:assert/strict'
import { groupProjectStages, stageGroupProgress, stageGroupTone } from '../src/serviceProgress.js'

test('operator groups follow the stored OS sequence and keep global substep indices', () => {
  const stages = ['Pintura', 'Corte a plasma', 'Corte e dobra', 'Montagem', 'Tornearia'].map((name, index) => ({ name, key: `stage-${index + 1}` }))
  const before = structuredClone(stages)
  const groups = groupProjectStages(stages)
  assert.deepEqual(groups.map((group) => group.name), ['Pintura', 'Caldeiraria', 'Usinagem'])
  assert.deepEqual(groups.map((group) => group.stages.map(({ index }) => index)), [[0], [1, 2], [3, 4]])
  assert.deepEqual(groups.flatMap((group) => group.stages.map(({ stage }) => stage)), stages)
  assert.deepEqual(stages, before)
})

test('legacy sequences are never regrouped out of execution order and custom steps stay visible', () => {
  const stages = ['Soldagem', 'Corte', 'Freza', 'Pintura', 'Polimento', 'Tratamento personalizado'].map((name, index) => ({ name, key: `stage-${index + 1}` }))
  const groups = groupProjectStages(stages)
  assert.deepEqual(groups.map((group) => group.name), ['Caldeiraria', 'Usinagem', 'Pintura', 'Caldeiraria', 'Outras etapas'])
  assert.deepEqual(groups.flatMap((group) => group.stages.map(({ stage }) => stage)), stages)
  assert.deepEqual(groupProjectStages(), [])
  assert.deepEqual(groupProjectStages([]), [])
  assert.deepEqual(groupProjectStages([{ key: 'stage-1', name: 'Pintura' }]).map((group) => group.name), ['Pintura'])
})

test('each production group has its own tone, and a group says where it stands', () => {
  assert.deepEqual(['Usinagem', 'Caldeiraria', 'Pintura', 'Outras etapas', undefined].map(stageGroupTone), ['machining', 'boilermaking', 'painting', 'other', 'other'])
  const stages = ['Tornearia', 'Freza', 'Pintura'].map((name, index) => ({ name, key: `stage-${index + 1}` }))
  const [machining, painting] = groupProjectStages(stages)
  const counts = (values) => Object.fromEntries(stages.map((stage, index) => [stage.key, values[index]]))
  assert.deepEqual(stageGroupProgress(machining, counts([0, 0, 0]), 10), { done: 0, total: 20, percent: 0, state: 'waiting' })
  assert.deepEqual(stageGroupProgress(machining, counts([10, 3, 0]), 10), { done: 13, total: 20, percent: 65, state: 'active' })
  assert.deepEqual(stageGroupProgress(machining, counts([10, 10, 4]), 10), { done: 20, total: 20, percent: 100, state: 'done' })
  assert.deepEqual(stageGroupProgress(painting, counts([10, 10, 4]), 10), { done: 4, total: 10, percent: 40, state: 'active' })
  // Counts above the quantity do not overfill the group, and a group without pieces is never "done".
  assert.deepEqual(stageGroupProgress(machining, counts([99, 99, 0]), 10), { done: 20, total: 20, percent: 100, state: 'done' })
  assert.deepEqual(stageGroupProgress(machining, counts([1, 1, 0]), 0), { done: 0, total: 0, percent: 0, state: 'waiting' })
  assert.deepEqual(stageGroupProgress(machining, undefined, 10), { done: 0, total: 20, percent: 0, state: 'waiting' })
})