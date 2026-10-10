import PDFDocument from 'pdfkit'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { integerInWords, moneyInWords } from './moneyWords.js'
import { round2, rateFor, tableTotals, itemTotal, letterTotal, situationLabels } from './proposalMath.js'
import { brandColors, brandPaths } from './proposalBrand.js'

export { round2, tableTotals, letterTotal }

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets')
const read = (file) => { try { return readFileSync(file) } catch { return null } }
const image = (name) => read(path.join(assets, name))

// The commercial team's documents use Arial, Calibri and Berlin Sans. When the server has them (Windows does) the PDF
// matches the originals; otherwise metric-compatible fonts are used: Helvetica for Arial, Carlito for Calibri.
const fontFolders = [process.env.WINDIR && path.join(process.env.WINDIR, 'Fonts'), 'C:/Windows/Fonts', '/usr/share/fonts/truetype/msttcorefonts', '/usr/share/fonts/TTF', '/Library/Fonts', '/System/Library/Fonts/Supplemental'].filter(Boolean)
const systemFont = (...names) => { for (const folder of fontFolders) for (const name of names) { const file = path.join(folder, name); if (existsSync(file)) return read(file) } return null }
let fontData = null
function fonts(doc) {
  fontData ||= {
    arial: systemFont('arial.ttf', 'Arial.ttf'), arialBold: systemFont('arialbd.ttf', 'Arial Bold.ttf'),
    calibri: systemFont('calibri.ttf') || image('fonts/Carlito-Regular.ttf'), calibriBold: systemFont('calibrib.ttf') || image('fonts/Carlito-Bold.ttf'),
    calibriItalic: systemFont('calibrii.ttf') || image('fonts/Carlito-Regular.ttf'), berlin: systemFont('BRLNSR.TTF', 'brlnsr.ttf') || image('fonts/Carlito-Bold.ttf'),
    montserratBold: image('fonts/Montserrat-Bold.ttf'),
  }
  const fallback = { arial: 'Helvetica', arialBold: 'Helvetica-Bold', calibri: 'Helvetica', calibriBold: 'Helvetica-Bold', calibriItalic: 'Helvetica-Oblique', berlin: 'Helvetica-Bold', montserratBold: 'Helvetica-Bold' }
  return Object.fromEntries(Object.entries(fallback).map(([key, standard]) => {
    if (!fontData[key]) return [key, standard]
    doc.registerFont(key, fontData[key])
    return [key, key]
  }))
}

const fixed = (value, digits = 2) => Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
export const brl = (value) => `R$ ${fixed(value)}`
const longDate = (value) => { const [year, month, day] = String(value).split('-').map(Number); return `${String(day).padStart(2, '0')} de ${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][month - 1]} de ${year}` }
const shortDate = (value) => String(value || '').split('-').reverse().join('/')

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.end()
  })
}

// Single-line text inside a cell. Positions are the top of the glyph box, as measured on the original documents.
function put(doc, value, x0, x1, top, { font, size, color = '#000000', align = 'left', pad = 2, underline = false, shrink = true, dx = 0 } = {}) {
  const text = String(value ?? '')
  if (!text) return
  let current = size
  const room = x1 - x0 - pad * 2
  doc.font(font)
  while (shrink && current > 5 && doc.fontSize(current).widthOfString(text) > room) current -= 0.25
  doc.fontSize(current).fillColor(color)
  const width = doc.widthOfString(text)
  const x = (align === 'right' ? x1 - pad - width : align === 'center' ? (x0 + x1 - width) / 2 : x0 + pad) + dx
  doc.text(text, x, top + (size - current) * 0.6, { lineBreak: false, underline })
}
const fill = (doc, x0, y0, x1, y1, color) => doc.save().rect(x0, y0, x1 - x0, y1 - y0).fill(color).restore()
const hLine = (doc, x0, x1, y, width = 0.7, color = '#000000') => doc.save().rect(x0, y, x1 - x0, width).fill(color).restore()
const vLine = (doc, x, y0, y1, width = 0.7, color = '#000000') => doc.save().rect(x, y0, width, y1 - y0).fill(color).restore()

function issuerLogo(issuer) {
  return issuer?.id === 'metalurgica' ? { data: image('gmac-logo.png'), ratio: 340 / 270 } : { data: image('proposal/gmac-usinagem-logo.jpg'), ratio: 233 / 88 }
}

// ---------------------------------------------------------------------------------------------------------------
// Nestlé "Planilha de Preços para Serviços de Usinagem (FS-3055)": reproduced from the customer's own spreadsheet.
const FS = { cols: [81.5, 105.5, 169.8, 347.3, 399.6, 465.9, 513.2, 560.5, 607.8, 655.1, 702.3, 768.6], row: 12.6, left: 62.2, right: 779.9 }

function nestleFrame(doc, top, bottom, { first, last }) {
  vLine(doc, FS.left, top, bottom, 1.5)
  vLine(doc, 778.3, first ? top + 1.6 : top, bottom, 1.6)
  if (first) hLine(doc, FS.left, FS.right, top, 1.6)
  if (last) hLine(doc, 63.7, FS.right, bottom - 1.6, 1.6)
}

function nestleLaborHeader(doc, f, top) {
  const [c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11] = FS.cols
  const bottom = top + 40.7
  fill(doc, c4, top, c5, bottom, '#ffc000'); fill(doc, c5, top, c8, bottom, '#bebfbe'); fill(doc, c8, top, c9, bottom, '#ffc000'); fill(doc, c9, top, c11, bottom, '#bebfbe')
  const bold = { font: f.arialBold, size: 7.2, align: 'center', pad: 0.5, dx: 0.8 }
  const mid = top + 16.8
  put(doc, 'Item', c0, c1, mid, bold); put(doc, 'Código SAP', c1, c2, mid, bold); put(doc, 'Descrição  - Mão de Obra', c2, c3, mid - 0.5, bold); put(doc, 'Unidade', c3, c4, mid, bold); put(doc, 'Quantidade', c4, c5, mid, bold)
  put(doc, 'Valor da  ', c5, c6, top + 12.1, bold); put(doc, 'hora normal', c5, c6, top + 21.5, bold)
  ;['Valor hora ', 'noturna ', 'semanal e ', 'sábados'].forEach((line, index) => put(doc, line, c6, c7, top + 2.7 + index * 9.4, bold))
  ;['Valor  da ', 'hora ', 'domingos e ', 'feriados'].forEach((line, index) => put(doc, line, c7, c8, top + 2.7 + index * 9.4, bold))
  put(doc, 'Situação', c8, c9, mid, bold); put(doc, 'Variante', c9, c10, mid, bold); put(doc, 'Valor total', c10, c11, mid, bold)
  return bottom
}

function nestleGrid(doc, top, bottom, rows) {
  for (const x of FS.cols) vLine(doc, x, top, bottom)
  for (const y of rows) hLine(doc, 82.2, 769.3, y)
}

