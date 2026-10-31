import { createReadStream, createWriteStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const MB = 1024 * 1024

// Attachments (drawings, 3D models, photos, receipts, contracts) up to UPLOAD_MAX_MB each, 500 MB by default: far above
// the documents the portal receives, but one request can no longer fill the disk. The disk also keeps a reserve
// (UPLOAD_DISK_RESERVE_MB, 256 MB by default): a file that would eat into it is refused, so the portal, its daily backups
// and its logs never run out of space. Both can be raised in the .env if GMAC ever needs bigger files.
export function uploadLimits(env = process.env) {
  return { maxBytes: (Number(env.UPLOAD_MAX_MB) || 500) * MB, reserveBytes: (Number(env.UPLOAD_DISK_RESERVE_MB) || 256) * MB }
}
const failure = (status, message) => Object.assign(new Error(message), { status })
const tooBig = (limits) => failure(413, `O arquivo passa de ${Math.round(limits.maxBytes / MB)} MB, o limite por anexo.`)

// Free space where the files go. Older Node versions have no statfs: then the reserve is not checked.
async function freeBytes(directory) {
  try { const { bavail, bsize } = await fs.statfs(directory); return bavail * bsize } catch { return Infinity }
}

// The body of the request goes to the disk as it arrives, never whole in memory, and the record is saved only
// afterwards, outside the transaction of the portal data (a long upload would hold it).
// Returns the size and `discard`, which removes the file when its record is not saved; null without a file.
export async function receiveFile(request, directory, id, limits = uploadLimits()) {
  if (!request.is('application/octet-stream')) return null
  // The browser announces the size: a file over the limit, or one the disk has no room for, is refused before it travels.
  const declared = Number(request.get('content-length')) || 0
  if (declared > limits.maxBytes) throw tooBig(limits)
  await fs.mkdir(directory, { recursive: true })
  if (await freeBytes(directory) - declared < limits.reserveBytes) throw failure(507, 'O servidor está sem espaço em disco para este arquivo. Avise o TI.')
  const target = path.join(directory, id)
  const discard = () => fs.rm(target, { force: true }).catch(() => {})
  // Without an announced size the bytes are counted as they arrive.
  let received = 0
  const counter = new Transform({ transform(chunk, _encoding, done) { received += chunk.length; done(received > limits.maxBytes ? tooBig(limits) : null, chunk) } })
  const output = createWriteStream(target)
  try { await pipeline(request, counter, output) } catch (error) { await discard(); throw error }
  if (!output.bytesWritten) { await discard(); return null }
  return { size: output.bytesWritten, discard }
}

// Sends a stored file as it is read, also without loading it whole. A missing file fails before anything is sent.
export async function sendStoredFile(response, file) {
  await fs.stat(file)
  await pipeline(createReadStream(file), response)
}
