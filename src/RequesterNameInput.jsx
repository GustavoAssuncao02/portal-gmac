import { useId, useState } from 'react'
import { normalizeSearch } from './offerResources.js'
import { samePiece } from './PieceNameInput.jsx'
import { contactKinds } from './RequestersScreen.jsx'

// Same behavior as the client search, limited to the requesters of the chosen client. A name that is not on the list is
// still accepted: when the client is registered, the requester is registered with the offer. The buyer field is the same,
// with `kind` naming the buyers (Cadastros > Compradores) and `who` describing the person.
export default function RequesterNameInput({ value, onChange, client, requesters, label, kind = contactKinds.requesters, who = 'quem pediu o serviço' }) {
  const [open, setOpen] = useState(false), listId = useId(), hintId = useId()
  const own = client ? requesters.filter((requester) => String(requester.clientId) === String(client.id)) : []
  const query = normalizeSearch(value)
  const matches = own.filter((requester) => !query || normalizeSearch(requester.name).includes(query)).slice(0, 8)
  const known = own.find((requester) => samePiece(requester.name, value))
  const hint = !client ? `Cliente não cadastrado: o ${kind.singular} fica só nesta oferta.` : known ? `${kind.Singular} cadastrado de ${client.name}.` : `Novo ${kind.singular}: será cadastrado em ${client.name} ao adicionar a solicitação.`
  return <div className="material-autocomplete client-autocomplete">
    <div className="material-autocomplete-input">
      <input value={value} autoComplete="off" role="combobox" aria-label={label} aria-describedby={value.trim() ? hintId : undefined} aria-expanded={open && Boolean(client)} aria-controls={listId} maxLength={160}
        placeholder={client ? `Digite para buscar os ${kind.plural} de ${client.name}` : `Nome de ${who}`}
        onFocus={() => setOpen(true)} onBlur={(event) => { if (!event.currentTarget.closest('.client-autocomplete')?.contains(event.relatedTarget)) setOpen(false) }}
        onChange={(event) => { onChange(event.target.value); setOpen(true) }}
        onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); if (event.key === 'ArrowDown' && matches.length) { event.preventDefault(); document.getElementById(listId)?.querySelector('button')?.focus() } }} />
      <span>⌄</span>
    </div>
    {open && client && <div className="material-suggestions" id={listId} role="listbox" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      {matches.length > 0 ? matches.map((requester) => <button type="button" role="option" aria-selected={known?.id === requester.id} key={requester.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(requester.name); setOpen(false) }}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = [...event.currentTarget.parentElement.querySelectorAll('button')]; const next = buttons.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1); buttons[(next + buttons.length) % buttons.length]?.focus() } if (event.key === 'Escape') setOpen(false) }}>
        <strong>{requester.name}</strong><small>{requester.email || client.name}</small></button>)
        : <div className="material-suggestion-empty"><strong>{own.length ? `${kind.Singular} não cadastrado` : `Nenhum ${kind.singular} de ${client.name}`}</strong><span>{value.trim() ? 'Será cadastrado automaticamente ao adicionar.' : `Digite o nome de ${who}.`}</span></div>}
    </div>}
    {value.trim() && <small className="piece-autocomplete-hint" id={hintId}>{hint}</small>}
  </div>
}
