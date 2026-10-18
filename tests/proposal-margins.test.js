import test from 'node:test'
import assert from 'node:assert/strict'
import { proposalMargins, marginLimits } from '../server/proposalMath.js'

const accepted = (key, margin, extra = {}) => ({ pieceTracking: true, proposal: { key, margin }, ...extra })

test('each option averages its own accepted proposals, starting from its original value', () => {
  assert.deepEqual(proposalMargins([]).map((row) => row.margin), [15, 20, 25, 30])
  const rows = proposalMargins([accepted('A', 17), accepted('A', 19), accepted('C', 35), { proposal: { key: 'A', margin: 90 } }, accepted('B', 90, { atypical: true })])
  assert.deepEqual(rows.map((row) => [row.key, row.margin, row.accepted]), [['A', 17, 2], ['B', 20, 0], ['C', 30, 1], ['D', 33, 0]], 'old OS and atypical ones stay out; D gives way to C')
})

test('the options never cross and keep 3 points between them', () => {
  const rows = proposalMargins([accepted('A', 29), accepted('A', 29)])
  assert.deepEqual(rows.map((row) => row.margin), [24.3, 27.3, 30.3, 33.3])
  assert.deepEqual(marginLimits([15, 20, 25, 30], 0), { min: 0, max: 17 })
  assert.deepEqual(marginLimits([15, 20, 25, 30], 1), { min: 18, max: 22 })
  assert.deepEqual(marginLimits([15, 20, 25, 30], 3), { min: 28, max: 1000 })
})

test('the acceptance rate counts accepted and declined proposals, never the ones still waiting', () => {
  const orders = [accepted('A', 15), accepted('A', 16, { atypical: true }), accepted('B', 20)]
  const offers = [{ status: 'rejected', proposalDecline: { key: 'A' } }, { status: 'proposed', proposal: { key: 'A' } }, { status: 'rejected' }]
  const [a, b, c] = proposalMargins(orders, offers)
  assert.deepEqual([a.won, a.declined, a.rate, a.accepted], [2, 1, 67, 1], 'an atypical OS was still accepted, but leaves the average')
  assert.equal(b.rate, 100)
  assert.equal(c.rate, null, 'no answer yet')
})

test('price-list proposals (Nestlé, Etiqueta) stay out of the average margin but count in the acceptance rate', () => {
  const orders = [
    accepted('A', 19),
    { pieceTracking: true, proposal: { key: 'A', margin: -19.3, layout: 'etiqueta', document: { model: 'etiqueta' } } },
    { pieceTracking: true, proposal: { key: 'A', margin: 40, layout: 'nestle', document: { model: 'nestle' } } },
    { pieceTracking: true, proposal: { key: 'A', margin: 21, layout: 'model-a', document: { model: 'model-a' } } },
  ]
  const [a] = proposalMargins(orders, [{ status: 'rejected', proposalDecline: { key: 'A' } }])
  assert.deepEqual([a.average, a.accepted], [18.3, 2], '(15 + 19 + 21) ÷ 3: the letter models only')
  assert.deepEqual([a.won, a.declined, a.rate], [4, 1, 80], 'all four accepted proposals count in the rate')
})
