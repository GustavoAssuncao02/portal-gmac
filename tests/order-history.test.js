import test from 'node:test'
import assert from 'node:assert/strict'
import { realChangedFields, describeOrderChanges, orderHistory } from '../server/orderHistory.js'

// The edition of OS-2026-0006: only the requested deadline changed; the rest is the same value written another way.
const changes = {
  changed: ['cnpj', 'deadline', 'resources', 'proposal'],
  before: { cnpj: '00.000.000/0000-00', deadline: '2027-01-01', resources: { materials: [], laborEntries: [{ id: 'l', type: 'machine', hours: 10, resource: 'Corte a Plasma 01', machineId: 4, hourlyRate: 0 }], stages: ['cut-bend'] }, proposal: { key: 'A', serviceValue: 100, profit: 57.6 } },
  after: { cnpj: '00000000000000', deadline: '2026-12-29', resources: { materials: [], laborEntries: [{ id: 'l', type: 'machine', hours: 10, resource: 'Corte a Plasma 01', machineId: 4, hourlyRate: 0, laborServiceId: null }], stages: ['cut-bend'], urgency: 'normal', stageTimes: {} }, proposal: { key: 'A', serviceValue: 100, profit: 0 } },
}

test('an edition lists only what really changed', () => {
  assert.deepEqual(realChangedFields(changes), ['deadline'])
  assert.deepEqual(describeOrderChanges(changes), ['Prazo solicitado: 01/01/2027 → 29/12/2026'])
  const real = { ...changes, changed: [...changes.changed], after: { ...changes.after, cnpj: '11111111000191', resources: { ...changes.after.resources, urgency: 'emergency' } } }
  assert.deepEqual(realChangedFields(real), ['cnpj', 'deadline', 'resources'])
  assert.ok(describeOrderChanges(real).includes('Tipo de proposta: Normal → Emergencial'))
})

test('editions saved before the check are shown with the real differences', () => {
  const event = { id: 'e', type: 'order_edited', at: '2026-10-16T04:50:39Z', changes, details: 'Campos atualizados: CNPJ, Prazo solicitado, Materiais e processo, Proposta. Justificativa do novo prazo: apenas para testar a funcionalidade' }
  const [shown] = orderHistory({}, { code: 'OS-2026-0006', createdAt: '2026-10-01T00:00:00Z' }, [event], true).filter((item) => item.type === 'order_edited')
  assert.equal(shown.details, 'Campos atualizados: Prazo solicitado. Justificativa do novo prazo: apenas para testar a funcionalidade')
  assert.deepEqual(shown.lines, ['Prazo solicitado: 01/01/2027 → 29/12/2026'])
})
