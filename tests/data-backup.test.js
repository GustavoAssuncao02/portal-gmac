import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { backupStore } from '../server/dataBackup.js'

test('one export of the database data per day, kept for 30 days', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'gmac-backup-'))
  let data = { offers: [1] }
  const read = async () => data
  try {
    await mkdir(path.join(dataDirectory, 'backups'))
    await writeFile(path.join(dataDirectory, 'backups', 'auto-2026-09-01.json'), 'antigo')
    await writeFile(path.join(dataDirectory, 'backups', 'before-mysql-1.json'), 'manual')
    const now = Date.parse('2026-10-16T12:00:00Z')
    assert.equal((await backupStore({ dataDirectory, read, now })).created, true)
    data = { offers: [2] }
    assert.equal((await backupStore({ dataDirectory, read, now: now + 3600000 })).created, false, 'the same day is not copied again')
    assert.equal(JSON.parse(await readFile(path.join(dataDirectory, 'backups', 'auto-2026-10-16.json'), 'utf8')).offers[0], 1)
    assert.deepEqual((await readdir(path.join(dataDirectory, 'backups'))).sort(), ['auto-2026-10-16.json', 'before-mysql-1.json'], 'copies older than 30 days go away; manual backups stay')
  } finally { await rm(dataDirectory, { recursive: true, force: true }) }
})
