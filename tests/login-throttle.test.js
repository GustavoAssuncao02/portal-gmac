import assert from 'node:assert/strict'
import test from 'node:test'
import { createLoginThrottle } from '../server/loginThrottle.js'

test('login throttle: counts failures per key, blocks at the limit, and a success clears it', () => {
  let clock = 1_000_000
  const throttle = createLoginThrottle({ limit: 5, windowMs: 3_600_000, now: () => clock })
  const key = '1.2.3.4|12345678901'

  assert.deepEqual(throttle.check(key), { blocked: false, remaining: 5, retryAfterMs: 0 })
  // Each wrong password lowers the remaining count; after the third, two are left (what the screen warns about).
  assert.equal(throttle.fail(key).remaining, 4)
  assert.equal(throttle.fail(key).remaining, 3)
  assert.equal(throttle.fail(key).remaining, 2)
  assert.equal(throttle.fail(key).remaining, 1)
  const fifth = throttle.fail(key)
  assert.equal(fifth.blocked, true)
  assert.equal(fifth.remaining, 0)
  assert.ok(fifth.retryAfterMs > 0)
  assert.equal(throttle.check(key).blocked, true)

  // Another IP for the same CPF is independent: nobody locks out an account from elsewhere.
  assert.equal(throttle.check('9.9.9.9|12345678901').blocked, false)
  // A correct login clears the key.
  throttle.succeed(key)
  assert.deepEqual(throttle.check(key), { blocked: false, remaining: 5, retryAfterMs: 0 })
})

test('login throttle: failures older than the window drop off, freeing new attempts', () => {
  let clock = 0
  const throttle = createLoginThrottle({ limit: 5, windowMs: 3_600_000, now: () => clock })
  const key = 'ip|cpf'
  for (let i = 0; i < 5; i += 1) throttle.fail(key)
  assert.equal(throttle.check(key).blocked, true)
  clock += 3_600_001
  // The hour passed: the window is empty again.
  assert.deepEqual(throttle.check(key), { blocked: false, remaining: 5, retryAfterMs: 0 })
  assert.equal(throttle.size, 0)
})
