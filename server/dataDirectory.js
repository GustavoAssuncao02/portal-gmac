import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Offers, OS, finance, attachments and statements. On the hosting, DATA_DIR points outside the deployed code,
// so a new deploy from GitHub replaces the code and keeps the data.
export const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data'))
