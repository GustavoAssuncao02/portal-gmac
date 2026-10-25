import test from 'node:test'
import assert from 'node:assert/strict'
import { currentVersion, releaseNotes } from '../src/releaseNotes.js'

const parts = (version) => version.split('.').map(Number)
const newer = (a, b) => { const [x, y] = [parts(a), parts(b)]; const index = x.findIndex((value, i) => value !== y[i]); return index >= 0 && x[index] > y[index] }

test('release notes list each version once, newest first, with a date and at least one note', () => {
  assert.equal(currentVersion, releaseNotes[0].version)
  for (const [index, { version, date, notes }] of releaseNotes.entries()) {
    assert.match(version, /^\d+\.\d+\.\d{2,}$/)
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(!Number.isNaN(Date.parse(date)), `${version} has a valid date`)
    assert.ok(notes.length > 0 && notes.every((note) => typeof note === 'string' && note.trim()), `${version} has notes`)
    const previous = releaseNotes[index + 1]
    if (!previous) continue
    assert.ok(newer(version, previous.version), `${version} comes after ${previous.version}`)
    assert.ok(date >= previous.date, `${version} is not dated before ${previous.version}`)
  }
})
