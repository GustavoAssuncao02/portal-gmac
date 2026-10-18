import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { backupStore } from '../server/dataBackup.js'

test('one copy of the data per day, kept for 30 days', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'gmac-backup-'))
  try {
    assert.equal(await backupStore({ dataDirectory }), null, 'nothing to copy yet')
    await writeFile(path.join(dataDirectory, 'offers.json'), '{"offers":[1]}')
    await mkdir(path.join(dataDirectory, 'backups'))
    await writeFile(path.join(dataDirectory, 'backups', 'auto-2026-09-01.json'), 'antigo')
    await writeFile(path.join(dataDirectory, 'backups', 'before-mysql-1.json'), 'manual')
    const now = Date.parse('2026-10-16T12:00:00Z')
    assert.equal((await backupStore({ dataDirectory, now })).created, true)
    await writeFile(path.join(dataDirectory, 'offers.json'), '{"offers":[2]}')
    assert.equal((await backupStore({ dataDirectory, now: now + 3600000 })).created, false, 'the same day is not copied again')
    assert.equal(await readFile(path.join(dataDirectory, 'backups', 'auto-2026-10-16.json'), 'utf8'), '{"offers":[1]}')
    assert.deepEqual((await readdir(path.join(dataDirectory, 'backups'))).sort(), ['auto-2026-10-16.json', 'before-mysql-1.json'], 'copies older than 30 days go away; manual backups stay')
  } finally { await rm(dataDirectory, { recursive: true, force: true }) }
})
