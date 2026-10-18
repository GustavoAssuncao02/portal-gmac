import https from 'node:https'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { dataDirectory } from './dataDirectory.js'
import express from 'express'

const catalogPath = path.join(dataDirectory, 'fiscal-catalog.json')
const WEEK = 7 * 86400000
const RETRY_AFTER_FAILURE = 6 * 3600000

// Companies whose registered activities (CNAEs) are read from the Receita Federal.
export const issuerCnpjs = ['33963385000141', '09608093000106']
export const fiscalSources = {
  cnae: 'https://servicodados.ibge.gov.br/api/v2/cnae/subclasses',
  ncm: 'https://brasilapi.com.br/api/ncm/v1',
  nbs: 'https://www.gov.br/mdic/pt-br/images/REPOSITORIO/scs/decos/NBS/NBSa_2-0.csv',
  company: [(cnpj) => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, (cnpj) => `https://publica.cnpj.ws/cnpj/${cnpj}`],
}

const digits = (value) => String(value ?? '').replace(/\D/g, '')
export const formatCnae = (value) => { const code = digits(value).padStart(7, '0'); return `${code.slice(0, 4)}-${code.slice(4, 5)}/${code.slice(5, 7)}` }
const sentence = (text) => { const value = String(text || '').trim(); return value === value.toLocaleUpperCase('pt-BR') ? value.charAt(0) + value.slice(1).toLocaleLowerCase('pt-BR') : value }
export const plain = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Government servers answer slowly over IPv6 from some networks; IPv4 is requested explicitly.
export function download(url, { redirects = 5, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { family: 4, timeout, headers: { 'User-Agent': 'portal-gmac/1.0', Accept: 'application/json, text/csv, */*' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects > 0) {
        response.resume()
        return resolve(download(new URL(response.headers.location, url).href, { redirects: redirects - 1, timeout }))
      }
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error(`Tempo esgotado ao consultar ${new URL(url).host}.`)))
    request.on('error', reject)
  })
}

async function fetchOk(fetcher, url) {
  const { status, body } = await fetcher(url)
  if (status !== 200) throw new Error(`${new URL(url).host} respondeu ${status}.`)
  return body
}
const decodeText = (buffer) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch { return new TextDecoder('windows-1252').decode(buffer) } }
const parseJson = (buffer) => JSON.parse(decodeText(buffer).replace(/^﻿/, ''))

export function normalizeCnae(list) {
  if (!Array.isArray(list) || list.length < 1000) throw new Error('Lista de CNAE incompleta.')
  return list.map((row) => ({ code: formatCnae(row.id), description: sentence(row.descricao), group: sentence(row.classe?.descricao) })).sort((a, b) => a.code.localeCompare(b.code))
}

// The NCM list mixes chapters, headings and items; items keep the heading text so "- Outras" stays understandable.
export function normalizeNcm(list) {
  if (!Array.isArray(list) || list.length < 5000) throw new Error('Lista de NCM incompleta.')
  const byCode = new Map(list.map((row) => [digits(row.codigo), String(row.descricao || '').replace(/^[-\s]+/, '').trim()]))
  return list.filter((row) => digits(row.codigo).length === 8).map((row) => {
    const code = digits(row.codigo)
    const chain = [code.slice(0, 4), code.slice(0, 5), code.slice(0, 6), code.slice(0, 7)].map((key) => byCode.get(key)).filter(Boolean)
    const own = byCode.get(code)
    const parts = [...new Set([...chain, own])].filter(Boolean)
    return { code: `${code.slice(0, 4)}.${code.slice(4, 6)}.${code.slice(6, 8)}`, description: parts.at(-1), group: parts.slice(0, -1).join(' › ') }
  })
}

export function normalizeNbs(buffer) {
  const lines = decodeText(buffer).split(/\r?\n/).map((line) => line.split(';')).filter((cells) => /^\d\.\d{2}/.test(cells[0] || ''))
  const parents = new Map(lines.map(([code, description]) => [code.trim(), String(description || '').trim()]))
  const rows = lines.filter(([code]) => /^\d\.\d{4}\.\d{2}\.\d{2}$/.test(code.trim())).map(([code, description]) => {
    const value = code.trim()
    const parent = [value.slice(0, 8), value.slice(0, 6)].map((key) => parents.get(key)).find(Boolean)
    return { code: value, description: String(description || '').trim(), group: parent && parent !== String(description || '').trim() ? parent : '' }
  })
  if (rows.length < 500) throw new Error('Tabela NBS incompleta.')
  return rows
}

