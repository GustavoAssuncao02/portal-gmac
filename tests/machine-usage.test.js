import test from 'node:test'
import assert from 'node:assert/strict'
import { machineDay, machineUsageReport, mergeIntervals } from '../server/machineUsage.js'
import { reportRange } from '../server/reportData.js'

const at = (day, hour, minute = 0) => `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-03:00`
const machines = [
  { id: 'torno', name: 'Torno CNC', type: 'Torno', sector: 'Usinagem', maintenanceHistory: [{ since: at(3, 14), until: at(3, 16), reason: 'Troca de óleo', startedBy: 'Rafael', endedBy: 'Rafael' }] },
  { id: 'fresa', name: 'Fresadora', type: 'Fresa', sector: 'Usinagem' },
  { id: 'serra', name: 'Serra fita', type: 'Serra', sector: 'Corte' },
]
const orders = () => [{ code: 'OS-1', service: 'Eixo', quantity: 4, operation: { activeSessions: [] }, operationEvents: [
  { type: 'started', sessionId: 'a', employeeId: 1, employeeName: 'Ana', machineId: 'torno', machineName: 'Torno CNC', workStageName: 'Tornearia', at: at(3, 8) },
  { type: 'stage_progress', sessionId: 'a', employeeId: 1, employeeName: 'Ana', machineId: 'torno', stageName: 'Tornearia', quantity: 2, stageTotal: 2, at: at(3, 9, 30) },
  { type: 'paused', sessionId: 'a', employeeId: 1, employeeName: 'Ana', machineId: 'torno', reason: 'Almoço', durationMs: 4 * 3600000, at: at(3, 12) },
  { type: 'resumed', sessionId: 'b', employeeId: 1, employeeName: 'Ana', machineId: 'torno', machineName: 'Torno CNC', workStageName: 'Tornearia', at: at(3, 13) },
  { type: 'machine_changed', sessionId: 'b', employeeId: 1, employeeName: 'Ana', machineId: 'torno', nextMachineId: 'fresa', nextMachineName: 'Fresadora', at: at(3, 14) },
  { type: 'paused', sessionId: 'b', employeeId: 1, employeeName: 'Ana', machineId: 'fresa', reason: 'Fim do turno', at: at(3, 15) },
] }, { code: 'OS-2', service: 'Polia', quantity: 1, operation: { activeSessions: [{ id: 'c', employeeId: 2, employeeName: 'Bruno', machineId: 'fresa', machineName: 'Fresadora', stageName: 'Freza', startedAt: at(4, 7), tokenHash: 'secret' }] }, operationEvents: [
  { type: 'started', sessionId: 'c', employeeId: 2, employeeName: 'Bruno', machineId: 'fresa', machineName: 'Fresadora', workStageName: 'Freza', at: at(4, 7) },
] }]

test('overlapping intervals count once', () => {
  assert.deepEqual(mergeIntervals([{ start: 5, end: 9 }, { start: 1, end: 3 }, { start: 2, end: 6 }, { start: 10, end: 10 }]), [{ start: 1, end: 9 }])
})

test('the period report ranks machines by use and splits each one into use, maintenance and idle time', () => {
  const now = Date.parse(at(4, 9))
  const report = machineUsageReport(machines, orders(), reportRange('2026-10-03', '2026-10-04'), now)
  const hours = (ms) => ms / 3600000
  assert.equal(hours(report.availableMs), 33)
  assert.deepEqual(report.machines.map((row) => row.name), ['Torno CNC', 'Fresadora', 'Serra fita'])
  const [torno, fresa, serra] = report.machines
  assert.equal(hours(torno.usedMs), 5)
  assert.equal(hours(torno.maintenanceMs), 2)
  assert.equal(hours(torno.idleMs), 26)
  assert.equal(torno.sessions, 2)
  assert.equal(torno.pieces, 2)
  assert.equal(torno.pauses, 1)
  assert.deepEqual(torno.topOperator, { name: 'Ana', ms: 5 * 3600000 })
  assert.equal(hours(fresa.usedMs), 3)
  assert.equal(fresa.inUse, true)
  assert.equal(fresa.operators, 2)
  assert.equal(serra.usedMs, 0)
  assert.equal(report.summary.mostUsed.name, 'Torno CNC')
  assert.equal(report.summary.mostIdle.name, 'Serra fita')
  assert.equal(report.summary.pieces, 2)
  assert.deepEqual(report.daily.map((day) => [day.date, hours(day.usedMs), day.machines]), [['2026-10-03', 6, 2], ['2026-10-04', 2, 1]])
  assert.equal(hours(report.hourly[8].usedMs), 2)
  assert.equal(report.summary.peakHour, 8)
  assert.deepEqual(report.pauseReasons, [{ reason: 'Almoço', count: 1 }, { reason: 'Fim do turno', count: 1 }])
  assert.deepEqual(report.operators.map((person) => [person.name, hours(person.ms), person.machines, person.pieces]), [['Ana', 6, 2, 2], ['Bruno', 2, 1, 0]])
  assert.ok(!JSON.stringify(report).includes('secret'))
})

test('the day of a machine lists who used it, the pauses, the maintenance and the idle gaps', () => {
  const day = machineDay(machines[0], orders(), '2026-10-03', Date.parse(at(4, 9)))
  assert.equal(day.summary.usedMs, 5 * 3600000)
  assert.equal(day.summary.maintenanceMs, 2 * 3600000)
  assert.equal(day.summary.idleMs, 17 * 3600000)
  assert.equal(day.summary.firstStartAt, new Date(at(3, 8)).toISOString())
  assert.equal(day.summary.lastEndAt, new Date(at(3, 14)).toISOString())
  assert.deepEqual(day.summary.operators, ['Ana'])
  assert.deepEqual(day.segments.map((part) => [part.kind, part.durationMs / 3600000]), [['idle', 8], ['use', 4], ['idle', 1], ['use', 1], ['maintenance', 2], ['idle', 8]])
  assert.deepEqual(day.events.map((event) => event.type), ['started', 'stage_progress', 'paused', 'resumed', 'machine_changed', 'maintenance_started', 'maintenance_ended'])
  assert.equal(day.events.find((event) => event.type === 'machine_changed').otherResource, 'Fresadora')
  assert.equal(day.sessions[0].stageName, 'Tornearia')

  const fresa = machineDay(machines[1], orders(), '2026-10-04', Date.parse(at(4, 9)))
  assert.equal(fresa.summary.inUse, true)
  assert.equal(fresa.summary.lastEndAt, null)
  assert.deepEqual(fresa.segments.map((part) => part.kind), ['idle', 'use', 'future'])
  assert.equal(fresa.sessions[0].stageName, 'Freza')
  const arrival = machineDay(machines[1], orders(), '2026-10-03', Date.parse(at(4, 9)))
  assert.equal(arrival.events[0].type, 'machine_arrived')
  assert.equal(arrival.events[0].otherResource, '')
})
