import { useId, useState } from 'react'
import { normalizeSearch } from './offerResources.js'
import { documentDigits, documentKind, maskClientDocument } from '../server/clientDocument.js'
import { samePiece } from './PieceNameInput.jsx'

// Same behavior as the piece search: typing shows the registered clients (by name or CPF/CNPJ); choosing one fills its
// document. A name that is not on the list is still accepted, typed with its document by hand.
export default function ClientNameInput({ value, documentValue, onChange, onSelect, clients, required, label }) {
  const [open, setOpen] = useState(false), listId = useId(), hintId = useId()
  const query = normalizeSearch(value), digits = documentDigits(value)
  const matches = clients.filter((client) => !query || normalizeSearch(client.name).includes(query) || (digits.length >= 3 && documentDigits(client.document).includes(digits))).slice(0, 8)
  const known = clients.find((client) => samePiece(client.name, value))
  const choose = (client) => { onSelect(client); setOpen(false) }
  const hint = !known ? 'Cliente não cadastrado: informe o CNPJ/CPF.' : documentDigits(documentValue) === documentDigits(known.document) ? `Cliente cadastrado · ${documentKind(known.document)} preenchido.` : 'Cliente cadastrado: escolha-o na lista para preencher o CNPJ/CPF.'
  return <div className="material-autocomplete client-autocomplete">
    <div className="material-autocomplete-input">
      <input value={value} autoComplete="off" role="combobox" aria-label={label} aria-describedby={value.trim() ? hintId : undefined} aria-expanded={open} aria-controls={listId} required={required} placeholder="Digite para buscar os clientes cadastrados"
        onFocus={() => setOpen(true)} onBlur={(event) => { if (!event.currentTarget.closest('.client-autocomplete')?.contains(event.relatedTarget)) setOpen(false) }}
        onChange={(event) => { onChange(event.target.value); setOpen(true) }}
        onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); if (event.key === 'ArrowDown' && matches.length) { event.preventDefault(); document.getElementById(listId)?.querySelector('button')?.focus() } }} />
      <span>⌄</span>
    </div>
    {open && <div className="material-suggestions" id={listId} role="listbox" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      {matches.length > 0 ? matches.map((client) => <button type="button" role="option" aria-selected={known?.id === client.id} key={client.id} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(client)}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = [...event.currentTarget.parentElement.querySelectorAll('button')]; const next = buttons.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1); buttons[(next + buttons.length) % buttons.length]?.focus() } if (event.key === 'Escape') setOpen(false) }}>
        <strong>{client.name}</strong><small>{documentKind(client.document)} {maskClientDocument(client.document)}</small></button>)
        : <div className="material-suggestion-empty"><strong>Cliente não cadastrado</strong><span>{value.trim() || 'Digite o nome da empresa ou do cliente'}</span></div>}
    </div>}
    {value.trim() && <small className="piece-autocomplete-hint" id={hintId}>{hint}</small>}
  </div>
}