export async function renderNestle(document) {
  const doc = new PDFDocument({ size: [841.92, 595.32], margin: 0, bufferPages: true, info: { Title: `Planilha de Preços FS-3055 ${document.number || ''}`.trim(), Author: document.issuer?.tradeName || 'GMAC' } })
  const f = fonts(doc)
  const totals = tableTotals(document)
  const [c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11] = FS.cols
  const regular = { font: f.arial, size: 8 }
  const centered = { ...regular, align: 'center', dx: 0.85 }
  const issuer = document.issuer

  // Page 1: heading, company data and labor.
  nestleFrame(doc, 5.0, 588.8, { first: true })
  fill(doc, 62.9, 14.5, 779.1, 35.0, '#9bc2e6')
  put(doc, 'Planilha de Preços para Serviços de Usinagem (FS-3055)', 62.9, 779.1, 15.8, { font: f.arialBold, size: 16, align: 'center', pad: 0, dx: 1.1 })
  fill(doc, 105.9, 47.2, 769.0, 150.1, '#ffff00')
  const head = { font: f.arialBold, size: 8.8 }
  put(doc, 'FORNECEDOR: PREENCHER SOMENTE CÉLULAS COM FUNDO AMARELO', 105.9, 703.1, 50.3, { ...head, align: 'center', pad: 0, dx: 1 })
  put(doc, shortDate(document.date), 700, 769.0, 50.8, { ...head, align: 'right', pad: 1.9 })
  doc.font(f.calibriBold).fontSize(9.6)
  const descriptionWidth = 590
  const descriptionHeight = doc.heightOfString(document.description || '', { width: descriptionWidth, align: 'center' })
  doc.fillColor('#000000').text(document.description || '', 412.75 - descriptionWidth / 2, Math.max(66, 87.3 - descriptionHeight / 2), { width: descriptionWidth, align: 'center', height: 44, ellipsis: true })
  put(doc, `Quantidade: ${String(document.quantity ?? '').padStart(2, '0')} ${document.quantityUnit || 'Un'}`, 105.9, 720.4, 115.9, { ...head, align: 'center', pad: 0 })
  put(doc, `Nº: ${document.number || ''}`, 655, 769.0, 115.9, { ...head, pad: 2.2 })
  put(doc, `Solicitante: ${document.requester || ''}`, 607.7, 769.0, 137.4, { ...head, pad: 2.2 })

  put(doc, 'DADOS DA EMPRESA', 251.1, 600, 154.9, { font: f.arialBold, size: 8, pad: 1.6 })
  fill(doc, 251.1, 166.8, 769.0, 264.9, '#ffff00')
  for (const y of [179.1, 191.3, 203.6, 215.8, 228.1, 240.3, 252.5]) hLine(doc, 251.1, 769.0, y, 0.35, '#808080')
  const labels = [['Nome fantasia:', issuer.tradeName], ['Razão Social:', issuer.legalName], ['Endereço:', issuer.address], ['CEP/Cidade/Estado:', null], ['Telefone:', issuer.phone], ['E-mail:', issuer.email], ['Nome para contato:', document.contact ?? issuer.contact], ['CNPJ:', issuer.cnpj]]
  const tops = [167.1, 179.4, 191.6, 203.9, 216.1, 228.3, 240.6, 254.7]
  labels.forEach(([label, value], index) => {
    put(doc, label, 120, 249.3, tops[index], { font: f.arialBold, size: 8, align: 'right', pad: 0 })
    if (label === 'E-mail:') put(doc, value, 252.7, 600, tops[index], { ...regular, pad: 0, color: '#0563c1', underline: true })
    else if (value != null) put(doc, value, 252.7, 769, tops[index], { ...regular, pad: 0 })
  })
  put(doc, issuer.zip, 252.7, 345, tops[3], { ...regular, pad: 0 }); put(doc, issuer.city, 349.4, 465, tops[3], { ...regular, pad: 0 }); put(doc, issuer.state, 468.0, 512, tops[3], { ...regular, pad: 0 }); put(doc, ' ,', 515.2, 530, tops[3], { ...regular, pad: 0 })

  fill(doc, 75.5, 273.5, 775.4, 589.1, '#bfc0bf')
  fill(doc, 82.2, 283.4, 769.1, 589.1, '#ffffff')
  let y = nestleLaborHeader(doc, f, 283.0)
  const laborRows = Math.max(document.laborRows || 21, document.labor.length)
  const rowLines = [283.0, y]
  const pages = []
  let pageTop = 283.0
  const bottomOf = (first) => first ? 588.4 : 529
  for (let index = 0; index < laborRows; index++) {
    if (y + FS.row > bottomOf(pages.length === 0) + 0.5) {
      nestleGrid(doc, pageTop, y + 0.7, rowLines.splice(0))
      pages.push(y)
      doc.addPage({ size: [841.92, 595.32], margin: 0 })
      nestleFrame(doc, 53.4, 541.8, {})
      fill(doc, 75.5, 53.4, 775.4, 531.7, '#bfc0bf'); fill(doc, 82.2, 53.4, 769.1, 529, '#ffffff')
      y = pageTop = 53.0
      rowLines.push(y)
    }
    const row = document.labor[index]
    const top = y
    if (row) {
      fill(doc, c4 + 0.4, top + 0.4, c5, top + FS.row, '#ffff00'); fill(doc, c5, top + 0.4, c8, top + FS.row, '#bebfbe'); fill(doc, c8, top + 0.4, c9, top + FS.row, '#00af50'); fill(doc, c9, top + 0.4, c10, top + FS.row, '#bebfbe')
      put(doc, row.sap, c1, c2, top + 2.2, centered)
      put(doc, row.description, c2, c3, top + 3.5, { ...regular, pad: 2.1 })
      put(doc, row.unit, c3, c4, top + 2.2, centered)
      if (Number(row.quantity)) put(doc, fixed(row.quantity), c4, c5, top + 3.6, { ...regular, align: 'right', pad: 3.9 })
      ;[['normal', c5, c6], ['night', c6, c7], ['holiday', c7, c8]].forEach(([key, x0, x1]) => row[key] != null && put(doc, fixed(row[key]), x0, x1, top + 3.5, { ...regular, align: 'right', pad: 4 }))
      put(doc, situationLabels[row.situation] || 'Normal', c8, c9, top + 3.5, { ...regular, pad: 4.6 })
      put(doc, fixed(rateFor(row)), c9, c10, top + 3.5, { ...regular, align: 'right', pad: 3.9 })
    }
    put(doc, String(index + 1), c0, c1, top + 2.2, centered)
    const total = row ? totals.labor[index] : 0
    put(doc, total ? fixed(total, 0) : '-', c10, c11, top + 3.6, { ...regular, align: 'right', pad: total ? 4 : 12.8 })
    y += FS.row
    rowLines.push(y)
  }
  nestleGrid(doc, pageTop, y + 0.7, rowLines.splice(0))

  // Totals and materials continue on the next page, vertically centered like the printed spreadsheet.
  doc.addPage({ size: [841.92, 595.32], margin: 0 })
  const materialRows = Math.max(document.materialRows || 30, document.materials.length)
  const height = 488.4 + (materialRows - 30) * FS.row
  const top = Math.max(10, (595.32 - height) / 2)
  const shift = top - 53.4
  const at = (value) => value + shift
  nestleFrame(doc, at(53.4), at(541.8), { last: true })
  fill(doc, 75.5, at(53.4), 775.4, at(531.7) + (materialRows - 30) * FS.row, '#bfc0bf')
  fill(doc, 81.8, at(53.4), 769.1, at(66.1), '#bcd6ed')
  put(doc, 'TOTAL SERVIÇOS POR HORA', c2, c3 + 100, at(54.8), { font: f.arialBold, size: 8, pad: 2.1 })
  put(doc, `R$ ${fixed(totals.laborTotal, 0)}`, c10, c11, at(56.6), { font: f.arialBold, size: 8, align: 'right', pad: 1.3 })
  for (const x of [c0, c1, c2, c8, c9, c10, c11]) vLine(doc, x, at(53.0), at(66.1))
  hLine(doc, 82.2, 769.3, at(53.0)); hLine(doc, 82.2, 769.3, at(65.7))
  fill(doc, 82.2, at(66.4), 769.1, at(72.6), '#bfc0bf')
  const materialHeader = at(72.6)
  fill(doc, 82.2, materialHeader, 769.1, at(89.7), '#ffffff')
  fill(doc, c4, materialHeader, c5, at(89.7), '#ffc000'); fill(doc, c7, materialHeader, c10, at(89.7), '#bebfbe')
  const headBold = { font: f.arialBold, size: 7.2, align: 'center', pad: 0.5, dx: 0.8 }
  put(doc, 'Item', c0, c1, at(77.6), headBold); put(doc, 'Código SAP', c1, c2, at(77.6), headBold); put(doc, 'Descrição - Materiais', c2, c3, at(77.1), headBold); put(doc, 'Unidade', c3, c4, at(77.6), headBold); put(doc, 'Quantidade', c4, c5, at(77.6), headBold); put(doc, 'Valor unitário', c5, c7, at(77.1), headBold); put(doc, 'Valores (R$)', c10, c11, at(77.6), headBold)
  let rowTop = at(89.7)
  const lines = [at(72.6), rowTop]
  for (let index = 0; index < materialRows; index++) {
    const row = document.materials[index]
    if (row) {
      fill(doc, c4 + 0.4, rowTop + 0.3, c5, rowTop + FS.row, '#ffff00'); fill(doc, c5, rowTop + 0.3, c10, rowTop + FS.row, '#bebfbe')
      put(doc, row.sap, c1, c2, rowTop + 2.2, centered)
      put(doc, row.description, c2, c3, rowTop + 2.2, { ...regular, pad: 2.1 })
      put(doc, row.unit, c3, c4, rowTop + 3.4, centered)
      if (Number(row.quantity)) put(doc, fixed(row.quantity), c4, c5, rowTop + 3.7, { ...regular, align: 'right', pad: 3.9 })
      put(doc, 'R$', c5, c6, rowTop + 2.7, { font: f.arial, size: 7.2, pad: 4.8 })
      put(doc, fixed(row.price), c5, c6, rowTop + 2.7, { font: f.arial, size: 7.2, align: 'right', pad: 3.6 })
    }
    put(doc, String(index + 1), c0, c1, rowTop + 2.2, centered)
    const total = row ? totals.materials[index] : 0
    if (!row) for (const x of [c8, c9]) vLine(doc, x, rowTop, rowTop + FS.row + 0.7)
    put(doc, 'R$', c10, c11, rowTop + 3.5, { ...regular, pad: 4.7 })
    put(doc, total ? fixed(total) : '-', c10, c11, rowTop + 3.5, { ...regular, align: 'right', pad: total ? 4 : 12.8 })
    rowTop += FS.row
    lines.push(rowTop)
  }
  for (const x of [c0, c1, c2, c3, c4, c5, c7, c10, c11]) vLine(doc, x, at(72.6), rowTop + 0.7)
  for (const line of lines) hLine(doc, 82.2, 769.3, line)
  // Totals: materials and contract.
  fill(doc, 170.2, rowTop + 0.4, 769.0, rowTop + 25.2, '#9bc2e6')
  fill(doc, 82.2, rowTop + 0.4, 170.2, rowTop + 25.2, '#ffffff')
  put(doc, 'TOTAL MATERIAIS', c2, c3 + 100, rowTop + 3.6, { font: f.arialBold, size: 8, pad: 2.1 })
  put(doc, `R$ ${fixed(totals.materialsTotal, 0)}`, c10, c11, rowTop + 3.6, { font: f.arialBold, size: 8, align: 'right', pad: 1.3 })
  put(doc, 'TOTAL DO CONTRATO', c2, c3 + 100, rowTop + 16.2, { font: f.arialBold, size: 8, pad: 2.1 })
  put(doc, `R$ ${fixed(totals.total, 0)}`, c10, c11, rowTop + 16.2, { font: f.arialBold, size: 8, align: 'right', pad: 1.3 })
  for (const x of [c0, c1, c2, c3, c8, c9, c10, c11]) vLine(doc, x, rowTop, rowTop + 25.9)
  hLine(doc, 82.2, 769.3, rowTop + 12.6); hLine(doc, 82.2, 769.3, rowTop + 25.2)
  // Observation in red.
  const note = rowTop + 35.1
  fill(doc, 82.2, rowTop + 25.9, 769.1, note, '#bfc0bf')
  fill(doc, 81.8, note, 210.7, note + 19.8, '#ffffff'); fill(doc, 210.6, note, 769.0, note + 19.8, '#ff0000')
  put(doc, 'Observação:', 81.8, 210.6, note + 1.2, { font: f.arialBold, size: 7.2, pad: 1.6 })
  put(doc, document.observation || '', 210.6, 769.0, note + 4.3, { font: f.arialBold, size: 9.6, color: '#ffffff', align: 'center' })
  hLine(doc, 82.2, 769.1, note - 0.3); hLine(doc, 82.2, 769.1, note + 19.4)
  vLine(doc, 81.5, note - 0.3, note + 20.1)
  return toBuffer(doc)
}

