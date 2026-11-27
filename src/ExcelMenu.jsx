import { useEffect, useRef, useState } from 'react'
import { Sheet, ChevronDown } from 'lucide-react'

// Excel of Contas a Pagar and Contas a Receber: the complete spreadsheet (every column, as before) or the summary
// (main columns and a TOTAL line). Closes on a click outside or Escape.
export default function ExcelMenu({ disabled = false, onExport, size = 16 }) {
  const [open, setOpen] = useState(false), box = useRef(null)
  useEffect(() => {
    if (!open) return
    const outside = (event) => { if (!box.current?.contains(event.target)) setOpen(false) }
    const escape = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  const choose = (variant) => { setOpen(false); onExport(variant) }
  return <span className="excel-menu" ref={box}>
    <button type="button" className="admin-tool-button" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Sheet size={size} />Excel<ChevronDown size={14} aria-hidden="true" /></button>
    {open && <span className="excel-menu-list" role="menu" aria-label="Excel">
      <button type="button" role="menuitem" onClick={() => choose('full')}>Completo<small>Todas as colunas</small></button>
      <button type="button" role="menuitem" onClick={() => choose('summary')}>Resumo<small>Colunas principais e total</small></button>
    </span>}
  </span>
}
