// Registries kept in the store (suppliers, machines, labor services) stay in the order they were created: a new one
// goes to the end. The lists sent to the screens come by name instead, as in the database registries (clients,
// employees, stock), with accents and capitals ignored and numbers in order ("Torno 2" before "Torno 10").
const collator = new Intl.Collator('pt-BR', { numeric: true })

export const byName = (left, right) => collator.compare(String(left?.name ?? '').trim(), String(right?.name ?? '').trim())
export const sortedByName = (rows) => [...(rows || [])].sort(byName)