// ---------------------------------------------------------------------------------------------------------------
// Etiqueta "Planilha de Preços para Serviços de Usinagem": GMAC's price sheet, orange frame, three pages.
const ET = { cols: [23.2, 93.6, 299.1, 346.1, 410.3, 475.0, 551.1, 614.1, 677.1, 735.6, 815.6], row: 14.04, orange: '#ff6600', grey: '#d8d9d8' }

function etiquetaSides(doc, y0, y1) {
  fill(doc, 6.5, y0, 17.9, y1, ET.orange)
  fill(doc, 821.8, y0, 835.6, y1, ET.orange)
  vLine(doc, 834.7, Math.max(y0, 1.6), y1, 1.5)
}
const band = (doc, y0, y1) => fill(doc, 6.5, y0, 835.6, y1, ET.orange)
function box(doc, x0, y0, x1, y1, width = 0.7) {
  hLine(doc, x0, x1 + width, y0, width); hLine(doc, x0, x1 + width, y1, width)
  vLine(doc, x0, y0, y1 + width, width); vLine(doc, x1, y0, y1 + width, width)
}

export async function renderEtiqueta(document) {
  const doc = new PDFDocument({ size: [841.92, 595.32], margin: 0, info: { Title: `Etiqueta ${document.labelNumber || ''}`.trim(), Author: document.issuer?.tradeName || 'GMAC' } })
  const f = fonts(doc)
  const totals = tableTotals(document)
  const issuer = document.issuer
  const [c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10] = ET.cols
  const label = { font: f.arialBold, size: 8.6, align: 'center', pad: 1, dx: 0.9 }
  const value = { font: f.arialBold, size: 8.6, align: 'center', pad: 2, color: '#ff0000' }
  const cell = { font: f.arial, size: 7.9 }

  // Page 1: identification, company data and the first labor rows.
  band(doc, 2.3, 11.3); hLine(doc, 821.8, 836.2, 1.6, 1.5); vLine(doc, 834.7, 1.6, 11.3, 1.5); etiquetaSides(doc, 11.2, 409.6)
  box(doc, 22.8, 16.1, 815.3, 93.0)
  const logo = issuerLogo(issuer)
  if (logo.data) { const height = issuer?.id === 'metalurgica' ? 66 : 66.5, width = Math.min(175.4, height * logo.ratio); doc.image(logo.data, 28.7 + (175.4 - width) / 2, 23.1, { width, height }) }
  put(doc, 'Planilha de Preços para Serviços de Usinagem', 210, 630, 45.6, { font: f.arialBold, size: 17.3, align: 'center', pad: 0 })
  const fields = [
    [98.7, 118.6, [[22.8, 136.3, 'Nome do componente', true], [136.3, 676.8, document.componentName], [676.8, 735.2, 'Etiqueta', true], [735.2, 815.3, document.labelNumber]]],
    [124.2, 144.1, [[22.8, 93.3, 'Equipamento', true], [93.3, 345.8, document.equipment], [345.8, 410.0, 'Componente', true], [410.0, 815.3, document.component]]],
    [149.8, 169.7, [[22.8, 93.3, 'Responsável', true], [93.3, 209.1, document.responsible], [209.1, 345.8, 'Requisitante', true], [345.8, 474.7, document.requester]]],
    [175.3, 195.3, [[22.8, 93.3, 'Data', true], [93.3, 172.7, shortDate(document.date)], [172.7, 298.7, 'Quantidade', true], [298.7, 345.8, document.quantity]]],
  ]
  for (const [y0, y1, cells] of fields) {
    for (const [x0, x1, text, isLabel] of cells) {
      if (isLabel) fill(doc, x0 + 0.7, y0 + 0.7, x1, y1, ET.grey)
      box(doc, x0, y0, x1, y1)
      put(doc, text, x0, x1, y0 + 5.9 + (isLabel && text === 'Nome do componente' ? -0.4 : 0), isLabel ? { ...label, underline: true } : value)
    }
  }
  fill(doc, 23.5, 201.6, 93.3, 253.2, ET.grey)
  box(doc, 22.8, 200.9, 93.3, 253.2); box(doc, 93.3, 200.9, 815.3, 253.2)
  put(doc, 'Descrição do', 22.8, 93.3, 217.4, label); put(doc, 'serviço', 22.8, 93.3, 228.3, label)
  doc.font(f.arialBold).fontSize(8.6)
  const descriptionHeight = doc.heightOfString(document.description || '', { width: 700, align: 'center' })
  doc.fillColor('#ff0000').text(document.description || '', 104.3, Math.max(204, 227.2 - descriptionHeight / 2), { width: 700, align: 'center', height: 46, ellipsis: true })
  band(doc, 259.6, 265.4)

  fill(doc, 23.5, 270.9, 816.1, 286.1, ET.grey); box(doc, 22.8, 270.2, 815.3, 285.3)
  put(doc, 'Dados da empresa', 22.8, 300, 273.3, { font: f.arialBold, size: 8.6, pad: 2.4 })
  const companyRows = [
    [290.9, 307.7, ['Nome fantasia:', issuer.tradeName, 345.8], ['Razão Social:', issuer.legalName]],
    [313.4, 330.2, ['Endereço:', issuer.address, 345.8], ['CEP/Cidade/Estado:', issuer.zip]],
    [335.8, 352.6, ['Telefone:', issuer.phone, 298.7], ['E-mail:', issuer.email, true]],
    [358.3, 375.1, ['Nome para contato:', document.contact ?? issuer.contact, 298.7], ['CNPJ:', issuer.cnpj]],
    [380.7, 397.5, ['CNPJ:', issuer.cnpj, 298.7]],
  ]
  for (const [y0, y1, left, right] of companyRows) {
    fill(doc, 23.5, y0 + 0.7, 172.7, y1, ET.grey); box(doc, 22.8, y0, 172.7, y1); box(doc, 172.7, y0, left[2], y1)
    put(doc, left[0], 22.8, 172.7, y0 + 4.4, { font: f.arialBold, size: 7.9, pad: 2.4 })
    put(doc, left[1], 172.7, left[2], y0 + 4.4, { font: f.arial, size: 7.9, align: 'center' })
    if (!right) continue
    fill(doc, 410.7, y0 + 0.7, 550.8, y1, ET.grey); box(doc, 410.0, y0, 550.8, y1); box(doc, 550.8, y0, 676.8, y1)
    put(doc, right[0], 410.0, 550.8, y0 + 4.4, { font: f.arialBold, size: 7.9, align: 'center' })
    put(doc, right[1], 550.8, 676.8, y0 + 4.7, { font: f.arial, size: 7.2, align: 'center', ...(right[2] ? { color: '#0563c1', underline: true } : {}) })
  }
  band(doc, 403.9, 409.6)

  // Labor table, split across pages exactly where the printed sheet breaks (ten rows on the first page).
  etiquetaSides(doc, 409.5, 595.32)
  const headerTop = 414.8, headerBottom = 451.4
  fill(doc, c0 + 0.3, headerTop + 0.4, c3 + 0.5, headerBottom, ET.grey); fill(doc, c3 + 0.4, headerTop + 0.4, c4 + 0.5, headerBottom, '#ffc000'); fill(doc, c4 + 0.4, headerTop + 0.4, c7 + 0.5, headerBottom, ET.grey); fill(doc, c7 + 0.4, headerTop + 0.4, c8 + 0.5, headerBottom, '#ffc000'); fill(doc, c8 + 0.4, headerTop + 0.4, c10 + 0.5, headerBottom, ET.grey)
  const head = { font: f.arialBold, size: 7.9, align: 'center', pad: 0.5 }
  put(doc, 'Item', c0, c1, 429.1, head); put(doc, 'Descrição  - Mão de Obra', c1, c2, 428.6, head); put(doc, 'Unidade', c2, c3, 429.1, head); put(doc, 'Quantidade', c3, c4, 429.3, head)
  put(doc, 'Valor da  hora ', c4, c5, 424.2, head); put(doc, 'normal', c4, c5, 434.4, head)
  put(doc, 'Valor hora noturna ', c5, c6, 424.2, head); put(doc, 'semanal e sábados', c5, c6, 434.4, head)
  put(doc, 'Valor hora ', c6, c7, 419.1, head); put(doc, 'domingos e ', c6, c7, 429.3, head); put(doc, 'feriados', c6, c7, 439.6, head)
  put(doc, 'Situação', c7, c8, 429.3, head); put(doc, 'Variante', c8, c9, 429.3, head); put(doc, 'Valor total', c9, c10, 429.3, head)
  const laborRows = Math.max(document.laborRows || 19, document.labor.length)
  const firstPageRows = 10
  let y = headerBottom
  let pageTop = headerTop
  const lines = [headerTop, headerBottom]
  const flushGrid = (bottom) => { for (const x of ET.cols) vLine(doc, x, pageTop, bottom + 0.7); for (const line of lines.splice(0)) hLine(doc, c0 + 0.7, c10 + 0.8, line) }
  for (let index = 0; index < laborRows; index++) {
    if (index === firstPageRows || (index > firstPageRows && y + ET.row > 575)) {
      flushGrid(y)
      doc.addPage({ size: [841.92, 595.32], margin: 0 })
      etiquetaSides(doc, 0, 595.32)
      y = pageTop = 0.4
      lines.push(y)
    }
    const row = document.labor[index]
    const top = y
    if (row) {
      fill(doc, c3 + 0.4, top + 0.4, c4 + 0.5, top + ET.row, '#ffff00'); fill(doc, c4 + 0.4, top + 0.4, c7 + 0.5, top + ET.row, ET.grey); fill(doc, c7 + 0.4, top + 0.4, c8 + 0.5, top + ET.row, '#00af50'); fill(doc, c8 + 0.4, top + 0.4, c9 + 0.5, top + ET.row, ET.grey)
      put(doc, row.description, c1, c2, top + 2.6, { ...cell, pad: 2.1 })
      put(doc, row.unit, c2, c3, top + 3.2, { ...cell, align: 'center' })
      if (Number(row.quantity)) put(doc, fixed(row.quantity), c3, c4, top + 3.1, { ...cell, align: 'right', pad: 4.1 })
      ;[['normal', c4, c5], ['night', c5, c6], ['holiday', c6, c7]].forEach(([key, x0, x1]) => row[key] != null && put(doc, brl(row[key]), x0, x1, top + 3.1, { ...cell, align: 'right', pad: 1.4 }))
      put(doc, situationLabels[row.situation] || 'Normal', c7, c8, top + 3.1, { ...cell, pad: 4.7 })
      put(doc, brl(rateFor(row)), c8, c9, top + 3.1, { ...cell, align: 'right', pad: 1.4 })
    } else {
      fill(doc, c3 + 0.4, top + 0.4, c4 + 0.5, top + ET.row, '#ffff00'); fill(doc, c7 + 0.4, top + 0.4, c8 + 0.5, top + ET.row, '#00af50')
      put(doc, document.labor[0]?.unit || 'Horas', c2, c3, top + 3.2, { ...cell, align: 'center' })
      put(doc, situationLabels.normal, c7, c8, top + 3.1, { ...cell, pad: 4.7 })
    }
    put(doc, String(index + 1), c0, c1, top + 3.1, { ...cell, align: 'center' })
    put(doc, brl(row ? totals.labor[index] : 0), c9, c10, top + 3.1, { ...cell, font: f.arialBold, align: 'right', pad: 1.4 })
    y += ET.row
    lines.push(y)
  }
  // Total of services.
  fill(doc, c0 + 0.3, y + 0.4, c10 + 0.5, y + ET.row, '#bcd6ed')
  put(doc, 'TOTAL SERVIÇOS POR HORA', c1, c2 + 40, y + 2.6, { font: f.arialBold, size: 7.9, pad: 11.5 })
  put(doc, brl(totals.laborTotal), c9, c10, y + 2.7, { font: f.arialBold, size: 7.9, align: 'right', pad: 1.4 })
  lines.push(y + ET.row)
  for (const x of ET.cols) vLine(doc, x, pageTop, y)
  for (const x of [c0, c1, c2, c7, c8, c9, c10]) vLine(doc, x, y, y + ET.row + 0.7)
  for (const line of lines.splice(0)) hLine(doc, c0 + 0.7, c10 + 0.8, line)
  y += ET.row

  // Materials.
  band(doc, y + 6.6, y + 12.9)
  const materialTop = y + 18.7
  fill(doc, c0 + 0.3, materialTop + 0.4, c3 + 0.5, materialTop + ET.row, ET.grey); fill(doc, c3 + 0.4, materialTop + 0.4, c4 + 0.5, materialTop + ET.row, '#ffc000'); fill(doc, c4 + 0.4, materialTop + 0.4, c10 + 0.5, materialTop + ET.row, ET.grey)
  put(doc, 'Item', c0, c1, materialTop + 3.0, head); put(doc, 'Descrição - Materiais', c1, c2, materialTop + 2.6, head); put(doc, 'Unidade', c2, c3, materialTop + 3.0, head); put(doc, 'Quantidade', c3, c4, materialTop + 3.0, head); put(doc, 'Valor unitário', c4, c6, materialTop + 2.6, head); put(doc, 'Valores (R$)', c9, c10, materialTop + 3.0, head)
  let rowTop = materialTop + ET.row
  const materialLines = [materialTop, rowTop]
  const materialRows = Math.max(document.materialRows || 28, document.materials.length)
  let materialPageTop = materialTop
  for (let index = 0; index < materialRows; index++) {
    if (rowTop + ET.row > 586) {
      for (const x of [c0, c1, c2, c3, c4, c6, c9, c10]) vLine(doc, x, materialPageTop, rowTop + 0.7)
      for (const line of materialLines.splice(0)) hLine(doc, c0 + 0.7, c10 + 0.8, line)
      doc.addPage({ size: [841.92, 595.32], margin: 0 })
      etiquetaSides(doc, 0, 595.32)
      rowTop = materialPageTop = 0.4
      materialLines.push(rowTop)
    }
    const row = document.materials[index]
    fill(doc, c3 + 0.4, rowTop + 0.4, c4 + 0.5, rowTop + ET.row, '#ffff00'); fill(doc, c6 + 0.4, rowTop + 0.4, c9 + 0.5, rowTop + ET.row, ET.grey)
    if (row) {
      put(doc, row.description, c1, c2, rowTop + 3.1, { ...cell, pad: 2.1 })
      put(doc, row.unit, c2, c3, rowTop + 3.2, { ...cell, align: 'center' })
      if (Number(row.quantity)) put(doc, fixed(row.quantity), c3, c4, rowTop + 3.1, { ...cell, align: 'right', pad: 4.1 })
      put(doc, brl(row.price), c4, c6, rowTop + 2.6, { ...cell, align: 'center' })
    }
    put(doc, String(index + 1), c0, c1, rowTop + 3.1, { ...cell, align: 'center' })
    put(doc, brl(row ? totals.materials[index] : 0), c9, c10, rowTop + 3.1, { ...cell, align: 'right', pad: 1.4 })
    rowTop += ET.row
    materialLines.push(rowTop)
  }
  fill(doc, c1 + 0.4, rowTop + 0.4, c7 + 0.5, rowTop + ET.row, '#9bc2e6'); fill(doc, c7 + 0.4, rowTop + 0.4, c10 + 0.5, rowTop + ET.row, '#ffc000')
  put(doc, 'TOTAL MATERIAIS', c1, c2, rowTop + 2.8, { font: f.arialBold, size: 7.9, pad: 2.1 })
  put(doc, brl(totals.materialsTotal), c7, c10, rowTop + 2.5, { font: f.arialBold, size: 7.9, align: 'center' })
  for (const x of [c0, c1, c2, c3, c4, c6, c9, c10]) vLine(doc, x, materialPageTop, rowTop + 0.7)
  for (const x of [c0, c1, c2, c7, c10]) vLine(doc, x, rowTop, rowTop + ET.row + 0.7)
  materialLines.push(rowTop + ET.row)
  for (const line of materialLines.splice(0)) hLine(doc, c0 + 0.7, c10 + 0.8, line)
  rowTop += ET.row
  band(doc, rowTop + 6.6, rowTop + 13.0)

  // Last page: freight, totals and observation, vertically centered as Excel prints it.
  doc.addPage({ size: [841.92, 595.32], margin: 0 })
  const top = (595.32 - 139.1) / 2
  const at = (offset) => top + offset
  etiquetaSides(doc, at(0), at(129.6)); vLine(doc, 834.7, at(129.6), at(139.7), 1.5); hLine(doc, 821.8, 836.2, at(138.2), 1.5)
  fill(doc, c0 + 0.3, at(6.6), c10 + 0.5, at(19.8), ET.grey); fill(doc, c0 + 0.3, at(19.6), c1 + 0.5, at(32.9), ET.grey)
  const freight = document.freight || { places: [] }
  const placeValue = (name) => freight.places?.find((item) => item.name === name)?.value
  const chosen = freight.places?.find((item) => item.name === freight.place)
  const bold = { font: f.arialBold, size: 7.9, align: 'center' }
  put(doc, 'Frete', c0, c1, at(14.5), { font: f.arialBold, size: 8.6, align: 'center' })
  put(doc, 'Local', c1, c2, at(8.5), bold); put(doc, freight.place || '', c1, c2, at(21.6), bold)
  const [fac, fai] = [freight.places?.[0], freight.places?.[1]]
  put(doc, `Valor do frete ${fac?.name || ''}`.trim(), c2, c4, at(8.3), bold); put(doc, fac ? brl(fac.value) : '', c2, c4, at(21.6), bold)
  put(doc, `Valor do frete ${fai?.name || ''}`.trim(), c4, c7, at(8.3), bold); put(doc, fai ? brl(fai.value) : '', c4, c7, at(21.6), bold)
  put(doc, 'Variante', c7, c9, at(8.5), bold); put(doc, freight.charge && chosen ? brl(placeValue(freight.place)) : '', c7, c9, at(21.6), bold)
  put(doc, 'Valor do Frete', c9, c10, at(8.5), bold); put(doc, brl(totals.freight), c9, c10, at(21.8), bold)
  for (const x of [c0, c1, c2, c4, c7, c9, c10]) vLine(doc, x, at(6.2), at(33.1))
  hLine(doc, c0 + 0.3, c10 + 0.8, at(6.2)); hLine(doc, c1, c10 + 0.8, at(19.3)); hLine(doc, c0 + 0.3, c10 + 0.8, at(32.4))
  band(doc, at(39.0), at(45.3))
  const totalRows = [['TOTAL SERVIÇOS POR HORA', totals.laborTotal, 51.5], ['TOTAL MATERIAIS', totals.materialsTotal, 61.5], ['FRETE', totals.freight, 72.0], ['TOTAL DO CONTRATO', totals.total, 82.8]]
  fill(doc, c1 + 0.4, at(82.8), c10 + 0.5, at(94.2), '#9bc2e6')
  totalRows.forEach(([name, amount, offset]) => {
    put(doc, name, c1, c2 + 20, at(offset + 0.8), { font: f.arialBold, size: 7.9, pad: 2.1 })
    put(doc, brl(amount), c9, c10, at(offset + 0.8), { font: f.arialBold, size: 7.9, align: 'center' })
  })
  for (const x of [c0, c1, c2, c7, c8, c9, c10]) vLine(doc, x, at(51.1), at(94.4))
  for (const offset of [51.1, 61.5, 72.0, 82.4, 93.7]) hLine(doc, c0 + 0.3, c10 + 0.8, at(offset))
  fill(doc, 137.1, at(103.0), 816.1, at(120.8), '#ff0000')
  put(doc, 'Observação:', c0, 137.1, at(106.7), { font: f.arialBold, size: 8.6, align: 'center' })
  put(doc, document.observation || '', 137.1, 816.1, at(106.7), { font: f.arialBold, size: 8.6, color: '#ffffff', align: 'center' })
  box(doc, c0, at(102.6), 816.0, at(120.4))
  band(doc, at(129.6), at(139.1))
  return toBuffer(doc)
}

