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

// The notes are read by everybody who uses the portal; the Desenvolvedor screen is seen only by the developers
// (2026-11-27 and 2026-11-28: "não é para ter nada de desenvolvimento nas notas de atualização").
test('release notes never mention the Desenvolvedor screen', () => {
  for (const { version, notes } of releaseNotes) {
    for (const note of notes) assert.doesNotMatch(note, /Desenvolvedor/, `${version}: ${note}`)
  }
})
