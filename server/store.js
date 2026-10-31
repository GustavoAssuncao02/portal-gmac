import { createHash } from 'node:crypto'
import { readFile, rename, mkdir } from 'node:fs/promises'
import path from 'node:path'

// Offers, OS, finance, registrations and settings live in MySQL. The business code still works on one object (the
// "store") read and changed as a whole; this module maps it to tables:
// - an array whose items all have a unique id (or code, or key) is a collection: one table `portal_<name>`, one row per
//   item, ordered by `position`;
// - anything else (sequences, settings, lists without ids) is one row of `portal_values`.
// Each change runs in a transaction that locks `portal_store` and writes only the rows that changed. The revision number
// in `portal_store` lets every process reuse its copy of the data while nobody else has written.
const KEY_FIELDS = ['id', 'code', 'key']
const DEFAULTS = { offers: [], orders: [], employees: [] }
const MAX_KEY = 191
const BATCH_BYTES = 512 * 1024

let pool = null
let ready = null
let cache = null
let loading = null
let pendingWrite = Promise.resolve()

export async function configureStore(nextPool) {
  if (!nextPool) throw new Error('O banco de dados é obrigatório: configure DB_HOST, DB_USER e DB_NAME.')
  pool = nextPool
  cache = null
  ready = createBaseTables(nextPool)
  await ready
}

export function storePool() {
  if (!pool) throw new Error('O armazenamento do portal ainda não foi ligado ao banco de dados.')
  return pool
}

