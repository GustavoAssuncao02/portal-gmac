import test from 'node:test'
import assert from 'node:assert/strict'
import { createOfferPresence, PRESENCE_STALE_MS } from '../server/offerPresence.js'

// "Criando oferta" in real time (2026-11-25): beats keep the offer "Criando oferta"; leaving, or no beat for the stale
// period, makes it "Em aberto" with the time of the last edit. Only the changes of `active` are saved.
function setup(editingBy = { id: 7, name: 'Nilson Gomes', at: '2026-11-25T12:00:00.000Z' }) {
  let clock = Date.parse('2026-11-25T12:00:00.000Z'), writes = 0
  const store = { offers: [{ id: 'o1', status: 'creating', createdAt: '2026-11-25T12:00:00.000Z', editingBy }] }
  const presence = createOfferPresence({
    readStore: async () => structuredClone(store),
    mutateStore: async (change) => { const before = JSON.stringify(store); const result = await change(store); if (JSON.stringify(store) !== before) writes += 1; return result },
    now: () => clock,
  })
  return { presence, store, tick: (ms) => { clock += ms }, writes: () => writes, offer: () => store.offers[0] }
}

test('beats keep the offer being created; leaving makes it open at once', async () => {
  const { presence, tick, writes, offer } = setup()
  assert.equal(await presence.beat('o1', 7), true)
  assert.equal(offer().editingBy.active, true)
  for (let i = 0; i < 4; i += 1) { tick(30000); await presence.beat('o1', 7) }
  assert.equal(writes(), 1, 'the beats in between are not saved')
  // Somebody else (or nobody) changes nothing.
  assert.equal(await presence.beat('o1', 8), false)
  assert.equal(await presence.leave('o1', 8), false)
  tick(5000)
  assert.equal(await presence.leave('o1', 7), true)
  assert.equal(offer().editingBy.active, false)
  assert.equal(offer().editingBy.lastActiveAt, '2026-11-25T12:02:05.000Z')
  assert.equal(offer().editingBy.name, 'Nilson Gomes', 'the name stays for "Em aberto"')
  // Coming back makes it "Criando oferta" again.
  tick(60000)
  await presence.beat('o1', 7)
  assert.equal(offer().editingBy.active, true)
})

test('without beats (tab closed, connection lost) the offer becomes open from the last beat', async () => {
  const { presence, tick, offer } = setup()
  await presence.beat('o1', 7)
  tick(30000)
  await presence.beat('o1', 7)
  tick(PRESENCE_STALE_MS - 1000)
  assert.equal(await presence.sweep(), 0)
  tick(2000)
  assert.equal(await presence.sweep(), 1)
  assert.equal(offer().editingBy.active, false)
  assert.equal(offer().editingBy.lastActiveAt, '2026-11-25T12:00:30.000Z')
})

test('after a restart an offer still marked active waits one stale period for its beat', async () => {
  const { presence, tick, offer } = setup({ id: 7, name: 'Nilson Gomes', at: '2026-11-25T11:00:00.000Z', active: true, lastActiveAt: '2026-11-25T11:58:00.000Z' })
  assert.equal(await presence.sweep(), 0)
  tick(PRESENCE_STALE_MS)
  assert.equal(await presence.sweep(), 1)
  assert.equal(offer().editingBy.lastActiveAt, '2026-11-25T11:58:00.000Z', 'the last time saved before the restart')
})