// ---------------------------------------------------------------------------------------------------------------
// Letter proposals (models A and B): GMAC's commercial proposal, with the fiscal codes highlighted.
const LETTER = { left: 36, right: 559.3, top: 106, bottom: 750 }
const INK = { navy: brandColors.navy, orange: brandColors.orange, text: '#1f2d3d', muted: '#5b6b7c', line: '#d9e2ec', panel: '#f3f6fa', fiscal: '#fff6ea' }

function brandPath(doc, name, { x, y, scale }, color) {
  const { d, box } = brandPaths[name]
  doc.save().translate(x - box[0] * scale, y - box[1] * scale).scale(scale).path(d).fill(color, 'even-odd').restore()
}

// GMAC logo as vectors (mark, wordmark and the company line); `height` is the height of the mark.
// Proportions follow the original lockup, with the company line aligned under the wordmark.
function brandLogo(doc, issuer, { x, y, height }) {
  const navyBox = brandPaths['mark-navy'].box, orangeBox = brandPaths['mark-orange'].box, wordBox = brandPaths.gmac.box
  const k = height / 33.2
  const markScale = height / (navyBox[3] - navyBox[1])
  brandPath(doc, 'mark-navy', { x, y, scale: markScale }, brandColors.navy)
  brandPath(doc, 'mark-orange', { x: x + (orangeBox[0] - navyBox[0]) * markScale, y: y + (orangeBox[1] - navyBox[1]) * markScale, scale: markScale }, brandColors.orange)
  const wordScale = 21.1 * k / (wordBox[3] - wordBox[1])
  const wordX = x + 39.6 * k, wordWidth = (wordBox[2] - wordBox[0]) * wordScale
  brandPath(doc, 'gmac', { x: wordX, y: y + 5.3 * k, scale: wordScale }, brandColors.navy)
  const baseline = y + 40 * k
  if (issuer?.id === 'metalurgica') {
    const box = brandPaths.metalurgica.box, scale = wordWidth / (box[2] - box[0])
    brandPath(doc, 'metalurgica', { x: wordX, y: baseline - (box[3] - box[1]) * scale, scale }, brandColors.orange)
  } else {
    const size = 11.3 * k, word = 'USINAGEM'
    doc.font('Times-Roman').fontSize(size)
    doc.fillColor(brandColors.subtitle).text(word, wordX, baseline - 0.683 * size, { lineBreak: false, characterSpacing: (wordWidth - doc.widthOfString(word)) / (word.length - 1) })
  }
}

