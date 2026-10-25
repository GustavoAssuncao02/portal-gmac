import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Daily export of the portal data (offers, OS, finance, registrations) read from the database, kept for `keep` days in
// data/backups. It protects against a wrong change; it does not replace a dump of the database (see README, "Backup").
const PREFIX = 'auto-', DAY = 86400000
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10)

export async function backupStore({ dataDirectory, read, now = Date.now(), keep = 30 }) {
  const folder = path.join(dataDirectory, 'backups')
  await mkdir(folder, { recursive: true })
  const target = path.join(folder, `${PREFIX}${dayOf(now)}.json`)
  let created = false
  try { await stat(target) } catch { await writeFile(target, JSON.stringify(await read(), null, 2), 'utf8'); created = true }
  const oldest = dayOf(now - (keep - 1) * DAY)
  for (const name of await readdir(folder)) {
    const day = name.startsWith(PREFIX) && name.endsWith('.json') ? name.slice(PREFIX.length, -5) : null
    if (day && day < oldest) await rm(path.join(folder, name), { force: true })
  }
  return { file: target, created }
}

// On start and every six hours; a failure is logged and never stops the server.
export function startDataBackups(dataDirectory, read, { keep = 30 } = {}) {
  const run = () => backupStore({ dataDirectory, read, keep }).catch((error) => console.error('Falha no backup diário dos dados:', error.message))
  run()
  return setInterval(run, 6 * 60 * 60 * 1000).unref()
}
