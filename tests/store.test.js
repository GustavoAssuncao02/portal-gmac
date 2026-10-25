import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configureStore, importJsonStore, mutateStore, readStore } from '../server/store.js'
import { createTestDatabase } from './workflowFixture.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const database = await createTestDatabase('gmac_test_store')
await configureStore(database.pool)
test.after(() => database.drop())

const rows = async (table) => (await database.pool.query(`SELECT record_key AS id, data FROM \`${table}\` ORDER BY position`))[0].map((row) => [row.id, JSON.parse(row.data)])

test('collections become one table each; only changed rows are written and order is kept', async () => {
  await mutateStore((store) => { store.payableEvents = [{ id: 'b', at: 1 }, { id: 'c', at: 2 }]; store.orders = [{ code: 'OS-1' }]; store.payableSequence = 7 })
  assert.deepEqual(await rows('portal_payable_events'), [['b', { id: 'b', at: 1 }], ['c', { id: 'c', at: 2 }]])
  assert.deepEqual(await rows('portal_orders'), [['OS-1', { code: 'OS-1' }]], 'OS are keyed by their code')
  const [[before]] = await database.pool.query("SELECT updated_at AS at FROM portal_payable_events WHERE record_key = 'c'")
  await new Promise((resolve) => setTimeout(resolve, 20))
  await mutateStore((store) => { store.payableEvents.unshift({ id: 'a', at: 0 }); store.payableEvents.splice(2, 0, { id: 'b2', at: 1.5 }); store.payableEvents[0].at = -1 })
  const [[after]] = await database.pool.query("SELECT updated_at AS at FROM portal_payable_events WHERE record_key = 'c'")
  assert.equal(after.at.getTime(), before.at.getTime(), 'a row that did not change is not rewritten')
  assert.deepEqual((await readStore()).payableEvents.map((item) => item.id), ['a', 'b', 'b2', 'c'])
  await mutateStore((store) => { store.payableEvents.reverse(); store.payableEvents = store.payableEvents.filter((item) => item.id !== 'b') })
  assert.deepEqual((await rows('portal_payable_events')).map(([id]) => id), ['c', 'b2', 'a'], 'reordering and deleting reach the table')
  assert.equal((await readStore()).payableSequence, 7)
})

test('lists without ids, objects and removed keys are kept as single values', async () => {
  await mutateStore((store) => { store.silentMaterialRequestIds = ['x', 'y']; store.bankSettings = { dateToleranceDays: 3 }; store.mixed = [{ id: 1 }, { id: 1 }] })
  const [values] = await database.pool.query("SELECT name, data FROM portal_values WHERE name IN ('silentMaterialRequestIds', 'bankSettings', 'mixed') ORDER BY name")
  assert.deepEqual(values.map((row) => row.name), ['bankSettings', 'mixed', 'silentMaterialRequestIds'], 'repeated ids cannot be rows')
  await mutateStore((store) => { store.mixed = [{ id: 1 }, { id: 2 }]; delete store.bankSettings })
  const store = await readStore()
  assert.deepEqual(store.mixed, [{ id: 1 }, { id: 2 }])
  assert.equal(store.bankSettings, undefined)
  assert.equal((await database.pool.query("SELECT COUNT(*) AS total FROM portal_values WHERE name IN ('mixed', 'bankSettings')"))[0][0].total, 0, 'the list moved to its own table')
  await mutateStore((store) => { store.mixed = [] })
  assert.deepEqual((await readStore()).mixed, [], 'an emptied collection is still an array')
})

test('a failed change, or a failed external commit, leaves the data as it was', async () => {
  await mutateStore((store) => { store.receivables = [{ id: 'REC-1', valueCents: 100 }] })
  await assert.rejects(mutateStore((store) => { store.receivables[0].valueCents = 1; throw new Error('regra') }), /regra/)
  let rolledBack = false
  await assert.rejects(mutateStore((store) => { store.receivables.push({ id: 'REC-2' }) }, { commit: () => { throw new Error('estoque') }, rollback: () => { rolledBack = true } }), /estoque/)
  assert.equal(rolledBack, true)
  assert.deepEqual((await readStore()).receivables, [{ id: 'REC-1', valueCents: 100 }])
  assert.deepEqual(await rows('portal_receivables'), [['REC-1', { id: 'REC-1', valueCents: 100 }]])
})

test('what one caller changes in its copy never leaks into the next read', async () => {
  const copy = await readStore()
  copy.receivables[0].valueCents = 999
  const returned = await mutateStore((store) => store.receivables[0])
  returned.valueCents = 555
  assert.equal((await readStore()).receivables[0].valueCents, 100)
})

test('a change written by another process is seen on the next read', async () => {
  await readStore()
  await database.pool.query("UPDATE portal_receivables SET data = JSON_SET(data, '$.valueCents', 250) WHERE record_key = 'REC-1'")
  await database.pool.query('UPDATE portal_store SET revision = revision + 1 WHERE id = 1')
  assert.equal((await readStore()).receivables[0].valueCents, 250)
  await mutateStore((store) => { store.receivables[0].valueCents += 1 })
  assert.equal((await readStore()).receivables[0].valueCents, 251)
})

test('the old offers.json is imported once into an empty database and moved to backups', async () => {
  const other = await createTestDatabase('gmac_test_store')
  const directory = await mkdtemp(path.join(root, 'test-results', 'store-import-'))
  try {
    const { configureStore: configure, importJsonStore: importJson, readStore: read } = await import(`../server/store.js?import-${Date.now()}`)
    await configure(other.pool)
    const file = path.join(directory, 'offers.json')
    await writeFile(file, JSON.stringify({ offers: [{ id: 'o1', code: 'OF-1' }], orders: [], payableSequence: 4, proposalSettings: { margin: 30 } }))
    assert.equal(await importJson(file, path.join(directory, 'backups')), true)
    const store = await read()
    assert.deepEqual([store.offers[0].code, store.payableSequence, store.proposalSettings.margin], ['OF-1', 4, 30])
    assert.match((await readdir(path.join(directory, 'backups')))[0], /^offers-before-mysql-.*\.json$/)
    await writeFile(file, JSON.stringify({ offers: [] }))
    assert.equal(await importJson(file, path.join(directory, 'backups')), false, 'a database with data is never overwritten')
    assert.equal((await read()).offers.length, 1)
  } finally {
    await other.drop()
    await rm(directory, { recursive: true, force: true })
  }
  await mkdir(path.join(root, 'test-results'), { recursive: true })
  assert.equal(await importJsonStore(path.join(root, 'test-results', 'missing.json'), root), false)
})