// Letterhead: navy band with an orange accent, logo on the left and the document title on the right.
function letterHeader(doc, f, issuer) {
  const page = doc.page.width
  doc.save().rect(0, 0, page, 7).fill(brandColors.navy).restore()
  doc.save().polygon([page - 170, 7], [page, 7], [page, 10], [page - 167, 10]).fill(brandColors.orange).restore()
  brandLogo(doc, issuer, { x: LETTER.left, y: 28, height: 34 })
  const title = 'PROPOSTA COMERCIAL', spacing = 1.6
  doc.font(f.montserratBold).fontSize(12.5)
  const titleWidth = doc.widthOfString(title) + spacing * (title.length - 1)
  doc.fillColor(brandColors.navy).text(title, LETTER.right - titleWidth, 36.5, { lineBreak: false, characterSpacing: spacing })
  doc.save().rect(LETTER.right - 30, 55, 30, 2.6).fill(brandColors.orange).restore()
  hLine(doc, LETTER.left, LETTER.right, 86, 0.6, INK.line)
}

function letterFooter(doc, f, document, page, pages) {
  const issuer = document.issuer
  const top = 770
  hLine(doc, LETTER.left, LETTER.right, top, 0.6, INK.line)
  doc.font(f.calibri).fontSize(7.8).fillColor(INK.muted)
  doc.text(issuer.address || '', LETTER.left, top + 8, { lineBreak: false })
  doc.text(`CEP: ${issuer.zip || ''} - ${issuer.city || ''}/${issuer.state || ''}`, LETTER.left, top + 17.5, { lineBreak: false })
  const whatsapp = whatsappLink(issuer.whatsapp, document)
  doc.font(f.calibriBold).fontSize(12).fillColor(INK.navy).text(issuer.phone || '', LETTER.left, top + 27, { lineBreak: false })
  if (whatsapp) {
    // The phone and a "WhatsApp" badge open a conversation about this quotation.
    const phoneWidth = issuer.phone ? doc.widthOfString(issuer.phone) + 7 : 0
    const badgeX = LETTER.left + phoneWidth
    doc.save().roundedRect(badgeX, top + 27.5, 62, 13, 6.5).fill('#edf8f1').restore()
    whatsappIcon(doc, badgeX + 2, top + 28.5, 11)
    doc.font(f.calibriBold).fontSize(8.5).fillColor('#1da851').text('WhatsApp', badgeX + 16, top + 30, { lineBreak: false })
    doc.link(LETTER.left, top + 26, phoneWidth + 62, 16, whatsapp)
  }
  doc.font(f.calibri).fontSize(8.5).fillColor(INK.navy)
  if (issuer.email) doc.text(issuer.email, 230, top + 10, { lineBreak: false, link: `mailto:${issuer.email}` })
  if (issuer.website) doc.text(issuer.website, 230, top + 21, { lineBreak: false, link: `https://${issuer.website.replace(/^https?:\/\//, '')}` })
  doc.font(f.calibriBold).fontSize(8.5).fillColor(INK.navy)
  const quote = `Cotação nº ${document.quoteNumber}`
  doc.text(quote, LETTER.right - doc.widthOfString(quote), top + 10, { lineBreak: false })
  doc.font(f.calibri).fontSize(8.5).fillColor(INK.muted)
  const pageText = `Página ${page} de ${pages}`
  doc.text(pageText, LETTER.right - doc.widthOfString(pageText), top + 21, { lineBreak: false })
  const width = doc.page.width, height = doc.page.height
  doc.save().polygon([0, height - 10], [167, height - 10], [170, height - 7], [0, height - 7]).fill(brandColors.orange).restore()
  doc.save().rect(0, height - 7, width, 7).fill(brandColors.navy).restore()
}

