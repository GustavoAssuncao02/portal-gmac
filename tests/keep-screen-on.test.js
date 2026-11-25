import test from 'node:test'
import assert from 'node:assert/strict'
import { keepScreenOn } from '../src/keepScreenOn.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))

// A browser with the Screen Wake Lock: `refuse` makes the next requests fail, `drop()` is the browser releasing the lock.
function fakeBrowser() {
  const listeners = { document: {}, window: {} }
  const on = (target) => (kind, handler) => { (listeners[target][kind] ||= new Set()).add(handler) }
  const off = (target) => (kind, handler) => { listeners[target][kind]?.delete(handler) }
  const env = {
    requests: 0, refuse: false, current: null,
    document: { visibilityState: 'visible', addEventListener: on('document'), removeEventListener: off('document') },
    window: { addEventListener: on('window'), removeEventListener: off('window') },
    navigator: { wakeLock: { async request(type) {
      assert.equal(type, 'screen')
      env.requests += 1
      if (env.refuse) throw new Error('NotAllowedError')
      const releaseHandlers = new Set()
      const sentinel = { released: false, addEventListener: (kind, handler) => releaseHandlers.add(handler), async release() { if (sentinel.released) return; sentinel.released = true; releaseHandlers.forEach((handler) => handler()) } }
      env.current = sentinel
      return sentinel
    } } },
    fire: (target, kind) => listeners[target][kind]?.forEach((handler) => handler()),
    listenerCount: () => Object.values(listeners).flatMap((group) => Object.values(group)).reduce((total, set) => total + set.size, 0),
  }
  return env
}

test('keeps the screen on when opened and asks again when the page comes back', async () => {
  const env = fakeBrowser()
  const stop = keepScreenOn(env)
  await tick()
  assert.equal(env.requests, 1)
  assert.equal(env.current.released, false)

  // The page is hidden (power button, another app): the browser drops the lock; nothing is asked while hidden.
  env.document.visibilityState = 'hidden'
  await env.current.release()
  env.fire('document', 'visibilitychange')
  await tick()
  assert.equal(env.requests, 1)

  env.document.visibilityState = 'visible'
  env.fire('document', 'visibilitychange')
  await tick()
  assert.equal(env.requests, 2)
  assert.equal(env.current.released, false)

  // A touch while the lock is held asks nothing more.
  env.fire('window', 'pointerdown')
  await tick()
  assert.equal(env.requests, 2)
  stop()
})

test('a refused lock is asked again on the next touch', async () => {
  const env = fakeBrowser()
  env.refuse = true
  const stop = keepScreenOn(env)
  await tick()
  assert.equal(env.requests, 1)
  assert.equal(env.current, null)

  env.refuse = false
  env.fire('window', 'pointerdown')
  await tick()
  assert.equal(env.requests, 2)
  assert.equal(env.current.released, false)
  stop()
})

test('leaving the screen releases the lock and stops listening', async () => {
  const env = fakeBrowser()
  const stop = keepScreenOn(env)
  await tick()
  stop()
  await tick()
  assert.equal(env.current.released, true)
  assert.equal(env.listenerCount(), 0)
})

test('a browser without the wake lock is left as it is', () => {
  const env = fakeBrowser()
  delete env.navigator.wakeLock
  const stop = keepScreenOn(env)
  assert.equal(env.listenerCount(), 0)
  stop()
})