export function normalizeCompany(data, cnpj) {
  const establishment = data.estabelecimento
  const primary = establishment ? establishment.atividade_principal && { code: formatCnae(establishment.atividade_principal.subclasse || establishment.atividade_principal.id), description: establishment.atividade_principal.descricao } : data.cnae_fiscal && { code: formatCnae(data.cnae_fiscal), description: data.cnae_fiscal_descricao }
  const secondary = establishment ? (establishment.atividades_secundarias || []).map((row) => ({ code: formatCnae(row.subclasse || row.id), description: row.descricao })) : (data.cnaes_secundarios || []).filter((row) => Number(row.codigo)).map((row) => ({ code: formatCnae(row.codigo), description: row.descricao }))
  if (!primary) throw new Error('A consulta do CNPJ não trouxe a atividade principal.')
  return { cnpj, legalName: data.razao_social || '', tradeName: establishment?.nome_fantasia || data.nome_fantasia || '', activities: [{ ...primary, description: sentence(primary.description), primary: true }, ...secondary.map((row) => ({ ...row, description: sentence(row.description), primary: false }))] }
}

let cache = null
export async function readFiscalCatalog() {
  try {
    const { mtimeMs } = await stat(catalogPath)
    if (cache?.mtimeMs !== mtimeMs) cache = { mtimeMs, data: JSON.parse(await readFile(catalogPath, 'utf8')) }
    return cache.data
  } catch (error) {
    if (error.code === 'ENOENT') return { cnae: [], ncm: [], nbs: [], companies: {}, sources: {} }
    throw error
  }
}

