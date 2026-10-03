import test from 'node:test'
import assert from 'node:assert/strict'
import { serviceStageGroups, stageGroupLabel } from '../server/serviceStages.js'
import { currentPieceProgress } from '../src/serviceProgress.js'

test('every configured substep resolves to its group by code or stored operation name', () => {
  for (const [group, options] of serviceStageGroups) {
    for (const [key, name] of options) {
      assert.equal(stageGroupLabel(key), group)
      assert.equal(stageGroupLabel({ key, name }), group)
      assert.equal(stageGroupLabel({ key: 'stage-1', name }), group)
    }
  }
  assert.equal(stageGroupLabel('cutting'), 'Caldeiraria')
  assert.equal(stageGroupLabel({ key: 'stage-2', name: 'Soldagem' }), 'Caldeiraria')
  assert.equal(stageGroupLabel('machining'), 'Usinagem')
  assert.equal(stageGroupLabel('boiler'), 'Caldeiraria')
  assert.equal(stageGroupLabel(undefined), null)
  assert.equal(stageGroupLabel({ key: 'stage-1', name: 'Etapa desconhecida' }), null)
})

test('panel group follows the current piece across substeps rather than the first unfinished batch stage', () => {
  const operation = { stages: [{ key: 'stage-1', name: 'Freza' }, { key: 'stage-2', name: 'Pintura' }], stageCounts: { 'stage-1': 8, 'stage-2': 7 } }
  const group = () => stageGroupLabel(currentPieceProgress(operation, 10).stages.find((stage) => !stage.filled))
  assert.equal(group(), 'Pintura')
  operation.stageCounts['stage-2'] = 8
  assert.equal(group(), 'Usinagem')
  operation.stageCounts['stage-1'] = 10
  operation.stageCounts['stage-2'] = 10
  assert.equal(group(), null)
})
