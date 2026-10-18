import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'

// Lists of the registrations (clients, suppliers, employees, administrators): search, count and sortable headers.
export const documentLabel = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return String(value ?? '')
}
const plain = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// `columns`: { key, label, value(row) to sort and search, numeric (starts from the largest), search }. Text starts from A.
export function useRegistryList(rows, columns, initialKey) {
  const [query, setQuery] = useState(''), [sort, setSort] = useState({ key: initialKey, direction: 1 })
  const term = plain(query.trim()), digits = query.replace(/\D/g, '')
  const searchable = columns.filter((column) => column.search)
  const matches = (row) => !term || searchable.some((column) => plain(column.value(row)).includes(term) || digits.length >= 3 && String(column.value(row) ?? '').replace(/\D/g, '').includes(digits))
  const column = columns.find((item) => item.key === sort.key)
  const compare = (left, right) => { const a = column.value(left), b = column.value(right); return sort.direction * (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { numeric: true, sensitivity: 'base' })) }
  const filtered = rows.filter(matches)
  const sortBy = (key) => setSort((current) => ({ key, direction: current.key === key ? -current.direction : columns.find((item) => item.key === key)?.numeric ? -1 : 1 }))
  return { query, setQuery, rows: column ? [...filtered].sort(compare) : filtered, sort, sortBy }
}

export function RegistryToolbar({ list, total, singular, plural, placeholder }) {
  const shown = list.rows.length
  return <div className="registry-toolbar">
    <label className="payable-search registry-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label={`Buscar ${plural}`} placeholder={placeholder} value={list.query} onChange={(event) => list.setQuery(event.target.value)} /></label>
    <span className="registry-count" role="status">{shown === total ? `${total} ${total === 1 ? singular : plural}` : `${shown} de ${total} ${plural}`}</span>
  </div>
}

export function SortHeader({ column, list, className }) {
  if (!column.value) return <th className={className}>{column.label}</th>
  const { sort, sortBy } = list
  return <th className={className} aria-sort={sort.key === column.key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => sortBy(column.key)}>{column.label}{sort.key !== column.key ? <ArrowUpDown size={12} aria-hidden="true" /> : sort.direction === 1 ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />}</button></th>
}