async function createBaseTables(target) {
  await target.query(`CREATE TABLE IF NOT EXISTS portal_store (
    id TINYINT UNSIGNED PRIMARY KEY,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  await target.query('INSERT IGNORE INTO portal_store (id, revision) VALUES (1, 0)')
  await target.query(`CREATE TABLE IF NOT EXISTS portal_collections (
    name VARCHAR(64) PRIMARY KEY,
    table_name VARCHAR(64) NOT NULL UNIQUE,
    key_field VARCHAR(16) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  await target.query(`CREATE TABLE IF NOT EXISTS portal_values (
    name VARCHAR(64) PRIMARY KEY,
    data LONGTEXT NOT NULL,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CHECK (JSON_VALID(data))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
}

const collectionTable = (target, table) => target.query(`CREATE TABLE IF NOT EXISTS \`${table}\` (
  record_key VARCHAR(${MAX_KEY}) PRIMARY KEY,
  position DOUBLE NOT NULL,
  data LONGTEXT NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY position_order (position),
  CHECK (JSON_VALID(data))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

// payableEvents -> portal_payable_events. Long or clashing names get a short hash so each collection has its own table.
function tableFor(name, taken) {
  const snake = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9_]/g, '_')
  let table = `portal_${snake}`.slice(0, 64)
  if (taken.has(table) || table === 'portal_store' || table === 'portal_values' || table === 'portal_collections') table = `${table.slice(0, 55)}_${createHash('sha1').update(name).digest('hex').slice(0, 8)}`
  return table
}

// The field that identifies every item of the array, or null when the array must be kept as a single value.
function keyFieldOf(list, previous) {
  if (!list.length) return previous || 'id'
  const candidates = previous ? [previous, ...KEY_FIELDS.filter((field) => field !== previous)] : KEY_FIELDS
  for (const field of candidates) {
    const keys = new Set()
    const valid = list.every((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      const value = item[field]
      if ((typeof value !== 'string' && typeof value !== 'number') || value === '') return false
      const key = String(value)
      if (key.length > MAX_KEY || keys.has(key)) return false
      keys.add(key)
      return true
    })
    if (valid) return field
  }
  return null
}

const withDefaults = (data) => { for (const [key, value] of Object.entries(DEFAULTS)) if (data[key] === undefined) data[key] = structuredClone(value); return data }

async function loadFrom(connection) {
  const [[state]] = await connection.query('SELECT revision FROM portal_store WHERE id = 1')
  const [registered] = await connection.query('SELECT name, table_name AS tableName, key_field AS keyField FROM portal_collections')
  const data = {}, collections = new Map(), values = new Map()
  for (const { name, tableName, keyField } of registered) {
    const [rows] = await connection.query(`SELECT record_key AS recordKey, position, data FROM \`${tableName}\` ORDER BY position, record_key`)
    const records = new Map()
    data[name] = rows.map((row) => { records.set(row.recordKey, { json: row.data, position: Number(row.position) }); return JSON.parse(row.data) })
    collections.set(name, { tableName, keyField, records })
  }
  const [rows] = await connection.query('SELECT name, data FROM portal_values')
  for (const row of rows) { data[row.name] = JSON.parse(row.data); values.set(row.name, row.data) }
  return { revision: Number(state.revision), data, collections, values }
}

async function loadSnapshot() {
  const connection = await storePool().getConnection()
  try {
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
    const snapshot = await loadFrom(connection)
    await connection.query('COMMIT')
    return snapshot
  } finally { connection.release() }
}

async function currentRevision(target) {
  const [[state]] = await target.query('SELECT revision FROM portal_store WHERE id = 1')
  return Number(state.revision)
}

// A fresh copy each call: callers may change what they read, as they did with the parsed file.
export async function readStore() {
  await ready
  const revision = await currentRevision(storePool())
  if (cache?.revision !== revision) {
    loading ||= loadSnapshot().finally(() => { loading = null })
    const snapshot = await loading
    if (!cache || snapshot.revision >= cache.revision) cache = snapshot
  }
  return withDefaults(structuredClone(cache.data))
}

// New positions keep the rows that did not move; only inserted items get a position between their neighbours.
function positionsFor(keys, records) {
  const positions = new Map()
  const kept = keys.filter((key) => records.has(key)).map((key) => records.get(key).position)
  const ordered = kept.every((position, index) => index === 0 || position > kept[index - 1])
  if (!ordered) { keys.forEach((key, index) => positions.set(key, index)); return positions }
  let index = 0
  while (index < keys.length) {
    if (records.has(keys[index])) { positions.set(keys[index], records.get(keys[index]).position); index++; continue }
    const start = index
    while (index < keys.length && !records.has(keys[index])) index++
    const count = index - start
    const left = start > 0 ? positions.get(keys[start - 1]) : null
    const right = index < keys.length ? records.get(keys[index]).position : null
    for (let offset = 0; offset < count; offset++) {
      const step = offset + 1
      const position = left === null && right === null ? offset : left === null ? right - (count - offset) : right === null ? left + step : left + (right - left) * step / (count + 1)
      positions.set(keys[start + offset], position)
    }
    if (left !== null && right !== null && (right - left) / (count + 1) < 1e-9) { keys.forEach((key, position) => positions.set(key, position)); return positions }
  }
  return positions
}

function plan(base, draft) {
  const steps = { tables: [], register: [], unregister: [], clear: [], upserts: [], deletes: [], values: [], removeValues: [] }
  const collections = new Map(), values = new Map()
  const taken = new Set([...base.collections.values()].map((entry) => entry.tableName))
  // The names whose data changed (offers, payables...), for whoever follows the changes (onStoreChange).
  const touched = new Set()
  const size = () => Object.values(steps).reduce((total, list) => total + list.length, 0)
  for (const name of new Set([...Object.keys(base.data), ...Object.keys(draft)])) {
    const before = size()
    planName(name)
    if (size() > before) touched.add(name)
  }
  function planName(name) {
    const next = draft[name]
    const previous = base.collections.get(name)
    const keyField = Array.isArray(next) ? keyFieldOf(next, previous?.keyField) : null
    if (next === undefined || !keyField) {
      if (previous) { steps.unregister.push(name); steps.clear.push(previous.tableName) }
      if (next === undefined) { if (base.values.has(name)) steps.removeValues.push(name); return }
      const json = JSON.stringify(next)
      if (base.values.get(name) !== json) steps.values.push([name, json])
      values.set(name, json)
      return
    }
    if (base.values.has(name)) steps.removeValues.push(name)
    let tableName = previous?.tableName
    if (!tableName) { tableName = tableFor(name, taken); taken.add(tableName); steps.tables.push(tableName) }
    const rewrite = !previous || previous.keyField !== keyField
    if (rewrite) { steps.register.push([name, tableName, keyField]); if (previous) steps.clear.push(tableName) }
    const records = rewrite ? new Map() : previous.records
    const keys = next.map((item) => String(item[keyField]))
    const positions = positionsFor(keys, records)
    const nextRecords = new Map()
    next.forEach((item, index) => {
      const key = keys[index], json = JSON.stringify(item), position = positions.get(key), old = records.get(key)
      if (!old || old.json !== json || old.position !== position) steps.upserts.push([tableName, key, position, json])
      nextRecords.set(key, { json, position })
    })
    if (!rewrite) for (const key of records.keys()) if (!nextRecords.has(key)) steps.deletes.push([tableName, key])
    collections.set(name, { tableName, keyField, records: nextRecords })
  }
  const changed = Object.values(steps).some((list) => list.length)
  return { steps, changed, collections, values, touched }
}

// Who wants to know, after each saved change, which names of the store changed (live updates of the screens).
const changeListeners = new Set()
export function onStoreChange(listener) {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}
function announce(names) {
  for (const listener of changeListeners) {
    try { listener(names) } catch (error) { console.error('Falha ao avisar uma mudança dos dados:', error.message) }
  }
}

function batches(rows, size) {
  const groups = []
  let group = [], bytes = 0
  for (const row of rows) {
    const length = size(row)
    if (group.length && (bytes + length > BATCH_BYTES || group.length >= 500)) { groups.push(group); group = []; bytes = 0 }
    group.push(row); bytes += length
  }
  if (group.length) groups.push(group)
  return groups
}

const byTable = (rows) => rows.reduce((map, row) => map.set(row[0], [...(map.get(row[0]) || []), row]), new Map())

async function apply(connection, { steps }) {
  // CREATE TABLE ends the open transaction in MySQL, so new tables are created on another connection first.
  for (const table of steps.tables) await collectionTable(storePool(), table)
  for (const name of steps.unregister) await connection.query('DELETE FROM portal_collections WHERE name = ?', [name])
  for (const table of new Set(steps.clear)) await connection.query(`DELETE FROM \`${table}\``)
  for (const [name, table, keyField] of steps.register) await connection.query('INSERT INTO portal_collections (name, table_name, key_field) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE table_name = VALUES(table_name), key_field = VALUES(key_field)', [name, table, keyField])
  for (const [table, rows] of byTable(steps.deletes)) {
    for (const group of batches(rows, (row) => row[1].length)) await connection.query(`DELETE FROM \`${table}\` WHERE record_key IN (?)`, [group.map((row) => row[1])])
  }
  for (const [table, rows] of byTable(steps.upserts)) {
    for (const group of batches(rows, (row) => row[3].length + row[1].length)) {
      await connection.query(`INSERT INTO \`${table}\` (record_key, position, data) VALUES ? ON DUPLICATE KEY UPDATE position = VALUES(position), data = VALUES(data)`, [group.map(([, key, position, json]) => [key, position, json])])
    }
  }
  if (steps.removeValues.length) await connection.query('DELETE FROM portal_values WHERE name IN (?)', [steps.removeValues])
  for (const group of batches(steps.values, (row) => row[1].length)) await connection.query('INSERT INTO portal_values (name, data) VALUES ? ON DUPLICATE KEY UPDATE data = VALUES(data)', [group])
}

// Changes are applied one at a time. `commit` and `rollback` belong to another SQL transaction opened by the change
// (stock movements): it is committed right before the store, and a failure undoes both.
export function mutateStore(change, { commit, rollback } = {}) {
  const operation = pendingWrite.catch(() => {}).then(async () => {
    await ready
    const connection = await storePool().getConnection()
    let open = false
    try {
      await connection.query('START TRANSACTION')
      open = true
      const [[state]] = await connection.query('SELECT revision FROM portal_store WHERE id = 1 FOR UPDATE')
      const base = cache?.revision === Number(state.revision) ? cache : await loadFrom(connection)
      const draft = withDefaults(structuredClone(base.data))
      const result = await change(draft)
      const writes = plan(base, draft)
      if (writes.changed) {
        await apply(connection, writes)
        await connection.query('UPDATE portal_store SET revision = revision + 1 WHERE id = 1')
      }
      await commit?.()
      await connection.query('COMMIT')
      open = false
      cache = writes.changed ? { revision: base.revision + 1, data: structuredClone(draft), collections: writes.collections, values: writes.values } : base
      if (writes.changed) announce([...writes.touched])
      return result
    } catch (error) {
      if (open) await connection.query('ROLLBACK').catch(() => {})
      await rollback?.()
      throw error
    } finally { connection.release() }
  })
  pendingWrite = operation
  return operation
}

const isEmpty = async () => {
  const [[collections]] = await storePool().query('SELECT COUNT(*) AS total FROM portal_collections')
  const [[values]] = await storePool().query('SELECT COUNT(*) AS total FROM portal_values')
  return !collections.total && !values.total
}

// The portal kept these data in DATA_DIR/offers.json before. On the first start with the database empty, the file is
// copied into the tables and moved to backups/, so it is never read again.
export async function importJsonStore(file, backupDirectory) {
  await ready
  let text
  try { text = await readFile(file, 'utf8') } catch (error) { if (error.code === 'ENOENT') return false; throw error }
  if (!await isEmpty()) return false
  const legacy = JSON.parse(text)
  await mutateStore((draft) => { for (const key of Object.keys(draft)) delete draft[key]; Object.assign(draft, legacy) })
  await mkdir(backupDirectory, { recursive: true })
  await rename(file, path.join(backupDirectory, `offers-before-mysql-${new Date().toISOString().replace(/[:.]/g, '-')}.json`))
  return true
}
