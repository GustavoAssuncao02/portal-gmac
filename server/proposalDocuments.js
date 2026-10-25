import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'
import { adminIdentity } from './accounts.js'
import { readFiscalCatalog, plain } from './fiscalCatalog.js'
import { defaultIssuers, nestleLabor, nestleMaterials, etiquetaLabor, etiquetaMaterials } from './proposalDefaults.js'
import { renderProposalDocument, tableTotals, letterTotal, round2 } from './proposalPdf.js'
import { proposalCosts, proposalPricing, hoursText } from './proposalMath.js'
import { todayBahia } from './payableRules.js'
import { materialUnit } from './materialUnits.js'
import { stagePlanPlace, stagePlanProblem } from './serviceStages.js'

export const documentModels = ['model-a', 'model-b', 'nestle', 'etiqueta']
const tableModels = ['nestle', 'etiqueta']
const situations = ['normal', 'night', 'holiday']

// Texts of the original proposals; only the Portuguese was corrected ("- O", "meio ambiente", final period).
export const defaultImportant = [
  '- Antecipadamente, expressamos nossa satisfação pela oportunidade desta proposta para prestação de serviço/fabricação;',
  '- O valor global é fixo dentro da validade da proposta e inclui todos os impostos pertinentes;',
  '- O serviço/fabricação tem previsão de realização em _horário comercial_. Caso se caracterize a necessidade de extra pelo cliente, elas serão apuradas e as diferenças para as horas extras serão cobradas à parte com percentuais conforme convenção coletiva vigente da nossa categoria;',
  '- O serviço/fabricação será executado obedecendo às normas técnicas, legislações aplicáveis e práticas industriais de segurança e meio ambiente.',
]
// Settings saved before the correction are read with the corrected texts.
const legacyImportant = [
  '- Antecipadamente, expressamos nossa satisfação pela oportunidade desta proposta para prestação de serviço/fabricação;',
  '- O valor global é fixo dentro da validade da proposta e inclui todos os impostos pertinentes;',
  '-O serviço/fabricação tem previsão de realização em _horário comercial_. Caso se caracterize a necessidade de extra pelo cliente, elas serão apuradas e as diferenças para as horas extras serão cobradas à parte com percentuais conforme convenção coletiva vigente da nossa categoria;',
  '- O serviço/fabricação será executado obedecendo às normas técnicas, legislações aplicáveis e práticas industriais de segurança e meio-ambiente;',
]
const defaultObservation = 'OS SERVIÇOS DEVEM SER REALIZADOS FORA DAS INSTALAÇÕES DA FÁBRICA'
// Registered activities of both GMAC companies (Receita Federal), used until the fiscal catalog is synchronized.
const knownActivities = { '2512-8/00': 'Fabricação de esquadrias de metal', '2511-0/00': 'Fabricação de estruturas metálicas', '2539-0/01': 'Serviços de usinagem, tornearia e solda', '2542-0/00': 'Fabricação de artigos de serralheria, exceto esquadrias', '3312-1/02': 'Manutenção e reparação de aparelhos e instrumentos de medida, teste e controle', '3321-0/00': 'Instalação de máquinas e equipamentos industriais' }

