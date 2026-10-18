import test from 'node:test'
import assert from 'node:assert/strict'
import { newId } from '../src/newId.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('identifiers are UUIDs with or without crypto.randomUUID, which browsers hide outside HTTPS and localhost', (t) => {
  assert.match(newId(), uuid)
  // Over HTTP on the local network the browser only offers crypto.getRandomValues.
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
  t.after(() => { delete crypto.randomUUID })
  assert.equal(typeof crypto.randomUUID, 'undefined')
  const ids = Array.from({ length: 500 }, newId)
  for (const id of ids) assert.match(id, uuid)
  assert.equal(new Set(ids).size, ids.length)
})
