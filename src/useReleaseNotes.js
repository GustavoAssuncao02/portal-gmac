import { useEffect, useState } from 'react'
import { payableRequest } from './payablesApi.js'
import { latestOnly, pollWhileVisible } from './polling.js'
import { releaseNotes } from './releaseNotes.js'

export function useReleaseNotes() {
  const [notes, setNotes] = useState(releaseNotes)
  useEffect(() => {
    let active = true
    const read = latestOnly(() => payableRequest('/release-notes'))
    const refresh = () => read(({ items }) => {
      if (!active || !Array.isArray(items)) return
      const byVersion = new Map(items.map(({ version, notes }) => [version, notes]))
      // The browser keeps its own version and dates even if a newer build was just published.
      setNotes(releaseNotes.map((release) => ({ ...release, notes: byVersion.get(release.version) ?? release.notes })))
    }).catch(() => {})
    refresh()
    const stop = pollWhileVisible(refresh, 60000, ['release-notes'])
    return () => { active = false; stop() }
  }, [])
  return notes
}
