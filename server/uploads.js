import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

// Attachments have no size limit. The body of the request goes to the disk as it arrives, never whole in memory, and the
// record is saved only afterwards, outside the transaction of the portal data (a long upload would hold it).
// Returns the size and `discard`, which removes the file when its record is not saved; null without a file.
export async function receiveFile(request, directory, id) {
  if (!request.is('application/octet-stream')) return null
  await mkdir(directory, { recursive: true })
  const target = path.join(directory, id)
  const discard = () => rm(target, { force: true }).catch(() => {})
  const output = createWriteStream(target)
  try { await pipeline(request, output) } catch (error) { await discard(); throw error }
  if (!output.bytesWritten) { await discard(); return null }
  return { size: output.bytesWritten, discard }
}

// Sends a stored file as it is read, also without loading it whole. A missing file fails before anything is sent.
export async function sendStoredFile(response, file) {
  await stat(file)
  await pipeline(createReadStream(file), response)
}