// WhatsApp link of the footer: wa.me with the quotation already mentioned in the message.
export function whatsappLink(number, document) {
  let digits = String(number || '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.length <= 11) digits = `55${digits}`
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Olá, GMAC! Gostaria de falar sobre a cotação nº ${document.quoteNumber} – ${document.subject}.`)}`
}
// Round badge with a phone, in WhatsApp green.
function whatsappIcon(doc, x, y, size) {
  doc.save().circle(x + size / 2, y + size / 2, size / 2).fill('#1da851').restore()
  const offset = size * 0.19
  doc.save().translate(x + offset, y + offset).scale(size / 24 * 0.62)
    .path('M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z')
    .fill('#ffffff').restore()
}

// Inline marks: **bold** and _italic_ segments.
function segments(text, f, base = f.calibri) {
  return String(text).split(/(\*\*[^*]+\*\*|_[^_]+_)/).filter(Boolean).map((part) => part.startsWith('**') ? [part.slice(2, -2), f.calibriBold] : part.startsWith('_') && part.endsWith('_') && part.length > 2 ? [part.slice(1, -1), f.calibriItalic] : [part, base])
}
const fitLine = (doc, text, width) => { let value = String(text); if (doc.widthOfString(value) <= width) return value; while (value.length > 1 && doc.widthOfString(`${value}…`) > width) value = value.slice(0, -1); return `${value.trimEnd()}…` }
const quantityText = (item) => `${fixed(item.quantity, Number.isInteger(Number(item.quantity)) ? 0 : 2)} ${item.unit || ''}`.trim()
const addDays = (value, days) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }

