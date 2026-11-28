import { releaseNotes } from '../src/releaseNotes.js'
import { releaseNoticeDescription } from './notificationEvents.js'

export function listReleaseNotes(store) {
  return releaseNotes.map((release) => ({
    ...release,
    notes: store.releaseNoteEdits?.[release.version] ?? release.notes,
  }))
}

export function editReleaseNotes(store, version, { notes, previousNotes } = {}) {
  const release = releaseNotes.find((entry) => entry.version === version)
  if (!release) throw Object.assign(new Error('Versão não encontrada.'), { status: 404 })
  if (typeof notes !== 'string' || notes.length > 20000) {
    throw Object.assign(new Error('Informe o texto da nota com até 20.000 caracteres.'), { status: 400 })
  }
  const lines = notes.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) throw Object.assign(new Error('Informe pelo menos um item na nota.'), { status: 400 })

  const current = store.releaseNoteEdits?.[version] ?? release.notes
  const item = { ...release, notes: lines }
  const changed = JSON.stringify(lines) !== JSON.stringify(current)
  if (!changed) return { item, changed }
  if (JSON.stringify(previousNotes) !== JSON.stringify(current)) {
    throw Object.assign(new Error('Esta nota foi alterada depois que você abriu o editor. Copie sua edição e reabra a janela para conferir a nota atual.'), { status: 409 })
  }

  store.releaseNoteEdits ||= {}
  if (JSON.stringify(lines) === JSON.stringify(release.notes)) delete store.releaseNoteEdits[version]
  else store.releaseNoteEdits[version] = lines

  const notice = store.operationalNotifications?.find((entry) => entry.id === `release:${version}` && entry.type === 'release')
  if (notice) notice.description = releaseNoticeDescription(lines)
  return { item, changed }
}
