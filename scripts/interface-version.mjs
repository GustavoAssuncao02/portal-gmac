import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { interfaceSources } from './ensure-build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Every file under a path, in a fixed order (the same on every machine).
function files(target) {
  if (!existsSync(target)) return []
  if (!statSync(target).isDirectory()) return [target]
  return readdirSync(target).sort().flatMap((name) => files(path.join(target, name)))
}

// The version of the interface: a fingerprint of what it is built from, the same sources whose change makes the
// hosting rebuild it (ensure-build.mjs). The same code always gives the same version, so a deploy that changes only the
// server, or a rebuild of the same code, asks nobody to reload; any change of the interface does.
export function interfaceVersion() {
  const hash = createHash('sha256')
  for (const file of interfaceSources.flatMap((source) => files(path.join(root, source)))) {
    hash.update(path.relative(root, file).split(path.sep).join('/'))
    hash.update(readFileSync(file))
  }
  return hash.digest('hex').slice(0, 16)
}

// The built page knows its version (__INTERFACE_VERSION__) and the build publishes the same one in dist/version.json,
// which the server sends without cache. A page left open compares the two and asks to reload (src/NewVersionPrompt.jsx).
export default function interfaceVersionPlugin() {
  const version = interfaceVersion()
  return {
    name: 'gmac-interface-version',
    config: () => ({ define: { __INTERFACE_VERSION__: JSON.stringify(version) } }),
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ version })}\n` }) },
  }
}
