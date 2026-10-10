import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { ordersWithOperations } from '../server/reportData.js'
import { employeeActivityQuery } from '../server/employeeActivity.js'
import { optimizeSqlIndexes, performanceIndexes } from '../scripts/sql-performance-indexes.mjs'

const options = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '' }
const database = `gmac_test_sql_${randomUUID().replaceAll('-', '')}`
assert.match(database, /^gmac_test_sql_[a-f0-9]{32}$/)
assert.notEqual(database, process.env.DB_NAME)
const admin = await mysql.createConnection(options)
let pool
const oldHistory = (id, range) => ({
  sql: `SELECT order_code AS orderCode, data FROM order_operation_events
    WHERE (JSON_UNQUOTE(JSON_EXTRACT(data, '$.employeeId')) = ? OR
      (JSON_UNQUOTE(JSON_EXTRACT(data, '$.type')) = 'admin_interrupted' AND
        JSON_UNQUOTE(JSON_EXTRACT(data, '$.sessionId')) IN
          (SELECT JSON_UNQUOTE(JSON_EXTRACT(data, '$.sessionId')) FROM order_operation_events
            WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.employeeId')) = ?)))${range ? ' AND occurred_at >= ? AND occurred_at < ?' : ''}
    ORDER BY occurred_at DESC, seq DESC`,
  params: range ? [id, id, new Date(range.start), new Date(range.end)] : [id, id],
})
async function oldOrders(orders) {
  const [states] = await pool.execute('SELECT order_code, data FROM order_operations')
  const [events] = await pool.execute('SELECT order_code, data FROM order_operation_events ORDER BY seq')
  const parse = (value) => typeof value === 'string' ? JSON.parse(value) : value
  const map = new Map(states.map((row) => [row.order_code, parse(row.data)]))
  return orders.map((order) => ({ ...order, operation: map.get(order.code), operationEvents: events.filter((event) => event.order_code === order.code).map((event) => parse(event.data)) }))
}
async function timed(task) {
  const times = []
  for (let i = 0; i < 4; i++) { const start = performance.now(); await task(); if (i) times.push(performance.now() - start) }
  return Number(times.sort((a, b) => a - b)[1].toFixed(2))
}
try {
  await admin.query(`CREATE DATABASE \`${database}\``)
  pool = mysql.createPool({ ...options, database, multipleStatements: true })
  let schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8')
  schema = schema.slice(schema.indexOf('CREATE TABLE'))
  for (const index of performanceIndexes) schema = schema.replace(`  INDEX ${index.name} (${index.columns.join(', ')}),\n`, '')
  await pool.query(schema)
  const orderValues = Array.from({ length: 200 }, (_, i) => [`OS-${i}`, JSON.stringify({ status: 'paused', activeSessions: [] })])
  await pool.query('INSERT INTO order_operations (order_code, data) VALUES ?', [orderValues])
  const eventValues = []
  for (let i = 0; i < 6000; i++) {
    const employeeId = i % 11 === 0 ? 'legacy-employee' : i % 11
    const at = new Date(Date.UTC(2026, 8, 1 + i % 60, 12))
    const interrupted = i % 120 === 0
    const event = { id: randomUUID(), type: interrupted ? 'admin_interrupted' : 'started', sessionId: `session-${Math.floor(i / 4)}`, employeeId: interrupted ? null : employeeId, at: at.toISOString() }
    if (i % 97 === 0) delete event.sessionId
    if (i % 89 === 0) event.sessionId = null
    eventValues.push([event.id, `OS-${i % 200}`, JSON.stringify(event), at])
  }
  // A session outside the date filter still identifies its later interruption.
  for (const event of [
    { type: 'started', employeeId: 7, sessionId: 'boundary', at: '2026-09-01T12:00:00Z' },
    { type: 'admin_interrupted', employeeId: null, sessionId: 'boundary', at: '2026-10-10T12:00:00Z' },
    { type: 'admin_interrupted', employeeId: 7, sessionId: 'boundary', at: '2026-10-10T12:00:00Z' },
  ]) { event.id = randomUUID(); eventValues.push([event.id, 'OS-1', JSON.stringify(event), new Date(event.at)]) }
  for (let offset = 0; offset < eventValues.length; offset += 500) await pool.query('INSERT INTO order_operation_events (id, order_code, data, occurred_at) VALUES ?', [eventValues.slice(offset, offset + 500)])
  await pool.execute("INSERT INTO inventory_materials (name) VALUES ('Performance fixture')")
  await pool.query('INSERT INTO inventory_movements (material_id, movement_type, quantity_kg, balance_after_kg, order_code) VALUES ?', [Array.from({ length: 3000 }, (_, i) => [1, i % 2 ? 'exit' : 'entry', 1, 1, `OS-${i % 200}`])])
  await pool.query('ANALYZE TABLE order_operation_events, inventory_movements, order_operations')
  const orders = [{ code: 'OS-1' }, { code: 'OS-9' }, { code: 'missing' }, { code: 'OS-1' }]
  const baseline = await oldOrders(orders)
  const range = { start: Date.parse('2026-10-10T03:00:00Z'), end: Date.parse('2026-10-11T03:00:00Z') }
  const movementSql = "SELECT id FROM inventory_movements WHERE order_code = ? AND movement_type = 'exit'"
  const historySql = 'SELECT data FROM order_operation_events WHERE order_code = ? ORDER BY seq'
  const plansBefore = {
    movements: (await pool.execute('EXPLAIN ' + movementSql, ['OS-1']))[0],
    history: (await pool.execute('EXPLAIN ' + historySql, ['OS-1']))[0],
  }
  const oldQuery = oldHistory('7', range)
  const beforeMs = await timed(() => oldOrders(orders))
  const oldEmployeeMs = await timed(() => pool.execute(oldQuery.sql, oldQuery.params))
  console.log('Baseline captured; checking index creation and equivalent result sets.')
  const connection = await pool.getConnection()
  try {
    const created = await optimizeSqlIndexes(connection, { apply: true })
    assert.ok(created.every((item) => item.status === 'created'))
    assert.ok((await optimizeSqlIndexes(connection, { apply: true })).every((item) => item.status === 'already-present'))
  } finally { connection.release() }
  assert.deepEqual(await ordersWithOperations(orders, pool), baseline)
  let cases = 0
  for (const id of ['7', 'legacy-employee', 'unknown', '0', 'null']) for (const period of [range, null]) {
    const previous = oldHistory(id, period), next = employeeActivityQuery(id, period)
    assert.deepEqual((await pool.execute(next.sql, next.params))[0], (await pool.execute(previous.sql, previous.params))[0], `History changed: ${id}, ${period ? 'day' : 'all'}`)
    cases++
  }
  const nextQuery = employeeActivityQuery('7', range)
  const afterMs = await timed(() => ordersWithOperations(orders, pool))
  const newEmployeeMs = await timed(() => pool.execute(nextQuery.sql, nextQuery.params))
  const plansAfter = {
    movements: (await pool.execute('EXPLAIN ' + movementSql, ['OS-1']))[0],
    history: (await pool.execute('EXPLAIN ' + historySql, ['OS-1']))[0],
    employee: (await pool.execute('EXPLAIN ' + nextQuery.sql, nextQuery.params))[0],
  }
  assert.equal(plansAfter.movements[0].key, 'idx_inventory_movements_order_type')
  console.log(JSON.stringify({ verified: true, events: eventValues.length, employeeEquivalenceCases: cases, selectedOrdersReturnedEvents: baseline.slice(0, 2).reduce((n, order) => n + order.operationEvents.length, 0), medianMs: { orderHistoryBefore: beforeMs, orderHistoryAfter: afterMs, employeeBefore: oldEmployeeMs, employeeAfter: newEmployeeMs }, plansBefore, plansAfter }, null, 2))
  assert.ok(plansAfter.history[0].possible_keys.includes('idx_order_operation_events_order_seq'))
} finally {
  await pool?.end()
  // The only removable database is the unique, validated test schema above.
  assert.match(database, /^gmac_test_sql_[a-f0-9]{32}$/)
  assert.notEqual(database, process.env.DB_NAME)
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await admin.end()
}
