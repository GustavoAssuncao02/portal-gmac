import { PDFDocument } from 'pdf-lib'

// Reads the invoices GMAC issues, in the two layouts it uses: the NFS-e of Feira de Santana (services) and the DANFE of an
// NF-e (products). Each page is read from its text (the PDFs come from the issuing system, never scanned); a DANFE may take
// more than one page ("FOLHA 1/2"), joined by its access key. Everything read is checked by the user before it is saved.

let pdfjs
async function loadPdfjs() {
  pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjs
}

const money = (text) => text ? Math.round(Number(text.replace(/[^\d,]/g, '').replace(',', '.')) * 100) : null
const isoDate = (text) => { const match = /(\d{2})\/(\d{2})\/(\d{4})/.exec(text || ''); return match ? `${match[3]}-${match[2]}-${match[1]}` : null }
const digits = (text) => String(text || '').replace(/\D/g, '')
// "00000007-BORRACHAS VIPAL NORDESTE S.A": the issuing system's own client code is left out.
const customerName = (text) => String(text || '').replace(/^\s*\d+\s*-\s*/, '').trim()
const MONEY = '(\\d{1,3}(?:\\.\\d{3})*,\\d{2})'

// The text of a page as positioned pieces, plus its rows (pieces on the same line, left to right). Text written sideways
// (the DANFE stub) only counts for the plain text.
async function readPage(page) {
  const { items } = await page.getTextContent()
  const pieces = items.filter((item) => item.str.trim()).map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width, size: Math.hypot(item.transform[0], item.transform[1]) || 8, upright: Math.abs(item.transform[1]) < 0.01 && item.transform[0] > 0 }))
  const upright = pieces.filter((piece) => piece.upright)
  const rows = []
  for (const piece of [...upright].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((item) => Math.abs(item.y - piece.y) <= 2)
    if (row) row.pieces.push(piece); else rows.push({ y: piece.y, pieces: [piece] })
  }
  for (const row of rows) { row.pieces.sort((a, b) => a.x - b.x); row.text = row.pieces.map((piece) => piece.text).join(' ') }
  return { pieces: upright, rows, raw: pieces.map((piece) => piece.text).join('\n') }
}

const findPiece = (page, pattern) => page.pieces.filter((piece) => pattern.test(piece.text)).sort((a, b) => b.y - a.y || a.x - b.x)[0] || null
// The value of a DANFE box: under its label, from the label up to the next label of the same line.
function valueBelow(page, label) {
  if (!label) return ''
  const right = page.pieces.filter((piece) => Math.abs(piece.y - label.y) < 1.5 && piece.x > label.x + 2).reduce((min, piece) => Math.min(min, piece.x), Infinity)
  const found = page.pieces.filter((piece) => piece.y < label.y - 1 && piece.y > label.y - 16 && piece.x >= label.x - 6 && piece.x < right - 1).sort((a, b) => b.y - a.y || a.x - b.x)
  return found.length ? found.filter((piece) => Math.abs(piece.y - found[0].y) < 1.5).map((piece) => piece.text).join(' ') : ''
}
const rowsBetween = (page, top, bottom) => page.rows.filter((row) => row.y < top && row.y > bottom)

function detect(page) {
  const text = page.rows.map((row) => row.text).join('\n')
  if (/NOTA FISCAL DE SERVI[ÇC]O ELETR[ÔO]NICA/i.test(text)) return 'nfse'
  if (/DANFE/.test(text) && /NOTA FISCAL ELETR[ÔO]NICA/i.test(text)) return 'nfe'
  return null
}

