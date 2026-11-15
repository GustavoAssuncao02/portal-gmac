import assert from 'node:assert/strict'
import test from 'node:test'
import { pieceWorkTimes } from '../server/operationEventTime.js'
import { piecesText } from '../src/pieceWorkText.js'

const at = (time) => `2026-11-13T${time}:00.000Z`
const minutes = (times, id) => times.get(id) / 60000
const by = (employeeId, sessionId) => ({ employeeId, employeeName: `Funcionário ${employeeId}`, sessionId })

test('the time of each registration of pieces is the work on that stage since the previous one, without pauses', () => {
  const ana = (sessionId) => by(1, sessionId)
  const events = [
    { id: 'start', type: 'started', at: at('08:00'), ...ana('s1'), workStageKey: 'cut' },
    { id: 'p1', type: 'stage_progress', at: at('08:20'), ...ana('s1'), stageKey: 'cut', quantity: 1 },
    { id: 'p2', type: 'stage_progress', at: at('09:20'), ...ana('s1'), stageKey: 'cut', quantity: 2 },
    // A pause of 30 minutes does not count.
    { id: 'pause', type: 'paused', at: at('09:30'), ...ana('s1') },
    { id: 'resume', type: 'resumed', at: at('10:00'), ...ana('s2'), workStageKey: 'cut' },
    { id: 'p3', type: 'stage_progress', at: at('10:15'), ...ana('s2'), stageKey: 'cut', quantity: 1 },
    // Another stage starts its own count from the change of stage.
    { id: 'change', type: 'stage_changed', at: at('10:20'), ...ana('s2'), workStageKey: 'weld' },
    { id: 'p4', type: 'stage_progress', at: at('10:50'), ...ana('s2'), stageKey: 'weld', quantity: 1 },
    // Someone else on the same stage has their own time.
    { id: 'bruno', type: 'started', at: at('10:00'), ...by(2, 's3'), workStageKey: 'weld' },
    { id: 'p5', type: 'stage_progress', at: at('10:45'), ...by(2, 's3'), stageKey: 'weld', quantity: 1 },
  ]
  const times = pieceWorkTimes(events)
  assert.deepEqual(['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => minutes(times, id)), [20, 60, 25, 30, 45])
  assert.equal(piecesText(events[1], times.get('p1')), '+1 peça - 20 minutos')
  assert.equal(piecesText(events[2], times.get('p2')), '+2 peças - 30 minutos por peça')
  assert.equal(piecesText({ quantity: 1 }, 95 * 60000), '+1 peça - 1 hora e 35 minutos')
  assert.equal(piecesText({ quantity: 3 }, undefined), '+3 peças', 'without a known time only the pieces show')
})

test('records older than the start event use the duration kept at the end of the session', () => {
  const times = pieceWorkTimes([
    { id: 'p1', type: 'stage_progress', at: at('09:00'), ...by(1, 's1'), stageKey: 'cut', quantity: 1 },
    { id: 'end', type: 'paused', at: at('09:10'), ...by(1, 's1'), durationMs: 40 * 60000 },
  ])
  assert.equal(minutes(times, 'p1'), 30)
})
