import { readStore, mutateStore } from './store.js'
import { etiquetaLabor, etiquetaMaterials, nestleLabor, nestleMaterials } from './proposalDefaults.js'
import { stageContract, stageContractRow } from './serviceStages.js'

// The lines of a client's price sheet (`kind`: labor or materials) as saved in Modelos de proposta.
const defaultSheets = { nestle: { labor: nestleLabor, materials: nestleMaterials }, etiqueta: { labor: etiquetaLabor, materials: etiquetaMaterials } }
export function sheetRows(store, model, kind) {
  const saved = store?.proposalSettings?.tables?.[model]?.[kind]
  return Array.isArray(saved) ? saved : defaultSheets[model]?.[kind] || []
}

// A stage of a client's price sheet (Nestlé, Etiqueta of the Belgo) is charged at the normal rate of its line in Modelos de
// proposta, as the materials of the sheet are: the hourly rate of the machine or service only says who does it.
export function sheetHourlyRate(store, code) {
  const model = stageContract(code)
  if (!model) return null
  const row = sheetRows(store, model, 'labor').find((entry) => entry?.id === stageContractRow(code))
  return row && row.normal != null && Number.isFinite(Number(row.normal)) ? Number(row.normal) : null
}

// The labor of an offer comes from its stages: each stage with a planned time and a machine or labor service is one row
// (hora máquina or hora homem), at the hourly rate registered for it (a stage of a price sheet: the rate of its line), so the
// time is typed once. Rows typed by hand before
// this rule (no stage) are kept, except those of a machine or service planned in a stage: they would count its hours twice.
const rowKeys = (entry) => {
  const type = entry.type === 'machine' ? 'machine' : 'person'
  const id = type === 'machine' ? entry.machineId : entry.laborServiceId
  return [id != null && id !== '' && `${type}:${id}`, entry.resource && `${type}:name:${String(entry.resource).trim().toLocaleLowerCase('pt-BR')}`].filter(Boolean)
}

export function stageLaborEntries(resources = {}, store = {}, manual = []) {
  const { machines = [], laborServices = [] } = store || {}
  const rows = (resources.stages || []).flatMap((code) => {
    const minutes = Number(resources.stageTimes?.[code]) || 0, choice = resources.stageResources?.[code]
    if (!minutes || !choice) return []
    const machine = choice.type === 'machine'
    const registered = (machine ? machines : laborServices).find((item) => String(item.id) === String(choice.id))
    return [{ id: `stage-${code}`, stageCode: code, type: machine ? 'machine' : 'person', ...(machine ? { machineId: choice.id } : { laborServiceId: choice.id }), resource: registered?.name || choice.name || '', hours: minutes / 60, hourlyRate: sheetHourlyRate(store, code) ?? (Number(registered?.hourlyRate) || 0) }]
  })
  const planned = new Set(rows.flatMap(rowKeys))
  return [...rows, ...manual.filter((entry) => !entry.stageCode && !rowKeys(entry).some((key) => planned.has(key)))]
}

// Offers still open when the rule arrived: their labor is rebuilt once from the stages, dropping the hand-typed rows that
// repeat a stage. Accepted offers and OS keep what they had; a proposal already generated is kept as it is.
export async function migrateStageLabor() {
  if ((await readStore()).migrations?.stageLabor) return
  await mutateStore((store) => {
    for (const offer of store.offers || []) {
      if (offer.orderCode || ['accepted', 'rejected'].includes(offer.status) || !offer.resources) continue
      offer.resources.laborEntries = stageLaborEntries(offer.resources, store, offer.resources.laborEntries || [])
    }
    store.migrations = { ...store.migrations, stageLabor: new Date().toISOString() }
  })
}

// Offers of a price sheet made before their labor took the rate of the sheet: rebuilt once, as long as they are open.
export async function migrateSheetLabor() {
  if ((await readStore()).migrations?.sheetLabor) return
  await mutateStore((store) => {
    for (const offer of store.offers || []) {
      if (!offer.contract || offer.orderCode || ['accepted', 'rejected'].includes(offer.status) || !offer.resources) continue
      offer.resources.laborEntries = stageLaborEntries(offer.resources, store, (offer.resources.laborEntries || []).filter((entry) => !entry.stageCode))
    }
    store.migrations = { ...store.migrations, sheetLabor: new Date().toISOString() }
  })
}
