import assert from 'node:assert/strict'
import test from 'node:test'
import { latestOnly } from '../src/polling.js'

// Reads whose answers the test releases one by one, in the order it wants.
function controlledReads() {
  const pending = []
  return { read: () => new Promise((resolve, reject) => { pending.push({ resolve, reject }) }), pending }
}

test('an older answer arriving last does not replace the newer one', async () => {
  const { read, pending } = controlledReads(), shown = []
  const latest = latestOnly(read)
  const older = latest((value) => shown.push(value)), newer = latest((value) => shown.push(value))
  pending[1].resolve('depois de salvar')
  await newer
  pending[0].resolve('antes de salvar')
  assert.equal(await older, 'antes de salvar', 'whoever waits still gets its answer')
  assert.deepEqual(shown, ['depois de salvar'])
})

test('answers in order are all shown', async () => {
  const { read, pending } = controlledReads(), shown = []
  const latest = latestOnly(read)
  const first = latest((value) => shown.push(value)), second = latest((value) => shown.push(value))
  pending[0].resolve('primeira')
  await first
  pending[1].resolve('segunda')
  await second
  assert.deepEqual(shown, ['primeira', 'segunda'])
})

test('a newer read that fails leaves the older answer on the screen and reports the failure', async () => {
  const { read, pending } = controlledReads(), shown = []
  const latest = latestOnly(read)
  const older = latest((value) => shown.push(value)), newer = latest((value) => shown.push(value))
  pending[1].reject(new Error('sem conexão'))
  await assert.rejects(newer, /sem conexão/)
  pending[0].resolve('antes de falhar')
  await older
  assert.deepEqual(shown, ['antes de falhar'])
})