function readNfse(page) {
  const text = page.rows.map((row) => row.text).join('\n'), warnings = []
  const number = /N[º°o]\s*:\s*(\d{6,})/.exec(text)?.[1] || ''
  const issued = findPiece(page, /^Emitida em:?$/i)
  const issueDate = isoDate(issued ? page.pieces.filter((piece) => piece.y < issued.y && piece.y > issued.y - 24 && Math.abs(piece.x - issued.x) < 30).map((piece) => piece.text).join(' ') : '') || isoDate(/Emitida em:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(page.raw)?.[1])
  const taker = findPiece(page, /^Tomador do Servi[çc]o/i), described = findPiece(page, /^Discrimina[çc][ãa]o do Servi[çc]o/i), service = findPiece(page, /^Valor do servi[çc]o:?$/i)
  const takerRows = taker ? rowsBetween(page, taker.y - 1, described ? described.y : -Infinity) : []
  const name = customerName(takerRows[0]?.text)
  const document = digits(/CPF\/CNPJ:?\s*([\d./-]{11,18})/i.exec(takerRows.map((row) => row.text).join('\n'))?.[1])
  // The service lines, as written ("1 - SERVICO DE USINAGEM ... - R$ 1.654,40").
  const description = described ? rowsBetween(page, described.y - 1, service ? service.y + 4 : -Infinity).map((row) => row.text).filter((line) => line.length > 2 && !/^(C[óo]digo de Verifica|Portal Fiscal)/i.test(line)).join('\n') : ''
  const valueCents = money(new RegExp(`Valor do servi[çc]o:?\\s*R\\$\\s*${MONEY}`, 'i').exec(text)?.[1])
  const issCents = money(new RegExp(`ISS retido na Fonte:?\\s*R\\$\\s*${MONEY}`, 'i').exec(text)?.[1]) ?? 0
  const netCents = money(new RegExp(`Valor L[íi]quido:?\\s*R\\$\\s*${MONEY}`, 'i').exec(text)?.[1])
  const federalCents = money(new RegExp(`Reten[çc][õo]es Federais:?\\s*R\\$\\s*${MONEY}`, 'i').exec(text)?.[1]) ?? 0
  if (federalCents) warnings.push(`A nota tem ${(federalCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} de retenções federais; o portal desconta só o ISS. Confira o valor.`)
  // "Vencimentos: 04/12/2026 - R$1.571,68": what the client pays on each date, already without the ISS.
  const due = findPiece(page, /^Vencimentos:?/i)
  const dueText = due ? rowsBetween(page, due.y + 2, due.y - 40).filter((row) => !/Constru[çc][ãa]o Civil|Matr[íi]cula/i.test(row.text)).map((row) => row.text).join(' ') : ''
  const dues = [...dueText.matchAll(new RegExp(`(\\d{2}\\/\\d{2}\\/\\d{4})\\s*-\\s*R\\$\\s*${MONEY}`, 'g'))].map((match) => ({ dueDate: isoDate(match[1]), netCents: money(match[2]) }))
  return { kind: 'nfse', number, documentNumber: number, issueDate, customerName: name, customerDocument: document, description, valueCents, issCents, netCents, installments: grossInstallments(dues, valueCents, issCents), warnings }
}

// Each due date of an NFS-e states the net amount; the account keeps the gross value with the ISS apart, so the gross of
// each installment is in proportion to its net (the last one takes the rounding).
function grossInstallments(dues, valueCents, issCents) {
  if (!dues.length || !valueCents) return dues.map((row) => ({ dueDate: row.dueDate, valueCents: null }))
  if (dues.length === 1) return [{ dueDate: dues[0].dueDate, valueCents }]
  const net = dues.reduce((sum, row) => sum + row.netCents, 0)
  let given = 0
  return dues.map((row, index) => {
    const part = index === dues.length - 1 ? valueCents - given : Math.round(valueCents * row.netCents / (net || valueCents - issCents))
    given += part
    return { dueDate: row.dueDate, valueCents: part }
  })
}

function nfeKey(page) {
  return /\b(\d{44})\b/.exec(page.rows.map((row) => row.text.replace(/(\d{4}) (?=\d{4})/g, '$1')).join('\n'))?.[1] || ''
}
// Products of a DANFE page: the description column of the items table, one product per product code.
function nfeProducts(page) {
  const header = findPiece(page, /^DESCRI[ÇC][ÃA]O DO(S)? PRODUTO/i)
  if (!header) return []
  const end = findPiece(page, /^(INFORMA[ÇC][ÕO]ES COMPLEMENTARES|DADOS ADICIONAIS)/i)
  const right = page.pieces.filter((piece) => Math.abs(piece.y - header.y) < 8 && piece.x > header.x + header.width - 2).reduce((min, piece) => Math.min(min, piece.x), Infinity)
  const products = []
  for (const row of rowsBetween(page, header.y - 8, end ? end.y + 4 : -Infinity)) {
    const code = row.pieces.some((piece) => piece.x < header.x - 2)
    const text = row.pieces.filter((piece) => piece.x >= header.x - 2 && piece.x < right - 1).map((piece) => piece.text).join(' ')
    if (!text) continue
    if (code || !products.length) products.push(text); else products[products.length - 1] += ` ${text}`
  }
  return products
}