export function proposalSettings(store) {
  const saved = store.proposalSettings || {}
  const table = (key, labor, materials, laborRows, materialRows, extra = {}) => ({ labor, materials, laborRows, materialRows, ...extra, ...(saved.tables?.[key] || {}) })
  return {
    issuers: defaultIssuers.map((issuer) => ({ ...issuer, ...(saved.issuers || []).find((item) => item.id === issuer.id) })),
    tables: {
      nestle: table('nestle', nestleLabor, nestleMaterials, 21, 30),
      etiqueta: table('etiqueta', etiquetaLabor, etiquetaMaterials, 19, 28, { freight: [{ name: 'BBA FAC', value: 100 }, { name: 'BBA FAI', value: 200 }] }),
    },
    important: !saved.important || JSON.stringify(saved.important) === JSON.stringify(legacyImportant) ? defaultImportant : saved.important,
    observation: saved.observation ?? defaultObservation,
    validityDays: saved.validityDays || 10,
    lastQuoteNumber: Number(saved.lastQuoteNumber) || 13482,
    defaultIssuer: { 'model-a': 'usinagem', 'model-b': 'usinagem', nestle: 'metalurgica', etiqueta: 'usinagem', ...(saved.defaultIssuer || {}) },
    aliases: { nestle: {}, etiqueta: {}, ...(saved.aliases || {}) },
  }
}

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const text = (value, limit, label, { required = false } = {}) => {
  if (value != null && typeof value !== 'string' && typeof value !== 'number') fail(`${label} inválido.`)
  const result = String(value ?? '').trim()
  if (required && !result) fail(`Informe ${label}.`)
  if (result.length > limit) fail(`${label} deve ter no máximo ${limit} caracteres.`)
  return result
}
const amount = (value, label, { min = 0, max = 1e9, required = true } = {}) => {
  if ((value === '' || value == null) && !required) return null
  const number = typeof value === 'string' ? Number(value.replace(/\./g, '').replace(',', '.')) : Number(value)
  if (!Number.isFinite(number) || number < min || number > max) fail(`${label} inválido.`)
  return round2(number)
}
const quantity = (value, label) => {
  if (value === '' || value == null) return 0
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 100000) fail(`Quantidade inválida em ${label}.`)
  return Math.round(number * 100) / 100
}
const formatDocument = (value) => { const digits = String(value || '').replace(/\D/g, ''); return digits.length === 14 ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : digits.length === 11 ? digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : String(value || '').trim() }
// Default technician of the letter models: the one registered for the issuing company.
export const issuerTechnician = (issuer) => ({ name: issuer?.technician || '', registry: issuer?.technicianRegistry || '', phone: issuer?.technicianPhone || '' })
const isoDate = (value) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) || Number.isNaN(Date.parse(value))) fail('Data inválida.'); return value }

// ---------- Validation of the settings edited in "Modelos de proposta".
export function validateSettings(input, current) {
  const issuers = (input.issuers || current.issuers).map((issuer) => {
    const base = current.issuers.find((item) => item.id === issuer.id) || fail('Empresa emissora desconhecida.')
    const fields = ['letterName', 'tradeName', 'legalName', 'address', 'zip', 'city', 'state', 'phone', 'email', 'website', 'whatsapp', 'contact', 'technician', 'technicianRegistry', 'technicianPhone']
    return { ...base, ...Object.fromEntries(fields.map((field) => [field, text(issuer[field] ?? base[field], 160, `campo ${field} da empresa`)])) }
  })
  const rows = (list, kind, key) => {
    if (!Array.isArray(list) || list.length > 60) fail('Tabela de preços inválida.')
    const ids = new Set()
    return list.map((row, index) => {
      const id = text(row.id, 60, 'identificador') || `${key}-${kind}-${randomUUID().slice(0, 8)}`
      if (ids.has(id)) fail('Linha repetida na tabela de preços.')
      ids.add(id)
      const base = { id, ...(row.sap ? { sap: text(row.sap, 30, 'código SAP') } : {}), description: text(row.description, 160, `descrição da linha ${index + 1}`, { required: true }), unit: text(row.unit, 20, `unidade da linha ${index + 1}`, { required: true }) }
      return kind === 'l'
        ? { ...base, normal: amount(row.normal, `valor da hora normal (linha ${index + 1})`), night: amount(row.night, `valor da hora noturna (linha ${index + 1})`, { required: false }), holiday: amount(row.holiday, `valor da hora em domingos e feriados (linha ${index + 1})`, { required: false }) }
        : { ...base, price: amount(row.price, `valor unitário (linha ${index + 1})`) }
    })
  }
  const tables = Object.fromEntries(tableModels.map((key) => {
    const source = input.tables?.[key] || current.tables[key]
    const table = { labor: rows(source.labor, 'l', key), materials: rows(source.materials, 'm', key), laborRows: Math.min(60, Math.max(Number(source.laborRows) || 0, source.labor.length)), materialRows: Math.min(60, Math.max(Number(source.materialRows) || 0, source.materials.length)) }
    if (key === 'etiqueta') {
      const freight = source.freight || current.tables.etiqueta.freight
      if (!Array.isArray(freight) || freight.length < 1 || freight.length > 2) fail('Informe um ou dois locais de frete.')
      table.freight = freight.map((place, index) => ({ name: text(place.name, 30, `local de frete ${index + 1}`, { required: true }), value: amount(place.value, `valor do frete ${index + 1}`) }))
    }
    return [key, table]
  }))
  const important = (input.important || current.important).map((line) => text(line, 800, 'parágrafo de "Importante"')).filter(Boolean)
  if (important.length > 12) fail('Use no máximo 12 parágrafos em "Importante".')
  const lastQuoteNumber = input.lastQuoteNumber == null ? current.lastQuoteNumber : Number(input.lastQuoteNumber)
  if (!Number.isInteger(lastQuoteNumber) || lastQuoteNumber < 0) fail('Número da última cotação inválido.')
  return { issuers, tables, important, observation: text(input.observation ?? current.observation, 200, 'observação'), validityDays: Math.min(365, Math.max(1, Number(input.validityDays ?? current.validityDays) || 10)), lastQuoteNumber, defaultIssuer: current.defaultIssuer, aliases: current.aliases }
}

