// Entry point for hosting process managers that start a file instead of "npm start" (pm2 and forever use server.js).
import 'dotenv/config'
import { ensureInterfaceBuild } from './scripts/ensure-build.mjs'

ensureInterfaceBuild()
await import('./server/index.js')
