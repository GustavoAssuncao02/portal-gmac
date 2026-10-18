import { useId, useState } from 'react'
import { normalizeSearch } from './offerResources.js'

// Same behavior as the material search: typing shows the pieces already made; a name that is not on the list is a new piece.
export const samePiece = (left, right) => normalizeSearch(left).replace(/\s+/g, ' ') === normalizeSearch(right).replace(/\s+/g, ' ')

export default function PieceNameInput({ value, onChange, pieces, required, label }) {
  const [open, setOpen] = useState(false), listId = useId(), hintId = useId()
  const query = normalizeSearch(value)
  const matches = pieces.filter((piece) => !query || normalizeSearch(piece.name).includes(query)).slice(0, 8)
  const known = pieces.find((piece) => samePiece(piece.name, value))
  const choose = (piece) => { onChange(piece.name); setOpen(false) }
  return <div className="material-autocomplete piece-autocomplete">
    <div className="material-autocomplete-input">
      <input value={value} autoComplete="off" role="combobox" aria-label={label} aria-describedby={value.trim() ? hintId : undefined} aria-expanded={open} aria-controls={listId} required={required} placeholder="Digite para buscar as peças já feitas"
        onFocus={() => setOpen(true)} onBlur={(event) => { if (!event.currentTarget.closest('.piece-autocomplete')?.contains(event.relatedTarget)) setOpen(false) }}
        onChange={(event) => { onChange(event.target.value); setOpen(true) }}
        onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); if (event.key === 'ArrowDown' && matches.length) { event.preventDefault(); document.getElementById(listId)?.querySelector('button')?.focus() } }} />
      <span>⌄</span>
    </div>
    {open && <div className="material-suggestions" id={listId} role="listbox" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      {matches.length > 0 ? matches.map((piece) => <button type="button" role="option" aria-selected={known?.key === piece.key} key={piece.key} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(piece)}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = [...event.currentTarget.parentElement.querySelectorAll('button')]; const next = buttons.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1); buttons[(next + buttons.length) % buttons.length]?.focus() } if (event.key === 'Escape') setOpen(false) }}>
        <strong>{piece.name}</strong><small>{piece.orders ? `${piece.orders} ${piece.orders === 1 ? 'OS feita' : 'OS feitas'}` : 'Ainda sem OS'}</small></button>)
        : <div className="material-suggestion-empty"><strong>Nova peça</strong><span>{value.trim() || 'Digite o nome da peça ou do serviço'}</span></div>}
    </div>}
    {value.trim() && <small className="piece-autocomplete-hint" id={hintId}>{known ? 'Peça já feita: materiais, etapas e tempos virão preenchidos com base no histórico.' : 'Nova peça: os dados serão definidos nesta oferta.'}</small>}
  </div>
}