// ---------- Matching what the system recorded (machines, labor services, materials) to the customer's price list.
const synonyms = { fresagem: 'fresa', freza: 'fresa', fresadora: 'fresa', fresamento: 'fresa', tornearia: 'torno', torneiria: 'torno', torneamento: 'torno', tornearia2: 'torno', soldagem: 'solda', soldador: 'solda', soldas: 'solda', caldeireiro: 'caldeiraria', pintor: 'pintura', mecanico: 'mecanica', latao: 'latao', aluminio: 'aluminio', retifica: 'retifica', retificadora: 'retifica', balanceamento: 'balanceamento', eletroerosao: 'eletroerosao', galvanoplastia: 'galvanoplastia' }
const stopWords = new Set(['serv', 'sev', 'servico', 'servicos', 'de', 'da', 'do', 'em', 'e', 'a', 'o', 'restauracao', 'restaurac', 'usinagem', 'barra', 'metalica', 'metais', 'ligas', 'nao', '1m', '1kg', 'kg', 'mm', 'sae', 'aisi', 'aco', 'carbono', 'um', 'h', 'hora', 'horas', 'maquina'])
export function tokens(value) {
  return plain(value).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean).flatMap((word) => {
    const alias = synonyms[word] || word
    // "sae1020" and "aisi304" carry the grade inside the word.
    const grade = alias.match(/^(?:sae|aisi)(\d+[a-z]?)$/)
    return grade ? [grade[1]] : [alias]
  }).filter((word) => !stopWords.has(word))
}
export function matchRow(name, rows, aliases = {}) {
  const known = aliases[plain(name).trim()]
  if (known && rows.some((row) => row.id === known)) return known
  const wanted = tokens(name)
  if (!wanted.length) return null
  let best = null, bestScore = 0, tie = false
  for (const row of rows) {
    const have = new Set(tokens(row.description))
    let score = 0
    for (const word of wanted) if (have.has(word)) score += /\d/.test(word) ? 3 : word === 'cnc' ? 2 : 1
    // A different steel grade or size is a different item.
    if ([...have].some((word) => /^\d{3,}/.test(word)) && wanted.some((word) => /^\d{3,}/.test(word)) && !wanted.some((word) => /^\d{3,}/.test(word) && have.has(word))) score = 0
    if (score > bestScore) { best = row.id; bestScore = score; tie = false } else if (score && score === bestScore) tie = true
  }
  return tie ? null : best
}

// Hours and materials planned in the offer.
export function systemUsage(offer) {
  const usage = []
  const add = (kind, name, value, unit, source) => {
    if (!(Number(value) > 0)) return
    const existing = usage.find((item) => item.kind === kind && item.name === name)
    if (existing) existing.quantity = round2(existing.quantity + Number(value))
    else usage.push({ id: `${kind}-${usage.length + 1}`, kind, name, quantity: round2(Number(value)), unit, source })
  }
  const resources = offer?.resources || {}
  for (const entry of resources.laborEntries || []) add('labor', entry.resource, entry.hours, 'h', 'Oferta (previsto)')
  for (const material of resources.materials || []) add('material', [material.name, material.detail].filter(Boolean).join(' '), material.quantity, materialUnit(material.unit) === 'un' ? 'Un' : 'kg', 'Oferta')
  return usage
}

function suggestedActivity(offer, catalog, cnpj) {
  const words = plain(`${offer?.service || ''} ${offer?.description || ''}`)
  const code = /estrutura|cobertura|galpao|mezanino/.test(words) ? '2511-0/00' : /esquadria|portao|janela|porta/.test(words) ? '2512-8/00' : /serralheria|grade|corrimao|guarda.corpo/.test(words) ? '2542-0/00' : /instala|montagem de maquina/.test(words) ? '3321-0/00' : /calibra|instrumento|medicao/.test(words) ? '3312-1/02' : '2539-0/01'
  const activity = catalog.companies?.[String(cnpj).replace(/\D/g, '')]?.activities?.find((row) => row.code === code)
  return { code, description: activity?.description || knownActivities[code], registered: true }
}

