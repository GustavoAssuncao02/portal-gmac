import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

// Daily copy of the data file (offers, OS, finance), kept for `keep` days in data/backups. It protects against a wrong
// change or a damaged file; it does not replace a copy outside the server (see README, "Backup").
const PREFIX = 'auto-', DAY = 86400000
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10)

export async function backupStore({ dataDirectory, now = Date.now(), keep = 30 }) {
  const source = path.join(dataDirectory, 'offers.json'), folder = path.join(dataDirectory, 'backups')
  try { await stat(source) } catch { return null }
  await mkdir(folder, { recursive: true })
  const target = path.join(folder, `${PREFIX}${dayOf(now)}.json`)
  let created = false
  try { await stat(target) } catch { await copyFile(source, target); created = true }
  const oldest = dayOf(now - (keep - 1) * DAY)
  for (const name of await readdir(folder)) {
    const day = name.startsWith(PREFIX) && name.endsWith('.json') ? name.slice(PREFIX.length, -5) : null
    if (day && day < oldest) await rm(path.join(folder, name), { force: true })
  }
  return { file: target, created }
}

// On start and once a day; a failure is logged and never stops the server.
export function startDataBackups(dataDirectory, { keep = 30 } = {}) {
  const run = () => backupStore({ dataDirectory, keep }).catch((error) => console.error('Falha no backup diário dos dados:', error.message))
  run()
  return setInterval(run, 6 * 60 * 60 * 1000).unref()
}
