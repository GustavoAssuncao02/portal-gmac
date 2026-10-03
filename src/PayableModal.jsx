import { useEffect, useId, useRef } from 'react'
import { X, Upload, Trash2 } from 'lucide-react'

export function PayableModal({ title, children, footer, onClose, wide = false, busy = false, className = '' }) {
  const ref = useRef(null), id = useId()
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close() }, [])
  return <dialog ref={ref} className={`payable-modal ${wide ? 'payable-modal--wide' : ''} ${className}`} aria-labelledby={id} onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <header><h2 id={id}>{title}</h2><button type="button" className="payable-icon" aria-label="Fechar janela" title="Fechar janela" disabled={busy} onClick={onClose}><X size={20} /></button></header>
    <div className="payable-modal-body" aria-busy={busy}>{children}</div>{footer && <footer>{footer}</footer>}
  </dialog>
}
export function FilePicker({ files, setFiles, title = 'Anexos', disabled = false }) {
  const input = useRef(null)
  const add = (incoming) => setFiles([...files, ...Array.from(incoming)])
  return <section className="payable-files"><h3>{title}</h3><div className="payable-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!disabled) add(event.dataTransfer.files) }}><Upload size={23} /><button type="button" className="admin-tool-button" disabled={disabled} onClick={() => input.current.click()}>Selecionar arquivos</button><input ref={input} type="file" aria-label={title} multiple hidden disabled={disabled} onChange={(event) => { add(event.target.files); event.target.value = '' }} /></div><ul>{files.map((file, index) => <li key={`${file.name}-${index}`}><span><strong>{file.name}</strong><small>{file.type || 'Arquivo'} · {(file.size / 1024).toFixed(1)} KB</small></span><button type="button" className="payable-icon" aria-label={`Remover ${file.name}`} title="Remover arquivo" disabled={disabled} onClick={() => setFiles(files.filter((_, i) => i !== index))}><Trash2 size={17} /></button></li>)}</ul></section>
}