async function writeCatalog(catalog) {
  await mkdir(dataDirectory, { recursive: true })
  const temporary = `${catalogPath}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(catalog), 'utf8')
  await rename(temporary, catalogPath)
  cache = null
}

let running = null
// Each source is independent: a failure keeps the previous list and is reported, the others are still updated.
export function syncFiscalCatalog({ fetcher = download, now = () => new Date() } = {}) {
  if (running) return running
  running = (async () => {
    const previous = await readFiscalCatalog()
    const catalog = { ...previous, companies: { ...previous.companies }, sources: { ...previous.sources } }
    const attempt = async (key, task) => {
      const at = now().toISOString()
      try {
        const result = await task()
        catalog.sources[key] = { updatedAt: at, checkedAt: at, count: Array.isArray(result) ? result.length : result.activities.length, error: null }
        return result
      } catch (error) {
        catalog.sources[key] = { ...previous.sources?.[key], checkedAt: at, error: error.message || 'Falha na consulta.' }
        return null
      }
    }
    const cnae = await attempt('cnae', async () => normalizeCnae(parseJson(await fetchOk(fetcher, fiscalSources.cnae))))
    if (cnae) catalog.cnae = cnae
    const ncm = await attempt('ncm', async () => normalizeNcm(parseJson(await fetchOk(fetcher, fiscalSources.ncm))))
    if (ncm) catalog.ncm = ncm
    const nbs = await attempt('nbs', async () => normalizeNbs(await fetchOk(fetcher, fiscalSources.nbs)))
    if (nbs) catalog.nbs = nbs
    for (const cnpj of issuerCnpjs) {
      const company = await attempt(`cnpj:${cnpj}`, async () => {
        let lastError
        for (const source of fiscalSources.company) {
          try { return normalizeCompany(parseJson(await fetchOk(fetcher, source(cnpj))), cnpj) } catch (error) { lastError = error }
        }
        throw lastError
      })
      if (company) catalog.companies[cnpj] = { ...company, updatedAt: now().toISOString() }
    }
    catalog.checkedAt = now().toISOString()
    catalog.cnae ||= []; catalog.ncm ||= []; catalog.nbs ||= []
    await writeCatalog(catalog)
    return fiscalStatus(catalog)
  })().finally(() => { running = null })
  return running
}

// Sundays at midnight in Feira de Santana (UTC-3, no daylight saving time).
export function nextWeeklyRun(from = Date.now()) {
  const local = new Date(from - 3 * 3600000)
  const candidate = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + (7 - local.getUTCDay()) % 7, 3, 0, 0)
  return candidate <= from ? candidate + WEEK : candidate
}

const failed = (catalog) => Object.values(catalog.sources || {}).some((source) => source.error)
export function fiscalStatus(catalog, now = Date.now()) {
  const label = { cnae: 'CNAE (IBGE)', ncm: 'NCM (Siscomex)', nbs: 'NBS (MDIC)' }
  return {
    checkedAt: catalog.checkedAt || null,
    nextRun: new Date(nextWeeklyRun(now)).toISOString(),
    counts: { cnae: catalog.cnae?.length || 0, ncm: catalog.ncm?.length || 0, nbs: catalog.nbs?.length || 0 },
    sources: Object.entries(catalog.sources || {}).map(([key, source]) => ({ key, label: label[key] || `Atividades do CNPJ ${key.slice(5).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}`, ...source })),
    companies: Object.values(catalog.companies || {}),
  }
}

let timer = null
export function startFiscalCatalogSchedule({ log = console } = {}) {
  const run = () => syncFiscalCatalog().then((status) => {
    const errors = status.sources.filter((source) => source.error)
    if (errors.length) log.warn?.(`Catálogo fiscal atualizado com falhas: ${errors.map((source) => `${source.label}: ${source.error}`).join('; ')}`)
    return status
  }).catch((error) => { log.error?.('Falha ao atualizar o catálogo fiscal:', error.message); return null })
  const schedule = (at) => { clearTimeout(timer); timer = setTimeout(async () => { const status = await run(); schedule(status && !status.sources.some((source) => source.error) ? nextWeeklyRun() : Math.min(nextWeeklyRun(), Date.now() + RETRY_AFTER_FAILURE)) }, Math.max(1000, at - Date.now())); timer.unref?.() }
  readFiscalCatalog().then((catalog) => {
    const stale = !catalog.checkedAt || Date.now() - Date.parse(catalog.checkedAt) > WEEK || !catalog.cnae?.length
    schedule(stale || failed(catalog) ? Date.now() + 60000 : nextWeeklyRun())
  }).catch(() => schedule(Date.now() + 60000))
  return () => clearTimeout(timer)
}

export function searchFiscal(catalog, kind, query, { cnpj, limit = 30 } = {}) {
  const list = catalog[kind] || []
  const text = plain(query).trim()
  const number = digits(query)
  const words = text.split(/\s+/).filter((word) => word && !/^\d+$/.test(word))
  const registered = new Map((catalog.companies?.[digits(cnpj)]?.activities || []).map((row) => [row.code, row]))
  const matches = (row) => (!number || digits(row.code).startsWith(number) || (!words.length && plain(row.description).includes(number))) && words.every((word) => plain(`${row.description} ${row.group || ''}`).includes(word))
  let rows = text ? list.filter(matches) : kind === 'cnae' && registered.size ? list.filter((row) => registered.has(row.code)) : list.slice(0, limit)
  if (kind === 'cnae') {
    rows = rows.map((row) => ({ ...row, registered: registered.has(row.code), primary: Boolean(registered.get(row.code)?.primary) }))
    // Company activities are listed first: only those can be invoiced by the selected issuer.
    for (const [code, row] of registered) if (!rows.some((item) => item.code === code) && (!text || matches(row))) rows.push({ ...row, group: '', registered: true })
    rows.sort((a, b) => Number(b.registered) - Number(a.registered) || Number(b.primary) - Number(a.primary) || a.code.localeCompare(b.code))
  }
  return rows.slice(0, limit)
}

export default function createFiscalRouter(requireAdmin) {
  const router = express.Router()
  router.get('/fiscal/status', requireAdmin, async (_request, response, next) => {
    try { response.set('Cache-Control', 'no-store').json(fiscalStatus(await readFiscalCatalog())) } catch (error) { next(error) }
  })
  router.get('/fiscal/search', requireAdmin, async (request, response, next) => {
    const kind = String(request.query.kind || '')
    if (!['cnae', 'ncm', 'nbs'].includes(kind)) return response.status(400).json({ message: 'Informe o tipo de código: CNAE, NCM ou NBS.' })
    try { response.json({ items: searchFiscal(await readFiscalCatalog(), kind, String(request.query.q || '').slice(0, 120), { cnpj: request.query.cnpj }) }) } catch (error) { next(error) }
  })
  router.post('/fiscal/sync', requireAdmin, async (_request, response, next) => {
    try { response.json(await syncFiscalCatalog()) } catch (error) { next(error) }
  })
  return router
}
