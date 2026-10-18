// Machines grouped by sector, in the order they were registered: [[sector, machines], ...]. A machine of more than one
// sector (the same Têmpera for Usinagem and Caldeiraria) appears in each of them; the same name can also exist in two
// sectors as different machines (Bancada), so the lists to choose a machine show the sector.
export const sectorsOf = (machine) => machine.sectors?.length ? machine.sectors : [String(machine.sector || '').trim() || 'Sem setor']

export function bySector(machines) {
  const groups = new Map()
  for (const machine of machines) {
    for (const sector of sectorsOf(machine)) {
      if (!groups.has(sector)) groups.set(sector, [])
      groups.get(sector).push(machine)
    }
  }
  return [...groups]
}

// "Usinagem, Caldeiraria" (typed in the registration) -> ['Usinagem', 'Caldeiraria'].
export const parseSectors = (text) => [...new Set(String(text || '').split(/[,;]/).map((value) => value.trim()).filter(Boolean))]
