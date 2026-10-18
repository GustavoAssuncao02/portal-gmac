// Entry point for hosting process managers that start a file instead of "npm start" (pm2 and forever use server.js).
// The build check comes first and uses built-in modules only: it installs the dependencies when they are missing.
import { ensureInterfaceBuild } from './scripts/ensure-build.mjs'

ensureInterfaceBuild()
await import('dotenv/config')
await import('./server/index.js')
