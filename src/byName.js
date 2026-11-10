// Lists of registries by name, with accents and capitals ignored and numbers in order ("Torno 2" before "Torno 10"),
// as the server sends them (server/byName.js).
const collator = new Intl.Collator('pt-BR', { numeric: true })

export const byName = (left, right) => collator.compare(String(left?.name ?? '').trim(), String(right?.name ?? '').trim())
