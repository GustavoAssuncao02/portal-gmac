import assert from 'node:assert/strict'
import test from 'node:test'
import { operatorConfigured, operatorCredentialsMatch } from '../server/operatorAuth.js'

test('operator login requires eleven digits and supports legacy formatted configuration', (t) => {
  const originalUsername = process.env.OPERATOR_USERNAME
  const originalPassword = process.env.OPERATOR_PASSWORD
  t.after(() => {
    if (originalUsername === undefined) delete process.env.OPERATOR_USERNAME
    else process.env.OPERATOR_USERNAME = originalUsername
    if (originalPassword === undefined) delete process.env.OPERATOR_PASSWORD
    else process.env.OPERATOR_PASSWORD = originalPassword
  })
  process.env.OPERATOR_PASSWORD = 'test-password'
  for (const username of ['00000000000', '000.000.000-00', '000.000.000.00']) {
    process.env.OPERATOR_USERNAME = username
    assert.equal(operatorConfigured(), true)
    assert.equal(operatorCredentialsMatch('00000000000', 'test-password'), true)
    assert.equal(operatorCredentialsMatch('00000000000', 'wrong-password'), false)
    assert.equal(operatorCredentialsMatch('00000000001', 'test-password'), false)
    for (const invalid of ['0000000000', '000000000000', '000.000.000-00', '000.000.000.00', 'abcdefghijk', 0, undefined]) {
      assert.equal(operatorCredentialsMatch(invalid, 'test-password'), false)
    }
  }
  process.env.OPERATOR_USERNAME = '1234'
  assert.equal(operatorConfigured(), false)
})
