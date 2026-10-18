import { execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// dist/ is not in the repository: on the hosting, every deploy from GitHub brings new sources without the interface.
// In production (or with BUILD_ON_START=true, for a hosted test environment that keeps the test login) the interface
// is rebuilt before the server starts whenever a source is newer than the last build.
// Locally nothing happens: development uses Vite and the tests build on their own.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sources = ['src', 'public', 'index.html', 'vite.config.js', 'package-lock.json', 'scripts/build-dark-theme.mjs']

function newest(target) {
  if (!existsSync(target)) return 0
  const info = statSync(target)
  if (!info.isDirectory()) return info.mtimeMs
  return Math.max(0, ...readdirSync(target).map((name) => newest(path.join(target, name))))
}

export function interfaceOutdated() {
  const built = path.join(root, 'dist', 'index.html')
  if (!existsSync(built)) return true
  return Math.max(...sources.map((source) => newest(path.join(root, source)))) > statSync(built).mtimeMs
}

export function ensureInterfaceBuild({ env = process.env } = {}) {
  if ((env.NODE_ENV !== 'production' && env.BUILD_ON_START !== 'true') || !interfaceOutdated()) return false
  console.log('Gerando a interface (npm run build)...')
  execSync('npm run build', { cwd: root, stdio: 'inherit' })
  return true
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) ensureInterfaceBuild()
