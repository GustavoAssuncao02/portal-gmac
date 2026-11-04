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

// The titles of a table order its rows: `columns` are { key, label, value(row) to sort, numeric (starts from the largest;
// also dates, from the latest) }; text starts from A and a second click reverses. Rows without a value always stay last.
// With no `initialKey` the rows keep their own order until a title is clicked.
export function useTableSort(rows, columns, initialKey = null) {
  const [sort, setSort] = useState({ key: initialKey, direction: 1 })
  const column = columns.find((item) => item.key === sort.key)
  const compare = (left, right) => {
    const a = column.value(left), b = column.value(right), emptyA = a == null || a === '', emptyB = b == null || b === ''
    if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1
    return sort.direction * (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' }))
  }
  const sortBy = (key) => setSort((current) => ({ key, direction: current.key === key ? -current.direction : columns.find((item) => item.key === key)?.numeric ? -1 : 1 }))
  return { rows: column?.value ? [...rows].sort(compare) : rows, sort, sortBy, columns }
}
// The same for a table drawn inside other content: `children` receives the sorted list.
export function SortableRows({ rows, columns, initialKey, children }) {
  return children(useTableSort(rows, columns, initialKey))
}
export { cellValue } from './tableSort.js'

// `columns`: the same, plus `search`: the columns the search looks in.
export function useRegistryList(rows, columns, initialKey) {
  const [query, setQuery] = useState('')
  const term = plain(query.trim()), digits = query.replace(/\D/g, '')
  const searchable = columns.filter((column) => column.search)
  const matches = (row) => !term || searchable.some((column) => plain(column.value(row)).includes(term) || digits.length >= 3 && String(column.value(row) ?? '').replace(/\D/g, '').includes(digits))
  return { query, setQuery, ...useTableSort(rows.filter(matches), columns, initialKey) }
}

export function RegistryToolbar({ list, total, singular, plural, placeholder }) {
  const shown = list.rows.length
  return <div className="registry-toolbar">
    <label className="payable-search registry-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label={`Buscar ${plural}`} placeholder={placeholder} value={list.query} onChange={(event) => list.setQuery(event.target.value)} /></label>
    <span className="registry-count" role="status">{shown === total ? `${total} ${total === 1 ? singular : plural}` : `${shown} de ${total} ${plural}`}</span>
  </div>
}

// `as="span"` for the lists drawn with rows of cells instead of a table.
export function SortHeader({ column, list, className, as: Cell = 'th' }) {
  if (!column.value) return <Cell className={className}>{column.label}</Cell>
  const { sort, sortBy } = list
  return <Cell className={className} role={Cell === 'th' ? undefined : 'columnheader'} aria-sort={sort.key === column.key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button className="sort-header-button" type="button" onClick={() => sortBy(column.key)}>{column.label}{sort.key !== column.key ? <ArrowUpDown size={12} aria-hidden="true" /> : sort.direction === 1 ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />}</button></Cell>
}
