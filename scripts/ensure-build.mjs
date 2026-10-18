import { execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { enabled, isProduction } from '../server/envFlags.js'

// dist/ and node_modules/ are not in the repository: on the hosting, a deploy from GitHub brings the sources only, and
// the hosting does not always run "npm install". In production (or with BUILD_ON_START=true, for a hosted test
// environment that keeps the test login) the dependencies are installed when missing or older than package-lock.json,
// and the interface is rebuilt whenever a source is newer than the last build, before the server starts.
// Locally nothing happens: development uses Vite and the tests build on their own.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sources = ['src', 'public', 'index.html', 'vite.config.js', 'package-lock.json', 'scripts/build-dark-theme.mjs']

function newest(target) {
  if (!existsSync(target)) return 0
  const info = statSync(target)
  if (!info.isDirectory()) return info.mtimeMs
  return Math.max(0, ...readdirSync(target).map((name) => newest(path.join(target, name))))
}

// npm writes node_modules/.package-lock.json at the end of every install.
export function dependenciesOutdated() {
  const installed = path.join(root, 'node_modules', '.package-lock.json')
  return !existsSync(installed) || statSync(path.join(root, 'package-lock.json')).mtimeMs > statSync(installed).mtimeMs
}

export function interfaceOutdated() {
  const built = path.join(root, 'dist', 'index.html')
  if (!existsSync(built)) return true
  return Math.max(...sources.map((source) => newest(path.join(root, source)))) > statSync(built).mtimeMs
}

export function ensureInterfaceBuild({ env = process.env } = {}) {
  if (!isProduction(env) && !enabled(env.BUILD_ON_START)) return false
  // The build tools are regular dependencies, so the development ones (browser tests) are left out.
  if (dependenciesOutdated()) {
    console.log('Instalando as dependências (npm install)...')
    execSync('npm install --omit=dev --no-audit --no-fund', { cwd: root, stdio: 'inherit' })
  }
  if (!interfaceOutdated()) return false
  console.log('Gerando a interface (npm run build)...')
  execSync('npm run build', { cwd: root, stdio: 'inherit' })
  return true
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) ensureInterfaceBuild()