export async function renderLetter(document) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `Proposta comercial ${document.quoteNumber || ''}`.trim(), Author: document.issuer?.letterName || 'GMAC' } })
  const f = fonts(doc)
  const issuer = document.issuer
  const width = LETTER.right - LETTER.left
  letterHeader(doc, f, issuer)
  let y = LETTER.top
  const newPage = () => { doc.addPage({ size: 'A4', margin: 0 }); letterHeader(doc, f, issuer); y = LETTER.top }
  const ensure = (height) => { if (y + height > LETTER.bottom) newPage() }
  const heightOf = (text, { font = f.calibri, size = 11, w = width, align = 'left' } = {}) => doc.font(font).fontSize(size).heightOfString(text, { width: w, lineGap: 1, align })
  const write = (text, { font = f.calibri, size = 11, color = INK.text, x = LETTER.left, w = LETTER.right - x, gap = 4, align = 'left' } = {}) => {
    const height = heightOf(text, { font, size, w, align })
    ensure(height)
    doc.font(font).fontSize(size).fillColor(color).text(text, x, y, { width: w, lineGap: 1, align })
    y += height + gap
  }
  const rich = (parts, { size = 11, color = INK.text, x = LETTER.left, w = LETTER.right - x, gap = 4, align = 'left' } = {}) => {
    const height = heightOf(parts.map(([text]) => text).join(''), { size, w, align })
    ensure(height)
    parts.forEach(([text, font, partColor], index) => {
      doc.font(font).fontSize(size).fillColor(partColor || color)
      const continued = index < parts.length - 1
      if (index) doc.text(text, { continued })
      else doc.text(text, x, y, { width: w, lineGap: 1, align, continued })
    })
    y += height + gap
  }
  // A section title never stays alone at the bottom of a page: it moves with the beginning of its content.
  const section = (title, keepWith = 40) => {
    y += 14
    ensure(30 + keepWith)
    doc.font(f.calibriBold).fontSize(12.5).fillColor(INK.navy).text(title, LETTER.left, y, { lineBreak: false })
    hLine(doc, LETTER.left, LETTER.right, y + 17, 0.8, INK.orange)
    y += 27
  }

  // Identification: who the proposal is for (left) and the quotation data (right).
  const card = { x: 336, w: LETTER.right - 336 }
  const until = shortDate(addDays(document.date, Number(document.validityDays) || 10))
  doc.font(f.calibriBold).fontSize(8).fillColor(INK.muted).text('PROPOSTA PARA', LETTER.left, y, { lineBreak: false, characterSpacing: 0.8 })
  let left = y + 13
  doc.font(f.calibriBold).fontSize(15).fillColor(INK.navy)
  const customerHeight = doc.heightOfString(`À ${document.customer}`, { width: 285 })
  doc.text(`À ${document.customer}`, LETTER.left, left, { width: 285 })
  left += customerHeight + 3
  const leftLine = (label, value) => {
    if (!value) return
    doc.font(f.calibri).fontSize(10.5).fillColor(INK.muted).text(`${label} `, LETTER.left, left, { continued: true, width: 285 }).font(f.calibriBold).fillColor(INK.text).text(value)
    left += 15
  }
  leftLine('CNPJ:', document.customerDocument)
  leftLine('Solicitante:', document.requester)
  leftLine('Aos cuidados de:', document.attention)
  const cardLines = [
    [[`${document.city || issuer.city}, ${longDate(document.date)}`, f.calibri]],
    [['Validade: ', f.calibri, INK.muted], [`${document.validityDays} dias corridos · até ${until}`, f.calibri]],
    [['Emitente: ', f.calibri, INK.muted], [issuer.letterName, f.berlin, INK.navy]],
    [[`CNPJ ${issuer.cnpj}`, f.calibri, INK.muted]],
  ]
  const cardHeight = 44 + cardLines.length * 14 + 6
  doc.save().roundedRect(card.x, y - 4, card.w, cardHeight, 6).fill(INK.panel).restore()
  doc.save().rect(card.x, y - 4, 3.5, cardHeight).fill(INK.orange).restore()
  doc.font(f.calibriBold).fontSize(8).fillColor(INK.muted).text('COTAÇÃO Nº', card.x + 14, y + 4, { lineBreak: false, characterSpacing: 0.8 })
  doc.font(f.berlin).fontSize(22).fillColor(INK.navy).text(String(document.quoteNumber || ''), card.x + 14, y + 14, { lineBreak: false })
  let cardY = y + 42
  for (const parts of cardLines) {
    parts.forEach(([text, font, color], index) => {
      doc.font(font).fontSize(font === f.berlin ? 10.5 : 10).fillColor(color || INK.text)
      if (index) doc.text(text, { continued: index < parts.length - 1, lineBreak: false })
      else doc.text(text, card.x + 14, cardY, { continued: parts.length > 1, lineBreak: false })
    })
    cardY += 14
  }
  y = Math.max(left, y - 4 + cardHeight) + 10

  // Fiscal identification, compact: one line per code.
  const fiscal = document.fiscal || {}
  const codes = [['CNAE – Código de atividade', fiscal.cnae], ['NBS', fiscal.nbs], ['NCM', fiscal.ncm]].filter(([, entry]) => entry?.code)
  if (codes.length) {
    const boxHeight = 20 + codes.length * 12.5
    doc.save().roundedRect(LETTER.left, y, width, boxHeight, 5).fill(INK.fiscal).restore()
    doc.save().rect(LETTER.left, y, 3.5, boxHeight).fill(INK.orange).restore()
    doc.font(f.calibriBold).fontSize(7.8).fillColor('#9a4f00').text('IDENTIFICAÇÃO FISCAL', LETTER.left + 12, y + 6, { lineBreak: false, characterSpacing: 0.8 })
    codes.forEach(([name, entry], index) => {
      const lineY = y + 18 + index * 12.5
      doc.font(f.calibriBold).fontSize(9.5).fillColor(INK.text)
      const label = `${name}: ${entry.code}`
      doc.text(label, LETTER.left + 12, lineY, { lineBreak: false })
      const used = doc.widthOfString(label)
      doc.font(f.calibri).fontSize(9).fillColor(INK.muted)
      if (entry.description) doc.text(fitLine(doc, ` · ${entry.description}`, width - 24 - used), LETTER.left + 12 + used, lineY + 0.4, { lineBreak: false })
    })
    y += boxHeight
  }

  section('1. Refere-se', 30)
  write('Prezados,', { gap: 6 })
  write(`Submetemos à apreciação de V.S.ª a presente proposta para ${document.subject}.`)

  const scope = (document.scope || []).filter((line) => String(line).trim())
  section('2. Escopo', heightOf(scope[0] || '', { w: LETTER.right - 58 }))
  scope.forEach((line, index) => {
    const height = heightOf(line, { w: LETTER.right - 58 })
    ensure(height)
    doc.font(document.model === 'model-b' ? f.calibriBold : f.calibri).fontSize(11).fillColor(INK.navy).text(document.model === 'model-b' ? `${index + 1}.` : '•', 44, y, { lineBreak: false })
    doc.font(f.calibri).fontSize(11).fillColor(INK.text).text(line, 58, y, { width: LETTER.right - 58, lineGap: 1 })
    y += height + 3
  })

  const items = document.items || []
  const total = letterTotal(document)
  section('3. Composição e preço global', 70)
  if (document.model === 'model-a') {
    // A single composition line, highlighted.
    const item = items[0]
    const detail = `${quantityText(item)} × ${brl(item.unitPrice)}`
    const descriptionHeight = heightOf(item.description, { font: f.calibriBold, size: 11.5, w: 250 })
    const lineHeight = Math.max(30, descriptionHeight + 14)
    ensure(lineHeight)
    doc.save().roundedRect(LETTER.left, y, width, lineHeight, 5).lineWidth(0.8).strokeColor(INK.line).stroke().restore()
    put(doc, '3.1', LETTER.left, LETTER.left + 34, y + lineHeight / 2 - 6, { font: f.calibriBold, size: 11, color: INK.navy, align: 'center' })
    doc.font(f.calibriBold).fontSize(11.5).fillColor(INK.text).text(item.description, LETTER.left + 38, y + (lineHeight - descriptionHeight) / 2, { width: 250, lineGap: 1 })
    put(doc, detail, 330, 452, y + lineHeight / 2 - 6, { font: f.calibri, size: 10.5, color: INK.muted, align: 'right' })
    put(doc, brl(itemTotal(item)), 452, LETTER.right - 6, y + lineHeight / 2 - 6.5, { font: f.calibriBold, size: 12, color: INK.navy, align: 'right' })
    y += lineHeight + 10
  } else {
    // Itemized table: numbers on the right; items with the same group get a subtotal.
    const cols = { item: [LETTER.left, 70], description: [70, 318], quantity: [318, 382], unit: [382, 462], total: [462, LETTER.right] }
    const header = () => {
      doc.save().rect(LETTER.left, y, width, 20).fill('#eaf0f7').restore()
      put(doc, 'Item', ...cols.item, y + 5.5, { font: f.calibriBold, size: 10, color: INK.navy, align: 'center' })
      put(doc, 'Descrição', ...cols.description, y + 5.5, { font: f.calibriBold, size: 10, color: INK.navy, pad: 6 })
      put(doc, 'Quantidade', ...cols.quantity, y + 5.5, { font: f.calibriBold, size: 10, color: INK.navy, align: 'right', pad: 6 })
      put(doc, 'Unitário', ...cols.unit, y + 5.5, { font: f.calibriBold, size: 10, color: INK.navy, align: 'right', pad: 6 })
      put(doc, 'Preço total', ...cols.total, y + 5.5, { font: f.calibriBold, size: 10, color: INK.navy, align: 'right', pad: 6 })
      y += 20
    }
    const row = (height) => { if (y + height > LETTER.bottom) { newPage(); header() } }
    header()
    const grouped = items.some((item) => String(item.group || '').trim())
    let currentGroup = null, groupTotal = 0
    const closeGroup = () => {
      if (!grouped || currentGroup === null || !currentGroup) return
      row(20)
      put(doc, `Subtotal – ${currentGroup}`, cols.description[0], cols.unit[1], y + 5, { font: f.calibriBold, size: 10, color: INK.muted, align: 'right', pad: 6 })
      put(doc, brl(groupTotal), ...cols.total, y + 5, { font: f.calibriBold, size: 10.5, color: INK.navy, align: 'right', pad: 6 })
      y += 19
      hLine(doc, LETTER.left, LETTER.right, y, 0.6, INK.line)
    }
    items.forEach((item, index) => {
      const group = String(item.group || '').trim()
      if (grouped && group !== currentGroup) {
        closeGroup()
        currentGroup = group; groupTotal = 0
        if (group) {
          row(40)
          doc.save().rect(LETTER.left, y + 2, width, 17).fill(INK.panel).restore()
          put(doc, group, LETTER.left, LETTER.right, y + 5.5, { font: f.calibriBold, size: 10.5, color: INK.navy, pad: 8 })
          y += 21
        }
      }
      const height = Math.max(18, heightOf(item.description, { size: 10.5, w: cols.description[1] - cols.description[0] - 12 }) + 8)
      row(height)
      put(doc, `3.${index + 1}`, ...cols.item, y + 4, { font: f.calibri, size: 10.5, color: INK.muted, align: 'center' })
      doc.font(f.calibri).fontSize(10.5).fillColor(INK.text).text(item.description, cols.description[0] + 6, y + 4, { width: cols.description[1] - cols.description[0] - 12, lineGap: 1 })
      put(doc, quantityText(item), ...cols.quantity, y + 4, { font: f.calibri, size: 10.5, color: INK.text, align: 'right', pad: 6 })
      put(doc, brl(item.unitPrice), ...cols.unit, y + 4, { font: f.calibri, size: 10.5, color: INK.text, align: 'right', pad: 6 })
      put(doc, brl(itemTotal(item)), ...cols.total, y + 4, { font: f.calibriBold, size: 10.5, color: INK.text, align: 'right', pad: 6 })
      y += height
      hLine(doc, LETTER.left, LETTER.right, y, 0.5, INK.line)
      groupTotal = round2(groupTotal + itemTotal(item))
    })
    closeGroup()
    y += 10
  }
  // Global price, right after the composition (the original "Preço Global" text is kept).
  const sentence = [['Pelo cumprimento do escopo, a GMAC deverá ser remunerada com', f.calibri], [` ${brl(total).replace(' ', ' ')}`, f.calibriBold], [' (', f.calibri], [moneyInWords(total), f.calibri], [').', f.calibri]]
  const sentenceWidth = 330
  const sentenceHeight = heightOf(sentence.map(([text]) => text).join(''), { size: 10.5, w: sentenceWidth })
  const totalBox = Math.max(48, sentenceHeight + 20)
  ensure(totalBox)
  doc.save().roundedRect(LETTER.left, y, width, totalBox, 6).fill('#eaf0f7').restore()
  doc.save().rect(LETTER.left, y, 4, totalBox).fill(INK.orange).restore()
  const textTop = y + (totalBox - sentenceHeight) / 2
  sentence.forEach(([text, font], index) => {
    doc.font(font).fontSize(10.5).fillColor(INK.text)
    if (index) doc.text(text, { continued: index < sentence.length - 1 })
    else doc.text(text, LETTER.left + 14, textTop, { width: sentenceWidth, lineGap: 1, continued: true })
  })
  doc.font(f.calibriBold).fontSize(8).fillColor(INK.muted).text('VALOR GLOBAL', 400, y + totalBox / 2 - 15, { width: LETTER.right - 412, align: 'right', characterSpacing: 0.8 })
  put(doc, brl(total), 380, LETTER.right - 12, y + totalBox / 2 - 4, { font: f.calibriBold, size: 18, color: INK.navy, align: 'right', pad: 0 })
  y += totalBox

  section('4. Prazos e condições', 70)
  const days = Number(document.validityDays) || 10
  const terms = [['Prazo de entrega', document.deliveryTerm || 'A combinar'], ['Pagamento', document.payment || 'A combinar'], ['Validade da proposta', `${days} (${integerInWords(days).toUpperCase()}) dias corridos a partir da data de emissão da proposta comercial.`]]
  const labelWidth = 150
  terms.forEach(([label, value], index) => {
    const height = Math.max(22, heightOf(value, { size: 10.5, w: width - labelWidth - 20 }) + 10)
    ensure(height)
    doc.save().rect(LETTER.left, y, labelWidth, height).fill(INK.panel).restore()
    if (!index) hLine(doc, LETTER.left, LETTER.right, y, 0.6, INK.line)
    put(doc, label, LETTER.left, LETTER.left + labelWidth, y + (height - 12) / 2, { font: f.calibriBold, size: 10.5, color: INK.navy, pad: 10 })
    doc.font(f.calibri).fontSize(10.5).fillColor(INK.text).text(value, LETTER.left + labelWidth + 10, y + 5, { width: width - labelWidth - 20, lineGap: 1 })
    y += height
    hLine(doc, LETTER.left, LETTER.right, y, 0.6, INK.line)
  })

  // "Importante": the general conditions as topics, then the closing with the technician and the contact.
  const important = (document.important || []).map((line) => String(line).replace(/^\s*-\s*/, '')).filter(Boolean)
  section('5. Importante', 60)
  doc.font(f.calibriBold).fontSize(10.5).fillColor(INK.navy).text('Condições gerais', LETTER.left, y, { lineBreak: false })
  y += 17
  for (const paragraph of important) {
    const parts = segments(paragraph, f)
    const height = heightOf(parts.map(([text]) => text).join(''), { size: 10.5, w: LETTER.right - 58, align: 'justify' })
    ensure(height)
    doc.font(f.calibri).fontSize(10.5).fillColor(INK.orange).text('•', 46, y, { lineBreak: false })
    rich(parts, { size: 10.5, x: 58, w: LETTER.right - 58, gap: 3, align: 'justify' })
  }
  y += 8
  ensure(70)
  hLine(doc, LETTER.left, LETTER.left + 120, y, 0.6, INK.orange)
  y += 9
  // Chosen in the proposal form (the issuer's technician by default); empty lines are left out.
  const technician = document.technician || { name: issuer.technician, registry: issuer.technicianRegistry, phone: issuer.technicianPhone }
  const technicianName = `${technician.name || ''} ${technician.name ? technician.registry || '' : ''}`.trim()
  if (technicianName) rich([['Técnico Responsável: ', f.calibri, INK.muted], [technicianName, f.calibriBold, INK.text]], { size: 10.5, gap: 2 })
  if (technician.phone) write(`Contato: ${technician.phone.replace(/\.$/, '')}.`, { size: 10.5, gap: 2 })
  write('Desse modo, nos colocamos à disposição para quaisquer eventuais dúvidas.', { size: 10.5, gap: 4 })
  write('Aguardamos pela decisão coerente e justa.', { font: f.calibriBold, size: 10.5, color: INK.navy })

  const range = doc.bufferedPageRange()
  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index)
    letterFooter(doc, f, document, index + 1, range.count)
  }
  return toBuffer(doc)
}

export function renderProposalDocument(document) {
  if (document.model === 'nestle') return renderNestle(document)
  if (document.model === 'etiqueta') return renderEtiqueta(document)
  return renderLetter(document)
}