function readNfe(pages) {
  const [page] = pages, text = page.rows.map((row) => row.text).join('\n'), key = nfeKey(page), warnings = []
  // The access key carries the number of the NF-e (positions 26–34).
  const fromKey = key ? key.slice(25, 34) : ''
  const number = fromKey ? fromKey.replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3') : /N[º°o]\.?\s*(\d{3}\.\d{3}\.\d{3})/.exec(text)?.[1] || ''
  const nameLabel = findPiece(page, /^NOME\s*\/\s*RAZ[ÃA]O SOCIAL$/i)
  const documentLabel = nameLabel ? page.pieces.filter((piece) => /^CNPJ\s*\/\s*CPF$/i.test(piece.text) && Math.abs(piece.y - nameLabel.y) < 1.5)[0] : null
  const issueDate = isoDate(valueBelow(page, findPiece(page, /^DATA (DA )?EMISS[ÃA]O$/i))) || isoDate(/EMISS[ÃA]O:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(page.raw)?.[1])
  const valueCents = money(valueBelow(page, findPiece(page, /^VALOR TOTAL DA NOTA$/i))) || money(new RegExp(`VALOR TOTAL:\\s*${MONEY}`, 'i').exec(page.raw)?.[1])
  // Duplicates: number, due date and value, side by side, between the FATURA header and the tax box.
  const invoice = findPiece(page, /^FAT\/DUP$/i), taxes = findPiece(page, /^BASE (DE )?C[ÁA]LCULO (DO )?ICMS$/i)
  const dueText = invoice ? rowsBetween(page, invoice.y - 1, taxes ? taxes.y + 1 : invoice.y - 40).map((row) => row.text).join(' ') : ''
  const installments = [...dueText.matchAll(new RegExp(`(\\S+)\\s+(\\d{2}\\/\\d{2}\\/\\d{4})\\s+(?:R\\$\\s*)?${MONEY}`, 'g'))].map((match) => ({ dueDate: isoDate(match[2]), valueCents: money(match[3]) }))
  if (installments.length && valueCents && installments.reduce((sum, row) => sum + row.valueCents, 0) !== valueCents) warnings.push('A soma das duplicatas é diferente do valor total da nota. Confira as parcelas.')
  return { kind: 'nfe', number, documentNumber: number, issueDate, customerName: customerName(valueBelow(page, nameLabel)), customerDocument: digits(valueBelow(page, documentLabel)), description: pages.flatMap(nfeProducts).join('\n'), valueCents, issCents: 0, netCents: valueCents, installments, warnings }
}

// Splits the PDF into its invoices. Returns `notes` (with the pages of each one, numbered from 1) and `problems`, the
// pages that could not be read as an invoice.
export async function readInvoices(bytes) {
  const { getDocument } = await loadPdfjs()
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 })
  let document
  try { document = await loading.promise }
  catch { throw Object.assign(new Error('Não foi possível abrir o arquivo como PDF.'), { status: 400 }) }
  const notes = [], problems = []
  try {
    let open = null
    for (let number = 1; number <= document.numPages; number++) {
      const page = await readPage(await document.getPage(number))
      const kind = detect(page)
      if (!kind) { problems.push({ page: number, message: page.pieces.length ? 'A página não é uma NFS-e nem uma DANFE de NF-e.' : 'A página não tem texto (imagem ou escaneada).' }); open = null; continue }
      if (kind === 'nfe') {
        const key = nfeKey(page)
        if (open?.kind === 'nfe' && key && open.key === key) { open.pages.push(number); open.read.push(page); continue }
        open = { kind, key, pages: [number], read: [page] }
      } else open = { kind, pages: [number], read: [page] }
      notes.push(open)
    }
  } finally { await loading.destroy() }
  return {
    problems,
    notes: notes.map(({ kind, key, pages, read }) => ({ ...(kind === 'nfse' ? readNfse(read[0]) : readNfe(read)), emitterDocument: key ? key.slice(6, 20) : '', pages })),
  }
}

// The PDF of one invoice: the original file when it holds only that invoice, otherwise just its pages.
export async function invoicePdf(bytes, pages, pageCount) {
  if (pages.length === pageCount) return Buffer.from(bytes)
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const target = await PDFDocument.create()
  for (const page of await target.copyPages(source, pages.map((number) => number - 1))) target.addPage(page)
  return Buffer.from(await target.save())
}
