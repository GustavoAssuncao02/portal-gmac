import { useEffect, useId, useRef, useState } from 'react'
import { X, Upload, Trash2, Download } from 'lucide-react'
import { downloadFile } from './payablesApi.js'

export function PayableModal({ title, children, footer, onClose, wide = false, busy = false, className = '' }) {
  const ref = useRef(null), id = useId()
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close() }, [])
  return <dialog ref={ref} className={`payable-modal ${wide ? 'payable-modal--wide' : ''} ${className}`} aria-labelledby={id} onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <header><h2 id={id}>{title}</h2><button type="button" className="payable-icon" aria-label="Fechar janela" title="Fechar janela" disabled={busy} onClick={onClose}><X size={20} /></button></header>
    <div className="payable-modal-body" aria-busy={busy}>{children}</div>{footer && <footer>{footer}</footer>}
  </dialog>
}
export const previewable = (file) => file.contentType?.startsWith('image/') || file.contentType === 'application/pdf'
// Files are fetched with the session token and shown from a local blob, so nothing is downloaded to disk.
export function FilePreview({ url, file, onClose }) {
  const [objectUrl, setObjectUrl] = useState(''), [error, setError] = useState('')
  useEffect(() => {
    let created = ''
    fetch(url, { headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}` } }).then(async (response) => {
      if (!response.ok) throw new Error('Não foi possível abrir o arquivo.')
      created = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: file.contentType }))
      setObjectUrl(created)
    }).catch((caught) => setError(caught.message))
    return () => { if (created) URL.revokeObjectURL(created) }
  }, [url, file.contentType])
  return <PayableModal title={file.name} wide className="payable-preview" onClose={onClose} footer={<><button type="button" className="admin-tool-button" onClick={() => downloadFile(url, file.name).catch((caught) => setError(caught.message))}><Download size={15} />Baixar</button><button type="button" className="admin-tool-button admin-tool-button--primary" onClick={onClose}>Fechar</button></>}>
    {error ? <p className="admin-tool-error" role="alert">{error}</p> : !objectUrl ? <p>Carregando arquivo...</p> : file.contentType === 'application/pdf' ? <iframe className="payable-preview-frame" title={`Pré-visualização de ${file.name}`} src={objectUrl} /> : <img className="payable-preview-image" src={objectUrl} alt={file.name} />}
  </PayableModal>
}
export function FilePicker({ files, setFiles, title = 'Anexos', disabled = false }) {
  const input = useRef(null)
  const add = (incoming) => setFiles([...files, ...Array.from(incoming)])
  return <section className="payable-files"><h3>{title}</h3><div className="payable-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!disabled) add(event.dataTransfer.files) }}><Upload size={23} /><button type="button" className="admin-tool-button" disabled={disabled} onClick={() => input.current.click()}>Selecionar arquivos</button><input ref={input} type="file" aria-label={title} multiple hidden disabled={disabled} onChange={(event) => { add(event.target.files); event.target.value = '' }} /></div><ul>{files.map((file, index) => <li key={`${file.name}-${index}`}><span><strong>{file.name}</strong><small>{file.type || 'Arquivo'} · {(file.size / 1024).toFixed(1)} KB</small></span><button type="button" className="payable-icon" aria-label={`Remover ${file.name}`} title="Remover arquivo" disabled={disabled} onClick={() => setFiles(files.filter((_, i) => i !== index))}><Trash2 size={17} /></button></li>)}</ul></section>
}
