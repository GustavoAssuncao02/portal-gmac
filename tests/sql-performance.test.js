import test from 'node:test'
import assert from 'node:assert/strict'
import { ordersWithOperations, operationStates } from '../server/reportData.js'
import { createAccountService } from '../server/accounts.js'

test('filtered histories preserve input order, duplicates, missing states and event order across query batches', async () => {
  const orders = Array.from({ length: 502 }, (_, index) => ({ code: `OS-${index}` }))
  orders.push({ code: 'os-0' }, orders[0], { code: 'missing', operation: { stale: true } })
  const state = { status: 'paused' }
  const events = [{ id: 'first' }, { id: 'second' }]
  let queries = 0
  const pool = { async execute(sql, params) {
    queries++
    assert.ok(params.length <= 500)
    assert.match(sql, /WHERE order_code IN/)
    // Emulate MySQL's case-insensitive comparison: OS-0 can appear in two batches.
    if (!params.some((code) => code.toLowerCase() === 'os-0')) return [[]]
    return [sql.includes('order_operation_events') ? events.map((event) => ({ order_code: 'OS-0', data: event })) : [{ order_code: 'OS-0', data: JSON.stringify(state) }]]
  } }
  const result = await ordersWithOperations(orders, pool)
  assert.equal(queries, 4)
  assert.deepEqual(result.map((row) => row.code), orders.map((row) => row.code))
  assert.deepEqual(result[0].operationEvents, events)
  assert.deepEqual(result.at(-2).operationEvents, events)
  assert.equal(result[502].operation, undefined)
  assert.deepEqual(result[502].operationEvents, [])
  assert.equal(result.at(-1).operation, undefined)
  assert.deepEqual(orders.at(-1).operation, { stale: true })
  assert.deepEqual(await ordersWithOperations([], pool), [])
  assert.equal(queries, 4, 'No database round trip for empty input')
  assert.equal(await ordersWithOperations(orders), orders, 'JSON fallback stays unchanged')
})

test('order codes stay parameters, including punctuation and SQL-like text', async () => {
  const code = "OS-' OR 1=1 --"
  const pool = { async execute(sql, params) {
    assert.ok(!sql.includes(code))
    assert.deepEqual(params, [code])
    return [[{ order_code: code, data: {} }]]
  } }
  assert.equal((await operationStates([{ code }], pool))[0].order_code, code)
})

test('public administrator reads omit hashes in SQL; authentication retains private fields', async () => {
  const queries = []
  const row = { id: 1, name: 'Admin', cpf: '12345678901', passwordHash: 'fixture-hash' }
  const service = createAccountService({ async execute(sql) { queries.push(sql); return [[row]] } })
  const publicRows = await service.admins()
  const privateRows = await service.admins(true)
  assert.equal(Object.hasOwn(publicRows[0], 'passwordHash'), false)
  assert.equal(privateRows[0].passwordHash, row.passwordHash)
  assert.ok(!queries[0].includes('password_hash'))
  assert.ok(queries[1].includes('password_hash'))
})
