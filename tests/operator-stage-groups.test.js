import test from 'node:test'
import assert from 'node:assert/strict'
import { groupProjectStages } from '../src/serviceProgress.js'

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
