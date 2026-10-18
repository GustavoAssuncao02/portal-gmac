import { useState } from 'react'
import { downloadFile } from './payablesApi.js'

// Files of the API (proposal PDF, offer and OS attachments) need the session, which a plain link cannot send: the file is
// fetched with it and saved. Without a token, the administrator session is used; the operator panel passes its own.
export default function DownloadLink({ url, name, token, className = 'download-link', children, ...props }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function download(event) {
    event.preventDefault()
    event.stopPropagation()
    if (busy) return
    setBusy(true); setError('')
    try { await downloadFile(url, name, token) } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <><button type="button" className={className} onClick={download} disabled={busy} aria-busy={busy} {...props}>{children}</button>{error && <small className="download-link-error" role="alert">{error}</small>}</>
}