// A contract may have several CNAE, NBS and NCM codes; the first CNAE is the main one.
const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []).filter((entry) => entry?.code)

function lastFiscal(store, offer) {
  const service = plain(offer?.service).trim()
  return store.offers.filter((item) => item.proposal?.document?.fiscal && plain(item.service).trim() === service).sort((a, b) => String(b.proposal.generatedAt).localeCompare(String(a.proposal.generatedAt)))[0]?.proposal.document.fiscal
}

export function nextQuoteNumber(store, settings) {
  const used = store.offers.map((item) => Number(item.proposal?.document?.quoteNumber)).filter(Number.isInteger)
  return String(Math.max(settings.lastQuoteNumber, ...used) + 1)
}

export async function buildDraft({ model, store, offer, value, deadline }) {
  if (!documentModels.includes(model)) fail('Modelo de proposta inválido.')
  const settings = proposalSettings(store)
  const source = offer
  const issuerId = settings.defaultIssuer[model]
  const issuer = settings.issuers.find((item) => item.id === issuerId)
  const base = { model, issuerId, date: todayBahia() }
  if (!tableModels.includes(model)) {
    const catalog = await readFiscalCatalog()
    const previous = lastFiscal(store, source)
    const total = Number(value) > 0 ? round2(value) : 0
    const quantityValue = Number(source?.quantity) > 0 ? Number(source.quantity) : 1
    return {
      ...base, quoteNumber: nextQuoteNumber(store, settings), customer: source?.company || '', customerDocument: formatDocument(source?.cnpj), requester: '', attention: '', subject: `serviço de ${source?.service || ''}`.trim(),
      scope: String(source?.description || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      items: [{ description: source?.service || 'Serviço', quantity: quantityValue, unit: 'Un', unitPrice: round2(total / quantityValue) }],
      deliveryTerm: /^\d{4}-\d{2}-\d{2}$/.test(String(deadline || '').trim()) ? String(deadline).trim().split('-').reverse().join('/') : String(deadline || '').trim(), payment: '', validityDays: settings.validityDays, important: settings.important,
      fiscal: { cnae: asList(previous?.cnae).length ? asList(previous.cnae) : asList(suggestedActivity(source, catalog, issuer.cnpj)), nbs: asList(previous?.nbs), ncm: asList(previous?.ncm) },
      technician: issuerTechnician(issuer),
    }
  }
  const table = settings.tables[model]
  const usage = systemUsage(offer).map((item) => ({ ...item, rowId: matchRow(item.name, item.kind === 'labor' ? table.labor : table.materials, settings.aliases[model]) }))
  const totalOf = (rowId) => round2(usage.filter((item) => item.rowId === rowId).reduce((total, item) => total + item.quantity, 0))
  return {
    ...base, number: source?.labelNumber || '', labelNumber: source?.labelNumber || '', componentName: source?.service || '', description: source?.description || '', quantity: source?.quantity || 1, quantityUnit: 'Un',
    requester: '', responsible: '', equipment: '', component: '', contact: issuer.contact,
    labor: table.labor.map((row) => ({ id: row.id, quantity: totalOf(row.id) || null, situation: 'normal' })),
    materials: table.materials.map((row) => ({ id: row.id, quantity: totalOf(row.id) || null })),
    ...(model === 'etiqueta' ? { freight: { place: table.freight.at(-1)?.name || '', charge: false } } : {}),
    observation: settings.observation, usage,
  }
}

// ---------- Normalization of what the user confirmed in the form; prices always come from the saved price list.
export async function normalizeDocument(model, input, store) {
  if (!documentModels.includes(model)) fail('Modelo de proposta inválido.')
  if (!input || typeof input !== 'object') fail('Preencha os dados do documento.')
  const settings = proposalSettings(store)
  const issuer = settings.issuers.find((item) => item.id === input.issuerId) || fail('Selecione a empresa emissora.')
  const common = { model, issuerId: issuer.id, issuer, date: isoDate(input.date) }
  if (tableModels.includes(model)) {
    const table = settings.tables[model]
    const pick = (rows, list, kind) => {
      const given = new Map((Array.isArray(list) ? list : []).map((row) => [row?.id, row]))
      for (const id of given.keys()) if (!rows.some((row) => row.id === id)) fail('A tabela de preços mudou. Abra o documento novamente.', 409)
      return rows.map((row) => {
        const entry = given.get(row.id) || {}
        const situation = kind === 'labor' ? (situations.includes(entry.situation) ? entry.situation : 'normal') : undefined
        return { ...row, quantity: quantity(entry.quantity, row.description), ...(situation ? { situation } : {}) }
      })
    }
    const document = {
      ...common,
      labor: pick(table.labor, input.labor, 'labor'), materials: pick(table.materials, input.materials, 'material'), laborRows: table.laborRows, materialRows: table.materialRows,
      description: text(input.description, 600, 'a descrição do serviço', { required: true }), quantity: quantity(input.quantity, 'quantidade da peça') || 1, quantityUnit: text(input.quantityUnit || 'Un', 10, 'a unidade'),
      requester: text(input.requester, 80, 'o solicitante'), contact: text(input.contact ?? issuer.contact, 80, 'o contato'), observation: text(input.observation ?? settings.observation, 200, 'a observação'),
    }
    if (model === 'nestle') document.number = text(input.number, 40, 'o número da solicitação', { required: true })
    else {
      Object.assign(document, { labelNumber: text(input.labelNumber, 40, 'o número da etiqueta', { required: true }), componentName: text(input.componentName, 120, 'o nome do componente', { required: true }), equipment: text(input.equipment, 120, 'o equipamento'), component: text(input.component, 120, 'o componente'), responsible: text(input.responsible, 80, 'o responsável') })
      const place = text(input.freight?.place, 30, 'o local do frete')
      if (place && !table.freight.some((item) => item.name === place)) fail('Local de frete inválido.')
      document.freight = { places: table.freight, place, charge: Boolean(input.freight?.charge && place) }
    }
    const totals = tableTotals(document)
    if (!(totals.total > 0)) fail('Informe a quantidade de pelo menos um serviço ou material.')
    document.totals = totals
    document.total = totals.total
    return document
  }
  const catalog = await readFiscalCatalog()
  const fiscalEntry = (entry, kind, pattern, label) => {
    if (!entry?.code) return null
    const code = String(entry.code).trim()
    if (!pattern.test(code)) fail(`Código ${label} inválido: ${code}.`)
    const found = (catalog[kind] || []).find((row) => row.code === code)
    return { code, description: found?.description || text(entry.description, 300, `a descrição do ${label}`) }
  }
  // Each kind is a list without repeated codes; the order is kept (the first CNAE is the main one).
  const fiscalList = (value, kind, pattern, label) => {
    const entries = asList(value).map((entry) => fiscalEntry(entry, kind, pattern, label)).filter(Boolean).filter((entry, index, list) => list.findIndex((other) => other.code === entry.code) === index)
    if (entries.length > 10) fail(`Informe no máximo 10 códigos ${label}.`)
    return entries
  }
  const cnae = fiscalList(input.fiscal?.cnae, 'cnae', /^\d{4}-\d\/\d{2}$/, 'CNAE')
  if (!cnae.length) fail('Informe o CNAE (código de atividade) da proposta.')
  const activities = catalog.companies?.[issuer.cnpj.replace(/\D/g, '')]?.activities
  for (const entry of cnae) entry.registered = activities ? activities.some((row) => row.code === entry.code) : Object.hasOwn(knownActivities, entry.code)
  const nbs = fiscalList(input.fiscal?.nbs, 'nbs', /^\d\.\d{4}\.\d{2}\.\d{2}$/, 'NBS')
  const ncm = fiscalList(input.fiscal?.ncm, 'ncm', /^\d{4}\.\d{2}\.\d{2}$/, 'NCM')
  if (!nbs.length && !ncm.length) fail('Informe o NBS (serviço) ou o NCM (produto) da proposta.')
  const scope = (Array.isArray(input.scope) ? input.scope : []).map((line) => text(line, 600, 'linha do escopo')).filter(Boolean)
  if (!scope.length) fail('Descreva o escopo da proposta.')
  if (scope.length > 40) fail('O escopo aceita no máximo 40 linhas.')
  const items = (Array.isArray(input.items) ? input.items : []).map((item, index) => ({
    description: text(item?.description, 300, `a descrição do item ${index + 1}`, { required: true }),
    quantity: (() => { const value = quantity(item?.quantity, `item ${index + 1}`); if (!value) fail(`Informe a quantidade do item ${index + 1}.`); return value })(),
    unit: { un: 'Un', unidade: 'Un', kg: 'kg' }[text(item?.unit, 20, `a unidade do item ${index + 1}`).toLowerCase()] || fail(`Escolha a unidade do item ${index + 1}: unidade ou kg.`), unitPrice: amount(item?.unitPrice, `valor unitário do item ${index + 1}`),
    ...(model === 'model-b' && text(item?.group, 60, `o grupo do item ${index + 1}`) ? { group: text(item.group, 60, 'o grupo') } : {}),
  }))
  if (!items.length) fail('Inclua pelo menos um item na composição.')
  if (model === 'model-a' && items.length > 1) fail('O modelo A tem uma única linha de composição. Use o modelo B para detalhar os itens.')
  if (items.length > 30) fail('A composição aceita no máximo 30 itens.')
  const document = {
    ...common, city: issuer.city, quoteNumber: text(input.quoteNumber, 20, 'o número da cotação', { required: true }), customer: text(input.customer, 160, 'o cliente', { required: true }), customerDocument: text(input.customerDocument, 20, 'o CNPJ do cliente'),
    requester: text(input.requester, 80, 'o solicitante'), attention: text(input.attention, 80, 'aos cuidados de'), subject: text(input.subject, 300, 'o objeto da proposta', { required: true }),
    scope, items, deliveryTerm: text(input.deliveryTerm, 200, 'o prazo de entrega'), payment: text(input.payment, 300, 'a condição de pagamento'),
    validityDays: Math.min(365, Math.max(1, Number(input.validityDays) || settings.validityDays)), important: settings.important, fiscal: { cnae, nbs, ncm },
    technician: input.technician && typeof input.technician === 'object' ? { name: text(input.technician.name, 120, 'o técnico responsável'), registry: text(input.technician.registry, 60, 'o registro do técnico'), phone: text(input.technician.phone, 40, 'o contato do técnico') } : issuerTechnician(issuer),
  }
  document.total = letterTotal(document)
  if (!(document.total > 0)) fail('O valor total da proposta deve ser maior que zero.')
  return document
}

// A saved document is reopened on the current price list: rows removed since then are dropped, new ones start empty.
function fromSaved(document, settings) {
  if (!tableModels.includes(document.model)) return { ...document, technician: document.technician || issuerTechnician(settings.issuers.find((item) => item.id === document.issuerId) || document.issuer) }
  const table = settings.tables[document.model]
  const find = (list, id) => (list || []).find((row) => row.id === id)
  return {
    ...document,
    labor: table.labor.map((row) => ({ id: row.id, quantity: find(document.labor, row.id)?.quantity || null, situation: find(document.labor, row.id)?.situation || 'normal' })),
    materials: table.materials.map((row) => ({ id: row.id, quantity: find(document.materials, row.id)?.quantity || null })),
    ...(document.freight ? { freight: { place: document.freight.place, charge: document.freight.charge } } : {}),
  }
}

function remember(store, model, document, assignments) {
  const saved = store.proposalSettings ||= {}
  if (document.quoteNumber && Number.isInteger(Number(document.quoteNumber))) saved.lastQuoteNumber = Math.max(Number(saved.lastQuoteNumber) || 13482, Number(document.quoteNumber))
  if (tableModels.includes(model) && Array.isArray(assignments)) {
    const settings = proposalSettings(store)
    const rows = [...settings.tables[model].labor, ...settings.tables[model].materials]
    saved.aliases ||= {}
    saved.aliases[model] ||= {}
    for (const { name, rowId } of assignments.slice(0, 200)) if (typeof name === 'string' && name.trim() && rows.some((row) => row.id === rowId)) saved.aliases[model][plain(name).trim()] = rowId
  }
}

// The proposal saved with a generated document. Costs and hours come from the planned resources of the offer, not from the
// form: they cannot be edited in the proposal. The OS value is the total of the generated document, which is what the
// customer receives.
export function documentProposal({ item, option = {}, document, model, stages, generatedBy = null }) {
  const key = ['A', 'B', 'C', 'D'].includes(option.key) ? option.key : 'A'
  const costs = proposalCosts(item.resources), margin = Math.min(1000, Math.max(0, Number(option.margin) || 0)), discount = Math.min(100, Math.max(0, Number(option.discount) || 0))
  const pricing = proposalPricing({ ...costs, margin, discount })
  // The margin and discount chosen in the card describe the document only while it charges the OS value they produce;
  // a price list (Nestlé, Etiqueta) or an edited price states its own, so the real margin on the cost is kept instead.
  const asChosen = Math.abs(document.total - pricing.osValue) <= Math.max(0.05, (Number(item.quantity) || 1) * 0.005)
  const realMargin = pricing.serviceValue > 0 ? Math.round((document.total - pricing.serviceValue) / pricing.serviceValue * 1000) / 10 : margin
  return {
    key, title: text(option.title, 80, 'o título') || `Opção ${key}`, deadline: text(option.deadline, 80, 'o prazo'),
    serviceValue: pricing.serviceValue, osValue: document.total, discount: asChosen ? discount : 0, margin: asChosen ? margin : realMargin, profit: round2(document.total - pricing.serviceValue),
    machine: hoursText(costs.machineHours), serviceTime: hoursText(costs.serviceHours), totalTime: hoursText(costs.totalHours), materials: costs.materials, labor: costs.labor,
    stages, kind: item.resources?.kind ?? 'service', layout: model, document, generatedAt: new Date().toISOString(), generatedBy,
  }
}
export default function createProposalDocumentsRouter(requireAdmin) {
  const router = express.Router()
  router.use((request, _response, next) => { const actor = adminIdentity(request); if (actor) { request.adminId = actor.id; request.adminName = actor.name } next() })
  const handle = (task) => async (request, response, next) => { try { await task(request, response) } catch (error) { if (error.status) return response.status(error.status).json({ message: error.message }); next(error) } }

  router.get('/proposal-settings', requireAdmin, handle(async (_request, response) => {
    const store = await readStore()
    const settings = proposalSettings(store)
    response.set('Cache-Control', 'no-store').json({ settings, nextQuoteNumber: nextQuoteNumber(store, settings) })
  }))
  router.put('/proposal-settings', requireAdmin, handle(async (request, response) => {
    const settings = await mutateStore((store) => {
      const next = validateSettings(request.body || {}, proposalSettings(store))
      const { aliases, defaultIssuer, ...editable } = next
      store.proposalSettings = { ...store.proposalSettings, ...editable }
      return proposalSettings(store)
    })
    response.json({ settings })
  }))

  router.get('/offers/:id/proposal-draft', requireAdmin, handle(async (request, response) => {
    const store = await readStore()
    const offer = store.offers.find((item) => item.id === request.params.id) || fail('Oferta não encontrada.', 404)
    const model = String(request.query.model || '')
    const fresh = await buildDraft({ model, store, offer, value: request.query.value, deadline: request.query.deadline })
    const draft = offer.proposal?.document?.model === model && !request.query.fresh ? { ...fromSaved(offer.proposal.document, proposalSettings(store)), usage: fresh.usage } : fresh
    response.set('Cache-Control', 'no-store').json({ draft, settings: proposalSettings(store) })
  }))

  router.post('/offers/:id/proposal-document', requireAdmin, handle(async (request, response) => {
    const { model, document: input, option = {}, assignments } = request.body || {}
    const before = await readStore()
    const offer = before.offers.find((item) => item.id === request.params.id)
    if (!offer || offer.orderCode || offer.status === 'rejected') fail('Oferta não encontrada, já aceita ou recusada.', 404)
    const stages = offer.resources?.stages ?? offer.proposal?.stages ?? []
    if (!stages.length) fail('Defina as etapas nos detalhes da oferta antes de gerar a proposta.')
    const problem = stagePlanProblem(stages, offer.resources)
    if (problem) fail(`${problem} ${stagePlanPlace}`)
    const document = await normalizeDocument(model, input, before)
    await renderProposalDocument(document)
    const updated = await mutateStore((store) => {
      const item = store.offers.find((entry) => entry.id === request.params.id)
      if (!item || item.orderCode || item.status === 'rejected') fail('Oferta não encontrada, já aceita ou recusada.', 404)
      item.proposal = documentProposal({ item, option, document, model, stages, generatedBy: request.adminName || null })
      item.status = 'proposed'
      remember(store, model, document, assignments)
      return item
    })
    response.json({ item: updated })
  }))

  return router
}

